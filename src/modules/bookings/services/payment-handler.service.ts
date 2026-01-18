import { Injectable, Logger, OnModuleInit, Inject, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, ClientSession } from 'mongoose';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { Booking } from '../entities/booking.entity';
import { BookingStatus, BookingType } from '@common/enums/booking.enum';
import { Schedule } from '../../schedules/entities/schedule.entity';
import { User } from '../../users/entities/user.entity';
import { FieldOwnerProfile } from '../../field-owner/entities/field-owner-profile.entity';
import { CoachProfile } from '../../coaches/entities/coach-profile.entity';
import { EmailService } from '../../email/email.service';
import { BookingEmailService } from './booking-email.service';
import { TransactionsService } from '../../transactions/transactions.service';
import { TransactionStatus } from '@common/enums/transaction.enum';
import { CleanupService } from '../../../service/cleanup.service';
import { WalletService } from '../../wallet/wallet.service';
import { WalletRole } from '@common/enums/wallet.enum';
import { InjectConnection } from '@nestjs/mongoose';
import { BookingsService } from '../bookings.service';

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
    @InjectModel(CoachProfile.name)
    private readonly coachProfileModel: Model<CoachProfile>,
    @InjectConnection() private readonly connection: any,
    private readonly eventEmitter: EventEmitter2,
    private readonly emailService: EmailService,
    private readonly bookingEmailService: BookingEmailService,
    private readonly transactionsService: TransactionsService,
    private readonly walletService: WalletService,
    @Inject(forwardRef(() => CleanupService)) private readonly cleanupService: CleanupService,
    @Inject(forwardRef(() => BookingsService)) private readonly bookingsService: BookingsService,
  ) {
    this.logger.log('PaymentHandlerService CONSTRUCTOR call');
  }

  /**
   * Setup event listeners when module initializes
   */
  onModuleInit() {
    this.logger.log('✅ PaymentHandlerService initialized');
  }

  /**
   * [V2] Event handler wrapper for check-in success
   */
  @OnEvent('booking.checkedIn')
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
  @OnEvent('payment.expired')
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
  /**
   * Handle payment success event
   * Updates booking status from PENDING to CONFIRMED
   * [V2] Adds money to admin systemBalance
   * ✅ SECURITY: Idempotent with atomic update to prevent race conditions
   */
  /**
   * Handle payment success event
   * Updates booking status from PENDING to CONFIRMED
   * [V2] Adds money to admin systemBalance
   * ✅ SECURITY: Idempotent with atomic update to prevent race conditions
   */
  @OnEvent('payment.success')
  async handlePaymentSuccess(event: {
    paymentId: string;
    bookingId: string; // Primary booking ID (or any format)
    userId: string;
    amount: number;
    method?: string;
    transactionId?: string;
  }): Promise<void> {
    const session: ClientSession = await this.connection.startSession();
    session.startTransaction();

    try {
      this.logger.log(`[Payment Success] Processing payment ${event.paymentId} for booking ${event.bookingId}`);

      // ✅ CRITICAL FIX 2: Query transaction WITHOUT session to avoid read isolation
      // Transaction was updated in webhook handler (no session), so we need to read latest data
      const transaction = await this.transactionsService.getPaymentById(event.paymentId);

      if (!transaction) {
        this.logger.error(`[Payment Success] Transaction ${event.paymentId} not found`);
        await session.abortTransaction();
        return;
      }

      if (transaction.status !== TransactionStatus.SUCCEEDED) {
        this.logger.warn(`[Payment Success] Transaction ${event.paymentId} status is ${transaction.status}, waiting...`);
        await session.abortTransaction();
        return;
      }

      // Handle Coach Verification (Non-booking)
      if ((transaction as any).metadata?.purpose === 'ACCOUNT_VERIFICATION' && (transaction as any).metadata?.targetRole === 'coach') {
        const coachUserId = (transaction.user as any)?.toString?.() || String(transaction.user);
        const coachProfileId = (transaction as any).metadata?.coachId;
        if (coachProfileId) {
          await this.coachProfileModel.findByIdAndUpdate(coachProfileId, { $set: { bankVerified: true, bankVerifiedAt: new Date() } }, { new: true });
        } else if (coachUserId) {
          await this.coachProfileModel.findOneAndUpdate({ user: new Types.ObjectId(coachUserId) }, { $set: { bankVerified: true, bankVerifiedAt: new Date() } }, { new: true });
        }
        await session.commitTransaction();
        return;
      }

      // ✅ CRITICAL FIX 2: Query bookings WITHOUT session first to avoid read isolation
      // Then retry with session if needed
      let bookings: Booking[] = [];
      let retryCount = 0;
      const maxRetries = 3;
      const retryDelay = 100; // ms

      while (bookings.length === 0 && retryCount < maxRetries) {
        if (retryCount > 0) {
          this.logger.warn(`[Payment Success] Retry ${retryCount}/${maxRetries} to find bookings for transaction ${transaction._id}`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
        }

        // Try finding bookings WITHOUT session first (to see latest data)
        bookings = await this.bookingsService.findBookingsByTransaction(transaction, undefined);

        // If not found, try with session (for transaction consistency)
        if (bookings.length === 0) {
          bookings = await this.bookingsService.findBookingsByTransaction(transaction, session);
        }

        retryCount++;
      }

      // ✅ CRITICAL FIX 3: Improved fallback logic
      if (bookings.length === 0) {
        this.logger.warn(`[Payment Success] No bookings found by transaction, trying fallbacks`);

        // Fallback 1: Try event.bookingId
        if (event.bookingId && Types.ObjectId.isValid(event.bookingId)) {
          const singleBooking = await this.bookingModel.findById(event.bookingId).exec();
          if (singleBooking) {
            this.logger.log(`[Payment Success] ✅ Found booking via event.bookingId`);
            bookings = [singleBooking];
          }
        }

        // Fallback 2: Try transaction.metadata.bookingId
        if (bookings.length === 0 && transaction.metadata?.bookingId && Types.ObjectId.isValid(String(transaction.metadata.bookingId))) {
          const metadataBookingId = String(transaction.metadata.bookingId);
          const metadataBooking = await this.bookingModel.findById(metadataBookingId).exec();
          if (metadataBooking) {
            this.logger.log(`[Payment Success] ✅ Found booking via metadata.bookingId`);
            bookings = [metadataBooking];
          }
        }

        // Fallback 3: Try direct booking.transaction link
        if (bookings.length === 0) {
          const directLinkBookings = await this.bookingModel.find({ transaction: transaction._id }).exec();
          if (directLinkBookings.length > 0) {
            this.logger.log(`[Payment Success] ✅ Found ${directLinkBookings.length} booking(s) via direct transaction link`);
            bookings = directLinkBookings;
          }
        }
      }

      if (bookings.length === 0) {
        this.logger.error(`[Payment Success] ❌ No bookings found for payment ${event.paymentId}`);
        await session.abortTransaction();
        return;
      }

      this.logger.log(`[Payment Success] Found ${bookings.length} booking(s) to confirm`);

      // ✅ 2. Admin Balance Update (ONCE per transaction)
      const adminWallet = await this.walletService.getOrCreateWallet('ADMIN_SYSTEM_ID', WalletRole.ADMIN, session);
      adminWallet.systemBalance = (adminWallet.systemBalance || 0) + event.amount;
      await adminWallet.save({ session });
      this.logger.log(`[Payment Success V2] ✅ Added ${event.amount}₫ to Admin. New Balance: ${adminWallet.systemBalance}₫`);

      // ✅ 3. Process Bookings & Calculate Owner Revenue
      const ownerRevenueMap = new Map<string, number>(); // OwnerID -> Revenue
      const recurringGroupsProcessed = new Set<string>(); // Track recurring groups for email

      for (const booking of bookings) {
        // Idempotency check
        if (booking.status === BookingStatus.CONFIRMED && booking.paymentStatus === 'paid') {
          this.logger.debug(`[Payment Success] Booking ${booking._id} already confirmed and paid, skipping`);
          continue; // Already processed
        }

        const isCoach = booking.type === BookingType.COACH;

        // Update Status
        booking.paymentStatus = 'paid';
        if (!isCoach) booking.status = BookingStatus.CONFIRMED;

        try {
          await booking.save({ session });
        } catch (saveError) {
          this.logger.error(`[Payment Success] ❌ Failed to save booking ${booking._id}: ${saveError.message}`, saveError);
          throw saveError; // Re-throw to trigger transaction rollback
        }

        // Emit Events
        this.eventEmitter.emit('booking.confirmed', {
          bookingId: booking.id.toString(),
          userId: event.userId,
          fieldId: booking.field?.toString() || null,
          courtId: booking.court?.toString() || null,
          date: booking.date,
        });

        // ✅ NEW: Send email only once per recurring group (or per single booking)
        const recurringGroupId = booking.recurringGroupId?.toString();
        if (recurringGroupId) {
          // This is a recurring booking - only send email for the first booking in the group
          if (!recurringGroupsProcessed.has(recurringGroupId)) {
            recurringGroupsProcessed.add(recurringGroupId);
            // Send consolidated email for the entire recurring group
            this.bookingEmailService.sendRecurringConfirmationEmail(
              recurringGroupId,
              event.method
            ).catch(e => this.logger.error('[Payment Success] Failed to send recurring email:', e));
            this.logger.log(`[Payment Success] Sent consolidated email for recurring group ${recurringGroupId}`);
          }
        } else {
          // Single booking - send individual email as before
          this.bookingEmailService.sendConfirmationEmails(booking.id.toString(), event.method)
            .catch(e => this.logger.error('[Payment Success] Failed to send confirmation email:', e));
        }

        // Calculate Revenue for Owner
        if (booking.field) {
          // Populate field and field.owner (FieldOwnerProfile) to get the actual userId
          const bookingWithField = await this.bookingModel
            .findById(booking._id)
            .populate({
              path: 'field',
              populate: {
                path: 'owner',
                model: 'FieldOwnerProfile',
              },
            })
            .session(session);

          if (bookingWithField && bookingWithField.field) {
            const field = bookingWithField.field as any;
            // field.owner is now populated FieldOwnerProfile document
            // We need the user field from FieldOwnerProfile, not the profile _id
            const ownerProfile = field.owner;
            const ownerUserId = ownerProfile?.user?.toString();

            if (ownerUserId) {
              let revenue = 0;
              if (bookingWithField.bookingAmount !== undefined) {
                revenue = bookingWithField.bookingAmount;
              } else {
                // Legacy calc
                const total = booking.totalPrice || 0;
                revenue = Math.round(total / 1.05);
              }

              const current = ownerRevenueMap.get(ownerUserId) || 0;
              ownerRevenueMap.set(ownerUserId, current + revenue);
              this.logger.debug(`[Payment Success] Mapped revenue ${revenue}₫ for owner profile ${ownerProfile._id}, userId: ${ownerUserId}`);
            } else {
              this.logger.warn(`[Payment Success] ⚠️ Could not find owner userId for field ${field._id}`);
            }
          }
        }
      }

      // ✅ 4. Owner Balance Update (Aggregated)
      for (const [ownerId, revenue] of ownerRevenueMap.entries()) {
        const ownerWallet = await this.walletService.getOrCreateWallet(ownerId, WalletRole.FIELD_OWNER, session);
        ownerWallet.pendingBalance = (ownerWallet.pendingBalance || 0) + revenue;
        ownerWallet.lastTransactionAt = new Date();
        await ownerWallet.save({ session });
        this.logger.log(`[Payment Success V2] ✅ Added ${revenue}₫ to Owner ${ownerId}. New Pending: ${ownerWallet.pendingBalance}₫`);
      }

      await session.commitTransaction();
      this.logger.log(`[Payment Success] ✅ Successfully confirmed ${bookings.length} booking(s)`);

    } catch (error) {
      await session.abortTransaction();
      this.logger.error(`[Payment Success] ❌ Error processing payment success: ${error.message}`, error);
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
   * Uses MongoDB $pull operator for atomic slot removal
   * Handles date normalization to match schedule storage format
   * 
   * ⚠️ IMPORTANT: 
   * - booking.date and schedule.date are stored as UTC midnight (no offset)
   * - Must use setUTCHours(0,0,0,0) to normalize date correctly
   * - This works correctly regardless of server timezone (UTC+8 Singapore, etc.)
   */
  async releaseBookingSlots(booking: Booking): Promise<void> {
    try {
      this.logger.log(
        `[Release Slots] 🔓 Releasing schedule slots for booking ${booking._id} ` +
        `(field: ${booking.field}, date: ${new Date(booking.date).toISOString().split('T')[0]}, ` +
        `slot: ${booking.startTime}-${booking.endTime}, type: ${booking.type})`
      );

      // ✅ CRITICAL: Use UTC methods to normalize date, not local time methods
      const bookingDate = new Date(booking.date);
      bookingDate.setUTCHours(0, 0, 0, 0);

      // Construct query based on booking type
      let query: any = { date: bookingDate };

      // Case 1: Coach Booking - Must use 'coach' field, NOT 'field' (field is optional/informational)
      if (booking.type === BookingType.COACH && booking.requestedCoach) {
        query.coach = booking.requestedCoach;
        // Coach schedules don't use court
      }
      // Case 2: Field Booking with specific Court - Must use 'court' field
      else if (booking.court) {
        query.court = booking.court;
      }
      // Case 3: Legacy/Simple Field Booking - Use 'field' only (no court specific)
      else if (booking.field) {
        query.field = booking.field;
        // Ensure we don't accidentally match a court-specific schedule if looking for field-level
        query.court = { $exists: false };
      }
      else {
        this.logger.error(`[Release Slots] ❌ Cannot determine schedule target for booking ${booking._id} (no coach, court, or field)`);
        return;
      }

      this.logger.debug(
        `[Release Slots] Searching for schedule with query: ${JSON.stringify(query)} ` +
        `to release slot=${booking.startTime}-${booking.endTime}`
      );

      // Use MongoDB $pull operator for atomic slot removal
      const updateResult = await this.scheduleModel.findOneAndUpdate(
        query,
        {
          $pull: {
            bookedSlots: {
              startTime: booking.startTime,
              endTime: booking.endTime
            }
          },
          $inc: { version: 1 }
        },
        {
          new: true
        }
      ).exec();

      if (!updateResult) {
        this.logger.warn(
          `[Release Slots] ⚠️ No schedule found matching query: ${JSON.stringify(query)} ` +
          `- slot may have already been released or schedule doesn't exist`
        );
        return;
      }

      // Check if slots were actually removed by comparing array lengths
      const slotStillExists = updateResult.bookedSlots.some(
        slot => slot.startTime === booking.startTime && slot.endTime === booking.endTime
      );

      if (slotStillExists) {
        this.logger.warn(
          `[Release Slots] ⚠️ Slot ${booking.startTime}-${booking.endTime} still exists in schedule ` +
          `after removal attempt for booking ${booking._id} - this may indicate a data inconsistency`
        );
      } else {
        this.logger.log(
          `[Release Slots] ✅ Successfully released slot ${booking.startTime}-${booking.endTime} ` +
          `from schedule (id: ${updateResult._id}) for booking ${booking._id}`
        );
      }

    } catch (error) {
      this.logger.error(`[Release Slots] Error releasing slots for booking ${booking._id}:`, error);
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

      // Update booking status to REFUNDED and map new payment status field
      booking.status = BookingStatus.CANCELLED;
      (booking as any).paymentStatus = 'refunded';
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
   * Unlocks money from pendingBalance to availableBalance
   * Called after customer successfully checks in
   * 
   * Flow:
   * 1. Get booking details
   * 2. Field owner wallet: pendingBalance -= amount
   * 3. Field owner wallet: availableBalance += amount
   * 4. Emit notification event
   * 
   * Note: Admin systemBalance is NOT touched here.
   * Money will be deducted from admin when field owner withdraws.
   * 
   * @param bookingId - Booking ID that was checked in
   */
  async handleCheckInSuccess(bookingId: string): Promise<void> {
    const session: ClientSession = await this.connection.startSession();
    session.startTransaction();

    try {
      this.logger.log(`[Check-In Success V2] Processing for booking ${bookingId}`);

      // Get booking details with field and owner populated
      const booking = await this.bookingModel
        .findById(bookingId)
        .populate({
          path: 'field',
          populate: {
            path: 'owner',
            model: 'FieldOwnerProfile',
          },
        })
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
      // field.owner is now populated FieldOwnerProfile document
      // We need the user field from FieldOwnerProfile (User._id), not the profile _id
      const ownerProfile = field.owner;
      const fieldOwnerId = ownerProfile?.user?.toString();

      if (!fieldOwnerId) {
        this.logger.error(`[Check-In Success V2] Field ${field._id} has no owner userId (profile: ${ownerProfile?._id})`);
        await session.abortTransaction();
        return;
      }

      // Use bookingAmount (owner revenue) or fallback to calculated value from totalPrice for backward compatibility
      const amount = booking.bookingAmount !== undefined
        ? booking.bookingAmount
        : (booking.totalPrice ? Math.round(booking.totalPrice / 1.05) : 0);

      // Get field owner wallet and move from pendingBalance to availableBalance
      const ownerWallet = await this.walletService.getOrCreateWallet(
        fieldOwnerId,
        WalletRole.FIELD_OWNER,
        session,
      );

      // Deduct from pendingBalance
      const currentPending = ownerWallet.pendingBalance || 0;
      if (currentPending < amount) {
        this.logger.warn(
          `[Check-In Success V2] Pending balance ${currentPending}d < ${amount}d, ` +
          `using available amount: ${currentPending}d`
        );
      }
      const unlockAmount = Math.min(currentPending, amount);

      ownerWallet.pendingBalance = currentPending - unlockAmount;
      ownerWallet.availableBalance = (ownerWallet.availableBalance || 0) + unlockAmount;
      ownerWallet.lastTransactionAt = new Date();
      await ownerWallet.save({ session });

      this.logger.log(
        `[Check-In Success V2] Unlocked ${unlockAmount}d for field owner ${fieldOwnerId}. ` +
        `Pending: ${ownerWallet.pendingBalance}d, Available: ${ownerWallet.availableBalance}d`
      );

      // Commit transaction
      await session.commitTransaction();

      this.logger.log(
        `[Check-In Success V2] Successfully unlocked ${unlockAmount}d to availableBalance for owner ${fieldOwnerId}`
      );

      // Emit event for notifications
      this.eventEmitter.emit('wallet.balance.unlocked', {
        bookingId,
        fieldOwnerId,
        amount: unlockAmount,
        availableBalance: ownerWallet.availableBalance,
        unlockedAt: new Date(),
      });

    } catch (error) {
      await session.abortTransaction();
      this.logger.error('[Check-In Success V2] Error processing check-in success event', error);
    } finally {
      session.endSession();
    }
  }

  /**
   * [V2 NEW] Handle Field Owner withdrawal from availableBalance
   * Transfers money from system to owner's bank account
   * 
   * Flow:
   * 1. Check owner has sufficient availableBalance
   * 2. Owner wallet: availableBalance -= amount
   * 3. Admin wallet: systemBalance -= amount
   * 4. Create WITHDRAWAL transaction record
   * 5. Call PayOS/Bank API to transfer to owner's bank (TODO)
   * 
   * @param ownerId - Field owner user ID
   * @param amount - Amount to withdraw
   */
  async withdrawAvailableBalance(ownerId: string, amount: number): Promise<void> {
    const session: ClientSession = await this.connection.startSession();
    session.startTransaction();

    try {
      this.logger.log(`[Withdraw V2] Processing withdrawal for owner ${ownerId}, amount: ${amount}d`);

      // Get owner wallet and check balance
      const ownerWallet = await this.walletService.getOrCreateWallet(
        ownerId,
        WalletRole.FIELD_OWNER,
        session,
      );

      const availableBalance = ownerWallet.availableBalance || 0;
      if (availableBalance < amount) {
        this.logger.error(
          `[Withdraw V2] Insufficient availableBalance. ` +
          `Required: ${amount}d, Available: ${availableBalance}d`
        );
        await session.abortTransaction();
        throw new Error(`So du kha dung khong du. Can: ${amount}d, Hien co: ${availableBalance}d`);
      }

      // Step 1: Deduct from owner's availableBalance
      ownerWallet.availableBalance = availableBalance - amount;
      ownerWallet.lastTransactionAt = new Date();
      await ownerWallet.save({ session });

      this.logger.log(
        `[Withdraw V2] Deducted ${amount}d from owner ${ownerId} availableBalance. ` +
        `New balance: ${ownerWallet.availableBalance}d`
      );

      // Step 2: Deduct from admin systemBalance
      const adminWallet = await this.walletService.getOrCreateWallet(
        'ADMIN_SYSTEM_ID',
        WalletRole.ADMIN,
        session,
      );

      if ((adminWallet.systemBalance || 0) < amount) {
        this.logger.error(
          `[Withdraw V2] Insufficient admin systemBalance. ` +
          `Required: ${amount}d, Available: ${adminWallet.systemBalance || 0}d`
        );
        await session.abortTransaction();
        throw new Error('Khong du so du he thong. Vui long lien he admin.');
      }

      adminWallet.systemBalance = (adminWallet.systemBalance || 0) - amount;
      await adminWallet.save({ session });

      this.logger.log(
        `[Withdraw V2] Deducted ${amount}d from admin systemBalance. ` +
        `New balance: ${adminWallet.systemBalance}d`
      );

      // Step 3: Create WITHDRAWAL transaction record
      await this.transactionsService.createWithdrawalTransaction({
        userId: ownerId,
        amount,
        method: 'BANK_TRANSFER',
      });

      // TODO: Step 4 - Call PayOS/Bank API to transfer to owner's bank
      this.logger.log(`[Withdraw V2] Initiating bank transfer via PayOS for ${amount}d`);

      // Commit transaction
      await session.commitTransaction();

      this.logger.log(`[Withdraw V2] Successfully withdrew ${amount}d for owner ${ownerId}`);

      // Emit withdrawal event
      this.eventEmitter.emit('wallet.withdrawal.completed', {
        userId: ownerId,
        amount,
        remainingBalance: ownerWallet.availableBalance,
        withdrawnAt: new Date(),
      });

    } catch (error) {
      await session.abortTransaction();
      this.logger.error('[Withdraw V2] Error processing withdrawal', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

}


