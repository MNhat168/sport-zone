import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Booking } from '../entities/booking.entity';
import { Field } from '../../fields/entities/field.entity';
import { FieldOwnerProfile } from '../../field-owner/entities/field-owner-profile.entity';
import { User } from '../../users/entities/user.entity';
import { EmailService } from '../../email/email.service';
import { EmailQueueService } from '../../email/email-queue.service';
import { QrCheckinService } from '../../qr-checkin/qr-checkin.service';
import * as QRCode from 'qrcode';

@Injectable()
export class BookingEmailService {
    private readonly logger = new Logger(BookingEmailService.name);

    constructor(
        @InjectModel(Booking.name) private readonly bookingModel: Model<Booking>,
        @InjectModel(Field.name) private readonly fieldModel: Model<Field>,
        @InjectModel(FieldOwnerProfile.name) private readonly fieldOwnerProfileModel: Model<FieldOwnerProfile>,
        @InjectModel(User.name) private readonly userModel: Model<User>,
        private readonly emailService: EmailService,
        private readonly emailQueue: EmailQueueService,
        private readonly qrCheckinService: QrCheckinService,
    ) { }

    /**
     * Unified confirmation emails for both cash and online payment flows
     * Sends to field owner and customer using a single implementation
     */
    async sendConfirmationEmails(bookingId: string, paymentMethod?: string): Promise<void> {
        try {
            if (!Types.ObjectId.isValid(bookingId)) {
                this.logger.warn(`[BookingEmail] Invalid bookingId: ${bookingId}`);
                return;
            }

            const booking = await this.bookingModel
                .findById(bookingId)
                .populate('field')
                .populate('user', 'fullName email phone')
                .lean();

            if (!booking || !booking.field || !booking.user) {
                this.logger.warn(`[BookingEmail] Booking ${bookingId} not fully populated`);
                return;
            }

            const field = booking.field as any;
            const customerUser = booking.user as any;
            const toVnd = (amount: number) => amount.toLocaleString('vi-VN') + '₫';

            const emailPayloadBase = {
                field: { name: field.name, address: field.location?.address || '' },
                customer: { fullName: customerUser.fullName, phone: customerUser.phone, email: customerUser.email },
                booking: {
                    date: (booking.date instanceof Date ? booking.date : new Date(booking.date)).toLocaleDateString('vi-VN'),
                    startTime: booking.startTime,
                    endTime: booking.endTime,
                    services: [],
                },
                pricing: {
                    services: [],
                    fieldPriceFormatted: toVnd((booking as any).bookingAmount ?? booking.totalPrice ?? 0),
                    totalFormatted: toVnd(
                        (booking as any).bookingAmount !== undefined && (booking as any).platformFee !== undefined
                            ? (booking as any).bookingAmount + (booking as any).platformFee
                            : booking.totalPrice || 0
                    ),
                },
                paymentMethod,
            };

            // Resolve field owner email
            let ownerEmail: string | undefined;
            const ownerRef = field?.owner?.toString?.() ?? field?.owner;
            if (ownerRef) {
                let ownerProfile = await this.fieldOwnerProfileModel.findById(ownerRef).lean();
                if (!ownerProfile) {
                    ownerProfile = await this.fieldOwnerProfileModel.findOne({ user: new Types.ObjectId(ownerRef) }).lean();
                }
                const ownerUserId = (ownerProfile?.user as any)?.toString?.() ?? ownerRef;
                if (ownerUserId && Types.ObjectId.isValid(ownerUserId)) {
                    const ownerUser = await this.userModel.findById(ownerUserId).select('email').lean();
                    ownerEmail = ownerUser?.email;
                }
            }

            // Enqueue emails to avoid blocking HTTP response
            if (ownerEmail) {
                this.emailQueue.enqueue({
                    type: 'FIELD_OWNER_BOOKING',
                    payload: {
                        ...emailPayloadBase,
                        to: ownerEmail,
                        preheader: 'Đặt sân thành công - Đơn mới',
                    },
                });
            }

            // Generate QR code for customer email
            let qrCodeDataUrl: string | undefined;
            try {
                // Generate static token for email-based QR check-in
                const token = await this.qrCheckinService.generateStaticCheckInToken(
                    booking._id.toString(),
                    booking.date
                );

                // Generate QR code image as data URL
                qrCodeDataUrl = await QRCode.toDataURL(token, {
                    width: 300,
                    margin: 2,
                    color: {
                        dark: '#000000',
                        light: '#FFFFFF'
                    }
                });

                this.logger.log(`[BookingEmail] Generated QR code for booking ${bookingId}`);
            } catch (qrError) {
                this.logger.error(`[BookingEmail] Failed to generate QR code: ${qrError.message}`, qrError.stack);
                // Continue without QR code if generation fails
            }

            if (customerUser.email) {
                this.emailQueue.enqueue({
                    type: 'CUSTOMER_BOOKING',
                    payload: {
                        ...emailPayloadBase,
                        to: customerUser.email,
                        preheader: 'Đặt sân thành công',
                        qrCodeDataUrl, // Add QR code to customer email
                    },
                });
            }
        } catch (err) {
            this.logger.warn('[BookingEmail] Failed to send confirmation emails', err);
        }
    }

    /**
     * Send consolidated confirmation email for recurring booking group
     * Sends ONE email with ONE QR code for all bookings in the group
     * @param recurringGroupId - The recurring group ID
     * @param paymentMethod - Payment method used
     */
    async sendRecurringConfirmationEmail(recurringGroupId: string, paymentMethod?: string): Promise<void> {
        try {
            if (!Types.ObjectId.isValid(recurringGroupId)) {
                this.logger.warn(`[RecurringEmail] Invalid recurringGroupId: ${recurringGroupId}`);
                return;
            }

            // Find all bookings in this recurring group
            const bookings = await this.bookingModel
                .find({ recurringGroupId: new Types.ObjectId(recurringGroupId) })
                .populate('field')
                .populate('user', 'fullName email phone')
                .sort({ date: 1 }) // Sort by date ascending
                .lean();

            if (bookings.length === 0) {
                this.logger.warn(`[RecurringEmail] No bookings found for recurring group ${recurringGroupId}`);
                return;
            }

            const firstBooking = bookings[0];
            const field = firstBooking.field as any;
            const customerUser = firstBooking.user as any;

            if (!field || !customerUser) {
                this.logger.warn(`[RecurringEmail] Missing field or user for recurring group ${recurringGroupId}`);
                return;
            }

            const toVnd = (amount: number) => amount.toLocaleString('vi-VN') + '₫';

            // Calculate total price for all bookings
            const totalPrice = bookings.reduce((sum, b) => {
                if ((b as any).bookingAmount !== undefined && (b as any).platformFee !== undefined) {
                    return sum + (b as any).bookingAmount + (b as any).platformFee;
                }
                return sum + (b.totalPrice || 0);
            }, 0);

            // Format date range
            const dates = bookings.map(b => new Date(b.date).toLocaleDateString('vi-VN'));
            const dateRange = dates.length > 1
                ? `${dates[0]} - ${dates[dates.length - 1]} (${dates.length} ngày)`
                : dates[0];

            const emailPayloadBase = {
                field: { name: field.name, address: field.location?.address || '' },
                customer: { fullName: customerUser.fullName, phone: customerUser.phone, email: customerUser.email },
                booking: {
                    date: dateRange,
                    startTime: firstBooking.startTime,
                    endTime: firstBooking.endTime,
                    services: [],
                    isRecurring: true,
                    totalDays: bookings.length,
                    dates: dates, // All dates for display
                },
                pricing: {
                    services: [],
                    fieldPriceFormatted: toVnd(totalPrice / bookings.length), // Average per day
                    totalFormatted: toVnd(totalPrice),
                },
                paymentMethod,
            };

            // Resolve field owner email
            let ownerEmail: string | undefined;
            const ownerRef = field?.owner?.toString?.() ?? field?.owner;
            if (ownerRef) {
                let ownerProfile = await this.fieldOwnerProfileModel.findById(ownerRef).lean();
                if (!ownerProfile) {
                    ownerProfile = await this.fieldOwnerProfileModel.findOne({ user: new Types.ObjectId(ownerRef) }).lean();
                }
                const ownerUserId = (ownerProfile?.user as any)?.toString?.() ?? ownerRef;
                if (ownerUserId && Types.ObjectId.isValid(ownerUserId)) {
                    const ownerUser = await this.userModel.findById(ownerUserId).select('email').lean();
                    ownerEmail = ownerUser?.email;
                }
            }

            // Send email to field owner
            if (ownerEmail) {
                this.emailQueue.enqueue({
                    type: 'FIELD_OWNER_BOOKING',
                    payload: {
                        ...emailPayloadBase,
                        to: ownerEmail,
                        preheader: `Đặt sân hàng loạt - ${bookings.length} ngày`,
                    },
                });
            }

            // Generate ONE QR code for the entire recurring group
            let qrCodeDataUrl: string | undefined;
            try {
                // Generate static token with recurringGroupId (not individual bookingId)
                const token = await this.qrCheckinService.generateRecurringGroupToken(
                    recurringGroupId,
                    firstBooking.date // Use first booking date as starting reference
                );

                // Generate QR code image as data URL
                qrCodeDataUrl = await QRCode.toDataURL(token, {
                    width: 300,
                    margin: 2,
                    color: {
                        dark: '#000000',
                        light: '#FFFFFF'
                    }
                });

                this.logger.log(`[RecurringEmail] Generated QR code for recurring group ${recurringGroupId}`);
            } catch (qrError) {
                this.logger.error(`[RecurringEmail] Failed to generate QR code: ${qrError.message}`, qrError.stack);
                // Continue without QR code if generation fails
            }

            // Send consolidated email to customer
            if (customerUser.email) {
                this.emailQueue.enqueue({
                    type: 'CUSTOMER_BOOKING',
                    payload: {
                        ...emailPayloadBase,
                        to: customerUser.email,
                        preheader: `Đặt sân thành công - ${bookings.length} ngày`,
                        qrCodeDataUrl, // Single QR code for all bookings
                        recurringGroupId, // Pass for template rendering
                    },
                });

                this.logger.log(`[RecurringEmail] Sent consolidated email for ${bookings.length} bookings to ${customerUser.email}`);
            }

        } catch (err) {
            this.logger.warn('[RecurringEmail] Failed to send recurring confirmation email', err);
        }
    }
}
