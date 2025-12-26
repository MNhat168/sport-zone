import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationsService } from './notifications.service';
import { NotificationType } from 'src/common/enums/notification-type.enum';
import { BookingType } from 'src/common/enums/booking.enum';
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

  // ===== PRIVATE HELPER METHODS =====

  /**
   * Resolve the owner userId from a field's owner reference
   * Handles both FieldOwnerProfile ID and direct User ID
   */
  private async resolveFieldOwnerId(field: any): Promise<string | undefined> {
    const ownerRef = field.owner;
    if (!ownerRef) return undefined;

    // Try to find profile first
    const profile = await this.fieldOwnerProfileModel.findById(ownerRef).lean();
    if (profile?.user) {
      return (profile.user as any).toString();
    }

    // Fallback: treat ownerRef as userId
    return (ownerRef as any).toString?.() || String(ownerRef);
  }

  /**
   * Format a date to Vietnamese locale (dd/mm/yyyy)
   */
  private formatDateVN(date: Date | string): string {
    if (date instanceof Date) {
      return date.toLocaleDateString('vi-VN');
    }

    // String input - try to parse if needed
    if (typeof date === 'string') {
      if (date.includes('T') || (date.includes('-') && !date.includes('/'))) {
        const dateObj = new Date(date);
        if (!isNaN(dateObj.getTime())) {
          return dateObj.toLocaleDateString('vi-VN');
        }
      }
      // Already formatted or unparseable
      return date;
    }

    return String(date);
  }

  /**
   * Format currency to Vietnamese format
   */
  private formatCurrency(amount: number): string {
    return amount.toLocaleString('vi-VN') + '₫';
  }

  /**
   * Send "New Booking" notification to field owner
   */
  private async notifyFieldOwnerNewBooking(params: {
    ownerUserId: string;
    fieldName: string;
    bookingDate: string;
    startTime: string;
    endTime: string;
    customerName: string;
    customerEmail: string;
    totalPrice: number;
    bookingId: string;
    fieldId: string;
    paymentMethod: string;
  }): Promise<void> {
    const totalPriceFormatted = this.formatCurrency(params.totalPrice);
    const notificationMessage = `Bạn có đặt sân mới tại ${params.fieldName} vào ${params.bookingDate} từ ${params.startTime} đến ${params.endTime}. Khách hàng: ${params.customerName}. Tổng tiền: ${totalPriceFormatted}`;

    await this.notificationsService.create({
      recipient: new Types.ObjectId(params.ownerUserId),
      type: NotificationType.BOOKING_CONFIRMED,
      title: 'Đặt sân mới',
      message: notificationMessage,
      metadata: {
        bookingId: params.bookingId,
        fieldId: params.fieldId,
        fieldName: params.fieldName,
        customerName: params.customerName,
        customerEmail: params.customerEmail,
        date: params.bookingDate,
        startTime: params.startTime,
        endTime: params.endTime,
        totalPrice: params.totalPrice,
        paymentMethod: params.paymentMethod,
      },
    }).catch(err => this.logger.warn('Failed to create owner notification', err));
  }

  // ===== EVENT HANDLERS =====


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

      // Relax status check for FIELD_COACH bookings (they start as pending)
      const isCombinedBooking = (booking as any).type === 'field_coach' || (payload as any).type === 'field_coach';
      if (!isCombinedBooking && booking.status !== 'confirmed') {
        return;
      }

      const field = await this.fieldModel.findById(payload.fieldId).lean();
      if (!field) {
        this.logger.warn(`[Booking Created] Field ${payload.fieldId} not found`);
        return;
      }

      // Resolve owner userId using helper
      const ownerUserId = await this.resolveFieldOwnerId(field);

      if (!ownerUserId || !Types.ObjectId.isValid(ownerUserId)) {
        this.logger.warn(`[Booking Created] Invalid ownerUserId for field ${payload.fieldId}`);
        return;
      }

      const customerUser = await this.userModel.findById(payload.userId).select('fullName email phone').lean();
      if (!customerUser) {
        this.logger.warn(`[Booking Created] Customer user ${payload.userId} not found`);
        return;
      }

      // Format booking date using helper
      const bookingDate = this.formatDateVN(payload.date);

      // Send notification to field owner using helper
      await this.notifyFieldOwnerNewBooking({
        ownerUserId,
        fieldName: (field as any).name,
        bookingDate,
        startTime: payload.startTime,
        endTime: payload.endTime,
        customerName: customerUser.fullName,
        customerEmail: customerUser.email,
        totalPrice: (booking as any).totalPrice || 0,
        bookingId: bookingIdStr,
        fieldId: payload.fieldId,
        paymentMethod: (booking as any).paymentMethod || 'cash',
      });

      // Notification for Coach (if Combined Booking)
      if (isCombinedBooking && (payload as any).coachId) {
        const coachId = (payload as any).coachId;
        const coachUser = await this.userModel.findById(coachId).select('fullName').lean(); // Verify coach exists

        if (coachUser) {
          const coachNotificationMessage = `Bạn có yêu cầu đặt HLV mới từ khách hàng ${customerUser.fullName} vào ${bookingDate} lúc ${payload.startTime}. Vui lòng kiểm tra và phản hồi.`;
          await this.notificationsService.create({
            recipient: new Types.ObjectId(coachId),
            type: NotificationType.COACH_REQUEST,
            title: 'Yêu cầu đặt HLV mới',
            message: coachNotificationMessage,
            metadata: {
              bookingId: bookingIdStr,
              fieldId: payload.fieldId,
              fieldName: (field as any).name,
              customerName: customerUser.fullName,
              date: bookingDate,
              startTime: payload.startTime,
              endTime: payload.endTime,
            }
          }).catch(err => this.logger.warn('Failed to create coach notification for booking.created', err));
        }
      }

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
    // Validate userId before creating ObjectId
    const userIdStr = typeof payload.userId === 'string'
      ? payload.userId
      : String(payload.userId);

    if (!Types.ObjectId.isValid(userIdStr)) {
      this.logger.error(`[Booking Accepted] Invalid userId: ${userIdStr}`);
      return;
    }

    // Fetch booking to determine type
    const booking = await this.bookingModel.findById(payload.bookingId).lean();
    const type = booking ? (booking as any).type : null;

    let title = 'Booking Accepted';
    let message = '';

    // Format Date & Time
    const dateStr = payload.date ? (payload.date.includes('-') && !payload.date.includes('/') ?
      new Date(payload.date).toLocaleDateString('vi-VN') : payload.date) : ''; // Ensure dd/mm/yyyy

    // Handle Address (payload.fieldLocation might be object)
    let address = '';
    if (payload.fieldLocation) {
      if (typeof payload.fieldLocation === 'string') {
        address = payload.fieldLocation;
      } else if (typeof payload.fieldLocation === 'object' && (payload.fieldLocation as any).address) {
        address = (payload.fieldLocation as any).address;
      }
    }

    // Template 3: Field + Coach
    if (type === BookingType.FIELD_COACH) {
      title = 'Lịch đặt Sân & HLV đã được xác nhận!';
      message = `Bạn đã đặt thành công combo Sân và HLV vào lúc ${payload.startTime} - ${payload.endTime} ngày ${dateStr} tại ${payload.fieldName || ''}, ${address}.`;
    }
    // Template 2: Coach (or default fallback)
    else {
      title = 'Lịch hẹn HLV đã được xác nhận!';
      // For pure coach, fieldName might be relevant or just address
      const locationStr = payload.fieldName ? `${payload.fieldName}, ${address}` : address;
      message = `Huấn luyện viên đã chấp nhận yêu cầu của bạn vào lúc ${payload.startTime} - ${payload.endTime} ngày ${dateStr} tại ${locationStr}.`;
    }

    // Clean up double spaces or trailing commas if checks failed
    message = message.replace(/ ,/g, ',').replace(/  +/g, ' ').replace(/, \./, '.').trim();

    await this.notificationsService.create({
      recipient: new Types.ObjectId(userIdStr),
      type: NotificationType.BOOKING_CONFIRMED,
      title,
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
      payload.coachName ? `${payload.coachName}` : 'Huấn luyện viên',
      'đã từ chối yêu cầu đặt của bạn',
    ];

    // Format Date string if available
    let dateStr = payload.date;
    if (dateStr && (dateStr.includes('-') && !dateStr.includes('/'))) {
      dateStr = new Date(dateStr).toLocaleDateString('vi-VN');
    }

    if (payload.startTime && payload.endTime && dateStr) {
      messageParts.push(`từ ${payload.startTime} đến ${payload.endTime} ngày ${dateStr}`);
    }

    if (payload.fieldName && payload.fieldLocation) {
      // Handle Address (might be object)
      let address = '';
      if (typeof payload.fieldLocation === 'string') {
        address = payload.fieldLocation;
      } else if (typeof payload.fieldLocation === 'object' && (payload.fieldLocation as any).address) {
        address = (payload.fieldLocation as any).address;
      }
      messageParts.push(`tại ${payload.fieldName} (${address})`);
    }

    if (payload.reason) {
      messageParts.push(`. Lý do: ${payload.reason}`);
    }

    const message = messageParts.join(' ');

    await this.notificationsService.create({
      recipient: new Types.ObjectId(payload.userId),
      type: NotificationType.BOOKING_CANCELLED,
      title: 'Yêu cầu đặt bị từ chối',
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
    const bookingDate = payload.date instanceof Date
      ? payload.date.toLocaleDateString('vi-VN')
      : new Date(payload.date).toLocaleDateString('vi-VN');

    const message = `Lịch đặt của bạn vào ngày ${bookingDate} lúc ${payload.slot} đã bị hủy do trùng lịch nghỉ của huấn luyện viên.`;

    await this.notificationsService.create({
      recipient: new Types.ObjectId(payload.userId),
      type: NotificationType.BOOKING_CANCELLED,
      title: 'Lịch đặt bị hủy',
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
    // Ensure userId is a valid string before creating ObjectId
    const userIdStr = typeof payload.userId === 'string'
      ? payload.userId
      : String(payload.userId);

    if (!Types.ObjectId.isValid(userIdStr)) {
      this.logger.error(`[Payment Success] Invalid userId: ${userIdStr}`);
      return;
    }

    let title = 'Thanh toán thành công';
    let message = '';
    const amountStr = payload.amount?.toLocaleString('vi-VN') + '₫';

    // Check if this is a Field booking to send "Booking Confirmed" notification
    let isFieldBooking = false;
    let booking: any = null;

    if (payload.bookingId) {
      const bookingIdStr = typeof payload.bookingId === 'string' ? payload.bookingId : String(payload.bookingId);
      if (Types.ObjectId.isValid(bookingIdStr)) {
        booking = await this.bookingModel.findById(bookingIdStr).populate('field').lean();
        if (booking && booking.type === BookingType.FIELD) {
          isFieldBooking = true;
        }
      }
    }

    if (isFieldBooking && booking) {
      // Template 1: Field Booking
      title = 'Lịch đặt sân đã được xác nhận!';

      const dateStr = booking.date instanceof Date
        ? booking.date.toLocaleDateString('vi-VN')
        : (typeof booking.date === 'string' ? new Date(booking.date).toLocaleDateString('vi-VN') : booking.date);

      const fieldName = booking.field?.name || '';
      const address = booking.field?.location?.address || '';

      message = `Bạn đã đặt sân thành công vào lúc ${booking.startTime} - ${booking.endTime} ngày ${dateStr} tại ${fieldName}, ${address}.`;
    } else {
      // Default Payment Success Message
      message = `Bạn đã thanh toán thành công ${amountStr} qua ${payload.method.toString().toUpperCase()}${payload.transactionId ? ` (Mã GD: ${payload.transactionId})` : ''}.`;
    }

    // Clean up message formatting
    message = message.replace(/ ,/g, ',').replace(/\.\./g, '.');

    await this.notificationsService.create({
      recipient: new Types.ObjectId(userIdStr),
      type: isFieldBooking ? NotificationType.BOOKING_CONFIRMED : NotificationType.PAYMENT_SUCCESS,
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
            const ownerUserId = await this.resolveFieldOwnerId(field);

            if (ownerUserId && Types.ObjectId.isValid(ownerUserId)) {
              const ownerUser = await this.userModel.findById(ownerUserId).select('email fullName phone').lean();
              const customerUser = await this.userModel.findById(booking.user).select('fullName email phone').lean();
              const ownerEmail = ownerUser?.email;
              if (ownerEmail && customerUser) {
                // Format date using helper
                const bookingDate = this.formatDateVN(booking.date);

                // Gửi email thông báo cho field owner
                await this.emailService.sendFieldOwnerBookingNotification({
                  to: ownerEmail,
                  field: { name: (field as any).name, address: (field as any)?.location?.address || '' },
                  customer: { fullName: customerUser.fullName, phone: (customerUser as any).phone, email: customerUser.email },
                  booking: {
                    date: bookingDate,
                    startTime: booking.startTime,
                    endTime: booking.endTime,
                    services: [],
                  },
                  pricing: {
                    services: [],
                    fieldPriceFormatted: this.formatCurrency(booking.totalPrice || 0),
                    totalFormatted: this.formatCurrency(booking.totalPrice || 0),
                  },
                  preheader: 'Thanh toán thành công - Thông báo đặt sân',
                  paymentMethod: payload.method,
                }).catch(err => this.logger.warn('Failed to send owner email', err));

                // Tạo notification cho field owner using helper
                await this.notifyFieldOwnerNewBooking({
                  ownerUserId,
                  fieldName: (field as any).name,
                  bookingDate,
                  startTime: booking.startTime,
                  endTime: booking.endTime,
                  customerName: customerUser.fullName,
                  customerEmail: customerUser.email,
                  totalPrice: booking.totalPrice || 0,
                  bookingId: bookingIdStr,
                  fieldId: (field as any)._id?.toString() || (field as any).id?.toString(),
                  paymentMethod: payload.method,
                });
              }

              // --- COMBINED BOOKING EMAILS (User & Coach) ---
              if ((booking as any).type === 'field_coach' && (booking as any).requestedCoach) {
                const coachId = (booking as any).requestedCoach;
                const coachUser = await this.userModel.findById(coachId).select('email fullName').lean();
                const coachPriceSnapshot = (booking as any).pricingSnapshot?.priceBreakdown?.match(/Coach: (\d+)/)?.[1] || '0';

                // 1. Send Email to Coach
                if (coachUser && coachUser.email) {
                  await this.emailService.sendCoachBookingConfirmed({
                    to: coachUser.email,
                    coach: { name: coachUser.fullName },
                    customer: { fullName: (customerUser as any)?.fullName || 'Khách hàng', phone: (customerUser as any)?.phone, email: (customerUser as any)?.email },
                    field: { name: (field as any).name, address: (field as any)?.location?.address || '' },
                    booking: {
                      date: (booking.date instanceof Date ? booking.date.toLocaleDateString('vi-VN') : booking.date as string),
                      startTime: booking.startTime,
                      endTime: booking.endTime
                    },
                    pricing: {
                      coachPriceFormatted: parseInt(coachPriceSnapshot).toLocaleString('vi-VN') + '₫'
                    }
                  }).catch(err => this.logger.warn('Failed to send coach confirmation email', err));
                }

                // 2. Send Email to Customer (Confirmation)
                if ((customerUser as any)?.email) {
                  await this.emailService.sendCustomerBookingConfirmation({
                    to: (customerUser as any).email,
                    field: { name: (field as any).name, address: (field as any)?.location?.address || '' },
                    customer: { fullName: (customerUser as any).fullName, phone: (customerUser as any).phone, email: (customerUser as any).email },
                    booking: {
                      date: (booking.date instanceof Date ? booking.date.toLocaleDateString('vi-VN') : booking.date as string),
                      startTime: booking.startTime,
                      endTime: booking.endTime,
                      services: [],
                      // Append coach info to confirmation? 
                      // Using standard template, might need customization or generic "services".
                      // For receiving generic confirmation, current template is fine.
                    },
                    pricing: {
                      services: [],
                      fieldPriceFormatted: (booking.totalPrice || 0).toLocaleString('vi-VN') + '₫', // Total
                      totalFormatted: (booking.totalPrice || 0).toLocaleString('vi-VN') + '₫',
                    },
                    preheader: 'Xác nhận đặt sân & HLV thành công',
                    paymentMethod: payload.method
                  }).catch(err => this.logger.warn('Failed to send customer confirmation email', err));
                }

                // --- ADMIN NOTIFICATION FOR COMBINED BOOKING PAYMENTS ---
                if ((booking as any).type === 'field_coach' && customerUser) {
                  try {
                    // Get all active admin users
                    const adminUsers = await this.userModel.find({
                      role: 'admin',
                      isActive: true
                    }).select('_id').lean() as unknown as Array<{ _id: any }>;

                    if (adminUsers.length > 0) {
                      const bookingIdShort = bookingIdStr.slice(-6);
                      const totalFormatted = this.formatCurrency(booking.totalPrice || 0);
                      const customerName = customerUser.fullName || 'Khách hàng';

                      // Send notification to each admin
                      for (const admin of adminUsers) {
                        await this.notificationsService.create({
                          recipient: new Types.ObjectId(admin._id),
                          type: NotificationType.PAYMENT_SUCCESS,
                          title: 'Thanh toán mới vào hệ thống',
                          message: `Đơn đặt sân & HLV #${bookingIdShort} đã được thanh toán ${totalFormatted}. Khách hàng: ${customerName}.`,
                          metadata: {
                            bookingId: bookingIdStr,
                            amount: booking.totalPrice,
                            paymentMethod: payload.method,
                            bookingType: 'field_coach',
                            customerId: (customerUser as any)._id?.toString(),
                            customerName: customerName
                          }
                        }).catch(err => this.logger.warn('Failed to notify admin', err));
                      }

                      this.logger.log(`Sent payment notification to ${adminUsers.length} admin(s) for booking ${bookingIdStr}`);
                    }
                  } catch (error) {
                    this.logger.error('Failed to send admin notification for combined booking payment', error);
                    // Don't throw - this is non-critical
                  }
                }
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

      const message = `Yêu cầu thuê HLV của bạn vào ngày ${bookingDate} lúc ${payload.startTime} đã bị từ chối do HLV không phản hồi.`

      await this.notificationsService.create({
        recipient: new Types.ObjectId(payload.userId),
        type: NotificationType.BOOKING_CANCELLED,
        title: 'Yêu cầu HLV bị hủy',
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

      // 3. Resolve Owner User ID using helper
      const ownerUserId = await this.resolveFieldOwnerId(field);

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
