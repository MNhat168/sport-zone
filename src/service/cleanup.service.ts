import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Transaction } from '../modules/transactions/entities/transaction.entity';
import { TransactionStatus, TransactionType } from '@common/enums/transaction.enum';
import { PaymentMethod } from '@common/enums/payment-method.enum';
import { Booking } from '../modules/bookings/entities/booking.entity';
import { BookingStatus } from '@common/enums/booking.enum';
import { PaymentHandlerService } from '../modules/bookings/services/payment-handler.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TimezoneService } from '../common/services/timezone.service';
import { getCurrentVietnamTimeForDB } from '../utils/timezone.utils';

/**
 * Cleanup Service - Cancel expired payments/bookings, release slots, fix data inconsistencies
 * Handles all cleanup operations including cron jobs for automatic cleanup
 */
@Injectable()
export class CleanupService {
  private readonly logger = new Logger(CleanupService.name);

  // Payment expiration time in minutes
  private readonly PAYMENT_EXPIRATION_MINUTES = 5;

  constructor(
    @InjectModel(Transaction.name) private readonly transactionModel: Model<Transaction>,
    @InjectModel(Booking.name) private readonly bookingModel: Model<Booking>,
    private readonly eventEmitter: EventEmitter2,
    private readonly timezoneService: TimezoneService,
    @Inject(forwardRef(() => PaymentHandlerService))
    private readonly paymentHandlerService: PaymentHandlerService,
  ) { }

  /** Cancel expired payment and associated booking */
  async cancelExpiredPaymentAndBooking(
    payment: Transaction,
    hasDataInconsistency: boolean = false
  ): Promise<void> {
    const paymentId = (payment._id as any).toString();

    const userId = (payment.user as any)?._id?.toString() || payment.user;

    // Resolve booking via reverse lookup
    const booking = await this.bookingModel.findOne({ transaction: payment._id });
    const bookingId = booking?._id?.toString();
    const bookingStatus = booking?.status || 'unknown';

    const notes = hasDataInconsistency
      ? 'Transaction expired - automatically cancelled after 5 minutes. ⚠️ DATA INCONSISTENCY: Booking was CONFIRMED but transaction was still PENDING. This has been corrected by marking both transaction and booking as FAILED/CANCELLED.'
      : 'Transaction expired - automatically cancelled after 5 minutes';

    // Update transaction to FAILED
    await this.transactionModel.findByIdAndUpdate(paymentId, {
      status: TransactionStatus.FAILED,
      notes,
      errorMessage: hasDataInconsistency ? 'Payment timeout - Data inconsistency corrected' : 'Payment timeout',
      metadata: {
        ...((payment as any).metadata || {}),
        cancelledAt: new Date(),
        cancelReason: 'timeout',
        autoCancel: true,
        dataInconsistencyFixed: hasDataInconsistency,
        bookingStatusAtCancel: bookingStatus,
      },
    });

    // Cancel booking and release slots if exists
    if (bookingId) {
      try {
        const bookingToCancel = await this.bookingModel.findById(bookingId);

        if (bookingToCancel) {
          // Only cancel if pending or confirmed
          if (bookingToCancel.status === BookingStatus.PENDING || bookingToCancel.status === BookingStatus.CONFIRMED) {
            const cancellationReason = hasDataInconsistency
              ? 'Payment expired - Data inconsistency: Booking was CONFIRMED but payment was still PENDING. This has been corrected by cancelling the booking.'
              : 'Payment expired - automatically cancelled after 5 minutes';

            await this.cancelBookingAndReleaseSlots(
              bookingId,
              cancellationReason,
              paymentId
            );

            if (hasDataInconsistency) {
              this.logger.warn(
                `⚠️  Cancelled booking ${bookingId} and released schedule slots due to data inconsistency (payment ${paymentId} was PENDING but booking was CONFIRMED)`
              );
            } else {
              this.logger.log(
                `✅ Cancelled booking ${bookingId} and released schedule slots due to payment expiration`
              );
            }
          } else {
            this.logger.debug(`[Cleanup] Booking ${bookingId} already ${bookingToCancel.status}, skipping cancellation`);
          }
        } else {
          this.logger.warn(`⚠️  Booking ${bookingId} not found when trying to cancel`);
        }
      } catch (bookingError) {
        this.logger.error(
          `❌ Failed to cancel booking ${bookingId}:`,
          bookingError
        );
      }
    }

    this.logger.warn(
      `⚠️  Cancelled expired payment ${paymentId} (Booking: ${bookingId}, Booking Status: ${bookingStatus}${hasDataInconsistency ? ' → CANCELLED' : ''})`
    );

    // Emit payment.expired event
    this.eventEmitter.emit('payment.expired', {
      paymentId,
      bookingId,
      userId,
      amount: payment.amount,
      method: payment.method,
      createdAt: payment.createdAt,
      cancelledAt: new Date(),
      hadDataInconsistency: hasDataInconsistency,
    });
  }

  /**
   * Cancel hold booking (PENDING booking without payment)
   * Validates that booking is a valid hold booking before cancelling
   * Used by public endpoint /bookings/:bookingId/cancel-hold
   */
  async cancelHoldBooking(
    bookingId: string,
    cancellationReason: string = 'Thời gian giữ chỗ đã hết (5 phút)',
    maxAgeMinutes: number | null = 10
  ): Promise<void> {
    if (!Types.ObjectId.isValid(bookingId)) {
      throw new Error(`Invalid booking ID: ${bookingId}`);
    }

    const booking = await this.bookingModel.findById(bookingId);
    if (!booking) {
      throw new Error(`Booking ${bookingId} not found`);
    }

    // Skip if already cancelled
    if (booking.status === BookingStatus.CANCELLED) {
      this.logger.debug(`[Cleanup] Booking ${bookingId} already cancelled, skipping hold cancellation`);
      return;
    }

    // Identify payment method from metadata
    const paymentMethod = booking.metadata?.paymentMethod;

    // Delegate to specialized handler based on payment method
    if (paymentMethod === PaymentMethod.PAYOS) {
      await this.cancelPayOSHold(booking, cancellationReason, maxAgeMinutes);
    } else {
      // Default to Bank Transfer logic (or specifically check for BANK_TRANSFER)
      await this.cancelBankTransferHold(booking, cancellationReason, maxAgeMinutes);
    }
  }

  /**
   * Specifically handles cancellation of BANK_TRANSFER hold bookings
   */
  private async cancelBankTransferHold(
    booking: any,
    cancellationReason: string,
    maxAgeMinutes: number | null
  ): Promise<void> {
    const bookingId = booking._id.toString();

    // Verify this is a hold booking that can be cancelled
    const hasTransaction = await this.transactionModel.exists({
      booking: new Types.ObjectId(bookingId),
      type: TransactionType.PAYMENT
    });

    const isHoldBooking =
      booking.status === BookingStatus.PENDING &&
      booking.paymentStatus === 'unpaid' &&
      !hasTransaction &&
      booking.metadata?.isSlotHold === true;

    if (!isHoldBooking) {
      throw new Error(
        'This booking cannot be cancelled via this endpoint. Only PENDING BANK_TRANSFER bookings without payment (slot holds) can be cancelled.'
      );
    }

    // Verify booking is not too old (prevent abuse) if check is enabled
    if (maxAgeMinutes !== null) {
      const bookingAge = Date.now() - new Date(booking.createdAt).getTime();
      const maxAge = maxAgeMinutes * 60 * 1000;
      if (bookingAge > maxAge) {
        throw new Error(`Booking is too old to cancel via this endpoint (max ${maxAgeMinutes} minutes)`);
      }
    }

    // Cancel booking and release slots
    await this.cancelBookingAndReleaseSlots(bookingId, cancellationReason);
  }

  /**
   * Specifically handles cancellation of PAYOS hold bookings
   * Also cancels any pending transactions
   */
  private async cancelPayOSHold(
    booking: any,
    cancellationReason: string,
    maxAgeMinutes: number | null
  ): Promise<void> {
    const bookingId = booking._id.toString();

    // Verify booking is not too old (prevent abuse) if check is enabled
    if (maxAgeMinutes !== null) {
      const bookingAge = Date.now() - new Date(booking.createdAt).getTime();
      const maxAge = maxAgeMinutes * 60 * 1000;
      if (bookingAge > maxAge) {
        throw new Error(`Booking is too old to cancel via this endpoint (max ${maxAgeMinutes} minutes)`);
      }
    }

    // 1. Cancel any PENDING transactions for this booking
    const pendingTransactions = await this.transactionModel.find({
      booking: new Types.ObjectId(bookingId),
      status: TransactionStatus.PENDING,
      type: TransactionType.PAYMENT
    });

    for (const tx of pendingTransactions) {
      await this.transactionModel.findByIdAndUpdate(tx._id, {
        status: TransactionStatus.FAILED,
        notes: `Cancelled due to booking hold cancellation: ${cancellationReason}`,
        errorMessage: 'Booking hold cancelled',
        metadata: {
          ...((tx as any).metadata || {}),
          cancelledAt: new Date(),
          cancelReason: 'hold_cancelled'
        }
      });
      this.logger.log(`[Cancel PayOS Hold] Cancelled pending transaction ${tx._id}`);
    }

    // 2. Cancel booking and release slots
    await this.cancelBookingAndReleaseSlots(bookingId, cancellationReason);
  }

  /** Cancel booking and release schedule slots */
  async cancelBookingAndReleaseSlots(
    bookingId: string,
    cancellationReason: string,
    paymentId?: string
  ): Promise<void> {
    try {
      if (!Types.ObjectId.isValid(bookingId)) {
        this.logger.error(`[Cancel Booking] Invalid booking ID: ${bookingId}`);
        return;
      }

      const booking = await this.bookingModel.findById(bookingId);
      if (!booking) {
        this.logger.error(`[Cancel Booking] Booking ${bookingId} not found`);
        return;
      }

      // Skip if already cancelled
      if (booking.status === BookingStatus.CANCELLED) {
        this.logger.warn(`[Cancel Booking] Booking ${bookingId} already cancelled`);
        return;
      }

      // Only cancel if pending or confirmed
      if (booking.status !== BookingStatus.PENDING && booking.status !== BookingStatus.CONFIRMED) {
        this.logger.warn(`[Cancel Booking] Booking ${bookingId} status is ${booking.status}, cannot cancel`);
        return;
      }

      const updateData: any = {
        status: BookingStatus.CANCELLED,
        cancellationReason,
      };

      if (paymentId) {
        updateData.transaction = new Types.ObjectId(paymentId);
      }

      await this.bookingModel.findByIdAndUpdate(
        new Types.ObjectId(bookingId),
        { $set: updateData },
        { new: true }
      );

      this.logger.log(`[Cancel Booking] ✅ Cancelled booking ${bookingId}: ${cancellationReason}`);

      await this.paymentHandlerService.releaseBookingSlots(booking);

      this.eventEmitter.emit('booking.cancelled', {
        bookingId,
        userId: booking.user.toString(),
        fieldId: booking.field?.toString() || null,
        reason: cancellationReason,
      });

    } catch (error) {
      this.logger.error(`[Cancel Booking] Error cancelling booking ${bookingId}:`, error);
      throw error;
    }
  }

  /** Cancel payment manually and associated booking */
  async cancelPaymentManually(
    paymentId: string,
    reason: string = 'User cancelled'
  ): Promise<void> {
    const payment = await this.transactionModel
      .findById(paymentId)
      .populate('booking')
      .populate('user', 'email fullName');

    if (!payment) {
      throw new Error(`Transaction ${paymentId} not found`);
    }

    if (payment.status !== TransactionStatus.PENDING) {
      throw new Error(
        `Cannot cancel transaction ${paymentId} - status is ${payment.status}`
      );
    }

    await this.transactionModel.findByIdAndUpdate(paymentId, {
      status: TransactionStatus.FAILED,
      notes: `Manually cancelled: ${reason}`,
      errorMessage: reason,
      metadata: {
        ...((payment as any).metadata || {}),
        cancelledAt: new Date(),
        cancelReason: 'manual',
        manualCancelReason: reason,
      },
    });

    this.logger.log(`✅ Manually cancelled payment ${paymentId}: ${reason}`);

    const booking = await this.bookingModel.findOne({ transaction: payment._id });
    const bookingId = booking?._id?.toString();
    if (bookingId) {
      try {
        await this.cancelBookingAndReleaseSlots(
          bookingId,
          `Payment manually cancelled: ${reason}`,
          paymentId
        );
      } catch (bookingError) {
        this.logger.error(`❌ Failed to cancel booking ${bookingId} during manual payment cancellation:`, bookingError);
      }
    }

    this.eventEmitter.emit('payment.cancelled', {
      paymentId: paymentId,
      bookingId,
      userId: (payment.user as any)?._id?.toString() || payment.user,
      amount: payment.amount,
      method: payment.method,
      reason,
      cancelledAt: new Date(),
    });
  }

  /**
   * Unified cron job: Cleanup expired bookings and payments every 5 minutes
   * Handles both:
   * 1. Expired payments (non-BANK_TRANSFER) with PENDING transactions
   * 2. BANK_TRANSFER bookings without payment proof (no transaction created)
   */
  @Cron(CronExpression.EVERY_5_MINUTES, {
    name: 'cleanup-expired-bookings-and-payments',
  })
  async cleanupExpiredBookingsAndPayments(): Promise<void> {
    try {
      const nowVN = getCurrentVietnamTimeForDB();
      let totalCancelled = 0;
      let totalErrors = 0;

      // ============================================================
      // Part 1: Cleanup expired payments (non-BANK_TRANSFER)
      // ============================================================
      const expiredPayments = await this.transactionModel.find({
        status: TransactionStatus.PENDING,
        type: TransactionType.PAYMENT,
        method: { $ne: PaymentMethod.BANK_TRANSFER }, // Exclude BANK_TRANSFER
      }).populate('user', 'email fullName');

      // Manual filtering since we can't populate 'booking' anymore
      const validExpiredPayments: any[] = [];

      for (const payment of expiredPayments) {
        const booking = await this.bookingModel.findOne({ transaction: payment._id });
        if (!booking) continue;

        const bookingCreatedAtVN = new Date(booking.createdAt as any);
        const timeSinceBookingMs = nowVN.getTime() - bookingCreatedAtVN.getTime();
        const timeSinceBookingMinutes = timeSinceBookingMs / 1000 / 60;

        const hasDataInconsistency = booking.status === BookingStatus.CONFIRMED;
        const isExpired = timeSinceBookingMinutes >= this.PAYMENT_EXPIRATION_MINUTES || hasDataInconsistency;

        if (hasDataInconsistency) {
          this.logger.warn(
            `[Cleanup] ⚠️ DATA INCONSISTENCY: Payment ${payment._id} is PENDING but booking ${booking._id} is CONFIRMED`
          );
        }

        if (isExpired) {
          // Attach booking to payment object tentatively for use in cancel function (though cancel function re-fetches or we should pass it)
          // Actually cancelExpiredPaymentAndBooking fetches booking again? 
          // No, cancelExpiredPaymentAndBooking now searches for booking.
          // But wait, the original code passed `payment` where `payment.booking` was populated.
          // My fix for cancelExpiredPaymentAndBooking calculates booking from DB.
          // So I can just push payment.
          validExpiredPayments.push(payment);
        }
      }

      for (const payment of validExpiredPayments) {
        try {
          const booking = await this.bookingModel.findOne({ transaction: payment._id });
          const hasDataInconsistency = booking?.status === BookingStatus.CONFIRMED;
          await this.cancelExpiredPaymentAndBooking(payment, hasDataInconsistency);
          totalCancelled++;
        } catch (error) {
          totalErrors++;
          this.logger.error(`Failed to cancel payment ${payment._id}:`, error.message);
        }
      }

      // ============================================================
      // Part 2: Cleanup BANK_TRANSFER bookings without payment proof
      // Excludes field_coach type since those require coach approval before payment
      // ============================================================
      const bookingsWithoutPayment = await this.bookingModel.find({
        status: BookingStatus.PENDING,
        paymentStatus: 'unpaid',
        transaction: { $exists: false },
        'metadata.paymentMethod': PaymentMethod.BANK_TRANSFER,
        'metadata.isSlotHold': true,
        type: { $ne: 'field_coach' }, // Exclude field_coach - these wait for coach approval first
      })
        .populate('user', 'email fullName password isVerified')
        .populate('field', 'name');

      const expiredBookings = bookingsWithoutPayment.filter((booking: any) => {
        if (booking.status === BookingStatus.CANCELLED) return false;

        const bookingCreatedAtVN = new Date(booking.createdAt);
        const timeSinceBookingMs = nowVN.getTime() - bookingCreatedAtVN.getTime();
        const timeSinceBookingMinutes = timeSinceBookingMs / 1000 / 60;

        return timeSinceBookingMinutes >= this.PAYMENT_EXPIRATION_MINUTES;
      });

      for (const booking of expiredBookings) {
        try {
          const bookingId = (booking._id as any).toString();
          const user = booking.user as any;
          const isGuestBooking = !user?.password || !user?.isVerified;

          const cancellationReason = isGuestBooking
            ? 'Guest booking: Payment proof not submitted within 5 minutes - booking automatically cancelled and slots released'
            : 'Payment proof not submitted within 5 minutes - booking automatically cancelled';

          await this.cancelBookingAndReleaseSlots(bookingId, cancellationReason);
          totalCancelled++;

          this.eventEmitter.emit('bank.transfer.booking.cancelled', {
            bookingId,
            userId: user?._id?.toString() || booking.user,
            fieldId: (booking.field as any)?._id?.toString() || booking.field,
            amount: booking.bookingAmount + booking.platformFee,
            createdAt: booking.createdAt,
            cancelledAt: nowVN,
            reason: cancellationReason,
            isGuestBooking,
          });
        } catch (error) {
          totalErrors++;
          this.logger.error(`Failed to cancel booking ${booking._id}:`, error.message);
        }
      }

    } catch (error) {
      this.logger.error('❌ Error during cleanup:', error);
    }
  }

  /**
   * Check if a payment is about to expire (within 2 minutes)
   * Used for frontend warnings
   */
  async isPaymentExpiringSoon(paymentId: string): Promise<boolean> {
    const payment = await this.transactionModel.findById(paymentId);

    if (!payment || payment.status !== TransactionStatus.PENDING) {
      return false;
    }

    // ✅ CRITICAL: Use getCurrentVietnamTimeForDB() to match how createdAt is stored
    // createdAt is saved with offset +8h, so we must use the same logic
    const nowVN = getCurrentVietnamTimeForDB();
    const createdAtVN = new Date(payment.createdAt);
    const minutesElapsed = (nowVN.getTime() - createdAtVN.getTime()) / 1000 / 60;

    // Return true if payment is 3+ minutes old (2 minutes left)
    return minutesElapsed >= (this.PAYMENT_EXPIRATION_MINUTES - 2);
  }

  /**
   * Get remaining time for a payment in seconds
   */
  async getPaymentRemainingTime(paymentId: string): Promise<number> {
    const payment = await this.transactionModel.findById(paymentId);

    if (!payment || payment.status !== TransactionStatus.PENDING) {
      return 0;
    }

    // ✅ CRITICAL: Use getCurrentVietnamTimeForDB() to match how createdAt is stored
    // createdAt is saved with offset +8h, so we must use the same logic
    const nowVN = getCurrentVietnamTimeForDB();
    const createdAtVN = new Date(payment.createdAt);
    const elapsedSeconds = (nowVN.getTime() - createdAtVN.getTime()) / 1000;
    const expirationSeconds = this.PAYMENT_EXPIRATION_MINUTES * 60;

    const remainingSeconds = Math.max(0, expirationSeconds - elapsedSeconds);
    return Math.floor(remainingSeconds);
  }

  /**
   * Extend payment expiration time
   * This creates a new "virtual" expiration by updating metadata
   * Note: The payment createdAt is not changed, but we store extension info
   */
  async extendPaymentTime(
    paymentId: string,
    additionalMinutes: number = 5
  ): Promise<void> {
    const payment = await this.transactionModel.findById(paymentId);

    if (!payment || payment.status !== TransactionStatus.PENDING) {
      throw new Error(`Cannot extend transaction ${paymentId}`);
    }

    // ✅ CRITICAL: Use getCurrentVietnamTimeForDB() to match how createdAt is stored (UTC+7)
    const nowVN = getCurrentVietnamTimeForDB();
    const extensions = ((payment as any).metadata?.extensions || 0) + 1;
    const totalExtendedMinutes = ((payment as any).metadata?.totalExtendedMinutes || 0) + additionalMinutes;

    // Limit maximum extensions to 2 times (10 minutes total)
    if (extensions > 2) {
      throw new Error('Maximum payment extensions reached (2 times)');
    }

    // Calculate extended expiration in Vietnam timezone, then convert to UTC for storage
    const extendedExpirationVietnam = new Date(nowVN.getTime() + additionalMinutes * 60 * 1000);

    await this.transactionModel.findByIdAndUpdate(paymentId, {
      metadata: {
        ...((payment as any).metadata || {}),
        extensions,
        totalExtendedMinutes,
        lastExtendedAt: nowVN,
        extendedExpirationTime: extendedExpirationVietnam,
      },
    });

    this.logger.log(
      `✅ Extended payment ${paymentId} by ${additionalMinutes} minutes (Extension #${extensions})`
    );

    // Emit payment.extended event
    this.eventEmitter.emit('payment.extended', {
      paymentId,
      extensions,
      additionalMinutes,
      totalExtendedMinutes,
      extendedAt: nowVN,
    });
  }

  /**
   * Check if payment has been extended and get effective expiration time
   */
  async getEffectiveExpirationTime(paymentId: string): Promise<Date | null> {
    const payment = await this.transactionModel.findById(paymentId);

    if (!payment || payment.status !== TransactionStatus.PENDING) {
      return null;
    }

    const metadata = (payment as any).metadata || {};

    // If payment has been extended, use extended expiration time (stored in UTC+7)
    if (metadata.extendedExpirationTime) {
      return new Date(metadata.extendedExpirationTime);
    }

    // Otherwise, use original expiration (createdAt + 5 minutes in UTC+7 timezone)
    const createdAtVN = new Date(payment.createdAt);
    const originalExpirationUTC8 = new Date(createdAtVN);
    originalExpirationUTC8.setMinutes(
      originalExpirationUTC8.getMinutes() + this.PAYMENT_EXPIRATION_MINUTES
    );
    return originalExpirationUTC8;
  }

  @Cron(CronExpression.EVERY_10_MINUTES, {
    name: 'auto-cancel-pending-coach-bookings',
  })
  async autoCancelPendingCoachBookings(): Promise<void> {
    const nowVN = getCurrentVietnamTimeForDB()

    try {
      const pendingCoachBookings = await this.bookingModel.find({
        type: 'coach',
        coachStatus: 'pending',
      })

      for (const booking of pendingCoachBookings) {
        const shouldCancel = this.shouldAutoCancelCoachBooking(booking, nowVN)

        if (!shouldCancel) {
          continue
        }

        await this.bookingModel.findByIdAndUpdate(
          booking._id,
          {
            coachStatus: 'declined',
            cancellationReason:
              'Automatically cancelled due to no coach response within allowed time',
          }
        )

        this.eventEmitter.emit('coach.booking.autoCancelled', {
          bookingId: booking.id.toString(),
          userId: booking.user.toString(),
          coachId: booking.requestedCoach?.toString(),
          date: booking.date,
          startTime: booking.startTime,
          cancelledAt: nowVN,
        })
      }
    } catch (error) {
      this.logger.error(
        '[Coach Auto-Cancel] Error auto-cancelling pending coach bookings:',
        error
      )
    }
  }

  private getBookingStartDateTime(booking: Booking): Date {
    const [hour, minute] = booking.startTime.split(':').map(Number)
    const start = new Date(booking.date)
    start.setHours(hour, minute, 0, 0)
    return start
  }

  private shouldAutoCancelCoachBooking(
    booking: Booking,
    nowVN: Date
  ): boolean {
    if (
      booking.type !== 'coach' ||
      booking.coachStatus !== 'pending'
    ) {
      return false
    }

    const startDateTime = this.getBookingStartDateTime(booking)

    const createdAt = new Date(booking.createdAt)

    const isSameDay =
      createdAt.toDateString() === startDateTime.toDateString()

    const diffMs = startDateTime.getTime() - nowVN.getTime()

    // Same-day → 5 minutes
    if (isSameDay) {
      return diffMs <= 5 * 60 * 1000
    }

    // Previous-day → 4 hours
    return diffMs <= 4 * 60 * 60 * 1000
  }

}

