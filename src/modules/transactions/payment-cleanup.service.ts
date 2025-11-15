import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Transaction, TransactionStatus, TransactionType } from './entities/transaction.entity';
import { CleanupService } from '../../service/cleanup.service';

/**
 * Payment Cleanup Service
 * Automatically cancels expired pending payments
 * Runs periodically to maintain data integrity
 */
@Injectable()
export class PaymentCleanupService {
  private readonly logger = new Logger(PaymentCleanupService.name);
  
  // Payment expiration time in minutes
  private readonly PAYMENT_EXPIRATION_MINUTES = 5;
  
  constructor(
    @InjectModel(Transaction.name) private readonly transactionModel: Model<Transaction>,
    private readonly cleanupService: CleanupService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Cron job: Check for expired payments every 5 minutes
   * Runs at: 0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55 minutes past every hour
   */
  @Cron(CronExpression.EVERY_5_MINUTES, {
    name: 'cleanup-expired-payments',
  })
  async handleExpiredPayments(): Promise<void> {
    try {
      this.logger.log('🔍 Starting expired payments cleanup...');
      
      // Calculate expiration threshold (5 minutes ago)
      const now = new Date();
      const expirationThreshold = new Date(now);
      expirationThreshold.setMinutes(
        expirationThreshold.getMinutes() - this.PAYMENT_EXPIRATION_MINUTES
      );

      this.logger.debug(`[Cleanup] Current time: ${now.toISOString()}`);
      this.logger.debug(`[Cleanup] Expiration threshold: ${expirationThreshold.toISOString()}`);
      this.logger.debug(`[Cleanup] Looking for payments created before: ${expirationThreshold.toISOString()}`);

      // Debug: Check all pending payments first
      const allPendingPayments = await this.transactionModel.find({
        status: TransactionStatus.PENDING,
        type: TransactionType.PAYMENT,
      }).select('_id createdAt status type').lean();

      this.logger.debug(`[Cleanup] Found ${allPendingPayments.length} total pending payments`);
      // Note: Detailed logging with booking reference is done in the filter function below

      // Find all pending payments (we'll filter by time in JavaScript to avoid timezone issues)
      // This approach is more reliable when dealing with timezone differences
      const query = {
        status: TransactionStatus.PENDING, // 'pending'
        type: TransactionType.PAYMENT, // 'payment'
      };
      
      this.logger.debug(`[Cleanup] Query: ${JSON.stringify({
        status: query.status,
        type: query.type,
      })}`);

      // Find all pending payments
      const allPendingPaymentsWithDetails = await this.transactionModel.find(query)
        .populate('booking')
        .populate('user', 'email fullName');
      
      this.logger.debug(`[Cleanup] Found ${allPendingPaymentsWithDetails.length} pending payments to check`);
      
      // Filter payments that are actually expired
      // Use booking.createdAt as reference point because:
      // 1. Both booking and transaction use the same currentTime() function (UTC+7 offset)
      // 2. They are created almost simultaneously (in same transaction)
      // 3. Comparing relative times avoids timezone issues
      const validExpiredPayments = allPendingPaymentsWithDetails.filter((payment: any) => {
        const booking = payment.booking;
        
        // If no booking, skip (shouldn't happen for payment transactions)
        if (!booking) {
          this.logger.warn(`[Cleanup] ⚠️ Payment ${payment._id} has no booking, skipping`);
          return false;
        }
        
        // ⚠️ DATA INCONSISTENCY CHECK: If booking is confirmed but transaction is still pending,
        // this is a data integrity issue. We'll mark both transaction and booking as FAILED/CANCELLED.
        const hasDataInconsistency = (booking as any).status === 'confirmed';
        if (hasDataInconsistency) {
          this.logger.warn(
            `[Cleanup] ⚠️ DATA INCONSISTENCY: Payment ${payment._id} is PENDING but booking ${(booking as any)._id} is CONFIRMED. ` +
            `This should not happen. Will mark both transaction and booking as FAILED/CANCELLED to fix data integrity.`
          );
        }
        
        // Use booking creation time as reference
        // Both booking.createdAt and payment.createdAt have the same UTC+7 offset
        // So comparing relative time is safe and accurate
        const bookingCreatedAt = new Date((booking as any).createdAt);
        const timeSinceBookingMs = now.getTime() - bookingCreatedAt.getTime();
        const timeSinceBookingMinutes = timeSinceBookingMs / 1000 / 60;
        
        // Payment is expired if booking was created >= 5 minutes ago
        // OR if there's a data inconsistency (needs immediate fix)
        const isExpired = timeSinceBookingMinutes >= this.PAYMENT_EXPIRATION_MINUTES || hasDataInconsistency;
        
        this.logger.debug(
          `[Cleanup] Payment ${payment._id}: ` +
          `booking created ${timeSinceBookingMinutes.toFixed(2)} minutes ago ` +
          `(${bookingCreatedAt.toISOString()}) ` +
          `booking status: ${(booking as any).status} ` +
          `${isExpired ? (hasDataInconsistency ? '⚠️ DATA INCONSISTENCY - Will fix' : '⚠️ EXPIRED') : '⏳ Still valid'}`
        );
        
        return isExpired;
      });

      this.logger.debug(`[Cleanup] Found ${allPendingPaymentsWithDetails.length} pending payments, ${validExpiredPayments.length} are actually expired`);

      if (validExpiredPayments.length === 0) {
        this.logger.log('✅ No expired payments found');
        return;
      }

      this.logger.warn(
        `⚠️  Found ${validExpiredPayments.length} expired payment(s), cancelling...`
      );

      // Cancel each expired payment
      let successCount = 0;
      let errorCount = 0;

      for (const payment of validExpiredPayments) {
        try {
          const booking = (payment as any).booking;
          const hasDataInconsistency = booking?.status === 'confirmed';
          await this.cleanupService.cancelExpiredPaymentAndBooking(payment, hasDataInconsistency);
          successCount++;
        } catch (error) {
          errorCount++;
          this.logger.error(
            `Failed to cancel payment ${payment._id}:`,
            error.message
          );
        }
      }

      this.logger.log(
        `✅ Cleanup completed: ${successCount} cancelled, ${errorCount} failed`
      );
    } catch (error) {
      this.logger.error('❌ Error during expired payments cleanup:', error);
    }
  }

  /**
   * Manual trigger to cancel a specific payment
   * Can be called from API endpoint for immediate cancellation
   */
  async cancelPaymentManually(
    paymentId: string,
    reason: string = 'User cancelled'
  ): Promise<void> {
    await this.cleanupService.cancelPaymentManually(paymentId, reason);
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

    const now = new Date();
    const createdAt = new Date(payment.createdAt);
    const minutesElapsed = (now.getTime() - createdAt.getTime()) / 1000 / 60;
    
    // Return true if payment is 13+ minutes old (2 minutes left)
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

    const now = new Date();
    const createdAt = new Date(payment.createdAt);
    const elapsedSeconds = (now.getTime() - createdAt.getTime()) / 1000;
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

    const now = new Date();
    const extensions = ((payment as any).metadata?.extensions || 0) + 1;
    const totalExtendedMinutes = ((payment as any).metadata?.totalExtendedMinutes || 0) + additionalMinutes;

    // Limit maximum extensions to 2 times (10 minutes total)
    if (extensions > 2) {
      throw new Error('Maximum payment extensions reached (2 times)');
    }

    await this.transactionModel.findByIdAndUpdate(paymentId, {
      metadata: {
        ...((payment as any).metadata || {}),
        extensions,
        totalExtendedMinutes,
        lastExtendedAt: now,
        extendedExpirationTime: new Date(now.getTime() + additionalMinutes * 60 * 1000),
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
      extendedAt: now,
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
    
    // If payment has been extended, use extended expiration time
    if (metadata.extendedExpirationTime) {
      return new Date(metadata.extendedExpirationTime);
    }

    // Otherwise, use original expiration (createdAt + 5 minutes)
    const originalExpiration = new Date(payment.createdAt);
    originalExpiration.setMinutes(
      originalExpiration.getMinutes() + this.PAYMENT_EXPIRATION_MINUTES
    );
    return originalExpiration;
  }
}
