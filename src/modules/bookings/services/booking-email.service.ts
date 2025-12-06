import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Booking } from '../entities/booking.entity';
import { Field } from '../../fields/entities/field.entity';
import { FieldOwnerProfile } from '../../field-owner/entities/field-owner-profile.entity';
import { User } from '../../users/entities/user.entity';
import { EmailService } from '../../email/email.service';
import { EmailQueueService } from '../../email/email-queue.service';

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

            if (customerUser.email) {
                this.emailQueue.enqueue({
                    type: 'CUSTOMER_BOOKING',
                    payload: {
                        ...emailPayloadBase,
                        to: customerUser.email,
                        preheader: 'Đặt sân thành công',
                    },
                });
            }
        } catch (err) {
            this.logger.warn('[BookingEmail] Failed to send confirmation emails', err);
        }
    }
}
