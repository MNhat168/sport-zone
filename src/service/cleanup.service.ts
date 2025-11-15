import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Transaction, TransactionStatus } from '../modules/transactions/entities/transaction.entity';
import { Booking, BookingStatus } from '../modules/bookings/entities/booking.entity';
import { PaymentHandlerService } from '../modules/bookings/services/payment-handler.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

/**
 * Cleanup Service
 * Centralized service for cleanup operations:
 * - Cancel expired payments and bookings
 * - Release schedule slots
 * - Fix data inconsistencies
 */
@Injectable()
export class CleanupService {
  private readonly logger = new Logger(CleanupService.name);

  constructor(
    @InjectModel(Transaction.name) private readonly transactionModel: Model<Transaction>,
    @InjectModel(Booking.name) private readonly bookingModel: Model<Booking>,
    private readonly eventEmitter: EventEmitter2,
    @Inject(forwardRef(() => PaymentHandlerService))
    private readonly paymentHandlerService: PaymentHandlerService,
  ) {}

  /**
   * Cancel expired payment and associated booking
   * Handles both normal expiration and data inconsistency cases
   */
  async cancelExpiredPaymentAndBooking(
    payment: Transaction,
    hasDataInconsistency: boolean = false
  ): Promise<void> {
    const paymentId = (payment._id as any).toString();
    const bookingId = (payment.booking as any)?._id?.toString() || payment.booking;
    const userId = (payment.user as any)?._id?.toString() || payment.user;
    const booking = (payment as any).booking;
    const bookingStatus = booking?.status || 'unknown';

    const notes = hasDataInconsistency
      ? 'Transaction expired - automatically cancelled after 5 minutes. ⚠️ DATA INCONSISTENCY: Booking was CONFIRMED but transaction was still PENDING. This has been corrected by marking both transaction and booking as FAILED/CANCELLED.'
      : 'Transaction expired - automatically cancelled after 5 minutes';

    // Update transaction status to FAILED
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

    // If booking exists and is still pending/confirmed, cancel it and release slots
    // This handles both normal expiration and data inconsistency cases
    if (bookingId) {
      try {
        // Get booking details first to check status and release slots
        const bookingToCancel = await this.bookingModel.findById(bookingId);
        
        if (bookingToCancel) {
          // Only cancel if booking is still pending or confirmed (not already cancelled)
          if (bookingToCancel.status === BookingStatus.PENDING || bookingToCancel.status === BookingStatus.CONFIRMED) {
            const cancellationReason = hasDataInconsistency
              ? 'Payment expired - Data inconsistency: Booking was CONFIRMED but payment was still PENDING. This has been corrected by cancelling the booking.'
              : 'Payment expired - automatically cancelled after 5 minutes';
            
            // Cancel the booking and release slots
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

    // Emit payment.expired event for other services to handle
    // (e.g., cancel booking, send notification)
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
   * Cancel booking and release schedule slots
   * Centralized method for cancelling bookings with slot release
   */
  async cancelBookingAndReleaseSlots(
    bookingId: string,
    cancellationReason: string,
    paymentId?: string
  ): Promise<void> {
    try {
      // Validate bookingId
      if (!Types.ObjectId.isValid(bookingId)) {
        this.logger.error(`[Cancel Booking] Invalid booking ID: ${bookingId}`);
        return;
      }

      // Find booking
      const booking = await this.bookingModel.findById(bookingId);
      if (!booking) {
        this.logger.error(`[Cancel Booking] Booking ${bookingId} not found`);
        return;
      }

      // Check if already cancelled (idempotency)
      if (booking.status === BookingStatus.CANCELLED) {
        this.logger.warn(`[Cancel Booking] Booking ${bookingId} already cancelled`);
        return;
      }

      // Only cancel if booking is still pending or confirmed
      if (booking.status !== BookingStatus.PENDING && booking.status !== BookingStatus.CONFIRMED) {
        this.logger.warn(`[Cancel Booking] Booking ${bookingId} status is ${booking.status}, cannot cancel`);
        return;
      }

      // Update booking status
      const updateData: any = {
        status: BookingStatus.CANCELLED,
        cancellationReason,
      };

      // Update transaction reference if provided
      if (paymentId) {
        updateData.transaction = new Types.ObjectId(paymentId);
      }

      await this.bookingModel.findByIdAndUpdate(
        new Types.ObjectId(bookingId),
        { $set: updateData },
        { new: true }
      );

      this.logger.log(`[Cancel Booking] ✅ Cancelled booking ${bookingId}: ${cancellationReason}`);

      // Release schedule slots
      await this.paymentHandlerService.releaseBookingSlots(booking);

      // Emit booking cancelled event
      this.eventEmitter.emit('booking.cancelled', {
        bookingId,
        userId: booking.user.toString(),
        fieldId: booking.field.toString(),
        reason: cancellationReason,
      });

    } catch (error) {
      this.logger.error(`[Cancel Booking] Error cancelling booking ${bookingId}:`, error);
      throw error;
    }
  }

  /**
   * Cancel a payment manually and associated booking if exists
   */
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

    // Update transaction status
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

    // Cancel associated booking if exists
    const bookingId = (payment.booking as any)?._id?.toString() || payment.booking;
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

    // Emit payment.cancelled event
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
}

