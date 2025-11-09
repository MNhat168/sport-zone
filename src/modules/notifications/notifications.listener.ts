import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationsService } from './notifications.service';
import { NotificationType } from 'src/common/enums/notification-type.enum';
import { Types } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Booking } from '../bookings/entities/booking.entity';
import { Field } from '../fields/entities/field.entity';
import { FieldOwnerProfile } from '../fields/entities/field-owner-profile.entity';
import { User } from '../users/entities/user.entity';
import { EmailService } from '../email/email.service';

@Injectable()
export class NotificationListener {
  private readonly logger = new Logger(NotificationListener.name);

  constructor(
    private readonly notificationsService: NotificationsService,
    @InjectModel(Booking.name) private readonly bookingModel: Model<Booking>,
    @InjectModel(Field.name) private readonly fieldModel: Model<Field>,
    @InjectModel(FieldOwnerProfile.name) private readonly fieldOwnerProfileModel: Model<FieldOwnerProfile>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    private readonly emailService: EmailService,
  ) { }

  @OnEvent('booking.coach.accept')
  async handleBookingAccepted(payload: {
    bookingId: string;
    userId: string;
    coachId: string;
    coachName?: string;
    fieldId?: string;
    fieldName?: string;
    fieldLocation?: string;
    date?: string;     
    startTime?: string;
    endTime?: string;
  }) {
    const messageParts = [
      payload.coachName ? `${payload.coachName}` : 'Your coach',
      'has accepted your booking request',
    ];

    if (payload.startTime && payload.endTime && payload.date) {
      messageParts.push(`from ${payload.startTime} to ${payload.endTime} on ${payload.date}`);
    }

    if (payload.fieldName && payload.fieldLocation) {
      messageParts.push(`at ${payload.fieldName} (${payload.fieldLocation})`);
    }

    const message = messageParts.join(' ') + '.';

    await this.notificationsService.create({
      recipient: new Types.ObjectId(payload.userId),
      type: NotificationType.BOOKING_CONFIRMED,
      title: 'Booking Accepted',
      message,
      metadata: {
        bookingId: payload.bookingId,
        coachId: payload.coachId,
        fieldId: payload.fieldId || null,
      },
    });
  }

  // Handle coach declining a booking
  @OnEvent('booking.coach.decline')
  async handleBookingDeclined(payload: {
    bookingId: string;
    userId: string;
    coachId: string;
    coachName?: string;
    fieldId?: string;
    fieldName?: string;
    fieldLocation?: string;
    date?: string;
    startTime?: string;
    endTime?: string;
    reason?: string;
  }) {
    const messageParts = [
      payload.coachName ? `${payload.coachName}` : 'Your coach',
      'has declined your booking request',
    ];

    if (payload.startTime && payload.endTime && payload.date) {
      messageParts.push(`from ${payload.startTime} to ${payload.endTime} on ${payload.date}`);
    }

    if (payload.fieldName && payload.fieldLocation) {
      messageParts.push(`at ${payload.fieldName} (${payload.fieldLocation})`);
    }

    if (payload.reason) {
      messageParts.push(`Reason: ${payload.reason}`);
    }

    const message = messageParts.join(' ') + '.';

    await this.notificationsService.create({
      recipient: new Types.ObjectId(payload.userId),
      type: NotificationType.BOOKING_CANCELLED,
      title: 'Booking Declined',
      message,
      metadata: {
        bookingId: payload.bookingId,
        coachId: payload.coachId,
        fieldId: payload.fieldId || null,
        reason: payload.reason || null,
      },
    });
  }

  //for accepted booking that was affect in holiday set by coach
  @OnEvent('schedule.holiday.set')
  async handleScheduleHoliday(payload: {
    bookingId: string;
    userId: string;
    scheduleId: string;
    slot: string;
    date: Date;
  }) {
    const message = `Your booking for ${payload.date.toISOString().slice(0, 10)} at ${payload.slot} has been cancelled due to holiday.`;

    await this.notificationsService.create({
      recipient: new Types.ObjectId(payload.userId),
      type: NotificationType.BOOKING_CANCELLED,
      title: 'Booking Cancelled',
      message,
      metadata: {
        bookingId: payload.bookingId,
        scheduleId: payload.scheduleId,
        slot: payload.slot,
        date: payload.date,
      },
    });
  }

  // Payment success notification
  @OnEvent('payment.success')
  async handlePaymentSuccess(payload: {
    paymentId: string;
    bookingId?: string;
    userId: string;
    amount: number;
    method: string;
    transactionId?: string;
  }) {
    const amountStr = payload.amount?.toLocaleString('vi-VN') + '₫';
    const title = 'Thanh toán thành công';
    const message = `Bạn đã thanh toán thành công ${amountStr} qua ${payload.method.toString().toUpperCase()}${payload.transactionId ? ` (Mã GD: ${payload.transactionId})` : ''}.`;

    // Ensure userId is a valid string before creating ObjectId
    const userIdStr = typeof payload.userId === 'string' 
      ? payload.userId 
      : String(payload.userId);
    
    if (!Types.ObjectId.isValid(userIdStr)) {
      this.logger.error(`[Payment Success] Invalid userId: ${userIdStr}`);
      return;
    }

    await this.notificationsService.create({
      recipient: new Types.ObjectId(userIdStr),
      type: NotificationType.PAYMENT_SUCCESS,
      title,
      message,
      metadata: {
        paymentId: payload.paymentId,
        bookingId: payload.bookingId || null,
        transactionId: payload.transactionId || null,
        amount: payload.amount,
        method: payload.method,
      },
    });

    // Send booking email to field owner on non-cash payments once payment succeeds
    try {
      if (payload.bookingId) {
        // Ensure bookingId is a valid string
        const bookingIdStr = typeof payload.bookingId === 'string'
          ? payload.bookingId
          : String(payload.bookingId);
        
        if (!Types.ObjectId.isValid(bookingIdStr)) {
          this.logger.error(`[Payment Success] Invalid bookingId: ${bookingIdStr}`);
          return;
        }

        const booking = await this.bookingModel.findById(bookingIdStr).lean();
        if (booking) {
          const field = await this.fieldModel.findById(booking.field).lean();
          if (field) {
            // Resolve owner email from profile.user → user.email or fallback if owner is userId
            let ownerUserId: string | undefined;
            const ownerRef: any = (field as any).owner;
            if (ownerRef) {
              // Try owner as profileId
              const profile = await this.fieldOwnerProfileModel.findById(ownerRef).lean();
              if (profile?.user) {
                ownerUserId = (profile.user as any).toString();
              } else {
                // Fallback: treat ownerRef as userId
                ownerUserId = (ownerRef as any).toString?.() || String(ownerRef);
              }
            }
            if (ownerUserId && Types.ObjectId.isValid(ownerUserId)) {
              const ownerUser = await this.userModel.findById(ownerUserId).select('email fullName phone').lean();
              const customerUser = await this.userModel.findById(booking.user).select('fullName email phone').lean();
              const ownerEmail = ownerUser?.email;
              if (ownerEmail && customerUser) {
                await this.emailService.sendFieldOwnerBookingNotification({
                  to: ownerEmail,
                  field: { name: (field as any).name, address: (field as any)?.location?.address || '' },
                  customer: { fullName: customerUser.fullName, phone: (customerUser as any).phone, email: customerUser.email },
                  booking: {
                    date: (booking.date instanceof Date ? booking.date.toLocaleDateString('vi-VN') : booking.date),
                    startTime: booking.startTime,
                    endTime: booking.endTime,
                    services: [],
                  },
                  pricing: {
                    services: [],
                    fieldPriceFormatted: (booking.totalPrice || 0).toLocaleString('vi-VN') + '₫',
                    totalFormatted: (booking.totalPrice || 0).toLocaleString('vi-VN') + '₫',
                  },
                  preheader: 'Thanh toán thành công - Thông báo đặt sân',
                  paymentMethod: payload.method,
                });
              }
            }
          }
        }
      }
    } catch (e) {
      // Swallow email errors to avoid blocking notifications
    }
  }

  // Payment failed notification
  @OnEvent('payment.failed')
  async handlePaymentFailed(payload: {
    paymentId: string;
    bookingId?: string;
    userId: string;
    amount: number;
    method: string;
    transactionId?: string;
    reason?: string;
  }) {
    // Ensure userId is a valid string before creating ObjectId
    const userIdStr = typeof payload.userId === 'string' 
      ? payload.userId 
      : String(payload.userId);
    
    if (!Types.ObjectId.isValid(userIdStr)) {
      this.logger.error(`[Payment Failed] Invalid userId: ${userIdStr}`);
      return;
    }
    const amountStr = payload.amount?.toLocaleString('vi-VN') + '₫';
    const title = 'Thanh toán thất bại';
    const message = `Thanh toán ${amountStr} qua ${payload.method.toString().toUpperCase()} thất bại${payload.reason ? `: ${payload.reason}` : ''}. Vui lòng thử lại.`;

    await this.notificationsService.create({
      recipient: new Types.ObjectId(userIdStr),
      type: NotificationType.PAYMENT_FAILED,
      title,
      message,
      metadata: {
        paymentId: payload.paymentId,
        bookingId: payload.bookingId || null,
        transactionId: payload.transactionId || null,
        amount: payload.amount,
        method: payload.method,
        reason: payload.reason || null,
      },
    });
  }
}