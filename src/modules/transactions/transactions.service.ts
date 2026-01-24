import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, ClientSession } from 'mongoose';
import { Transaction } from './entities/transaction.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { TransactionStatus, TransactionType } from '@common/enums/transaction.enum';
import { PaymentMethod } from 'src/common/enums/payment-method.enum';
import * as crypto from 'crypto';
import * as qs from 'qs';

export interface CreatePaymentData {
  bookingId?: string;
  userId: string;
  amount: number;
  method: PaymentMethod;
  paymentNote?: string;
  transactionId?: string;
  externalTransactionId?: string; // ✅ PayOS orderCode
  metadata?: Record<string, any>; // ✅ Add optional metadata for custom fields like recurringGroupId
}

@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name);

  constructor(
    @InjectModel(Transaction.name) private readonly transactionModel: Model<Transaction>,
    @InjectModel(Booking.name) private readonly bookingModel: Model<Booking>,
    private readonly configService: ConfigService,
  ) { }

  /**
   * Tạo transaction record mới
   * @param data Payment data
   * @param session Optional MongoDB session for transaction support
   */
  async createPayment(data: CreatePaymentData, session?: ClientSession): Promise<Transaction> {
    try {
      // Nếu là chuyển khoản ngân hàng (BANK_TRANSFER), mặc định set trạng thái thành SUCCEEDED
      // để tránh nằm ở trạng thái pending không cần thiết (luồng upload chứng từ đã xử lý riêng).
      const initialStatus =
        data.method === PaymentMethod.BANK_TRANSFER
          ? TransactionStatus.SUCCEEDED
          : TransactionStatus.PENDING;

      // ✅ Build metadata: merge bookingId and custom metadata
      const metadata: Record<string, any> = {};
      if (data.bookingId && Types.ObjectId.isValid(data.bookingId)) {
        metadata.bookingId = data.bookingId;
      }
      if (data.metadata) {
        Object.assign(metadata, data.metadata);
      }

      const transaction = new this.transactionModel({
        user: new Types.ObjectId(data.userId),
        amount: data.amount,
        direction: 'in',
        method: data.method,
        status: initialStatus,
        type: TransactionType.PAYMENT,
        notes: data.paymentNote || null,
        // ✅ Linked Booking
        ...(data.bookingId && Types.ObjectId.isValid(data.bookingId) && { booking: new Types.ObjectId(data.bookingId) }),
        // ✅ CRITICAL: Store externalTransactionId for PayOS lookup
        ...(data.externalTransactionId && { externalTransactionId: data.externalTransactionId }),
        // ✅ Store metadata (bookingId + custom metadata like recurringGroupId)
        ...(Object.keys(metadata).length > 0 && { metadata }),
      });

      // ✅ CRITICAL: Save with session if provided (for transaction atomicity)
      const savedTransaction = session
        ? await transaction.save({ session })
        : await transaction.save();

      this.logger.log(`Created transaction ${savedTransaction._id} for booking ${data.bookingId}`);
      if (data.externalTransactionId) {
        this.logger.log(`  - External Transaction ID: ${data.externalTransactionId}`);
      }

      return savedTransaction;
    } catch (error) {
      this.logger.error('Error creating transaction', error);
      throw new BadRequestException('Failed to create transaction');
    }
  }

  /**
   * Tạo transaction xác thực tài khoản cho Coach (10k)
   */
  async createCoachBankVerificationTransaction(params: {
    coachUserId: string;
    coachProfileId: string;
    bankAccountNumber: string;
    bankName: string;
    method: PaymentMethod;
    amount?: number; // default 10000
  }, session?: ClientSession): Promise<Transaction> {
    const amount = params.amount ?? 10000;
    try {
      const tx = new this.transactionModel({
        user: new Types.ObjectId(params.coachUserId),
        amount,
        direction: 'in',
        method: params.method,
        status: TransactionStatus.PENDING,
        type: TransactionType.PAYMENT,
        metadata: {
          purpose: 'ACCOUNT_VERIFICATION',
          targetRole: 'coach',
          coachId: params.coachProfileId,
          bankAccount: params.bankAccountNumber,
          bankName: params.bankName,
        },
      });
      const saved = session ? await tx.save({ session }) : await tx.save();
      this.logger.log(`Created coach verification tx ${saved._id} for user ${params.coachUserId}`);
      return saved;
    } catch (err) {
      this.logger.error('Error creating coach verification transaction', err);
      throw new BadRequestException('Failed to create coach verification transaction');
    }
  }

  async updatePaymentStatusSafe(
    transactionId: string,
    status: TransactionStatus,
    receiptUrl?: string,
    gatewayData?: {
      payosOrderCode?: number;
      payosReference?: string;
      payosAccountNumber?: string;
      payosTransactionDateTime?: string;
    }
  ): Promise<Transaction> {
    // ✅ CRITICAL: Read existing transaction first to preserve metadata
    // Use findOneAndUpdate with $set on metadata fields to ensure atomic merge
    const existingTransaction = await this.transactionModel.findById(transactionId);

    if (!existingTransaction) {
      throw new NotFoundException(`Transaction with ID ${transactionId} not found`);
    }

    // ✅ Preserve existing metadata and merge with new PayOS data
    const existingMetadata = existingTransaction.metadata || {};

    // 1. Build atomic update operations
    const updateOperations: any = {
      $set: {
        status,
      }
    };

    // ✅ CRITICAL FIX: Use dot notation for PayOS fields to preserve existing metadata
    // DO NOT replace entire metadata object - use individual field updates
    if (gatewayData) {
      if (gatewayData.payosOrderCode) {
        updateOperations.$set['metadata.payosOrderCode'] = gatewayData.payosOrderCode;
      }
      if (gatewayData.payosReference) {
        updateOperations.$set['metadata.payosReference'] = gatewayData.payosReference;
      }
      if (gatewayData.payosAccountNumber) {
        updateOperations.$set['metadata.payosAccountNumber'] = gatewayData.payosAccountNumber;
      }
      if (gatewayData.payosTransactionDateTime) {
        updateOperations.$set['metadata.payosTransactionDateTime'] = gatewayData.payosTransactionDateTime;
      }
    }

    // Set externalTransactionId if PayOS order code provided
    if (gatewayData?.payosOrderCode) {
      updateOperations.$set.externalTransactionId = String(gatewayData.payosOrderCode);
    }

    // 2. Update timestamps based on status
    if (status === TransactionStatus.SUCCEEDED) {
      updateOperations.$set.completedAt = new Date();
      // Preserve existing notes if any
      const existingNotes = existingTransaction.notes || '';
      updateOperations.$set.notes = existingNotes
        ? `${existingNotes}\nTransaction completed successfully`
        : 'Transaction completed successfully';
    } else if (status === TransactionStatus.FAILED) {
      updateOperations.$set.failedAt = new Date();
      const existingNotes = existingTransaction.notes || '';
      updateOperations.$set.notes = existingNotes
        ? `${existingNotes}\nTransaction failed`
        : 'Transaction failed';
    } else if (status === TransactionStatus.PROCESSING) {
      updateOperations.$set.processedAt = new Date();
    }

    // 3. ✅ CRITICAL: Use findOneAndUpdate with atomic operations
    // This ensures metadata is properly merged and preserved
    const transaction = await this.transactionModel.findOneAndUpdate(
      {
        _id: transactionId,
      },
      updateOperations,
      {
        new: true,
        runValidators: true
      }
    ).populate('user');

    if (!transaction) {
      throw new NotFoundException(`Transaction with ID ${transactionId} not found after update`);
    }

    // ✅ CRITICAL FIX 4: Verify metadata was preserved and restore if lost
    const preservedKeys = Object.keys(existingMetadata);
    const finalKeys = Object.keys(transaction.metadata || {});
    const missingKeys = preservedKeys.filter(key => !finalKeys.includes(key));

    if (missingKeys.length > 0) {
      this.logger.error(`[updatePaymentStatus] ❌ CRITICAL: Metadata keys were lost: ${missingKeys.join(', ')}`);
      this.logger.error(`[updatePaymentStatus] Expected keys: ${preservedKeys.join(', ')}, Final keys: ${finalKeys.join(', ')}`);
      this.logger.error(`[updatePaymentStatus] Existing metadata was: ${JSON.stringify(existingMetadata)}`);
      this.logger.error(`[updatePaymentStatus] Final metadata is: ${JSON.stringify(transaction.metadata)}`);

      // ✅ CRITICAL: Restore missing metadata keys
      const restoreOperations: any = { $set: {} };
      for (const key of missingKeys) {
        restoreOperations.$set[`metadata.${key}`] = existingMetadata[key];
        this.logger.warn(`[updatePaymentStatus] Restoring metadata.${key} = ${JSON.stringify(existingMetadata[key])}`);
      }

      // Restore missing metadata
      const restoredTransaction = await this.transactionModel.findByIdAndUpdate(
        transactionId,
        restoreOperations,
        { new: true, runValidators: true }
      ).populate('user');

      if (restoredTransaction) {
        this.logger.log(`[updatePaymentStatus] ✅ Restored ${missingKeys.length} missing metadata key(s)`);
        return restoredTransaction;
      } else {
        this.logger.error(`[updatePaymentStatus] ❌ Failed to restore metadata for transaction ${transactionId}`);
      }
    }

    // ✅ CRITICAL: Double-check critical metadata fields
    if (existingMetadata.bookingId && !transaction.metadata?.bookingId) {
      this.logger.error(`[updatePaymentStatus] ❌ CRITICAL: bookingId was lost! Restoring...`);
      const restored = await this.transactionModel.findByIdAndUpdate(
        transactionId,
        { $set: { 'metadata.bookingId': existingMetadata.bookingId } },
        { new: true, runValidators: true }
      ).populate('user');
      if (restored) {
        this.logger.log(`[updatePaymentStatus] ✅ Restored metadata.bookingId`);
        return restored;
      }
    }

    this.logger.log(`Updated transaction ${transactionId} status to ${status}`);

    return transaction;
  }

  /**
   * Lấy transaction theo booking ID
   */
  async getPaymentByBookingId(bookingId: string): Promise<Transaction | null> {
    // Priority: Try to find by direct booking field in Transaction entity (modern way)
    const transaction = await this.transactionModel
      .findOne({
        booking: new Types.ObjectId(bookingId),
        type: TransactionType.PAYMENT
      })
      .populate('user', 'fullName email')
      .exec();

    if (transaction) return transaction;

    // Fallback: Try the deprecated booking.transaction link (legacy/compatibility)
    const booking = await this.bookingModel.findById(bookingId).select('transaction').exec();
    if (!booking?.transaction) return null;

    return this.transactionModel
      .findOne({
        _id: booking.transaction,
        type: TransactionType.PAYMENT
      })
      .populate('user', 'fullName email')
      .exec();
  }

  /**
   * Get latest successful transaction for a booking
   * Replaces direct access to booking.transaction field
   */
  async getLatestSuccessfulTransaction(bookingId: string): Promise<Transaction | null> {
    // Modern way: search via booking field in transaction
    const transaction = await this.transactionModel
      .findOne({
        booking: new Types.ObjectId(bookingId),
        status: TransactionStatus.SUCCEEDED
      })
      .sort({ createdAt: -1 })
      .populate('user', 'fullName email')
      .exec();

    if (transaction) return transaction;

    // Legacy fallback
    const booking = await this.bookingModel.findById(bookingId).select('transaction').exec();
    if (!booking?.transaction) return null;

    return this.transactionModel
      .findOne({
        _id: booking.transaction,
        status: TransactionStatus.SUCCEEDED
      })
      .populate('user', 'fullName email')
      .exec();
  }

  /**
   * Get all transactions for a booking (payment, refunds, etc.)
   * Useful for getting complete transaction history
   */
  async getBookingTransactions(bookingId: string): Promise<Transaction[]> {
    // Modern way: Find all transactions where transaction.booking points to this bookingId
    const transactions = await this.transactionModel
      .find({ booking: new Types.ObjectId(bookingId) })
      .sort({ createdAt: -1 })
      .populate('user', 'fullName email')
      .exec();

    if (transactions.length > 0) return transactions;

    // Legacy fallback: Use booking.transaction and its relatives
    const booking = await this.bookingModel.findById(bookingId).select('transaction').exec();
    if (!booking?.transaction) return [];

    return this.transactionModel
      .find({
        $or: [
          { _id: booking.transaction },
          { relatedTransaction: booking.transaction }
        ]
      })
      .sort({ createdAt: -1 })
      .populate('user', 'fullName email')
      .exec();
  }

  /**
   * Lấy transaction theo ID
   */
  /**
   * Get payment by external transaction ID (PayOS order code, etc.)
   */
  async getPaymentByExternalId(externalId: string): Promise<Transaction | null> {
    return await this.transactionModel
      .findOne({ externalTransactionId: externalId })
      .populate('user', 'fullName email')
      .exec();
  }

  async getPaymentById(transactionId: string): Promise<Transaction | null> {
    return this.transactionModel
      .findById(transactionId)
      .populate('user', 'fullName email')
      .exec();
  }

  /**
   * ✅ OPTIMIZED: Extract bookingId from transaction with priority order
   * This method centralizes the logic to find bookingId from a transaction,
   * avoiding code duplication across webhook handlers.
   * 
   * Priority order:
   * 1. Direct link via booking.transaction (fastest - single query)
   * 2. Recurring group via metadata.recurringGroupId (returns first booking ID for event)
   * 3. Single booking via metadata.bookingId
   * 4. Fallback: Extract bookingId from transaction notes
   * 
   * @param transaction - Transaction object
   * @returns bookingId string or undefined if not found
   */
  async extractBookingIdFromTransaction(transaction: Transaction): Promise<string | undefined> {
    try {
      // ✅ Priority 1: Direct link via booking.transaction
      const bookingDoc = await this.bookingModel.findOne({ transaction: transaction._id }).select('_id').exec();
      if (bookingDoc) {
        return bookingDoc._id?.toString();
      }

      // ✅ Priority 2: Recurring bookings via metadata.recurringGroupId
      if (transaction.metadata?.recurringGroupId) {
        const recurringGroupId = transaction.metadata.recurringGroupId;
        const bookings = await this.bookingModel.find({
          recurringGroupId: new Types.ObjectId(recurringGroupId)
        }).select('_id').exec();
        // Return first booking ID for event (payment-handler will process all)
        return bookings[0]?._id?.toString();
      }

      // ✅ Priority 3: Single booking via metadata.bookingId
      if (transaction.metadata?.bookingId && Types.ObjectId.isValid(String(transaction.metadata.bookingId))) {
        return String(transaction.metadata.bookingId);
      }

      // ✅ Priority 4: Fallback - Extract bookingId from notes
      if (transaction.notes) {
        const bookingIdMatch = transaction.notes.match(/Payment for booking\s+([a-f0-9]{24})/i);
        if (bookingIdMatch && Types.ObjectId.isValid(bookingIdMatch[1])) {
          return bookingIdMatch[1];
        }
      }

      return undefined;
    } catch (error) {
      this.logger.error(`[extractBookingIdFromTransaction] Error: ${error.message}`, error);
      return undefined;
    }
  }

  /**
   * Log transaction error for tracking and debugging
   * This helps with error analysis and customer support
   */
  async logPaymentError(
    transactionId: string,
    errorCode: string,
    errorMessage: string,
    additionalData?: Record<string, any>
  ): Promise<void> {
    try {
      const transaction = await this.transactionModel.findById(transactionId);

      if (!transaction) {
        this.logger.warn(`Cannot log error for non-existent transaction ${transactionId}`);
        return;
      }

      // Update transaction with error information
      await this.transactionModel.findByIdAndUpdate(transactionId, {
        status: TransactionStatus.FAILED,
        notes: `Error ${errorCode}: ${errorMessage}`,
        errorCode,
        errorMessage,
        // Store error details in a structured way if needed
        ...(additionalData && {
          metadata: {
            ...((transaction as any).metadata || {}),
            lastError: {
              code: errorCode,
              message: errorMessage,
              timestamp: new Date(),
              ...additionalData,
            }
          }
        }),
      });

      // Log for monitoring/alerting systems
      // Lookup booking for logging
      const booking = await this.bookingModel.findOne({ transaction: transactionId }).select('_id').exec();

      this.logger.error(
        `Transaction Error [${transactionId}]: Code ${errorCode} - ${errorMessage}`,
        JSON.stringify({
          transactionId,
          errorCode,
          errorMessage,
          bookingId: booking?._id,
          userId: transaction.user,
          amount: transaction.amount,
          ...additionalData,
        })
      );
    } catch (error) {
      this.logger.error('Failed to log transaction error', error);
    }
  }

  /**
   * Process refund for a transaction
   * Supports both full and partial refunds
   * Creates a new Transaction record with type REFUND
   */
  async processRefund(
    transactionId: string,
    refundAmount?: number,
    reason?: string,
    refundNote?: string,
    refundedByUserId?: string
  ): Promise<{
    paymentId: string;
    bookingId: string | null;
    refundAmount: number;
    originalAmount: number;
    refundPaymentId: string;
    refundedAt: string;
  }> {
    // Get original transaction

    const originalTransaction = await this.transactionModel
      .findById(transactionId)
      .populate('user')
      .exec();

    if (!originalTransaction) {
      throw new NotFoundException(`Transaction with ID ${transactionId} not found`);
    }

    // Validate transaction can be refunded
    if (originalTransaction.status !== TransactionStatus.SUCCEEDED) {
      throw new BadRequestException(
        `Transaction cannot be refunded. Current status: ${originalTransaction.status}. Only succeeded transactions can be refunded.`
      );
    }

    // Determine refund amount (full or partial)
    const finalRefundAmount = refundAmount && refundAmount > 0
      ? Math.min(refundAmount, originalTransaction.amount)
      : originalTransaction.amount;

    if (finalRefundAmount > originalTransaction.amount) {
      throw new BadRequestException(
        `Refund amount (${finalRefundAmount}) cannot exceed original transaction amount (${originalTransaction.amount})`
      );
    }

    const refundType = finalRefundAmount >= originalTransaction.amount
      ? TransactionType.REFUND_FULL
      : TransactionType.REFUND_PARTIAL;

    // Create refund transaction record
    const refundTransaction = new this.transactionModel({
      amount: finalRefundAmount,
      direction: 'out',
      method: originalTransaction.method,
      status: TransactionStatus.SUCCEEDED,
      type: refundType,
      relatedTransaction: new Types.ObjectId(transactionId),
      user: originalTransaction.user,
      originalAmount: originalTransaction.amount,
      refundReason: reason || 'No reason provided',
      refundedBy: refundedByUserId ? new Types.ObjectId(refundedByUserId) : originalTransaction.user,
      notes: `Refund processed. Original transaction: ${transactionId}. Amount: ${finalRefundAmount} VND. Reason: ${reason || 'No reason provided'}`,
      completedAt: new Date(),
    });

    await refundTransaction.save();

    // Update original transaction status if full refund
    if (refundType === TransactionType.REFUND_FULL) {
      await this.transactionModel.findByIdAndUpdate(transactionId, {
        status: TransactionStatus.REFUNDED,
        notes: `${originalTransaction.notes || ''}\nREFUND: ${reason || 'No reason provided'}\nRefund amount: ${finalRefundAmount} VND\nRefund note: ${refundNote || 'N/A'}\nRefunded at: ${new Date().toISOString()}`,
      });
    }

    this.logger.log(`Transaction ${transactionId} refunded. Amount: ${finalRefundAmount} VND. Reason: ${reason}`);

    return {
      paymentId: (originalTransaction._id as any).toString(),

      bookingId: null, // Booking ID is not stored on transaction anymore
      refundAmount: finalRefundAmount,
      originalAmount: originalTransaction.amount,
      refundPaymentId: (refundTransaction._id as any).toString(),
      refundedAt: new Date().toISOString(),
    };
  }

  /**
   * Get payment history for a user
   * Includes all transactions, refunds, and payment details
   */
  async getPaymentHistory(
    userId: string,
    status?: TransactionStatus,
    limit: number = 10,
    offset: number = 0
  ): Promise<{
    payments: any[];
    total: number;
    limit: number;
    offset: number;
  }> {
    const query: any = {
      user: new Types.ObjectId(userId),
      type: TransactionType.PAYMENT
    };

    if (status) {
      query.status = status;
    }

    // Get total count
    const total = await this.transactionModel.countDocuments(query);

    // Get transactions with pagination
    // Get transactions with pagination
    const transactions = await this.transactionModel
      .find(query)
      .populate('user', 'fullName email')
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(offset)
      .exec();

    // Collect transaction IDs to find associated bookings
    const transactionIds = transactions.map(t => t._id);
    const bookings = await this.bookingModel.find({ transaction: { $in: transactionIds } })
      .select('fieldId date startTime endTime totalPrice status transaction')
      .populate('field', 'name') // Optional: populate field info if needed
      .exec();

    const bookingMap = new Map();
    bookings.forEach(b => {
      // Create a booking object similar to what was originally populated
      const bookingObj = b.toObject();
      // Ensure we map by string ID
      if (b.transaction) {
        bookingMap.set(b.transaction.toString(), bookingObj);
      }
    });

    const formattedPayments = transactions.map((transaction) => {
      // Extract refund information from notes if exists
      const refundInfo = this.extractRefundInfo(transaction.notes);
      const booking = bookingMap.get((transaction._id as any).toString());

      return {
        paymentId: (transaction._id as any).toString(),
        bookingId: booking?._id?.toString() || null,
        booking: booking || null,
        amount: transaction.amount,
        status: transaction.status,
        method: transaction.method,
        transactionId: transaction.externalTransactionId || null,
        createdAt: transaction.createdAt,
        updatedAt: transaction.updatedAt,
        ...(transaction.status === TransactionStatus.REFUNDED && refundInfo),
      };
    });

    return {
      payments: formattedPayments,
      total,
      limit,
      offset,
    };
  }

  /**
   * Extract refund information from transaction notes
   * Helper method to parse refund details
   */
  private extractRefundInfo(notes?: string): {
    refundedAt?: string;
    refundAmount?: number;
    refundReason?: string;
    refundNote?: string;
  } {
    if (!notes || !notes.includes('REFUND:')) {
      return {};
    }

    const refundInfo: any = {};

    // Extract refund date
    const refundedAtMatch = notes.match(/Refunded at: (.+)/);
    if (refundedAtMatch) {
      refundInfo.refundedAt = refundedAtMatch[1];
    }

    // Extract refund amount
    const refundAmountMatch = notes.match(/Refund amount: (\d+) VND/);
    if (refundAmountMatch) {
      refundInfo.refundAmount = parseInt(refundAmountMatch[1], 10);
    }

    // Extract refund reason
    const refundReasonMatch = notes.match(/REFUND: (.+)\n/);
    if (refundReasonMatch) {
      refundInfo.refundReason = refundReasonMatch[1];
    }

    // Extract refund note
    const refundNoteMatch = notes.match(/Refund note: (.+)\n/);
    if (refundNoteMatch && refundNoteMatch[1] !== 'N/A') {
      refundInfo.refundNote = refundNoteMatch[1];
    }

    return refundInfo;
  }

  /**
   * Get detailed transaction history for a user
   * Returns transaction records with full PayOS data and filters
   */
  async getTransactionHistory(userId: string, options?: {
    type?: TransactionType;
    status?: TransactionStatus;
    startDate?: string;
    endDate?: string;
    limit?: number;
    offset?: number;
  }): Promise<{
    transactions: Transaction[];
    total: number;
    limit: number;
    offset: number;
  }> {
    const query: any = { user: new Types.ObjectId(userId) };

    if (options?.type) {
      query.type = options.type;
    }

    if (options?.status) {
      query.status = options.status;
    }

    if (options?.startDate || options?.endDate) {
      query.createdAt = {};
      if (options.startDate) {
        query.createdAt.$gte = new Date(options.startDate);
      }
      if (options.endDate) {
        query.createdAt.$lte = new Date(options.endDate);
      }
    }

    const limit = options?.limit || 10;
    const offset = options?.offset || 0;

    const total = await this.transactionModel.countDocuments(query);

    const transactions = await this.transactionModel
      .find(query)
      .populate('user', 'fullName email')
      .populate('relatedTransaction')
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(offset)
      .exec();

    return {
      transactions,
      total,
      limit,
      offset,
    };
  }

  /**
   * Update transaction metadata atomically (tránh race condition)
   * Dùng cho việc đánh dấu email sent, hoặc update thông tin khác mà không ảnh hưởng PayOS data
   */
  async updateTransactionMetadata(
    transactionId: string,
    metadataUpdates: Record<string, any>,
    additionalFields?: Record<string, any>
  ): Promise<Transaction | null> {
    const updateData: any = {};

    // Update metadata fields using dot notation
    Object.keys(metadataUpdates).forEach(key => {
      updateData[`metadata.${key}`] = metadataUpdates[key];
    });

    // Add any additional top-level fields
    if (additionalFields) {
      Object.assign(updateData, additionalFields);
    }

    const transaction = await this.transactionModel.findByIdAndUpdate(
      transactionId,
      { $set: updateData },
      { new: true }
    ).populate('user', 'fullName email');

    if (transaction) {
      this.logger.log(`Updated transaction ${transactionId} metadata atomically`);
    }

    return transaction;
  }

  /**
   * Update transaction externalTransactionId (PayOS orderCode)
   * Used when reusing existing transaction for PayOS payment
   */
  async updateTransactionExternalId(
    transactionId: string,
    externalTransactionId: string
  ): Promise<Transaction | null> {
    const transaction = await this.transactionModel.findByIdAndUpdate(
      transactionId,
      { $set: { externalTransactionId } },
      { new: true }
    ).exec();

    if (transaction) {
      this.logger.log(`Updated transaction ${transactionId} externalTransactionId to ${externalTransactionId}`);
    }

    return transaction;
  }

  /**
   * Update transaction amount
   * Used when amount changes due to bulk discount application or other adjustments
   */
  async updateTransactionAmount(
    transactionId: string,
    amount: number
  ): Promise<Transaction | null> {
    const transaction = await this.transactionModel.findByIdAndUpdate(
      transactionId,
      { $set: { amount } },
      { new: true }
    ).exec();

    if (transaction) {
      this.logger.log(`Updated transaction ${transactionId} amount to ${amount}`);
    }

    return transaction;
  }

  /**
   * Get transaction by ID
   */
  async getTransactionById(transactionId: string): Promise<Transaction | null> {
    return await this.transactionModel
      .findById(transactionId)
      .populate('user', 'fullName email')
      .populate('relatedTransaction')
      .exec();
  }


  /**
   * Get all transactions for a transaction (including refunds)
   */
  async getPaymentTransactions(transactionId: string): Promise<Transaction[]> {
    // Get all transactions related to this transaction (refunds, etc.)
    return await this.transactionModel
      .find({
        $or: [
          { _id: new Types.ObjectId(transactionId) },
          { relatedTransaction: new Types.ObjectId(transactionId) },
        ]
      })
      .populate('user', 'fullName email')
      .populate('relatedTransaction')
      .sort({ createdAt: 1 })
      .exec();
  }

  /**
   * Get refund statistics for a transaction
   */
  async getRefundStats(transactionId: string): Promise<{
    paymentId: string;
    totalRefunded: number;
    refundCount: number;
    originalAmount: number;
    remainingAmount: number;
  }> {
    // Get original transaction
    const transaction = await this.transactionModel.findById(transactionId).exec();
    if (!transaction) {
      throw new NotFoundException(`Transaction with ID ${transactionId} not found`);
    }

    // Get all refund transactions
    const refunds = await this.transactionModel
      .find({
        relatedTransaction: new Types.ObjectId(transactionId),
        type: { $in: [TransactionType.REFUND_FULL, TransactionType.REFUND_PARTIAL] },
      })
      .exec();

    const totalRefunded = refunds.reduce((sum, refund) => sum + refund.amount, 0);
    const refundCount = refunds.length;

    return {
      paymentId: transactionId,
      totalRefunded,
      refundCount,
      originalAmount: transaction.amount,
      remainingAmount: Math.max(0, transaction.amount - totalRefunded),
    };
  }

  /**
   * Create payout transaction (Hệ thống → coach / field owner)
   */
  async createPayout(bookingId: string, coachId: string, amount: number, bankAccount?: string, bankName?: string): Promise<Transaction> {
    try {
      const payout = new this.transactionModel({
        amount: -amount, // Negative for outgoing
        direction: 'out',
        type: TransactionType.PAYOUT,
        method: PaymentMethod.BANK_TRANSFER,
        status: TransactionStatus.PENDING,
        user: new Types.ObjectId(coachId),
        payoutTo: new Types.ObjectId(coachId),
        payoutBankAccount: bankAccount || undefined,
        payoutBankName: bankName || undefined,
        notes: `Payout for booking ${bookingId}`,
      });

      const savedPayout = await payout.save();
      this.logger.log(`Created payout ${savedPayout._id} for booking ${bookingId}, amount: ${amount} VND`);

      return savedPayout;
    } catch (error) {
      this.logger.error('Error creating payout', error);
      throw new BadRequestException('Failed to create payout');
    }
  }

  /**
   * Create fee transaction (Phí hệ thống thu)
   */
  async createFee(bookingId: string, amount: number, feeRate?: number, systemUserId?: string): Promise<Transaction> {
    try {
      // Use system user ID if provided, otherwise use a default system user ID
      // You may want to create a SYSTEM_USER constant
      const userId = systemUserId || new Types.ObjectId('000000000000000000000000');

      const fee = new this.transactionModel({
        amount: amount,
        direction: 'in',
        type: TransactionType.FEE,
        method: PaymentMethod.INTERNAL,
        status: TransactionStatus.SUCCEEDED,
        user: userId,
        feeRate: feeRate || undefined,
        notes: 'Platform fee',
      });

      const savedFee = await fee.save();
      this.logger.log(`Created fee ${savedFee._id} for booking ${bookingId}, amount: ${amount} VND`);

      return savedFee;
    } catch (error) {
      this.logger.error('Error creating fee', error);
      throw new BadRequestException('Failed to create fee');
    }
  }

  /**
   * Create withdrawal transaction (Chu san / Coach rut tien tu availableBalance)
   * @param data Withdrawal data
   * @param session Optional MongoDB session for transaction support
   */
  async createWithdrawalTransaction(data: {
    userId: string;
    amount: number;
    method: PaymentMethod;
    bankAccount?: string;
    bankName?: string;
    notes?: string;
  }, session?: ClientSession): Promise<Transaction> {
    try {
      const withdrawal = new this.transactionModel({
        user: new Types.ObjectId(data.userId),
        amount: data.amount,
        direction: 'out',
        method: data.method,
        status: TransactionStatus.SUCCEEDED,
        type: TransactionType.WITHDRAWAL,
        payoutTo: new Types.ObjectId(data.userId),
        payoutBankAccount: data.bankAccount,
        payoutBankName: data.bankName,
        notes: data.notes || 'Rut tien tu so du kha dung',
        completedAt: new Date(),
      });

      const savedWithdrawal = session
        ? await withdrawal.save({ session })
        : await withdrawal.save();

      this.logger.log(
        `Created withdrawal ${savedWithdrawal._id} for user ${data.userId}, ` +
        `amount: ${data.amount} VND`
      );

      return savedWithdrawal;
    } catch (error) {
      this.logger.error('Error creating withdrawal transaction', error);
      throw new BadRequestException('Failed to create withdrawal transaction');
    }
  }
}
