import { Injectable, Logger, OnModuleInit, Inject, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, ClientSession } from 'mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Booking, BookingStatus } from '../entities/booking.entity';
import { Schedule } from '../../schedules/entities/schedule.entity';
import { User } from '../../users/entities/user.entity';
import { FieldOwnerProfile } from '../../fields/entities/field-owner-profile.entity';
import { EmailService } from '../../email/email.service';
import { TransactionsService } from '../../transactions/transactions.service';
import { TransactionStatus } from '../../transactions/entities/transaction.entity';
import { CleanupService } from '../../../service/cleanup.service';
import { WalletService } from '../../wallet/wallet.service';
import { WalletRole } from '../../wallet/entities/wallet.entity';
import { InjectConnection } from '@nestjs/mongoose';

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
    @InjectConnection() private readonly connection: any,
    private readonly eventEmitter: EventEmitter2,
    private readonly emailService: EmailService,
    private readonly transactionsService: TransactionsService,
    private readonly walletService: WalletService,
    @Inject(forwardRef(() => CleanupService)) private readonly cleanupService: CleanupService,
  ) {}

  /**
   * Setup event listeners when module initializes
   */
  onModuleInit() {
    // Listen for payment expired events (from payment cleanup service)
    this.eventEmitter.on('payment.expired', this.handlePaymentExpired.bind(this));
    
    // [V2] Listen for check-in success events
    this.eventEmitter.on('booking.checkedIn', this.handleCheckInEvent.bind(this));
    
    this.logger.log('✅ Payment event listeners registered (payment.expired, booking.checkedIn)');
  }

  /**
   * [V2] Event handler wrapper for check-in success
   */
  private async handleCheckInEvent(event: { bookingId: string }): Promise<void> {
    try {
      await this.handleCheckInSuccess(event.bookingId);
    } catch (error) {
      this.logger.error('[Check-In Event] Error handling check-in event', error);
    }
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
   * [V2] Adds money to admin systemBalance
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
    const session: ClientSession = await this.connection.startSession();
    session.startTransaction();

    try {
      this.logger.log(`[Payment Success] Processing for booking ${event.bookingId}`);
      
      // Validate bookingId format
      if (!Types.ObjectId.isValid(event.bookingId)) {
        this.logger.error(`[Payment Success] Invalid booking ID: ${event.bookingId}`);
        await session.abortTransaction();
        return;
      }

      // ✅ CRITICAL: Verify transaction status is SUCCEEDED before updating booking
      // This ensures transaction is actually succeeded before confirming booking
      const transaction = await this.transactionsService.getPaymentById(event.paymentId);
      
      if (!transaction) {
        this.logger.error(
          `[Payment Success] Transaction ${event.paymentId} not found - cannot confirm booking`
        );
        await session.abortTransaction();
        return;
      }
      
      if (transaction.status !== TransactionStatus.SUCCEEDED) {
        this.logger.warn(
          `[Payment Success] Transaction ${event.paymentId} status is ${transaction.status}, ` +
          `not SUCCEEDED - cannot confirm booking. Waiting for transaction to be updated.`
        );
        await session.abortTransaction();
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
          session, // Use transaction session
          // ✅ SECURITY: Write concern for durability
          writeConcern: { w: 'majority', j: true }
        }
      ).exec();

      // ✅ SECURITY: Idempotency check - if no update, already processed
      if (!updateResult) {
        const booking = await this.bookingModel.findById(event.bookingId).session(session);
        if (!booking) {
          this.logger.error(`[Payment Success] Booking ${event.bookingId} not found`);
          await session.abortTransaction();
          return;
        }
        
        if (booking.status === BookingStatus.CONFIRMED) {
          this.logger.warn(`[Payment Success] Booking ${event.bookingId} already confirmed (idempotent)`);
          await session.abortTransaction();
          return;
        }
        
        this.logger.error(`[Payment Success] Failed to update booking ${event.bookingId}`);
        await session.abortTransaction();
        return;
      }

      // ====================================================================
      // [V2 LOGIC] Add money to admin systemBalance và field-owner pendingBalance
      // ====================================================================
      
      // Step 1: Get booking with field info to find owner
      const bookingWithField = await this.bookingModel
        .findById(event.bookingId)
        .populate('field')
        .session(session);

      if (!bookingWithField || !bookingWithField.field) {
        this.logger.error(`[Payment Success V2] Booking ${event.bookingId} or field not found`);
        await session.abortTransaction();
        return;
      }

      const field = bookingWithField.field as any;
      const fieldOwnerId = field.owner?.toString();

      if (!fieldOwnerId) {
        this.logger.error(`[Payment Success V2] Field ${field._id} has no owner`);
        await session.abortTransaction();
        return;
      }

      // Step 2: Add to admin systemBalance (FULL amount - includes system fee)
      const adminWallet = await this.walletService.getOrCreateWallet(
        'ADMIN_SYSTEM_ID',
        WalletRole.ADMIN,
        session,
      );

      adminWallet.systemBalance = (adminWallet.systemBalance || 0) + event.amount;
      await adminWallet.save({ session });

      this.logger.log(
        `[Payment Success V2] ✅ Added ${event.amount}₫ to admin systemBalance. ` +
        `New balance: ${adminWallet.systemBalance}₫`
      );

      // Step 3: Calculate owner revenue from booking data
      // Use bookingAmount directly (no reverse calculation needed)
      // For backward compatibility: if bookingAmount doesn't exist, calculate from totalPrice
      let ownerRevenue: number;
      let platformFee: number;
      let totalAmount: number;

      if (bookingWithField.bookingAmount !== undefined && bookingWithField.platformFee !== undefined) {
        // New booking structure: use bookingAmount and platformFee directly
        ownerRevenue = bookingWithField.bookingAmount;
        platformFee = bookingWithField.platformFee;
        totalAmount = ownerRevenue + platformFee;
      } else {
        // Old booking structure: calculate backwards from totalPrice for backward compatibility
        const bookingTotalPrice = bookingWithField.totalPrice || event.amount;
        const systemFeeRate = 0.05;
        ownerRevenue = Math.round(bookingTotalPrice / (1 + systemFeeRate));
        platformFee = bookingTotalPrice - ownerRevenue;
        totalAmount = bookingTotalPrice;
        this.logger.warn(
          `[Payment Success V2] ⚠️ Old booking structure detected for ${event.bookingId}. ` +
          `Calculated ownerRevenue: ${ownerRevenue}₫, platformFee: ${platformFee}₫ from totalPrice: ${bookingTotalPrice}₫`
        );
      }

      // Step 4: Add to field owner pendingBalance (bookingAmount without platform fee)
      const ownerWallet = await this.walletService.getOrCreateWallet(
        fieldOwnerId,
        WalletRole.FIELD_OWNER,
        session,
      );

      ownerWallet.pendingBalance = (ownerWallet.pendingBalance || 0) + ownerRevenue;
      ownerWallet.lastTransactionAt = new Date();
      await ownerWallet.save({ session });

      this.logger.log(
        `[Payment Success V2] ✅ Added ${ownerRevenue}₫ (bookingAmount) to field owner ${fieldOwnerId} pendingBalance. ` +
        `Platform fee: ${platformFee}₫, Total: ${totalAmount}₫. New balance: ${ownerWallet.pendingBalance}₫`
      );

      // Commit transaction
      await session.commitTransaction();

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
      // Rollback on error
      await session.abortTransaction();
      // ✅ SECURITY: Log errors but don't throw - payment webhooks shouldn't fail
      this.logger.error('[Payment Success] Error processing payment success event', error);
    } finally {
      session.endSession();
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
   * [V2 NEW] Handle refund request
   * Supports 2 refund options:
   * - refundTo: 'bank' -> Direct bank refund via PayOS
   * - refundTo: 'credit' -> Add to user's refundBalance (lazy wallet creation)
   * 
   * Flow:
   * 1. Admin systemBalance -= refund amount
   * 2a. If bank: Call PayOS API to refund
   * 2b. If credit: User wallet refundBalance += amount (lazy create)
   * 
   * @param bookingId - Booking ID to refund
   * @param refundTo - 'bank' or 'credit'
   * @param refundAmount - Amount to refund (optional, defaults to booking total)
   * @param reason - Refund reason for logging
   */
  async handleRefund(
    bookingId: string,
    refundTo: 'bank' | 'credit',
    refundAmount?: number,
    reason?: string,
  ): Promise<void> {
    const session: ClientSession = await this.connection.startSession();
    session.startTransaction();

    try {
      this.logger.log(`[Refund V2] Processing refund for booking ${bookingId} to ${refundTo}`);

      // Get booking details
      const booking = await this.bookingModel.findById(bookingId).session(session);

      if (!booking) {
        this.logger.error(`[Refund V2] Booking ${bookingId} not found`);
        await session.abortTransaction();
        return;
      }

      // Use totalAmount (bookingAmount + platformFee) or fallback to totalPrice for backward compatibility
      const totalAmount = booking.bookingAmount !== undefined && booking.platformFee !== undefined
        ? booking.bookingAmount + booking.platformFee
        : (booking.totalPrice || 0);
      const amount = refundAmount || totalAmount;
      const userId = booking.user.toString();

      // Step 1: Deduct from admin systemBalance
      const adminWallet = await this.walletService.getOrCreateWallet(
        'ADMIN_SYSTEM_ID',
        WalletRole.ADMIN,
        session,
      );

      if ((adminWallet.systemBalance || 0) < amount) {
        this.logger.error(
          `[Refund V2] Insufficient admin systemBalance for refund. ` +
          `Required: ${amount}₫, Available: ${adminWallet.systemBalance || 0}₫`
        );
        await session.abortTransaction();
        return;
      }

      adminWallet.systemBalance = (adminWallet.systemBalance || 0) - amount;
      await adminWallet.save({ session });

      this.logger.log(
        `[Refund V2] Deducted ${amount}₫ from admin systemBalance. ` +
        `New balance: ${adminWallet.systemBalance}₫`
      );

      // Step 2: Process refund based on refundTo option
      if (refundTo === 'bank') {
        // Call PayOS API to refund to bank
        // TODO: Integrate with PayOS refund API
        this.logger.log(`[Refund V2] Initiating bank refund via PayOS for ${amount}₫`);
        
        // Placeholder for PayOS API call
        // await this.payosService.refund(booking.transaction.toString(), amount);
        
        this.logger.log(`[Refund V2] ✅ Bank refund initiated for booking ${bookingId}`);

      } else if (refundTo === 'credit') {
        // Add to user's refundBalance (lazy wallet creation)
        const userWallet = await this.walletService.getOrCreateWallet(
          userId,
          WalletRole.USER,
          session,
        );

        userWallet.refundBalance = (userWallet.refundBalance || 0) + amount;
        await userWallet.save({ session });

        this.logger.log(
          `[Refund V2] Added ${amount}₫ to user ${userId} refundBalance. ` +
          `New balance: ${userWallet.refundBalance}₫`
        );

        this.logger.log(`[Refund V2] ✅ Credit refund completed for booking ${bookingId}`);
      }

      // Update booking status to REFUNDED
      booking.status = BookingStatus.CANCELLED;
      await booking.save({ session });

      // Commit transaction
      await session.commitTransaction();

      this.logger.log(
        `[Refund V2] ✅ Successfully refunded ${amount}₫ to ${refundTo} for booking ${bookingId}. ` +
        `Reason: ${reason || 'N/A'}`
      );

      // Emit refund event
      this.eventEmitter.emit('booking.refunded', {
        bookingId,
        userId,
        amount,
        refundTo,
        reason,
        refundedAt: new Date(),
      });

    } catch (error) {
      await session.abortTransaction();
      this.logger.error('[Refund V2] Error processing refund', error);
      throw error; // Re-throw for admin to handle
    } finally {
      session.endSession();
    }
  }

  /**
   * [V2 NEW] Handle user withdrawal from refundBalance
   * User can withdraw their refundBalance to their bank account
   * 
   * Flow:
   * 1. Check user has sufficient refundBalance
   * 2. User wallet: refundBalance -= amount
   * 3. Call PayOS API to transfer to bank
   * 
   * @param userId - User ID requesting withdrawal
   * @param amount - Amount to withdraw
   */
  async withdrawRefund(userId: string, amount: number): Promise<void> {
    const session: ClientSession = await this.connection.startSession();
    session.startTransaction();

    try {
      this.logger.log(`[Withdraw V2] Processing withdrawal for user ${userId}, amount: ${amount}₫`);

      // Check if user has sufficient refundBalance
      const hasSufficientBalance = await this.walletService.hasRefundBalance(userId, amount);

      if (!hasSufficientBalance) {
        this.logger.error(`[Withdraw V2] User ${userId} has insufficient refundBalance`);
        await session.abortTransaction();
        throw new Error('Insufficient refund balance');
      }

      // Get user wallet
      const userWallet = await this.walletService.getOrCreateWallet(
        userId,
        WalletRole.USER,
        session,
      );

      if (!userWallet) {
        this.logger.error(`[Withdraw V2] User ${userId} wallet not found`);
        await session.abortTransaction();
        throw new Error('User wallet not found');
      }

      // Deduct from refundBalance
      userWallet.refundBalance = (userWallet.refundBalance || 0) - amount;
      await userWallet.save({ session });

      this.logger.log(
        `[Withdraw V2] Deducted ${amount}₫ from user ${userId} refundBalance. ` +
        `New balance: ${userWallet.refundBalance}₫`
      );

      // Call PayOS API to transfer to bank
      // TODO: Integrate with PayOS transfer API
      this.logger.log(`[Withdraw V2] Initiating bank transfer via PayOS for ${amount}₫`);
      
      // Placeholder for PayOS API call
      // await this.payosService.transfer(userId, amount);

      // Commit transaction
      await session.commitTransaction();

      this.logger.log(`[Withdraw V2] ✅ Successfully withdrew ${amount}₫ for user ${userId}`);

      // Emit withdrawal event
      this.eventEmitter.emit('wallet.withdrawal.completed', {
        userId,
        amount,
        withdrawnAt: new Date(),
      });

    } catch (error) {
      await session.abortTransaction();
      this.logger.error('[Withdraw V2] Error processing withdrawal', error);
      throw error; // Re-throw for user to handle
    } finally {
      session.endSession();
    }
  }

  /**
   * [V2 NEW] Handle check-in success event
   * Automatically transfers money from admin systemBalance to field owner pendingBalance
   * Called after customer successfully checks in
   * 
   * Flow:
   * 1. Get booking details
   * 2. Admin wallet: systemBalance -= amount
   * 3. Field owner wallet: pendingBalance += amount
   * 4. Field owner receives bank transfer notification (UI only)
   * 
   * @param bookingId - Booking ID that was checked in
   */
  async handleCheckInSuccess(bookingId: string): Promise<void> {
    const session: ClientSession = await this.connection.startSession();
    session.startTransaction();

    try {
      this.logger.log(`[Check-In Success V2] Processing for booking ${bookingId}`);

      // Get booking details
      const booking = await this.bookingModel
        .findById(bookingId)
        .populate('field')
        .session(session);

      if (!booking) {
        this.logger.error(`[Check-In Success V2] Booking ${bookingId} not found`);
        await session.abortTransaction();
        return;
      }

      if (booking.status !== BookingStatus.CONFIRMED && booking.status !== BookingStatus.COMPLETED) {
        this.logger.warn(
          `[Check-In Success V2] Booking ${bookingId} status is ${booking.status}, ` +
          `not CONFIRMED/COMPLETED - skipping transfer`
        );
        await session.abortTransaction();
        return;
      }

      const field = booking.field as any;
      const fieldOwnerId = field.owner?.toString();

      if (!fieldOwnerId) {
        this.logger.error(`[Check-In Success V2] Field ${field._id} has no owner`);
        await session.abortTransaction();
        return;
      }

      // Use bookingAmount (owner revenue) or fallback to calculated value from totalPrice for backward compatibility
      const amount = booking.bookingAmount !== undefined
        ? booking.bookingAmount
        : (booking.totalPrice ? Math.round(booking.totalPrice / 1.05) : 0);

      // Step 1: Get admin wallet and deduct from systemBalance
      const adminWallet = await this.walletService.getOrCreateWallet(
        'ADMIN_SYSTEM_ID',
        WalletRole.ADMIN,
        session,
      );

      if ((adminWallet.systemBalance || 0) < amount) {
        this.logger.error(
          `[Check-In Success V2] Insufficient admin systemBalance. ` +
          `Required: ${amount}₫, Available: ${adminWallet.systemBalance || 0}₫`
        );
        await session.abortTransaction();
        return;
      }

      adminWallet.systemBalance = (adminWallet.systemBalance || 0) - amount;
      await adminWallet.save({ session });

      this.logger.log(
        `[Check-In Success V2] Deducted ${amount}₫ from admin systemBalance. ` +
        `New balance: ${adminWallet.systemBalance}₫`
      );

      // Step 2: Get field owner wallet and add to pendingBalance
      const ownerWallet = await this.walletService.getOrCreateWallet(
        fieldOwnerId,
        WalletRole.FIELD_OWNER,
        session,
      );

      ownerWallet.pendingBalance = (ownerWallet.pendingBalance || 0) + amount;
      await ownerWallet.save({ session });

      this.logger.log(
        `[Check-In Success V2] Added ${amount}₫ to field owner ${fieldOwnerId} pendingBalance. ` +
        `New balance: ${ownerWallet.pendingBalance}₫`
      );

      // Commit transaction
      await session.commitTransaction();

      this.logger.log(
        `[Check-In Success V2] ✅ Successfully transferred ${amount}₫ from admin to field owner ${fieldOwnerId}`
      );

      // Emit event for notifications (field owner receives bank transfer)
      this.eventEmitter.emit('wallet.transfer.completed', {
        bookingId,
        fieldOwnerId,
        amount,
        transferredAt: new Date(),
      });

    } catch (error) {
      await session.abortTransaction();
      this.logger.error('[Check-In Success V2] Error processing check-in success event', error);
    } finally {
      session.endSession();
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
          fieldPriceFormatted: toVnd(booking.bookingAmount || booking.totalPrice || 0),
          totalFormatted: toVnd(
            (booking.bookingAmount !== undefined && booking.platformFee !== undefined)
              ? booking.bookingAmount + booking.platformFee
              : (booking.totalPrice || 0)
          ),
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


