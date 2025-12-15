import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { User, UserDocument } from '../users/entities/user.entity';
import { Invoice, InvoiceStatus } from './entities/invoice.entity';
import { PayOSService } from '../transactions/payos.service';
import { CreatePayOSUrlDto } from '../transactions/dto/payos.dto';
import { TransactionsService } from '../transactions/transactions.service';
import { UserRole } from '../../common/enums/user.enum';
import { PaymentMethod } from '../../common/enums/payment-method.enum';
import { TransactionType } from '../../common/enums/transaction.enum';

import { EmailService } from '../email/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../../common/enums/notification-type.enum';

@Injectable()
export class BillingService {
    private readonly logger = new Logger(BillingService.name);
    private readonly MONTHLY_FEE = 50000; // 50,000 VND
    private readonly GRACE_PERIOD_DAYS = 7;

    constructor(
        @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
        @InjectModel(Invoice.name) private readonly invoiceModel: Model<Invoice>,
        private readonly payosService: PayOSService,
        private readonly transactionsService: TransactionsService,
        private readonly configService: ConfigService,
        private readonly emailService: EmailService,
        private readonly notificationsService: NotificationsService,
    ) { }

    /**
     * Cron Job: Generate invoices on the 1st of every month
     * Optimized: Batch operations, set grace period status
     */
    @Cron(CronExpression.EVERY_1ST_DAY_OF_MONTH_AT_MIDNIGHT)
    async generateMonthlyInvoices() {
        this.logger.log('Starting monthly invoice generation...');
        const today = new Date();
        const currentMonth = today.getMonth() + 1;
        const currentYear = today.getFullYear();
        const dueDate = new Date(today);
        dueDate.setDate(today.getDate() + this.GRACE_PERIOD_DAYS);

        // Find all FIELD_OWNERs (HOSTS) - optimized: only get IDs and email/name
        const hosts = await this.userModel.find(
            { role: UserRole.FIELD_OWNER },
            '_id email fullName'
        ).lean();

        if (hosts.length === 0) {
            this.logger.log('No field owners found');
            return;
        }

        // Batch check existing invoices to avoid N+1 queries
        const hostIds = hosts.map(h => h._id);
        const existingInvoices = await this.invoiceModel.find({
            user: { $in: hostIds },
            month: currentMonth,
            year: currentYear
        }, 'user').lean();

        const existingUserIds = new Set(
            existingInvoices.map(inv => inv.user.toString())
        );

        // Filter hosts without existing invoices
        const hostsToInvoice = hosts.filter(h => !existingUserIds.has(h._id.toString()));

        if (hostsToInvoice.length === 0) {
            this.logger.log('All field owners already have invoices for this month');
            return;
        }

        // Batch create invoices
        const invoicesToCreate = hostsToInvoice.map(host => ({
            user: host._id,
            amount: this.MONTHLY_FEE,
            status: InvoiceStatus.PENDING,
            month: currentMonth,
            year: currentYear,
            dueDate: dueDate
        }));

        const createdInvoices = await this.invoiceModel.insertMany(invoicesToCreate);

        // Batch update users: set grace_period status and gracePeriodEndDate
        const userIdsToUpdate = hostsToInvoice.map(h => h._id);
        await this.userModel.updateMany(
            { _id: { $in: userIdsToUpdate } },
            {
                $set: {
                    subscriptionStatus: 'grace_period',
                    gracePeriodEndDate: dueDate
                }
            }
        );

        // Send notifications (parallel, non-blocking)
        const notificationPromises = createdInvoices.map(async (invoice, index) => {
            const host = hostsToInvoice[index];
            try {
                // Email
                await this.emailService.sendInvoiceGenerated(
                    host.email,
                    host.fullName || 'Partner',
                    {
                        month: currentMonth,
                        year: currentYear,
                        amount: this.MONTHLY_FEE,
                        dueDate: dueDate
                    }
                );

                // In-app Notification
                await this.notificationsService.create({
                    recipient: host._id as Types.ObjectId,
                    type: NotificationType.INVOICE_GENERATED,
                    title: 'Hóa đơn tháng mới',
                    message: `Hóa đơn phí duy trì tháng ${currentMonth}/${currentYear} đã được tạo. Vui lòng thanh toán trước ${dueDate.toLocaleDateString('vi-VN')}.`,
                    metadata: { invoiceId: invoice._id }
                });
            } catch (error) {
                this.logger.error(`Failed to send invoice notification to ${host.email}`, error);
            }
        });

        await Promise.allSettled(notificationPromises);

        this.logger.log(`Generated ${createdInvoices.length} invoices for ${currentMonth}/${currentYear}`);
    }

    /**
     * Cron Job: Check for overdue invoices daily
     * Optimized: Batch operations
     */
    @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
    async checkOverdueInvoices() {
        this.logger.log('Checking for overdue invoices...');
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Find pending invoices where dueDate < today
        const overdueInvoices = await this.invoiceModel.find({
            status: InvoiceStatus.PENDING,
            dueDate: { $lt: today }
        }).populate('user', 'email fullName subscriptionStatus').lean();

        if (overdueInvoices.length === 0) {
            this.logger.log('No overdue invoices found');
            return;
        }

        // Batch update invoices to OVERDUE
        const invoiceIds = overdueInvoices.map(inv => inv._id);
        await this.invoiceModel.updateMany(
            { _id: { $in: invoiceIds } },
            { $set: { status: InvoiceStatus.OVERDUE } }
        );

        // Find users that need to be suspended (not already suspended)
        const usersToSuspend = overdueInvoices
            .filter(inv => {
                const user = inv.user as any;
                return user && user.subscriptionStatus !== 'suspended';
            })
            .map(inv => ({
                userId: (inv.user as any)._id,
                invoice: inv
            }));

        if (usersToSuspend.length > 0) {
            // Batch suspend users
            const userIdsToSuspend = usersToSuspend.map(u => u.userId);
            await this.userModel.updateMany(
                { _id: { $in: userIdsToSuspend } },
                { $set: { subscriptionStatus: 'suspended' } }
            );

            // Send suspension notifications (parallel)
            const notificationPromises = usersToSuspend.map(async ({ userId, invoice }) => {
                const user = invoice.user as any;
                try {
                    // Email
                    await this.emailService.sendSubscriptionSuspended(
                        user.email,
                        user.fullName || 'Partner',
                        `Hóa đơn tháng ${invoice.month}/${invoice.year} quá hạn`
                    );

                    // In-app Notification
                    await this.notificationsService.create({
                        recipient: userId as Types.ObjectId,
                        type: NotificationType.SUBSCRIPTION_SUSPENDED,
                        title: 'Tài khoản bị tạm khóa',
                        message: `Tài khoản của bạn đã bị tạm khóa do hóa đơn tháng ${invoice.month}/${invoice.year} quá hạn. Vui lòng thanh toán để mở khóa.`,
                        metadata: { invoiceId: invoice._id }
                    });
                } catch (error) {
                    this.logger.error(`Failed to send suspension notification to ${user.email}`, error);
                }
            });

            await Promise.allSettled(notificationPromises);
            this.logger.warn(`Suspended ${usersToSuspend.length} users due to overdue invoices`);
        }
    }

    /**
     * Cron Job: Send reminder notifications 3 days before due date
     */
    @Cron('0 9 * * *') // Every day at 9 AM
    async sendDueDateReminders() {
        this.logger.log('Checking for invoices due in 3 days...');
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const reminderDate = new Date(today);
        reminderDate.setDate(today.getDate() + 3);
        reminderDate.setHours(0, 0, 0, 0);
        const reminderDateEnd = new Date(reminderDate);
        reminderDateEnd.setHours(23, 59, 59, 999);

        // Find pending invoices due in exactly 3 days
        const invoicesDueSoon = await this.invoiceModel.find({
            status: InvoiceStatus.PENDING,
            dueDate: {
                $gte: reminderDate,
                $lte: reminderDateEnd
            }
        }).populate('user', 'email fullName').lean();

        if (invoicesDueSoon.length === 0) {
            return;
        }

        // Send reminders (parallel)
        const reminderPromises = invoicesDueSoon.map(async (invoice) => {
            const user = invoice.user as any;
            try {
                // Email reminder
                await this.emailService.sendInvoiceGenerated(
                    user.email,
                    user.fullName || 'Partner',
                    {
                        month: invoice.month,
                        year: invoice.year,
                        amount: invoice.amount,
                        dueDate: invoice.dueDate
                    }
                );

                // In-app Notification
                await this.notificationsService.create({
                    recipient: (invoice.user as any)._id as Types.ObjectId,
                    type: NotificationType.INVOICE_OVERDUE,
                    title: 'Nhắc nhở thanh toán',
                    message: `Hóa đơn tháng ${invoice.month}/${invoice.year} sẽ đến hạn trong 3 ngày. Vui lòng thanh toán trước ${new Date(invoice.dueDate).toLocaleDateString('vi-VN')}.`,
                    metadata: { invoiceId: invoice._id }
                });
            } catch (error) {
                this.logger.error(`Failed to send reminder to ${user.email}`, error);
            }
        });

        await Promise.allSettled(reminderPromises);
        this.logger.log(`Sent ${invoicesDueSoon.length} due date reminders`);
    }

    /**
     * Cron Job: Send notifications on due date
     */
    @Cron('0 9 * * *') // Every day at 9 AM (runs after reminder check)
    async sendDueDateNotifications() {
        this.logger.log('Checking for invoices due today...');
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const endOfDay = new Date(today);
        endOfDay.setHours(23, 59, 59, 999);

        // Find pending invoices due today
        const invoicesDueToday = await this.invoiceModel.find({
            status: InvoiceStatus.PENDING,
            dueDate: {
                $gte: today,
                $lte: endOfDay
            }
        }).populate('user', 'email fullName').lean();

        if (invoicesDueToday.length === 0) {
            return;
        }

        // Send due date notifications (parallel)
        const notificationPromises = invoicesDueToday.map(async (invoice) => {
            const user = invoice.user as any;
            try {
                // Email
                await this.emailService.sendInvoiceGenerated(
                    user.email,
                    user.fullName || 'Partner',
                    {
                        month: invoice.month,
                        year: invoice.year,
                        amount: invoice.amount,
                        dueDate: invoice.dueDate
                    }
                );

                // In-app Notification
                await this.notificationsService.create({
                    recipient: (invoice.user as any)._id as Types.ObjectId,
                    type: NotificationType.INVOICE_OVERDUE,
                    title: 'Hóa đơn đến hạn thanh toán',
                    message: `Hóa đơn tháng ${invoice.month}/${invoice.year} đến hạn thanh toán hôm nay. Vui lòng thanh toán ngay để tránh bị tạm khóa tài khoản.`,
                    metadata: { invoiceId: invoice._id }
                });
            } catch (error) {
                this.logger.error(`Failed to send due date notification to ${user.email}`, error);
            }
        });

        await Promise.allSettled(notificationPromises);
        this.logger.log(`Sent ${invoicesDueToday.length} due date notifications`);
    }

    /**
     * Create payment link for an invoice
     */
    async createPaymentLink(userId: string, invoiceId: string) {
        const invoice = await this.invoiceModel.findOne({ _id: invoiceId, user: userId });
        if (!invoice) {
            throw new NotFoundException('Invoice not found');
        }

        if (invoice.status === InvoiceStatus.PAID) {
            throw new BadRequestException('Invoice is already paid');
        }

        // Check for existing transaction or create new? 
        // Reuse PayOS service

        // We need to generate a unique order code for PayOS
        // If invoice already has one, reuse it? Or generate new one if expired?
        // For simplicity, let's generate a new order code every time they try to pay

        const orderCode = Number(Date.now().toString().slice(-10)); // Simple generation

        // Store orderCode in invoice to match later? 
        // Or better create a Transaction record.

        // Create a pending transaction
        const transaction = await this.transactionsService.createPayment({
            bookingId: undefined, // No booking
            userId: userId,
            amount: invoice.amount,
            method: PaymentMethod.PAYOS, // Or BANK_TRANSFER via PayOS
            externalTransactionId: orderCode.toString(),
            paymentNote: `Payment for Invoice #${invoice._id}`
        });

        // Link transaction to invoice
        transaction.invoice = invoice._id as Types.ObjectId;
        await transaction.save();

        // Create PayOS link
        const paymentDto: CreatePayOSUrlDto = {
            orderId: orderCode.toString(), // Required by DTO
            orderCode: orderCode,
            amount: invoice.amount,
            description: `SportZone Invoice ${invoice.month}/${invoice.year}`,
            items: [{ name: `Subscription ${invoice.month}/${invoice.year}`, quantity: 1, price: invoice.amount }],
            returnUrl: `${this.configService.get('APP_URL')}/billing/success`, // Frontend URL
            cancelUrl: `${this.configService.get('APP_URL')}/billing/cancel`
        };

        return this.payosService.createPaymentUrl(paymentDto);
    }

    /**
     * Get current billing status
     */
    async getCurrentStatus(userId: string) {
        const user = await this.userModel.findById(userId);
        const today = new Date();
        const currentMonth = today.getMonth() + 1;
        const currentYear = today.getFullYear();

        const currentInvoice = await this.invoiceModel.findOne({
            user: userId,
            month: currentMonth,
            year: currentYear
        });

        // Find latest invoice if current not found?

        if (!user) {
            throw new NotFoundException('User not found');
        }

        return {
            subscriptionStatus: user.subscriptionStatus,
            nextPaymentDate: user.nextPaymentDate,
            currentInvoice: currentInvoice
        };
    }

    /**
     * Get invoice history
     */
    async getHistory(userId: string) {
        return this.invoiceModel.find({ user: userId }).sort({ year: -1, month: -1 });
    }

    /**
     * Handle payment success event
     * Payload: { paymentId, transactionId (PayOS ref), amount, ... }
     * Optimized: Single query for user update
     */
    @OnEvent('payment.success')
    async handlePaymentSuccess(payload: any) {
        this.logger.log(`Handling payment success event: ${JSON.stringify(payload)}`);

        // Find transaction
        const transaction = await this.transactionsService.getTransactionById(payload.paymentId);

        if (!transaction) {
            this.logger.warn(`Transaction not found: ${payload.paymentId}`);
            return;
        }

        // Check if this transaction is linked to an invoice
        if (!transaction.invoice) {
            return; // Not an invoice payment
        }

        this.logger.log(`Processing invoice payment for transaction ${transaction._id}`);

        // Update Invoice and get user info in parallel
        const [invoice, user] = await Promise.all([
            this.invoiceModel.findById(transaction.invoice),
            this.invoiceModel.findById(transaction.invoice).populate('user', 'email fullName')
        ]);

        if (!invoice) {
            this.logger.warn(`Invoice not found: ${transaction.invoice}`);
            return;
        }

        // Update invoice
        invoice.status = InvoiceStatus.PAID;
        invoice.paidAt = new Date();
        invoice.payosOrderCode = Number(transaction.externalTransactionId);
        await invoice.save();

        // Calculate next payment date
        const invoiceMonth = invoice.month; // 1-12
        const invoiceYear = invoice.year;
        let nextMonth = invoiceMonth + 1;
        let nextYear = invoiceYear;
        if (nextMonth > 12) {
            nextMonth = 1;
            nextYear++;
        }
        const nextDue = new Date(nextYear, nextMonth - 1, 1);

        // Update user (single query)
        const updatedUser = await this.userModel.findByIdAndUpdate(
            invoice.user,
            {
                $set: {
                    subscriptionStatus: 'active',
                    lastPaymentDate: new Date(),
                    nextPaymentDate: nextDue
                },
                $unset: {
                    gracePeriodEndDate: ''
                }
            },
            { new: true }
        );

        if (updatedUser) {
            this.logger.log(`Updated user ${updatedUser._id} subscription status to active. Next due: ${nextDue}`);

            // Send Reactivation Notification
            try {
                const userData = invoice.user as any;
                // Email
                await this.emailService.sendSubscriptionReactivated(
                    userData.email || updatedUser.email,
                    userData.fullName || updatedUser.fullName || 'Partner'
                );

                // In-app Notification
                await this.notificationsService.create({
                    recipient: updatedUser._id as Types.ObjectId,
                    type: NotificationType.SUBSCRIPTION_REACTIVATED,
                    title: 'Tài khoản đã được mở khóa',
                    message: `Thanh toán thành công. Tài khoản của bạn đã hoạt động trở lại bình thường.`,
                    metadata: { invoiceId: invoice._id }
                });
            } catch (error) {
                this.logger.error(`Failed to send reactivation notification`, error);
            }
        }
    }

    /**
     * Admin: Get overdue accounts
     */
    async getOverdueAccounts(page: number = 1, limit: number = 10) {
        const skip = (page - 1) * limit;
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const [overdueInvoices, total] = await Promise.all([
            this.invoiceModel.find({
                status: { $in: [InvoiceStatus.PENDING, InvoiceStatus.OVERDUE] },
                dueDate: { $lt: today }
            })
                .populate('user', 'email fullName subscriptionStatus phone')
                .sort({ dueDate: 1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            this.invoiceModel.countDocuments({
                status: { $in: [InvoiceStatus.PENDING, InvoiceStatus.OVERDUE] },
                dueDate: { $lt: today }
            })
        ]);

        return {
            data: overdueInvoices.map(inv => ({
                invoiceId: inv._id,
                userId: (inv.user as any)._id,
                email: (inv.user as any).email,
                fullName: (inv.user as any).fullName,
                phone: (inv.user as any).phone,
                subscriptionStatus: (inv.user as any).subscriptionStatus,
                amount: inv.amount,
                month: inv.month,
                year: inv.year,
                dueDate: inv.dueDate,
                status: inv.status,
                daysOverdue: Math.floor((today.getTime() - new Date(inv.dueDate).getTime()) / (1000 * 60 * 60 * 24))
            })),
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        };
    }

    /**
     * Admin: Manually suspend a user
     */
    async suspendUser(userId: string, reason?: string) {
        const user = await this.userModel.findById(userId);
        if (!user) {
            throw new NotFoundException('User not found');
        }

        if (user.role !== UserRole.FIELD_OWNER) {
            throw new BadRequestException('Only field owners can be suspended via billing');
        }

        if (user.subscriptionStatus === 'suspended') {
            throw new BadRequestException('User is already suspended');
        }

        user.subscriptionStatus = 'suspended';
        await user.save();

        // Send notification
        try {
            await this.emailService.sendSubscriptionSuspended(
                user.email,
                user.fullName || 'Partner',
                reason || 'Tài khoản bị tạm khóa bởi quản trị viên'
            );

            await this.notificationsService.create({
                recipient: user._id as Types.ObjectId,
                type: NotificationType.SUBSCRIPTION_SUSPENDED,
                title: 'Tài khoản bị tạm khóa',
                message: reason || 'Tài khoản của bạn đã bị tạm khóa bởi quản trị viên.',
                metadata: { reason }
            });
        } catch (error) {
            this.logger.error(`Failed to send suspension notification`, error);
        }

        return user;
    }

    /**
     * Admin: Manually unsuspend a user
     */
    async unsuspendUser(userId: string) {
        const user = await this.userModel.findById(userId);
        if (!user) {
            throw new NotFoundException('User not found');
        }

        if (user.subscriptionStatus !== 'suspended') {
            throw new BadRequestException('User is not suspended');
        }

        user.subscriptionStatus = 'active';
        await user.save();

        // Send notification
        try {
            await this.emailService.sendSubscriptionReactivated(
                user.email,
                user.fullName || 'Partner'
            );

            await this.notificationsService.create({
                recipient: user._id as Types.ObjectId,
                type: NotificationType.SUBSCRIPTION_REACTIVATED,
                title: 'Tài khoản đã được mở khóa',
                message: 'Tài khoản của bạn đã được mở khóa bởi quản trị viên.',
                metadata: {}
            });
        } catch (error) {
            this.logger.error(`Failed to send reactivation notification`, error);
        }

        return user;
    }
}
