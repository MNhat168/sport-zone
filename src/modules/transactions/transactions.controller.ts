import { Controller, Get, Post, Body, Query, Param, Req, BadRequestException, NotFoundException, Delete, Patch, HttpCode, Res, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiParam, ApiBody, ApiBearerAuth } from '@nestjs/swagger';
import { TransactionsService } from './transactions.service';
import * as crypto from 'crypto';
import * as qs from 'qs';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuthGuard } from '@nestjs/passport';
import { TransactionStatus, TransactionType } from '@common/enums/transaction.enum';
import { BookingStatus } from '@common/enums/booking.enum';
import { PayOSService } from './payos.service';
import { CreateCoachVerificationDto } from './dto/coach-verification.dto';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CoachProfile } from '../coaches/entities/coach-profile.entity';
import {
    CreatePayOSUrlDto,
    PayOSCallbackDto,
    PayOSPaymentLinkResponseDto,
    PayOSTransactionQueryResponseDto,
    PayOSCancelResponseDto,
    CancelPayOSTransactionDto,
} from './dto/payos.dto';
import { Inject, forwardRef } from '@nestjs/common';
import { FieldOwnerService } from '../field-owner/field-owner.service';
import { Response } from 'express';
import { CleanupService } from '../../service/cleanup.service';
import { Transaction } from './entities/transaction.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { NotificationsGateway } from '../notifications/notifications.gateway';

@ApiTags('Transactions')
@Controller('transactions')
export class TransactionsController {

    constructor(
        private readonly transactionsService: TransactionsService,
        private readonly cleanupService: CleanupService,
        private readonly payosService: PayOSService,
        private readonly configService: ConfigService,
        private readonly eventEmitter: EventEmitter2,
        @Inject(forwardRef(() => FieldOwnerService))
        private readonly fieldOwnerService: FieldOwnerService,
        @InjectModel(CoachProfile.name) private readonly coachProfileModel: Model<CoachProfile>,
        @InjectModel(Transaction.name) private readonly transactionModel: Model<Transaction>,
        @InjectModel(Booking.name) private readonly bookingModel: Model<Booking>,
        private readonly notificationsGateway: NotificationsGateway,
    ) { }

    /**
     * Tạo transaction xác thực tài khoản ngân hàng cho coach (10k)
     */
    @Post('coach-verification')
    @UseGuards(AuthGuard('jwt'))
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Coach - tạo transaction xác thực tài khoản ngân hàng (10k)' })
    @ApiResponse({ status: 201, description: 'Tạo transaction thành công' })
    async createCoachVerification(
        @Req() req: Request & { user?: any },
        @Body() dto: CreateCoachVerificationDto,
    ) {
        const coachUserId = (req as any).user?.userId || (req as any).user?._id;
        if (!coachUserId) throw new BadRequestException('Missing user');

        const profile = await this.coachProfileModel.findOne({ user: new Types.ObjectId(coachUserId) }).lean();
        if (!profile) throw new NotFoundException('Coach profile not found');

        const tx = await this.transactionsService.createCoachBankVerificationTransaction({
            coachUserId: String(coachUserId),
            coachProfileId: String(profile._id),
            bankAccountNumber: dto.bankAccountNumber,
            bankName: dto.bankName,
            method: dto.method,
            amount: dto.amount,
        });

        // Trả về transactionId để FE gọi tạo link thanh toán
        return {
            transactionId: (tx._id as any).toString(),
            amount: tx.amount,
            method: tx.method,
            metadata: tx.metadata,
            note: 'Dùng transactionId này để tạo link thanh toán'
        };
    }











    /**
     * Get payment status by ID
     * Used for polling payment status during QR code payment
     */
    @Get(':paymentId/status')
    @ApiOperation({
        summary: 'Lấy trạng thái thanh toán',
        description: 'Get current payment status for polling during QR payment'
    })
    @ApiParam({ name: 'paymentId', description: 'Payment ID', example: '6904dd2a6289f3cf36b1dbe3' })
    @ApiResponse({
        status: 200,
        description: 'Payment status retrieved successfully',
        schema: {
            type: 'object',
            properties: {
                paymentId: { type: 'string' },
                status: { type: 'string', enum: ['pending', 'succeeded', 'failed', 'refunded'] },
                bookingId: { type: 'string' },
                amount: { type: 'number' },
                transactionId: { type: 'string' },
                createdAt: { type: 'string' },
                updatedAt: { type: 'string' }
            }
        }
    })
    @ApiResponse({ status: 404, description: 'Payment not found' })
    async getPaymentStatus(@Param('paymentId') paymentId: string) {
        const payment = await this.transactionsService.getPaymentById(paymentId);

        if (!payment) {
            throw new NotFoundException('Payment not found');
        }

        const booking = await this.bookingModel.findOne({ transaction: payment._id }).select('_id');

        return {
            paymentId: (payment._id as any).toString(),
            status: payment.status,
            bookingId: booking?._id?.toString() || null,
            amount: payment.amount,
            transactionId: payment.externalTransactionId || null,
            createdAt: payment.createdAt,
            updatedAt: payment.updatedAt
        };
    }

    /**
     * Cancel a payment manually
     * Used when user wants to cancel payment before it completes
     */
    @Delete(':paymentId/cancel')
    @ApiOperation({
        summary: 'Hủy thanh toán',
        description: 'Manually cancel a pending payment'
    })
    @ApiParam({ name: 'paymentId', description: 'Payment ID to cancel' })
    @ApiBody({
        schema: {
            type: 'object',
            properties: {
                reason: {
                    type: 'string',
                    description: 'Reason for cancellation',
                    example: 'User cancelled payment'
                }
            }
        }
    })
    @ApiResponse({
        status: 200,
        description: 'Payment cancelled successfully',
        schema: {
            type: 'object',
            properties: {
                success: { type: 'boolean' },
                message: { type: 'string' },
                paymentId: { type: 'string' }
            }
        }
    })
    @ApiResponse({ status: 404, description: 'Payment not found' })
    @ApiResponse({ status: 400, description: 'Payment cannot be cancelled' })
    async cancelPayment(
        @Param('paymentId') paymentId: string,
        @Body('reason') reason?: string
    ) {
        try {
            await this.cleanupService.cancelPaymentManually(
                paymentId,
                reason || 'User cancelled payment'
            );

            return {
                success: true,
                message: 'Payment cancelled successfully',
                paymentId
            };
        } catch (error) {
            if (error.message.includes('not found')) {
                throw new NotFoundException(error.message);
            }
            throw new BadRequestException(error.message);
        }
    }

    /**
     * Get remaining time for a payment
     * Used by frontend to show countdown timer
     */
    @Get(':paymentId/remaining-time')
    @ApiOperation({
        summary: 'Lấy thời gian còn lại của thanh toán',
        description: 'Get remaining time before payment expires'
    })
    @ApiParam({ name: 'paymentId', description: 'Payment ID' })
    @ApiResponse({
        status: 200,
        description: 'Remaining time retrieved',
        schema: {
            type: 'object',
            properties: {
                paymentId: { type: 'string' },
                remainingSeconds: { type: 'number', description: 'Seconds until expiration' },
                isExpiringSoon: { type: 'boolean', description: 'True if less than 2 minutes left' },
                expiresAt: { type: 'string', description: 'ISO timestamp of expiration' }
            }
        }
    })
    async getPaymentRemainingTime(@Param('paymentId') paymentId: string) {
        const remainingSeconds = await this.cleanupService.getPaymentRemainingTime(paymentId);
        const isExpiringSoon = await this.cleanupService.isPaymentExpiringSoon(paymentId);
        const expiresAt = await this.cleanupService.getEffectiveExpirationTime(paymentId);

        return {
            paymentId,
            remainingSeconds,
            isExpiringSoon,
            expiresAt: expiresAt?.toISOString() || null
        };
    }

    /**
     * Extend payment expiration time
     * Allows user to get more time to complete payment
     */
    @Patch(':paymentId/extend')
    @ApiOperation({
        summary: 'Gia hạn thời gian thanh toán',
        description: 'Extend payment expiration time by 5 minutes (max 2 extensions)'
    })
    @ApiParam({ name: 'paymentId', description: 'Payment ID to extend' })
    @ApiBody({
        schema: {
            type: 'object',
            properties: {
                additionalMinutes: {
                    type: 'number',
                    description: 'Additional minutes to add (default: 5)',
                    example: 5,
                    minimum: 1,
                    maximum: 10
                }
            }
        },
        required: false
    })
    @ApiResponse({
        status: 200,
        description: 'Payment time extended successfully',
        schema: {
            type: 'object',
            properties: {
                success: { type: 'boolean' },
                message: { type: 'string' },
                paymentId: { type: 'string' },
                additionalMinutes: { type: 'number' },
                newExpiresAt: { type: 'string' }
            }
        }
    })
    @ApiResponse({ status: 404, description: 'Payment not found' })
    @ApiResponse({ status: 400, description: 'Cannot extend payment (max extensions reached or not pending)' })
    async extendPaymentTime(
        @Param('paymentId') paymentId: string,
        @Body('additionalMinutes') additionalMinutes?: number
    ) {
        try {
            const minutes = additionalMinutes && additionalMinutes > 0 && additionalMinutes <= 10
                ? additionalMinutes
                : 5;

            await this.cleanupService.extendPaymentTime(paymentId, minutes);

            const newExpiresAt = await this.cleanupService.getEffectiveExpirationTime(paymentId);

            return {
                success: true,
                message: `Payment time extended by ${minutes} minutes`,
                paymentId,
                additionalMinutes: minutes,
                newExpiresAt: newExpiresAt?.toISOString() || null
            };
        } catch (error) {
            throw new BadRequestException(error.message);
        }
    }

    /**
     * Refund a payment
     * Process refund for a successful payment
     */
    @Post(':paymentId/refund')
    @ApiOperation({
        summary: 'Hoàn tiền thanh toán',
        description: 'Process refund for a successful payment. Can be full or partial refund.'
    })
    @ApiParam({ name: 'paymentId', description: 'Payment ID to refund' })
    @ApiBody({
        schema: {
            type: 'object',
            properties: {
                amount: {
                    type: 'number',
                    description: 'Refund amount (VND). If not provided, full refund.',
                    example: 200000,
                    minimum: 1
                },
                reason: {
                    type: 'string',
                    description: 'Reason for refund',
                    example: 'Customer request'
                },
                refundNote: {
                    type: 'string',
                    description: 'Additional notes for refund',
                    example: 'Refund processed by admin'
                }
            },
            required: ['reason']
        }
    })
    @ApiResponse({
        status: 200,
        description: 'Refund processed successfully',
        schema: {
            type: 'object',
            properties: {
                success: { type: 'boolean' },
                message: { type: 'string' },
                paymentId: { type: 'string' },
                refundAmount: { type: 'number' },
                originalAmount: { type: 'number' },
                transactionId: { type: 'string' },
                refundedAt: { type: 'string' }
            }
        }
    })
    @ApiResponse({ status: 404, description: 'Payment not found' })
    @ApiResponse({ status: 400, description: 'Payment cannot be refunded (not succeeded or already refunded)' })
    async refundPayment(
        @Param('paymentId') paymentId: string,
        @Body() body: { amount?: number; reason: string; refundNote?: string }
    ) {
        try {
            const result = await this.transactionsService.processRefund(
                paymentId,
                body.amount,
                body.reason,
                body.refundNote
            );

            // Emit refund event
            this.eventEmitter.emit('payment.refunded', {
                paymentId: result.paymentId,
                bookingId: result.bookingId,
                refundAmount: result.refundAmount,
                originalAmount: result.originalAmount,
                reason: body.reason,
                refundPaymentId: result.refundPaymentId,
            });

            return {
                success: true,
                message: 'Refund processed successfully',
                paymentId: result.paymentId,
                refundAmount: result.refundAmount,
                originalAmount: result.originalAmount,
                refundPaymentId: result.refundPaymentId,
                refundedAt: result.refundedAt
            };
        } catch (error) {
            if (error instanceof NotFoundException) {
                throw error;
            }
            throw new BadRequestException(error.message);
        }
    }

    /**
     * Get transaction history for a user
     * Returns detailed transaction records with PayOS data, refunds, etc.
     */
    @Get('transactions/history/:userId')
    @ApiOperation({
        summary: 'Lịch sử giao dịch chi tiết của user',
        description: 'Get detailed transaction history including PayOS data, refunds, and full audit trail'
    })
    @ApiParam({ name: 'userId', description: 'User ID' })
    @ApiQuery({
        name: 'type',
        description: 'Filter by transaction type',
        required: false,
        enum: ['payment', 'refund_full', 'refund_partial', 'reversal', 'adjustment']
    })
    @ApiQuery({
        name: 'status',
        description: 'Filter by transaction status',
        required: false,
        enum: ['pending', 'processing', 'succeeded', 'failed', 'cancelled', 'refunded']
    })
    @ApiQuery({
        name: 'startDate',
        description: 'Start date (ISO format)',
        required: false,
        example: '2025-01-01T00:00:00Z'
    })
    @ApiQuery({
        name: 'endDate',
        description: 'End date (ISO format)',
        required: false,
        example: '2025-12-31T23:59:59Z'
    })
    @ApiQuery({
        name: 'limit',
        description: 'Number of records to return',
        required: false,
        example: 20
    })
    @ApiQuery({
        name: 'offset',
        description: 'Number of records to skip',
        required: false,
        example: 0
    })
    @ApiResponse({
        status: 200,
        description: 'Transaction history retrieved successfully',
        schema: {
            type: 'object',
            properties: {
                transactions: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            _id: { type: 'string' },
                            payment: { type: 'object' },
                            booking: { type: 'object' },
                            userId: { type: 'string' },
                            type: { type: 'string' },
                            status: { type: 'string' },
                            amount: { type: 'number' },
                            method: { type: 'string' },

                            relatedTransaction: { type: 'string' },
                            refundReason: { type: 'string' },
                            createdAt: { type: 'string' },
                            completedAt: { type: 'string' }
                        }
                    }
                },
                total: { type: 'number' },
                limit: { type: 'number' },
                offset: { type: 'number' }
            }
        }
    })
    @ApiResponse({ status: 400, description: 'Invalid query parameters' })
    async getTransactionHistory(
        @Param('userId') userId: string,
        @Query('type') type?: string,
        @Query('status') status?: string,
        @Query('startDate') startDate?: string,
        @Query('endDate') endDate?: string,
        @Query('limit') limit?: number,
        @Query('offset') offset?: number
    ) {
        const limitNum = limit && limit > 0 ? Math.min(limit, 100) : 20;
        const offsetNum = offset && offset >= 0 ? offset : 0;

        const options: any = {
            limit: limitNum,
            skip: offsetNum
        };

        if (type) options.type = type;
        if (status) options.status = status;
        if (startDate) options.startDate = new Date(startDate);
        if (endDate) options.endDate = new Date(endDate);

        const result = await this.transactionsService.getTransactionHistory(
            userId,
            options
        );

        return result;
    }

    /**
     * Get transaction details by ID
     */
    @Get('transactions/:transactionId')
    @ApiOperation({
        summary: 'Chi tiết giao dịch',
        description: 'Get detailed information about a specific transaction'
    })
    @ApiParam({ name: 'transactionId', description: 'Transaction ID' })
    @ApiResponse({
        status: 200,
        description: 'Transaction details retrieved successfully'
    })
    @ApiResponse({ status: 404, description: 'Transaction not found' })
    async getTransactionById(@Param('transactionId') transactionId: string) {
        const transaction = await this.transactionsService.getTransactionById(transactionId);

        if (!transaction) {
            throw new NotFoundException('Transaction not found');
        }

        return transaction;
    }

    /**
     * Get transaction by booking ID
     */
    @Get('booking/:bookingId')
    @ApiOperation({
        summary: 'Lấy transaction theo booking ID',
        description: 'Get transaction by booking ID'
    })
    @ApiParam({ name: 'bookingId', description: 'Booking ID' })
    @ApiResponse({
        status: 200,
        description: 'Transaction retrieved successfully'
    })
    @ApiResponse({ status: 404, description: 'Transaction not found' })
    async getTransactionByBookingId(@Param('bookingId') bookingId: string) {
        const transaction = await this.transactionsService.getPaymentByBookingId(bookingId);

        if (!transaction) {
            throw new NotFoundException('Transaction not found for this booking');
        }

        return transaction;
    }

    /**
     * Get all transactions for a payment
     */
    @Get('transactions/payment/:paymentId')
    @ApiOperation({
        summary: 'Tất cả giao dịch của một payment',
        description: 'Get all transaction records related to a payment (including refunds)'
    })
    @ApiParam({ name: 'paymentId', description: 'Payment ID' })
    @ApiResponse({
        status: 200,
        description: 'Payment transactions retrieved successfully'
    })
    async getPaymentTransactions(@Param('paymentId') paymentId: string) {
        const transactions = await this.transactionsService.getPaymentTransactions(paymentId);

        return {
            paymentId,
            transactions,
            count: transactions.length
        };
    }

    /**
     * Get refund statistics for a payment
     */
    @Get('transactions/payment/:paymentId/refund-stats')
    @ApiOperation({
        summary: 'Thống kê refund của payment',
        description: 'Get refund statistics including total refunded and refund count'
    })
    @ApiParam({ name: 'paymentId', description: 'Payment ID' })
    @ApiResponse({
        status: 200,
        description: 'Refund stats retrieved successfully',
        schema: {
            type: 'object',
            properties: {
                paymentId: { type: 'string' },
                totalRefunded: { type: 'number' },
                refundCount: { type: 'number' },
                originalAmount: { type: 'number' },
                remainingAmount: { type: 'number' }
            }
        }
    })
    async getRefundStats(@Param('paymentId') paymentId: string) {
        const stats = await this.transactionsService.getRefundStats(paymentId);
        return stats;
    }

    /**
     * Get payment history with transactions
     * Retrieve complete payment history including all transactions and refunds
     */
    @Get('history/:userId')
    @ApiOperation({
        summary: 'Lịch sử thanh toán của user',
        description: 'Get complete payment history for a user including transactions and refunds'
    })
    @ApiParam({ name: 'userId', description: 'User ID' })
    @ApiQuery({
        name: 'status',
        description: 'Filter by payment status',
        required: false,
        enum: ['pending', 'succeeded', 'failed', 'refunded']
    })
    @ApiQuery({
        name: 'limit',
        description: 'Number of records to return',
        required: false,
        example: 10
    })
    @ApiQuery({
        name: 'offset',
        description: 'Number of records to skip',
        required: false,
        example: 0
    })
    @ApiResponse({
        status: 200,
        description: 'Payment history retrieved successfully',
        schema: {
            type: 'object',
            properties: {
                payments: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            paymentId: { type: 'string' },
                            bookingId: { type: 'string' },
                            amount: { type: 'number' },
                            status: { type: 'string' },
                            method: { type: 'string' },
                            transactionId: { type: 'string' },
                            createdAt: { type: 'string' },
                            refundedAt: { type: 'string' },
                            refundAmount: { type: 'number' }
                        }
                    }
                },
                total: { type: 'number' },
                limit: { type: 'number' },
                offset: { type: 'number' }
            }
        }
    })
    async getPaymentHistory(
        @Param('userId') userId: string,
        @Query('status') status?: TransactionStatus,
        @Query('limit') limit?: number,
        @Query('offset') offset?: number
    ) {
        const limitNum = limit && limit > 0 ? Math.min(limit, 100) : 10;
        const offsetNum = offset && offset >= 0 ? offset : 0;

        const result = await this.transactionsService.getPaymentHistory(
            userId,
            status,
            limitNum,
            offsetNum
        );

        return result;
    }

    // ============================================
    // PAYOS ENDPOINTS
    // ============================================

    /**
     * Create PayOS payment URL
     */
    @Post('payos/create-payment')
    @ApiOperation({
        summary: 'Tạo URL thanh toán PayOS',
        description: 'Create PayOS payment link for booking'
    })
    @ApiBody({ type: CreatePayOSUrlDto })
    @ApiResponse({ status: 201, description: 'Payment link created successfully', type: PayOSPaymentLinkResponseDto })
    @ApiResponse({ status: 400, description: 'Invalid request data' })
    async createPayOSPayment(@Body() dto: CreatePayOSUrlDto): Promise<PayOSPaymentLinkResponseDto> {
        console.log(`[Create PayOS Payment] Received orderId: ${dto.orderId}`);

        // CRITICAL: dto.orderId is the PAYMENT ID (transaction ID), not booking ID
        // Lookup transaction by payment ID to get externalTransactionId (PayOS orderCode)
        const transaction = await this.transactionsService.getPaymentById(dto.orderId);

        if (!transaction) {
            console.error(`[Create PayOS Payment] Transaction not found with ID: ${dto.orderId}`);
            throw new NotFoundException(`Transaction not found with ID: ${dto.orderId}`);
        }

        console.log(`[Create PayOS Payment] Found transaction by ID: ${(transaction._id as any).toString()}`);
        return this.createPaymentLinkWithTransaction(dto, transaction);
    }

    /**
     * Helper method to create PayOS payment link with transaction
     */
    private async createPaymentLinkWithTransaction(dto: CreatePayOSUrlDto, transaction: any): Promise<PayOSPaymentLinkResponseDto> {
        // If transaction has externalTransactionId, use it as PayOS orderCode
        // Otherwise, generate a new one (fallback for backward compatibility)
        let orderCodeToUse: number;

        if (transaction.externalTransactionId) {
            orderCodeToUse = Number(transaction.externalTransactionId);
            console.log(`[Create PayOS Payment] Using existing orderCode from transaction: ${orderCodeToUse}`);
        } else {
            // Fallback: generate new orderCode and update transaction
            const { generatePayOSOrderCode } = await import('./utils/payos.utils');
            orderCodeToUse = generatePayOSOrderCode();

            // Update transaction with new orderCode
            await this.transactionsService.updatePaymentStatusSafe(
                (transaction._id as any).toString(),
                transaction.status, // Keep current status
                undefined,
                { payosOrderCode: orderCodeToUse }
            );

            console.log(`[Create PayOS Payment] Generated new orderCode: ${orderCodeToUse}`);
        }

        // Create payment link with the orderCode
        // Pass orderCode to PayOSService so it uses the same orderCode
        const result = await this.payosService.createPaymentUrl({
            ...dto,
            orderCode: orderCodeToUse, // ✅ FIX: Pass orderCode from transaction
        });

        return result;
    }

    /**
     * PayOS Webhook Handler
     * Server-to-server callback from PayOS
     */
    @Post('payos/webhook')
    @HttpCode(200)
    @ApiOperation({
        summary: 'PayOS Webhook (Internal)',
        description: 'Server-to-server webhook from PayOS. Must be configured in PayOS portal.'
    })
    @ApiResponse({ status: 200, description: 'Webhook processed' })
    async handlePayOSWebhook(@Body() body: any, @Req() req: Request) {
        try {
            console.log('[PayOS Webhook] Received webhook');

            // PayOS sends: { "data": {...}, "signature": "..." }
            const receivedSignature = body.signature;
            const webhookData = body.data;

            if (!receivedSignature) {
                console.warn('[PayOS Webhook] Missing signature');
                return {
                    code: '97',
                    desc: 'Missing signature',
                };
            }

            if (!webhookData) {
                console.warn('[PayOS Webhook] Missing data');
                return {
                    code: '99',
                    desc: 'Invalid webhook data',
                };
            }


            // Verify signature
            // Use webhookData directly as PayOS signs all fields in data object
            const verificationResult = this.payosService.verifyCallback(webhookData, receivedSignature);

            if (!verificationResult.isValid) {
                console.warn(`[PayOS Webhook] Invalid signature for order ${webhookData.orderCode}`);
                return {
                    code: '97',
                    desc: 'Invalid signature',
                };
            }

            console.log(`[PayOS Webhook] Signature verified for order ${webhookData.orderCode}, status: ${webhookData.status}`);

            // Check if this is a bank account verification payment
            // Payment creation uses prefix 'BANKACCVERIFY' (no underscore - PayOS strips special chars)
            const isVerificationPayment = webhookData.description?.startsWith('BANKACCVERIFY');

            if (isVerificationPayment) {
                console.log(`[PayOS Webhook] Detected bank account verification payment for orderCode: ${webhookData.orderCode}`);
                console.log(`[PayOS Webhook] Webhook status: ${webhookData.status}`);
                console.log(`[PayOS Webhook] Counter account number: ${webhookData.counterAccountNumber || webhookData.accountNumber || 'NOT PROVIDED'}`);
                console.log(`[PayOS Webhook] Counter account name: ${webhookData.counterAccountName || 'NOT PROVIDED'}`);

                // Extract bankAccountId from description if available (future extension)
                // Example format: "BANK_ACC_VERIFY - {accountNumber} - {bankAccountId}"
                let bankAccountId: string | null = null;
                if (webhookData.description) {
                    const parts = webhookData.description.split(' - ');
                    if (parts.length >= 3) {
                        bankAccountId = parts[2];
                    }
                }

                // Process verification webhook (update BankAccount AND Transaction)
                try {
                    await this.fieldOwnerService.processVerificationWebhook(
                        webhookData.orderCode,
                        {
                            counterAccountNumber: webhookData.counterAccountNumber || webhookData.accountNumber,
                            counterAccountName: webhookData.counterAccountName,
                            amount: webhookData.amount,
                            status: webhookData.status || 'PAID',
                            reference: webhookData.reference,
                            transactionDateTime: webhookData.transactionDateTime,
                        },
                    );
                    console.log(`[PayOS Webhook] Bank account verification processed for orderCode: ${webhookData.orderCode}`);

                    // CRITICAL: Return success immediately for verification payments
                    // Do NOT proceed to booking-related logic below
                    return {
                        code: '00',
                        desc: 'Verification payment processed successfully',
                    };
                } catch (verificationError) {
                    console.error(`[PayOS Webhook] Error processing bank account verification:`, verificationError);

                    // Return error to PayOS so it retries later
                    // This gives the BankAccount record time to be saved if it's a timing issue
                    return {
                        code: '99',
                        desc: `Verification processing failed: ${verificationError.message}`,
                    };
                }
            } else {
                console.log(`[PayOS Webhook] Not a verification payment (description: "${webhookData.description}")`);
            }

            // Find transaction by externalTransactionId (PayOS order code)
            const transaction = await this.transactionsService.getPaymentByExternalId(
                String(webhookData.orderCode)
            );

            if (!transaction) {
                // For verification payments, it's OK if transaction doesn't exist
                if (isVerificationPayment) {
                    console.log(`[PayOS Webhook] Verification payment processed (no transaction record needed)`);
                    return {
                        code: '00',
                        desc: 'Verification payment processed',
                    };
                }

                console.warn(`[PayOS Webhook] Transaction not found for orderCode: ${webhookData.orderCode}`);
                return {
                    code: '01',
                    desc: 'Transaction not found',
                };
            }

            // Check if already processed
            if (transaction.status === TransactionStatus.SUCCEEDED || transaction.status === TransactionStatus.FAILED) {
                console.log(`[PayOS Webhook] Transaction already processed: ${transaction.status}`);
                return {
                    code: '02',
                    desc: 'Transaction already processed',
                };
            }

            // Determine status from PayOS
            const payosStatus = webhookData.status || 'PAID';
            let newStatus: TransactionStatus;

            if (payosStatus === 'PAID') {
                newStatus = TransactionStatus.SUCCEEDED;
            } else if (payosStatus === 'CANCELLED' || payosStatus === 'EXPIRED') {
                newStatus = TransactionStatus.FAILED;
            } else {
                newStatus = TransactionStatus.PROCESSING;
            }

            // Update transaction
            const updated = await this.transactionsService.updatePaymentStatusSafe(
                (transaction._id as any).toString(),
                newStatus,
                undefined,
                {
                    payosOrderCode: webhookData.orderCode,
                    payosReference: webhookData.reference,
                    payosAccountNumber: webhookData.accountNumber,
                    payosTransactionDateTime: webhookData.transactionDateTime,
                }
            );

            // Extract tournamentId from transaction metadata if present
            const tournamentId = updated.metadata?.tournamentId
                ? String(updated.metadata.tournamentId)
                : undefined;

            // Emit payment.failed event if transaction was cancelled or expired
            // This triggers cleanup (cancel booking and release slots) via CleanupService
            if (newStatus === TransactionStatus.FAILED) {
                // ✅ OPTIMIZED: Use centralized helper method to extract bookingId
                const bookingIdStr = await this.transactionsService.extractBookingIdFromTransaction(updated);
                if (bookingIdStr) {
                    console.log(`[PayOS Webhook] Found bookingId ${bookingIdStr} from transaction (failed payment)`);
                }

                const userIdStr = updated.user
                    ? (typeof updated.user === 'string'
                        ? updated.user
                        : (updated.user as any)?._id
                            ? String((updated.user as any)._id)
                            : String(updated.user))
                    : undefined;

                const reason = payosStatus === 'CANCELLED'
                    ? 'PayOS transaction cancelled'
                    : 'PayOS transaction expired';

                this.eventEmitter.emit('payment.failed', {
                    paymentId: String(updated._id),
                    bookingId: bookingIdStr,
                    tournamentId: tournamentId, // Include tournamentId if present
                    userId: userIdStr,
                    amount: updated.amount,
                    method: updated.method,
                    transactionId: webhookData.reference || String(webhookData.orderCode),
                    reason,
                });

                console.log(`[PayOS Webhook] Payment failed (${payosStatus}), emitted payment.failed event`);
                if (tournamentId) {
                    console.log(`[PayOS Webhook] Tournament ID included in failed event: ${tournamentId}`);
                }
            }

            // CRITICAL: Verify transaction was actually updated to SUCCEEDED before emitting event
            // This ensures transaction status is committed before booking is updated
            if (newStatus === TransactionStatus.SUCCEEDED) {
                // Double-check transaction status to ensure it's actually succeeded
                const verifiedTransaction = await this.transactionsService.getPaymentById(
                    (updated._id as any).toString()
                );

                if (!verifiedTransaction) {
                    console.error(`[PayOS Webhook] Transaction ${updated._id} not found after update`);
                    return {
                        code: '99',
                        desc: 'Transaction verification failed',
                    };
                }

                if (verifiedTransaction.status !== TransactionStatus.SUCCEEDED) {
                    console.error(
                        `[PayOS Webhook] Transaction ${updated._id} status mismatch: ` +
                        `expected SUCCEEDED, got ${verifiedTransaction.status}`
                    );
                    return {
                        code: '99',
                        desc: 'Transaction status verification failed',
                    };
                }

                console.log(`[PayOS Webhook] Transaction ${updated._id} verified as SUCCEEDED, emitting event`);

                // Extract tournamentId from verified transaction metadata
                const verifiedTournamentId = verifiedTransaction.metadata?.tournamentId
                    ? String(verifiedTransaction.metadata.tournamentId)
                    : tournamentId; // Fallback to previously extracted tournamentId

                // CRITICAL: Do NOT emit payment.success for verification payments
                // Check if this is a verification transaction (bank account or coach bank account)
                const isVerificationTx = verifiedTransaction.metadata?.verificationType &&
                    (verifiedTransaction.metadata.verificationType === 'BANK_ACCOUNT_VERIFICATION' ||
                        verifiedTransaction.metadata.verificationType === 'COACH_BANK_ACCOUNT_VERIFICATION');

                if (isVerificationTx) {
                    console.log(`[PayOS Webhook] Skipping payment.success emission for verification transaction ${updated._id}`);
                    console.log(`[PayOS Webhook] Verification transaction updated successfully`);
                    return {
                        code: '00',
                        desc: 'Verification transaction updated successfully',
                    };
                }

                // ✅ OPTIMIZED: Use centralized helper method to extract bookingId
                const bookingIdStr = await this.transactionsService.extractBookingIdFromTransaction(verifiedTransaction);
                if (bookingIdStr) {
                    console.log(`[PayOS Webhook] Found bookingId ${bookingIdStr} from transaction`);
                } else {
                    console.warn(`[PayOS Webhook] No bookingId found for transaction ${verifiedTransaction._id}`);
                }

                const userIdStr = updated.user
                    ? (typeof updated.user === 'string'
                        ? updated.user
                        : (updated.user as any)?._id
                            ? String((updated.user as any)._id)
                            : String(updated.user))
                    : undefined;

                // Only emit event after transaction is verified as SUCCEEDED
                // Include tournamentId in event payload if present
                console.log(`[PayOS Webhook] 🔔 Emitting payment.success event for transaction ${updated._id} (Booking: ${bookingIdStr})`);
                this.eventEmitter.emit('payment.success', {
                    paymentId: String(updated._id),
                    bookingId: bookingIdStr,
                    tournamentId: verifiedTournamentId, // ✅ Include tournamentId from metadata
                    userId: userIdStr,
                    amount: updated.amount,
                    method: updated.method,
                    transactionId: webhookData.reference,
                });

                if (verifiedTournamentId) {
                    console.log(`[PayOS Webhook] Tournament ID included in success event: ${verifiedTournamentId}`);
                } else {
                    console.log(`[PayOS Webhook] No tournament ID found in transaction metadata`);
                }

                // Successfully emitted payment.success event
                // This will be handled by NotificationListener to create a persistent notification
                // and by PaymentHandlerService to confirm the booking.

                // ✅ CRITICAL FIX 5: Direct booking update fallback (last resort)
                // Wait a bit for event handler to process, then verify booking was updated
                if (bookingIdStr && Types.ObjectId.isValid(bookingIdStr)) {
                    setTimeout(async () => {
                        try {
                            const booking = await this.bookingModel.findById(bookingIdStr).exec();
                            if (booking && (booking.status !== BookingStatus.CONFIRMED || booking.paymentStatus !== 'paid')) {
                                console.warn(`[PayOS Webhook] ⚠️ Booking ${bookingIdStr} not updated after 200ms, attempting direct update`);
                                
                                // Direct update as last resort
                                booking.paymentStatus = 'paid';
                                if (booking.type !== 'coach') {
                                    booking.status = BookingStatus.CONFIRMED;
                                }
                                await booking.save();
                                
                                console.log(`[PayOS Webhook] ✅ Directly updated booking ${bookingIdStr} as fallback`);
                                
                                // Emit booking.confirmed event
                                this.eventEmitter.emit('booking.confirmed', {
                                    bookingId: bookingIdStr,
                                    userId: userIdStr,
                                    fieldId: booking.field?.toString() || null,
                                    courtId: booking.court?.toString() || null,
                                    date: booking.date,
                                });
                            } else if (booking) {
                                console.log(`[PayOS Webhook] ✅ Booking ${bookingIdStr} already updated by event handler`);
                            }
                        } catch (fallbackError) {
                            console.error(`[PayOS Webhook] ❌ Error in fallback booking update: ${fallbackError.message}`);
                        }
                    }, 200); // Wait 200ms for event handler
                }
            }

            console.log(`[PayOS Webhook] Transaction updated: ${newStatus}`);

            return {
                code: '00',
                desc: 'Success',
            };
        } catch (error) {
            console.error(`[PayOS Webhook] Error: ${error.message}`);
            return {
                code: '99',
                desc: 'System error',
            };
        }
    }

    /**
     * PayOS Return URL Handler
     * Called when user returns from PayOS payment page
     * ✅ ENHANCED: Updates transaction status and emits payment events with idempotency check
     */
    @Get('payos/return')
    @ApiOperation({
        summary: 'PayOS Return URL',
        description: 'Handle return from PayOS payment page. Updates transaction status and triggers booking confirmation.'
    })
    @ApiQuery({ name: 'orderCode', description: 'PayOS order code', required: false })
    @ApiQuery({ name: 'status', description: 'Payment status', required: false })
    @ApiResponse({ status: 200, description: 'Payment verification result' })
    async handlePayOSReturn(@Query() query: any) {
        try {
            const orderCode = query.orderCode ? Number(query.orderCode) : null;
            const status = query.status;

            if (!orderCode) {
                return {
                    success: false,
                    paymentStatus: 'failed',
                    bookingId: '',
                    message: 'Missing order code',
                    amount: 0,
                };
            }

            console.log(`[PayOS Return] Processing return for orderCode: ${orderCode}`);

            // Query transaction from PayOS
            const payosTransaction = await this.payosService.queryTransaction(orderCode);

            // Find local transaction
            const transaction = await this.transactionsService.getPaymentByExternalId(String(orderCode));

            if (!transaction) {
                console.warn(`[PayOS Return] Transaction not found for orderCode: ${orderCode}`);
                return {
                    success: false,
                    paymentStatus: 'failed',
                    bookingId: '',
                    message: 'Transaction not found',
                    reason: 'Transaction not found in system',
                    amount: payosTransaction.amount,
                };
            }

            // Map PayOS status to our TransactionStatus enum
            let newStatus: TransactionStatus;
            let paymentStatus: 'succeeded' | 'failed' | 'pending' | 'cancelled';
            let shouldEmitFailedEvent = false;
            let shouldEmitSuccessEvent = false;

            if (payosTransaction.status === 'PAID') {
                newStatus = TransactionStatus.SUCCEEDED;
                paymentStatus = 'succeeded';
                shouldEmitSuccessEvent = true;
            } else if (payosTransaction.status === 'CANCELLED') {
                newStatus = TransactionStatus.CANCELLED;
                paymentStatus = 'cancelled';
                shouldEmitFailedEvent = true;
            } else if (payosTransaction.status === 'EXPIRED') {
                newStatus = TransactionStatus.FAILED;
                paymentStatus = 'failed';
                shouldEmitFailedEvent = true;
            } else if (payosTransaction.status === 'PENDING' || payosTransaction.status === 'PROCESSING') {
                newStatus = TransactionStatus.PROCESSING;
                paymentStatus = 'pending';
            } else {
                newStatus = TransactionStatus.FAILED;
                paymentStatus = 'failed';
                shouldEmitFailedEvent = true;
            }

            console.log(`[PayOS Return] Current transaction status: ${transaction.status}, New status: ${newStatus}`);

            // ✅ ENHANCED IDEMPOTENCY CHECK: Only update if status has actually changed
            let updated = transaction;
            if (transaction.status !== newStatus) {
                console.log(`[PayOS Return] Status changed from ${transaction.status} to ${newStatus}. Updating...`);

                // Update transaction status with atomic $set operation
                updated = await this.transactionsService.updatePaymentStatusSafe(
                    (transaction._id as any).toString(),
                    newStatus,
                    undefined,
                    {
                        payosOrderCode: payosTransaction.orderCode,
                        payosReference: payosTransaction.reference,
                        payosAccountNumber: payosTransaction.accountNumber,
                        payosTransactionDateTime: payosTransaction.transactionDateTime,
                    }
                );

                // ✅ CHECK FOR BANK VERIFICATION: Process bank account verification if this is a verification payment
                const isVerificationPayment = updated.metadata?.verificationType &&
                    (updated.metadata.verificationType === 'BANK_ACCOUNT_VERIFICATION' ||
                        updated.metadata.verificationType === 'COACH_BANK_ACCOUNT_VERIFICATION');

                if (isVerificationPayment && payosTransaction.status === 'PAID') {
                    console.log(`[PayOS Return] 🔍 Detected bank account verification payment for orderCode: ${orderCode}`);
                    try {
                        await this.fieldOwnerService.processVerificationWebhook(
                            orderCode,
                            {
                                counterAccountNumber: payosTransaction.accountNumber,
                                counterAccountName: undefined, // PayOS doesn't provide this in query response
                                amount: payosTransaction.amount,
                                status: 'PAID',
                                reference: payosTransaction.reference,
                                transactionDateTime: payosTransaction.transactionDateTime,
                            },
                        );
                        console.log(`[PayOS Return] ✅ Bank account verification processed for orderCode: ${orderCode}`);
                    } catch (verificationError) {
                        console.error(`[PayOS Return] ❌ Error processing bank account verification:`, verificationError);
                    }
                }

                // ✅ ENHANCED IDEMPOTENCY CHECK: Only update if status has actually changed
                if (shouldEmitFailedEvent) {
                    // ✅ OPTIMIZED: Use centralized helper method to extract bookingId
                    const bookingIdStr = await this.transactionsService.extractBookingIdFromTransaction(updated);

                    const userIdStr = updated.user
                        ? (typeof updated.user === 'string'
                            ? updated.user
                            : (updated.user as any)?._id
                                ? String((updated.user as any)._id)
                                : String(updated.user))
                        : undefined;

                    // ✅ Extract tournamentId from transaction metadata
                    const tournamentId = updated.metadata?.tournamentId
                        ? String(updated.metadata.tournamentId)
                        : undefined;

                    const reason = payosTransaction.status === 'CANCELLED'
                        ? 'PayOS transaction cancelled'
                        : 'PayOS transaction expired or failed';

                    this.eventEmitter.emit('payment.failed', {
                        paymentId: String(updated._id),
                        bookingId: bookingIdStr,
                        tournamentId: tournamentId, // ✅ Include tournamentId
                        userId: userIdStr,
                        amount: updated.amount,
                        method: updated.method,
                        transactionId: payosTransaction.reference || String(payosTransaction.orderCode),
                        reason,
                    });

                    console.log(`[PayOS Return] ❌ Payment failed (${payosTransaction.status}), emitted payment.failed event`);
                    if (tournamentId) {
                        console.log(`[PayOS Return] Tournament ID included in failed event: ${tournamentId}`);
                    }
                }

                // ✅ CRITICAL: Emit payment.success event if payment succeeded
                if (shouldEmitSuccessEvent) {
                    console.log(`[PayOS Return] ✅ Transaction ${updated._id} succeeded, emitting payment.success event`);

                    // ✅ OPTIMIZED: Use centralized helper method to extract bookingId
                    const bookingIdStr = await this.transactionsService.extractBookingIdFromTransaction(updated);
                    if (bookingIdStr) {
                        console.log(`[PayOS Return] Found bookingId ${bookingIdStr} from transaction`);
                    }

                    const userIdStr = updated.user
                        ? (typeof updated.user === 'string'
                            ? updated.user
                            : (updated.user as any)?._id
                                ? String((updated.user as any)._id)
                                : String(updated.user))
                        : undefined;

                    // ✅ Extract tournamentId from transaction metadata (for tournament payments and cancellation fees)
                    const tournamentId = updated.metadata?.tournamentId
                        ? String(updated.metadata.tournamentId)
                        : undefined;

                    // Emit payment.success event to trigger booking confirmation
                    this.eventEmitter.emit('payment.success', {
                        paymentId: String(updated._id),
                        bookingId: bookingIdStr,
                        tournamentId: tournamentId, // ✅ Include tournamentId for tournament-related payments
                        userId: userIdStr,
                        amount: updated.amount,
                        method: updated.method,
                        transactionId: payosTransaction.reference,
                    });

                    console.log(`[PayOS Return] ✅ Payment success event emitted for booking ${bookingIdStr}`);
                    if (tournamentId) {
                        console.log(`[PayOS Return] ✅ Tournament ID included in event: ${tournamentId}`);
                    }
                }
            } else {
                console.log(`[PayOS Return] ℹ️ Transaction ${transaction._id} is already ${transaction.status}. Skipping update to prevent race condition.`);

                // Force emit success event if transaction is SUCCEEDED
                // This handles cases where webhook processed the transaction but the booking handler failed or missed the event
                if (transaction.status === TransactionStatus.SUCCEEDED && shouldEmitSuccessEvent) {
                    console.log(`[PayOS Return] ℹ️ Force emitting payment.success for already succeeded transaction ${transaction._id}`);
                    const bookingDoc = await this.bookingModel.findOne({ transaction: updated._id }).select('_id');
                    const bookingIdStr = bookingDoc?._id?.toString();

                    const userIdStr = updated.user
                        ? (typeof updated.user === 'string'
                            ? updated.user
                            : (updated.user as any)?._id
                                ? String((updated.user as any)._id)
                                : String(updated.user))
                        : undefined;

                    console.log(`[PayOS Return] 🔔 Force emitting payment.success event for transaction ${updated._id}`);
                    this.eventEmitter.emit('payment.success', {
                        paymentId: String(updated._id),
                        bookingId: bookingIdStr,
                        userId: userIdStr,
                        amount: updated.amount,
                        method: updated.method,
                        transactionId: payosTransaction.reference,
                    });
                }
            }

            const bookingDoc = await this.bookingModel.findOne({ transaction: updated._id }).select('_id');
            const bookingId = bookingDoc?._id?.toString() || '';

            return {
                success: paymentStatus === 'succeeded',
                paymentStatus,
                bookingId,
                message: paymentStatus === 'succeeded' ? 'Payment successful' : 'Payment failed',
                orderCode: payosTransaction.orderCode,
                reference: payosTransaction.reference,
                amount: payosTransaction.amount,
            };
        } catch (error) {
            console.error('[PayOS Return] Error:', error);
            return {
                success: false,
                paymentStatus: 'failed',
                bookingId: '',
                message: 'Error verifying payment',
                reason: error.message,
                amount: 0,
            };
        }
    }

    /**
     * Query PayOS Transaction Status
     */
    @Get('payos/query/:orderCode')
    @ApiOperation({
        summary: 'Query PayOS transaction status',
        description: 'Query transaction status directly from PayOS API'
    })
    @ApiParam({ name: 'orderCode', description: 'PayOS order code', example: '123456789' })
    @ApiResponse({ status: 200, description: 'Transaction query result', type: PayOSTransactionQueryResponseDto })
    @ApiResponse({ status: 400, description: 'Invalid order code or transaction not found' })
    async queryPayOSTransaction(@Param('orderCode') orderCode: string): Promise<PayOSTransactionQueryResponseDto> {
        const orderCodeNum = Number(orderCode);
        if (isNaN(orderCodeNum)) {
            throw new BadRequestException('Invalid order code format');
        }
        return await this.payosService.queryTransaction(orderCodeNum);
    }

    /**
     * Cancel PayOS Transaction
     */
    @Post('payos/cancel/:orderCode')
    @ApiOperation({
        summary: 'Cancel PayOS transaction',
        description: 'Cancel a PayOS payment transaction'
    })
    @ApiParam({ name: 'orderCode', description: 'PayOS order code', example: '123456789' })
    @ApiBody({ type: CancelPayOSTransactionDto, required: false })
    @ApiResponse({ status: 200, description: 'Transaction cancelled successfully', type: PayOSCancelResponseDto })
    @ApiResponse({ status: 400, description: 'Cannot cancel transaction' })
    async cancelPayOSTransaction(
        @Param('orderCode') orderCode: string,
        @Body() dto?: CancelPayOSTransactionDto
    ): Promise<PayOSCancelResponseDto> {
        const orderCodeNum = Number(orderCode);
        if (isNaN(orderCodeNum)) {
            throw new BadRequestException('Invalid order code format');
        }
        return await this.payosService.cancelTransaction(orderCodeNum, dto?.cancellationReason);
    }

    /**
* Tournament-specific PayOS return URL
* Handles return from tournament payment and redirects to tournament page
* ✅ ENHANCED: Added idempotency check to prevent race conditions with webhook
*/
    @Get('payos/tournament-return/:tournamentId')
    @ApiOperation({
        summary: 'Tournament PayOS Return URL',
        description: 'Handle return from tournament payment and redirect to tournament page with status'
    })
    @ApiParam({ name: 'tournamentId', description: 'Tournament ID' })
    @ApiQuery({ name: 'orderCode', description: 'PayOS order code', required: false })
    @ApiQuery({ name: 'status', description: 'Payment status', required: false })
    async handleTournamentPaymentReturn(
        @Param('tournamentId') tournamentId: string,
        @Query() query: any,
        @Res() res: Response
    ) {
        try {
            const orderCode = query.orderCode ? Number(query.orderCode) : null;
            const status = query.status;

            // Get frontend URL from config
            const frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:5173';

            if (!orderCode) {
                // Redirect to tournament page with error
                return res.redirect(`${frontendUrl}/tournaments/${tournamentId}?payment=error&reason=missing_order_code`);
            }

            console.log(`[Tournament Payment Return] Processing return for orderCode: ${orderCode}, tournament: ${tournamentId}`);

            // Query transaction from PayOS
            const payosTransaction = await this.payosService.queryTransaction(orderCode);

            // Find local transaction
            const transaction = await this.transactionsService.getPaymentByExternalId(String(orderCode));

            if (!transaction) {
                console.log(`[Tournament Return URL] Transaction not found for orderCode ${orderCode}`);
                return res.redirect(`${this.configService.get('FRONTEND_URL')}/tournament/${tournamentId}?payment=error&reason=transaction_not_found`);
            }

            // Map PayOS status to our TransactionStatus enum
            let newStatus: TransactionStatus;
            let paymentStatus: 'succeeded' | 'failed' | 'pending' | 'cancelled';
            let shouldEmitEvent = false;

            switch (payosTransaction.status) {
                case 'PAID':
                    newStatus = TransactionStatus.SUCCEEDED;
                    paymentStatus = 'succeeded';
                    shouldEmitEvent = true;
                    break;
                case 'PENDING':
                    newStatus = TransactionStatus.PENDING;
                    paymentStatus = 'pending';
                    break;
                case 'PROCESSING':
                    newStatus = TransactionStatus.PROCESSING;
                    paymentStatus = 'pending';
                    break;
                case 'CANCELLED':
                    newStatus = TransactionStatus.CANCELLED;
                    paymentStatus = 'cancelled';
                    break;
                default:
                    newStatus = TransactionStatus.FAILED;
                    paymentStatus = 'failed';
                    break;
            }

            // ✅ Update transaction status if not already finalized
            // updatePaymentStatus now preserves existing metadata automatically
            if (transaction.status !== TransactionStatus.SUCCEEDED && transaction.status !== TransactionStatus.FAILED) {
                console.log(`[Tournament Payment Return] Updating transaction ${transaction._id} from ${transaction.status} to ${newStatus}`);

                const updated = await this.transactionsService.updatePaymentStatusSafe(
                    (transaction._id as any).toString(),
                    newStatus,
                    undefined,
                    {
                        payosOrderCode: payosTransaction.orderCode,
                        payosReference: payosTransaction.reference,
                        payosAccountNumber: payosTransaction.accountNumber,
                        payosTransactionDateTime: payosTransaction.transactionDateTime,
                    }
                );

                console.log(`[Tournament Payment Return] ✅ Transaction updated, metadata preserved:`, {
                    hasTournamentId: !!updated.metadata?.tournamentId,
                    metadataKeys: Object.keys(updated.metadata || {})
                });

                // ✅ Extract userId and tournamentId for event emission
                const userIdStr = updated.user
                    ? (typeof updated.user === 'string'
                        ? updated.user
                        : (updated.user as any)?._id
                            ? String((updated.user as any)._id)
                            : String(updated.user))
                    : undefined;

                // ✅ Use tournamentId from URL param, fallback to metadata if needed
                const finalTournamentId = tournamentId ||
                    (updated.metadata?.tournamentId ? String(updated.metadata.tournamentId) : undefined);

                // Emit payment events based on status
                if (newStatus === TransactionStatus.FAILED) {


                    const reason = payosTransaction.status === 'CANCELLED'
                        ? 'PayOS transaction cancelled'
                        : 'PayOS transaction expired';

                    this.eventEmitter.emit('payment.failed', {
                        paymentId: String(updated._id),
                        tournamentId: finalTournamentId, // ✅ Include tournamentId
                        userId: userIdStr,
                        amount: updated.amount,
                        method: updated.method,
                        transactionId: payosTransaction.reference || String(payosTransaction.orderCode),
                        reason,
                    });

                    console.log(`[Tournament Payment Return] ❌ Payment failed event emitted for tournament: ${finalTournamentId}`);
                } else if (newStatus === TransactionStatus.SUCCEEDED) {
                    // ✅ Double-check transaction status before emitting success event
                    const verifiedTransaction = await this.transactionsService.getPaymentById(
                        (updated._id as any).toString()
                    );

                    if (verifiedTransaction && verifiedTransaction.status === TransactionStatus.SUCCEEDED) {


                        // ✅ Emit payment.success event for tournament with all required fields
                        this.eventEmitter.emit('payment.success', {
                            paymentId: String(updated._id),
                            tournamentId: finalTournamentId, // ✅ Ensure tournamentId is included
                            userId: userIdStr,
                            amount: updated.amount,
                            method: updated.method,
                            transactionId: payosTransaction.reference,
                        });

                        console.log(`[Tournament Payment Return] ✅ Payment success event emitted for tournament: ${finalTournamentId}, userId: ${userIdStr}`);
                    } else {
                        console.warn(`[Tournament Payment Return] ⚠️ Transaction status verification failed, not emitting success event`);
                    }
                }
            } else {
                console.log(`[Tournament Payment Return] ℹ️ Transaction ${transaction._id} already finalized (${transaction.status}), skipping update`);

                // ✅ Even if transaction is already finalized, emit event if it's SUCCEEDED and event hasn't been processed
                // This handles cases where webhook processed but return URL is called first
                if (transaction.status === TransactionStatus.SUCCEEDED && shouldEmitEvent) {
                    const userIdStr = transaction.user
                        ? (typeof transaction.user === 'string'
                            ? transaction.user
                            : (transaction.user as any)?._id
                                ? String((transaction.user as any)._id)
                                : String(transaction.user))
                        : undefined;

                    const finalTournamentId = tournamentId ||
                        (transaction.metadata?.tournamentId ? String(transaction.metadata.tournamentId) : undefined);

                    if (finalTournamentId && userIdStr) {
                        // Check if already processed by looking at metadata
                        if (!transaction.metadata?.tournamentProcessed) {
                            this.eventEmitter.emit('payment.success', {
                                paymentId: String(transaction._id),
                                tournamentId: finalTournamentId,
                                userId: userIdStr,
                                amount: transaction.amount,
                                method: transaction.method,
                                transactionId: transaction.externalTransactionId || undefined,
                            });
                            console.log(`[Tournament Payment Return] ✅ Emitted success event for already-succeeded transaction`);
                        } else {
                            console.log(`[Tournament Payment Return] ℹ️ Transaction already processed (tournamentProcessed flag set)`);
                        }
                    }
                }
            }

            // Redirect to tournament page with payment status
            return res.redirect(
                `${frontendUrl}/tournaments/${tournamentId}?payment=${paymentStatus}&orderCode=${orderCode}`
            );

        } catch (error) {
            console.error(`[Tournament Return URL] Error:`, error);
            const frontendUrl = this.configService.get('FRONTEND_URL') || 'http://localhost:5173';
            return res.redirect(`${frontendUrl}/tournament/${tournamentId}?payment=error&reason=server_error`);
        }
    }
}

