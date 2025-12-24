import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationsService } from './notifications.service';
import { NotificationType } from 'src/common/enums/notification-type.enum';
import { Types } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Booking } from '../bookings/entities/booking.entity';
import { Field } from '../fields/entities/field.entity';
import { FieldOwnerProfile } from '../field-owner/entities/field-owner-profile.entity';
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

  // Handle booking created event (for CASH payments that are confirmed immediately)
  @OnEvent('booking.created')
  async handleBookingCreated(payload: {
    bookingId: string;
    userId: string;
    fieldId: string;
    date: string;
    startTime: string;
    endTime: string;
  }) {
    try {
      const bookingIdStr = typeof payload.bookingId === 'string'
        ? payload.bookingId
        : String(payload.bookingId);

      if (!Types.ObjectId.isValid(bookingIdStr)) {
        this.logger.error(`[Booking Created] Invalid bookingId: ${bookingIdStr}`);
        return;
      }

      const booking = await this.bookingModel.findById(bookingIdStr).lean();
      if (!booking) {
        this.logger.warn(`[Booking Created] Booking ${bookingIdStr} not found`);
        return;
      }

      // Only create notification for confirmed bookings (CASH payments)
      if (booking.status !== 'confirmed') {
        return;
      }

      const field = await this.fieldModel.findById(payload.fieldId).lean();
      if (!field) {
        this.logger.warn(`[Booking Created] Field ${payload.fieldId} not found`);
        return;
      }

      // Resolve owner userId
      let ownerUserId: string | undefined;
      const ownerRef: any = (field as any).owner;
      if (ownerRef) {
        const profile = await this.fieldOwnerProfileModel.findById(ownerRef).lean();
        if (profile?.user) {
          ownerUserId = (profile.user as any).toString();
        } else {
          ownerUserId = (ownerRef as any).toString?.() || String(ownerRef);
        }
      }

      if (!ownerUserId || !Types.ObjectId.isValid(ownerUserId)) {
        this.logger.warn(`[Booking Created] Invalid ownerUserId for field ${payload.fieldId}`);
        return;
      }

      const customerUser = await this.userModel.findById(payload.userId).select('fullName email phone').lean();
      if (!customerUser) {
        this.logger.warn(`[Booking Created] Customer user ${payload.userId} not found`);
        return;
      }

      // Format booking date - payload.date is always a string
      let bookingDate: string;
      try {
        if (payload.date.includes('T') || payload.date.includes('-')) {
          // ISO date string or date string, convert to Date then format
          const dateObj = new Date(payload.date);
          if (!isNaN(dateObj.getTime())) {
            bookingDate = dateObj.toLocaleDateString('vi-VN');
          } else {
            bookingDate = payload.date; // Fallback to original string
          }
        } else {
          // Already formatted date string
          bookingDate = payload.date;
        }
      } catch {
        // Fallback to original string if parsing fails
        bookingDate = payload.date;
      }

      const totalPriceFormatted = ((booking as any).totalPrice || 0).toLocaleString('vi-VN') + '₫';
      const notificationMessage = `Bạn có đặt sân mới tại ${(field as any).name} vào ${bookingDate} từ ${payload.startTime} đến ${payload.endTime}. Khách hàng: ${customerUser.fullName}. Tổng tiền: ${totalPriceFormatted}`;

      await this.notificationsService.create({
        recipient: new Types.ObjectId(ownerUserId),
        type: NotificationType.BOOKING_CONFIRMED,
        title: 'Đặt sân mới',
        message: notificationMessage,
        metadata: {
          bookingId: bookingIdStr,
          fieldId: payload.fieldId,
          fieldName: (field as any).name,
          customerName: customerUser.fullName,
          customerEmail: customerUser.email,
          date: bookingDate,
          startTime: payload.startTime,
          endTime: payload.endTime,
          totalPrice: (booking as any).totalPrice || 0,
          paymentMethod: (booking as any).paymentMethod || 'cash',
        },
      }).catch(err => this.logger.warn('Failed to create owner notification for booking.created', err));
    } catch (error) {
      this.logger.error('[Booking Created] Error creating notification', error);
    }
  }

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
                // Gửi email thông báo cho field owner
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
                }).catch(err => this.logger.warn('Failed to send owner email', err));

                // Tạo notification cho field owner
                const bookingDate = booking.date instanceof Date
                  ? booking.date.toLocaleDateString('vi-VN')
                  : (typeof booking.date === 'string' ? booking.date : new Date(booking.date).toLocaleDateString('vi-VN'));

                const totalPriceFormatted = (booking.totalPrice || 0).toLocaleString('vi-VN') + '₫';
                const notificationMessage = `Bạn có đặt sân mới tại ${(field as any).name} vào ${bookingDate} từ ${booking.startTime} đến ${booking.endTime}. Khách hàng: ${customerUser.fullName}. Tổng tiền: ${totalPriceFormatted}`;

                await this.notificationsService.create({
                  recipient: new Types.ObjectId(ownerUserId),
                  type: NotificationType.BOOKING_CONFIRMED,
                  title: 'Đặt sân mới',
                  message: notificationMessage,
                  metadata: {
                    bookingId: bookingIdStr,
                    fieldId: (field as any)._id?.toString() || (field as any).id?.toString(),
                    fieldName: (field as any).name,
                    customerName: customerUser.fullName,
                    customerEmail: customerUser.email,
                    date: bookingDate,
                    startTime: booking.startTime,
                    endTime: booking.endTime,
                    totalPrice: booking.totalPrice || 0,
                    paymentMethod: payload.method,
                  },
                }).catch(err => this.logger.warn('Failed to create owner notification', err));
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

  @OnEvent('coach.booking.autoCancelled')
  async handleCoachBookingAutoCancelled(payload: {
    bookingId: string
    userId: string
    coachId?: string
    date: Date
    startTime: string
    cancelledAt: Date
  }) {
    try {
      // Validate userId
      if (!Types.ObjectId.isValid(payload.userId)) {
        this.logger.error(
          `[Coach Auto-Cancel] Invalid userId: ${payload.userId}`
        )
        return
      }

      // Fetch booking (optional but useful)
      const booking = await this.bookingModel
        .findById(payload.bookingId)
        .lean()

      if (!booking) {
        this.logger.warn(
          `[Coach Auto-Cancel] Booking ${payload.bookingId} not found`
        )
        return
      }

      // Format date
      const bookingDate =
        payload.date instanceof Date
          ? payload.date.toLocaleDateString('vi-VN')
          : new Date(payload.date).toLocaleDateString('vi-VN')

      const message = `Your coach request on ${bookingDate} at ${payload.startTime} was declined due to coach not responding.`

      await this.notificationsService.create({
        recipient: new Types.ObjectId(payload.userId),
        type: NotificationType.BOOKING_CANCELLED,
        title: 'Coach request declined',
        message,
        metadata: {
          bookingId: payload.bookingId,
          coachId: payload.coachId || null,
          date: bookingDate,
          startTime: payload.startTime,
          reason: 'AUTO_CANCEL_NO_COACH_RESPONSE',
        },
      })
    } catch (error) {
      this.logger.error(
        '[Coach Auto-Cancel] Error handling auto-cancel notification',
        error
      )
    }
  }

  @OnEvent('payment.proof.submitted')
  async handlePaymentProofSubmitted(payload: {
    bookingId: string;
    paymentId: string;
    userId: string;
    fieldId?: string;
  }) {
    try {
      // 1. Validate payload
      if (!payload.bookingId) {
        this.logger.error('[Payment Proof] Missing bookingId in payload');
        return;
      }
      if (!payload.fieldId) {
        // Try to fetch fieldId from booking if missing
        const booking = await this.bookingModel.findById(payload.bookingId).lean();
        if (booking && booking.field) {
          payload.fieldId = booking.field.toString();
        } else {
          this.logger.error(`[Payment Proof] Missing fieldId in payload and booking ${payload.bookingId}`);
          return;
        }
      }

      // 2. Get Field to find Owner
      const field = await this.fieldModel.findById(payload.fieldId).lean();
      if (!field) {
        this.logger.warn(`[Payment Proof] Field ${payload.fieldId} not found`);
        return;
      }

      // 3. Resolve Owner User ID
      let ownerUserId: string | undefined;
      const ownerRef: any = (field as any).owner;

      if (ownerRef) {
        // Try owner as profileId first (common pattern in this codebase)
        if (Types.ObjectId.isValid(ownerRef)) {
          const profile = await this.fieldOwnerProfileModel.findById(ownerRef).lean();
          if (profile?.user) {
            ownerUserId = (profile.user as any).toString();
          } else {
            // Fallback: treat ownerRef as userId if profile not found or has no user
            ownerUserId = (ownerRef as any).toString?.() || String(ownerRef);
          }
        } else {
          // ownerRef might be an object
          ownerUserId = (ownerRef as any).toString?.() || String(ownerRef);
        }
      }

      if (!ownerUserId || !Types.ObjectId.isValid(ownerUserId)) {
        this.logger.warn(`[Payment Proof] Could not resolve valid ownerUserId from field ${payload.fieldId}`);
        return;
      }

      // 4. Create Notification for Owner
      const customer = await this.userModel.findById(payload.userId).select('fullName email').lean();
      const customerName = customer?.fullName || 'Khách hàng';

      await this.notificationsService.create({
        recipient: new Types.ObjectId(ownerUserId),
        type: NotificationType.PAYMENT_PROOF_SUBMITTED,
        title: 'Gửi bằng chứng thanh toán',
        message: `${customerName} đã gửi bằng chứng thanh toán cho sân ${(field as any).name}. Vui lòng kiểm tra và xác nhận.`,
        metadata: {
          bookingId: payload.bookingId,
          paymentId: payload.paymentId,
          fieldId: payload.fieldId,
          customerId: payload.userId
        }
      });

      this.logger.log(`[Payment Proof] Notification sent to owner ${ownerUserId} for booking ${payload.bookingId}`);

    } catch (error) {
      this.logger.error('[Payment Proof] Error handling payment proof notification', error);
    }
  }
}
