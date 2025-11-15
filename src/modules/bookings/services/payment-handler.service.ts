import { Injectable, Logger, OnModuleInit, Inject, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Booking, BookingStatus } from '../entities/booking.entity';
import { Schedule } from '../../schedules/entities/schedule.entity';
import { User } from '../../users/entities/user.entity';
import { FieldOwnerProfile } from '../../fields/entities/field-owner-profile.entity';
import { EmailService } from '../../email/email.service';
import { TransactionsService } from '../../transactions/transactions.service';
import { TransactionStatus } from '../../transactions/entities/transaction.entity';
import { CleanupService } from '../../../service/cleanup.service';

/**
 * Payment Handler Service
 * CRITICAL: Handles payment success/failure/expired events from payment gateway
 * Updates booking status and sends confirmation emails
 */
@Injectable()
export class PaymentHandlerService implements OnModuleInit {
  private readonly logger = new Logger(PaymentHandlerService.name);

  constructor(
    @InjectModel(Booking.name) private readonly bookingModel: Model<Booking>,
    @InjectModel(Schedule.name) private readonly scheduleModel: Model<Schedule>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(FieldOwnerProfile.name) 
    private readonly fieldOwnerProfileModel: Model<FieldOwnerProfile>,
    private readonly eventEmitter: EventEmitter2,
    private readonly emailService: EmailService,
    private readonly transactionsService: TransactionsService,
    @Inject(forwardRef(() => CleanupService)) private readonly cleanupService: CleanupService,
  ) {}

  /**
   * Setup event listeners when module initializes
   */
  onModuleInit() {
    // Listen for payment expired events (from payment cleanup service)
    this.eventEmitter.on('payment.expired', this.handlePaymentExpired.bind(this));
    this.logger.log('✅ Payment event listeners registered (payment.expired)');
  }

  /**
   * Handle payment expired event (from payment cleanup service)
   * Cancels booking and releases schedule slots when payment expires
   */
  private async handlePaymentExpired(event: {
    paymentId: string;
    bookingId: string;
    userId: string;
    amount: number;
    method?: string;
    cancelledAt: Date;
  }): Promise<void> {
    try {
      this.logger.log(`[Payment Expired] Processing for booking ${event.bookingId}`);
      
      // Call handlePaymentFailed with expired reason
      await this.handlePaymentFailed({
        paymentId: event.paymentId,
        bookingId: event.bookingId,
        userId: event.userId,
        amount: event.amount,
        method: event.method,
        reason: 'Payment expired - automatically cancelled after 5 minutes',
      });
    } catch (error) {
      this.logger.error('[Payment Expired] Error handling payment expired event', error);
    }
  }

  /**
   * Handle payment success event
   * Updates booking status from PENDING to CONFIRMED
   * ✅ SECURITY: Idempotent with atomic update to prevent race conditions
   */
  async handlePaymentSuccess(event: {
    paymentId: string;
    bookingId: string;
    userId: string;
    amount: number;
    method?: string;
    transactionId?: string;
  }): Promise<void> {
    try {
      this.logger.log(`[Payment Success] Processing for booking ${event.bookingId}`);
      
      // Validate bookingId format
      if (!Types.ObjectId.isValid(event.bookingId)) {
        this.logger.error(`[Payment Success] Invalid booking ID: ${event.bookingId}`);
        return;
      }

      // ✅ CRITICAL: Verify transaction status is SUCCEEDED before updating booking
      // This ensures transaction is actually succeeded before confirming booking
      const transaction = await this.transactionsService.getPaymentById(event.paymentId);
      
      if (!transaction) {
        this.logger.error(
          `[Payment Success] Transaction ${event.paymentId} not found - cannot confirm booking`
        );
        return;
      }
      
      if (transaction.status !== TransactionStatus.SUCCEEDED && 
          transaction.status !== TransactionStatus.COMPLETED) {
        this.logger.warn(
          `[Payment Success] Transaction ${event.paymentId} status is ${transaction.status}, ` +
          `not SUCCEEDED/COMPLETED - cannot confirm booking. Waiting for transaction to be updated.`
        );
        return;
      }
      
      this.logger.log(
        `[Payment Success] ✅ Transaction ${event.paymentId} verified as ${transaction.status}, ` +
        `proceeding to confirm booking ${event.bookingId}`
      );

      // ✅ SECURITY: Atomic update with condition check (prevents race condition)
      // This ensures only ONE update happens even if webhook is called multiple times
      const updateResult = await this.bookingModel.findOneAndUpdate(
        {
          _id: new Types.ObjectId(event.bookingId),
          status: { $ne: BookingStatus.CONFIRMED } // ✅ Only update if NOT already confirmed
        },
        {
          $set: {
            status: BookingStatus.CONFIRMED,
            transaction: new Types.ObjectId(event.paymentId)
          }
        },
        {
          new: true, // Return updated document
          // ✅ SECURITY: Write concern for durability
          writeConcern: { w: 'majority', j: true }
        }
      ).exec();

      // ✅ SECURITY: Idempotency check - if no update, already processed
      if (!updateResult) {
        const booking = await this.bookingModel.findById(event.bookingId);
        if (!booking) {
          this.logger.error(`[Payment Success] Booking ${event.bookingId} not found`);
          return;
        }
        
        if (booking.status === BookingStatus.CONFIRMED) {
          this.logger.warn(`[Payment Success] Booking ${event.bookingId} already confirmed (idempotent)`);
          return;
        }
        
        this.logger.error(`[Payment Success] Failed to update booking ${event.bookingId}`);
        return;
      }

      this.logger.log(`[Payment Success] ✅ Booking ${event.bookingId} confirmed successfully`);

      // Emit booking confirmed event for other services
      this.eventEmitter.emit('booking.confirmed', {
        bookingId: event.bookingId,
        userId: event.userId,
        fieldId: updateResult.field.toString(),
        date: updateResult.date,
      });

      // Send confirmation emails (non-blocking)
      await this.sendConfirmationEmails(event.bookingId, event.method);

    } catch (error) {
      // ✅ SECURITY: Log errors but don't throw - payment webhooks shouldn't fail
      this.logger.error('[Payment Success] Error processing payment success event', error);
    }
  }

  /**
   * Handle payment failed event
   * Cancels booking and releases schedule slots
   */
  async handlePaymentFailed(event: {
    paymentId: string;
    bookingId: string;
    userId: string;
    amount: number;
    method?: string;
    transactionId?: string;
    reason: string;
  }): Promise<void> {
    try {
      this.logger.log(`[Payment Failed] Processing for booking ${event.bookingId}`);
      
      // Cancel booking and release slots using centralized cleanup service
      // CleanupService handles all validation and idempotency checks
      await this.cleanupService.cancelBookingAndReleaseSlots(
        event.bookingId,
        event.reason || 'Payment failed',
        event.paymentId
      );

      this.logger.log(`[Payment Failed] ⚠️ Booking ${event.bookingId} cancelled due to payment failure`);
      
    } catch (error) {
      this.logger.error('[Payment Failed] Error handling payment failure', error);
      // Don't throw - we don't want to fail the payment update
    }
  }

  /**
   * Release schedule slots when booking is cancelled
   */
  async releaseBookingSlots(booking: Booking): Promise<void> {
    try {
      this.logger.log(`[Release Slots] Releasing slots for booking ${booking._id}`);

      const schedule = await this.scheduleModel.findOne({
        field: booking.field,
        date: booking.date
      });

      if (!schedule) {
        this.logger.warn(`[Release Slots] No schedule found for field ${booking.field} on ${booking.date}`);
        return;
      }

      // Remove the booking's slots from bookedSlots array
      const originalLength = schedule.bookedSlots.length;
      schedule.bookedSlots = schedule.bookedSlots.filter(slot => 
        !(slot.startTime === booking.startTime && slot.endTime === booking.endTime)
      );

      const removedCount = originalLength - schedule.bookedSlots.length;
      
      if (removedCount > 0) {
        await schedule.save();
        this.logger.log(`[Release Slots] ✅ Released ${removedCount} slot(s) for booking ${booking._id}`);
      } else {
        this.logger.warn(`[Release Slots] No matching slots found to release for booking ${booking._id}`);
      }

    } catch (error) {
      this.logger.error('[Release Slots] Error releasing booking slots', error);
      // Don't throw - this is a cleanup operation
    }
  }

  /**
   * Send confirmation emails to field owner and customer
   * Non-blocking operation - errors are logged but don't fail the transaction
   */
  private async sendConfirmationEmails(bookingId: string, paymentMethod?: string): Promise<void> {
    try {
      // Populate booking with field and user details
      const booking = await this.bookingModel
        .findById(bookingId)
        .populate('field')
        .populate('user', 'fullName email phone')
        .exec();

      if (!booking || !booking.field || !booking.user) {
        this.logger.warn(`[Confirmation Email] Booking ${bookingId} not fully populated`);
        return;
      }

      const field = booking.field as any;
      const customerUser = booking.user as any;
      
      const toVnd = (amount: number) => amount.toLocaleString('vi-VN') + '₫';
      const emailPayload = {
        field: { 
          name: field.name, 
          address: field.location?.address || '' 
        },
        customer: { 
          fullName: customerUser.fullName, 
          phone: customerUser.phone, 
          email: customerUser.email 
        },
        booking: {
          date: booking.date.toLocaleDateString('vi-VN'),
          startTime: booking.startTime,
          endTime: booking.endTime,
          services: [],
        },
        pricing: {
          services: [],
          fieldPriceFormatted: toVnd(booking.totalPrice),
          totalFormatted: toVnd(booking.totalPrice),
        },
        paymentMethod,
      };

      // Get field owner email
      const ownerProfileId = field.owner?.toString();
      if (ownerProfileId) {
        let fieldOwnerProfile = await this.fieldOwnerProfileModel
          .findById(ownerProfileId)
          .lean()
          .exec();

        if (!fieldOwnerProfile) {
          fieldOwnerProfile = await this.fieldOwnerProfileModel
            .findOne({ user: new Types.ObjectId(ownerProfileId) })
            .lean()
            .exec();
        }

        let ownerEmail: string | undefined;
        if (fieldOwnerProfile?.user) {
          const ownerUser = await this.userModel
            .findById(fieldOwnerProfile.user)
            .select('email')
            .lean()
            .exec();
          ownerEmail = ownerUser?.email;
        }

        // Send emails (non-blocking, errors logged but don't fail)
        if (ownerEmail) {
          await this.emailService
            .sendFieldOwnerBookingNotification({
              ...emailPayload,
              to: ownerEmail,
            })
            .catch(err => this.logger.warn('[Confirmation Email] Failed to send owner email', err));
        }

        if (customerUser.email) {
          await this.emailService
            .sendCustomerBookingConfirmation({
              ...emailPayload,
              to: customerUser.email,
              preheader: 'Thanh toán thành công - Xác nhận đặt sân',
            })
            .catch(err => this.logger.warn('[Confirmation Email] Failed to send customer email', err));
        }
      }
    } catch (mailErr) {
      // ✅ SECURITY: Email failures don't affect booking confirmation
      this.logger.warn('[Confirmation Email] Failed to send confirmation emails (non-critical)', mailErr);
    }
  }
}


