import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Transaction, TransactionStatus, TransactionType } from './entities/transaction.entity';
import { EventEmitter2 } from '@nestjs/event-emitter';

/**
 * Payment Cleanup Service
 * Automatically cancels expired pending payments
 * Runs periodically to maintain data integrity
 */
@Injectable()
export class PaymentCleanupService {
  private readonly logger = new Logger(PaymentCleanupService.name);
  
  // Payment expiration time in minutes
  private readonly PAYMENT_EXPIRATION_MINUTES = 15;
  
  constructor(
    @InjectModel(Transaction.name) private readonly transactionModel: Model<Transaction>,
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
      
      // Calculate expiration threshold (15 minutes ago)
      const expirationThreshold = new Date();
      expirationThreshold.setMinutes(
        expirationThreshold.getMinutes() - this.PAYMENT_EXPIRATION_MINUTES
      );

      // Find all pending transactions older than 15 minutes
      const expiredPayments = await this.transactionModel.find({
        status: TransactionStatus.PENDING,
        type: TransactionType.PAYMENT,
        createdAt: { $lt: expirationThreshold },
      }).populate('booking').populate('user', 'email fullName');

      if (expiredPayments.length === 0) {
        this.logger.log('✅ No expired payments found');
        return;
      }

      this.logger.warn(
        `⚠️  Found ${expiredPayments.length} expired payment(s), cancelling...`
      );

      // Cancel each expired payment
      let successCount = 0;
      let errorCount = 0;

      for (const payment of expiredPayments) {
        try {
          await this.cancelExpiredPayment(payment);
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
   * Cancel a single expired transaction
   */
  private async cancelExpiredPayment(payment: Transaction): Promise<void> {
    const paymentId = (payment._id as any).toString();
    const bookingId = (payment.booking as any)?._id?.toString() || payment.booking;
    const userId = (payment.user as any)?._id?.toString() || payment.user;

    // Update transaction status to FAILED
    await this.transactionModel.findByIdAndUpdate(paymentId, {
      status: TransactionStatus.FAILED,
      notes: 'Transaction expired - automatically cancelled after 15 minutes',
      errorMessage: 'Payment timeout',
      metadata: {
        ...((payment as any).metadata || {}),
        cancelledAt: new Date(),
        cancelReason: 'timeout',
        autoCancel: true,
      },
    });

    this.logger.warn(
      `⚠️  Cancelled expired payment ${paymentId} (Booking: ${bookingId})`
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
    });
  }

  /**
   * Manual trigger to cancel a specific payment
   * Can be called from API endpoint for immediate cancellation
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

    // Emit payment.cancelled event
    this.eventEmitter.emit('payment.cancelled', {
      paymentId: paymentId,
      bookingId: (payment.booking as any)?._id?.toString() || payment.booking,
      userId: (payment.user as any)?._id?.toString() || payment.user,
      amount: payment.amount,
      method: payment.method,
      reason,
      cancelledAt: new Date(),
    });
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

    // Otherwise, use original expiration (createdAt + 15 minutes)
    const originalExpiration = new Date(payment.createdAt);
    originalExpiration.setMinutes(
      originalExpiration.getMinutes() + this.PAYMENT_EXPIRATION_MINUTES
    );
    return originalExpiration;
  }
}
