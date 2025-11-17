import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, ClientSession } from 'mongoose';
import { Transaction, TransactionStatus, TransactionType } from './entities/transaction.entity';
import { PaymentMethod } from 'src/common/enums/payment-method.enum';
import * as crypto from 'crypto';
import * as qs from 'qs';

export interface CreatePaymentData {
  bookingId: string;
  userId: string;
  amount: number;
  method: PaymentMethod;
  paymentNote?: string;
  transactionId?: string;
  externalTransactionId?: string; // ✅ PayOS orderCode or VNPay transaction ID
}

@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name);

  constructor(
    @InjectModel(Transaction.name) private readonly transactionModel: Model<Transaction>,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Tạo transaction record mới
   * @param data Payment data
   * @param session Optional MongoDB session for transaction support
   */
  async createPayment(data: CreatePaymentData, session?: ClientSession): Promise<Transaction> {
    try {
      const transaction = new this.transactionModel({
        booking: new Types.ObjectId(data.bookingId),
        user: new Types.ObjectId(data.userId),
        amount: data.amount,
        direction: 'in',
        method: data.method,
        status: TransactionStatus.PENDING,
        type: TransactionType.PAYMENT,
        notes: data.paymentNote || null,
        // ✅ CRITICAL: Store externalTransactionId for PayOS/VNPay lookup
        ...(data.externalTransactionId && { externalTransactionId: data.externalTransactionId }),
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
   * Cập nhật trạng thái transaction với VNPay hoặc PayOS data
   */
  async updatePaymentStatus(
    transactionId: string, 
    status: TransactionStatus,
    receiptUrl?: string,
    gatewayData?: {
      // VNPay fields
      vnp_TransactionNo?: string;
      vnp_BankTranNo?: string;
      vnp_BankCode?: string;
      vnp_CardType?: string;
      vnp_ResponseCode?: string;
      vnp_TransactionStatus?: string;
      // PayOS fields
      payosOrderCode?: number;
      payosReference?: string;
      payosAccountNumber?: string;
      payosTransactionDateTime?: string;
    }
  ): Promise<Transaction> {
    const updateData: any = {
      status,
      ...(receiptUrl && { receiptUrl }),
    };

    // Update VNPay fields
    if (gatewayData) {
      if (gatewayData.vnp_TransactionNo) {
        updateData.vnpayTransactionNo = gatewayData.vnp_TransactionNo;
        updateData.externalTransactionId = gatewayData.vnp_TransactionNo;
      }
      if (gatewayData.vnp_BankTranNo) {
        updateData.vnpayBankTranNo = gatewayData.vnp_BankTranNo;
        if (!updateData.externalTransactionId) {
          updateData.externalTransactionId = gatewayData.vnp_BankTranNo;
        }
      }
      if (gatewayData.vnp_BankCode) updateData.vnpayBankCode = gatewayData.vnp_BankCode;
      if (gatewayData.vnp_CardType) updateData.vnpayCardType = gatewayData.vnp_CardType;
      if (gatewayData.vnp_ResponseCode) updateData.vnpayResponseCode = gatewayData.vnp_ResponseCode;
      if (gatewayData.vnp_TransactionStatus) updateData.vnpayTransactionStatus = gatewayData.vnp_TransactionStatus;

      // Update PayOS fields
      if (gatewayData.payosOrderCode) {
        updateData.externalTransactionId = String(gatewayData.payosOrderCode);
      }
      if (gatewayData.payosReference) {
        updateData.metadata = {
          ...updateData.metadata,
          payosReference: gatewayData.payosReference,
        };
      }
      if (gatewayData.payosAccountNumber) {
        updateData.metadata = {
          ...updateData.metadata,
          payosAccountNumber: gatewayData.payosAccountNumber,
        };
      }
      if (gatewayData.payosTransactionDateTime) {
        updateData.metadata = {
          ...updateData.metadata,
          payosTransactionDateTime: gatewayData.payosTransactionDateTime,
        };
      }
    }

    // Update timestamps based on status
    if (status === TransactionStatus.SUCCEEDED) {
      updateData.completedAt = new Date();
    } else if (status === TransactionStatus.FAILED) {
      updateData.failedAt = new Date();
      if (gatewayData?.vnp_ResponseCode) {
        updateData.errorCode = gatewayData.vnp_ResponseCode;
        updateData.errorMessage = this.getVNPayErrorDescription(gatewayData.vnp_ResponseCode);
      }
    } else if (status === TransactionStatus.PROCESSING) {
      updateData.processedAt = new Date();
    }

    // Update notes
    if (status === TransactionStatus.SUCCEEDED) {
      updateData.notes = 'Transaction completed successfully';
    } else if (status === TransactionStatus.FAILED) {
      updateData.notes = `Transaction failed with code ${gatewayData?.vnp_ResponseCode || 'unknown'}`;
    }

    const transaction = await this.transactionModel.findByIdAndUpdate(
      transactionId,
      updateData,
      { new: true }
    ).populate('booking').populate('user');

    if (!transaction) {
      throw new NotFoundException(`Transaction with ID ${transactionId} not found`);
    }

    this.logger.log(`Updated transaction ${transactionId} status to ${status}`);
    return transaction;
  }

  /**
   * Lấy transaction theo booking ID
   */
  async getPaymentByBookingId(bookingId: string): Promise<Transaction | null> {
    return this.transactionModel
      .findOne({ 
        booking: new Types.ObjectId(bookingId),
        type: TransactionType.PAYMENT 
      })
      .populate('user', 'fullName email')
      .exec();
  }

  /**
   * Lấy transaction theo ID
   */
  /**
   * Get payment by external transaction ID (PayOS order code, VNPay transaction no, etc.)
   */
  async getPaymentByExternalId(externalId: string): Promise<Transaction | null> {
    return await this.transactionModel
      .findOne({ externalTransactionId: externalId })
      .populate('booking')
      .populate('user', 'fullName email')
      .exec();
  }

  async getPaymentById(transactionId: string): Promise<Transaction | null> {
    return this.transactionModel
      .findById(transactionId)
      .populate('booking')
      .populate('user', 'fullName email')
      .exec();
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
      this.logger.error(
        `Transaction Error [${transactionId}]: Code ${errorCode} - ${errorMessage}`,
        JSON.stringify({
          transactionId,
          errorCode,
          errorMessage,
          bookingId: transaction.booking,
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
   * Get VNPay error description from response code
   * Used for better error reporting
   */
  getVNPayErrorDescription(responseCode: string): string {
    const errorMap: Record<string, string> = {
      '00': 'Giao dịch thành công',
      '07': 'Trừ tiền thành công. Giao dịch bị nghi ngờ (liên quan tới lừa đảo, giao dịch bất thường)',
      '09': 'Thẻ/Tài khoản chưa đăng ký dịch vụ InternetBanking',
      '10': 'Xác thực thông tin thẻ/tài khoản không đúng quá 3 lần',
      '11': 'Đã hết hạn chờ thanh toán',
      '12': 'Thẻ/Tài khoản bị khóa',
      '13': 'Nhập sai mật khẩu OTP',
      '24': 'Khách hàng hủy giao dịch',
      '51': 'Tài khoản không đủ số dư',
      '65': 'Vượt quá hạn mức giao dịch trong ngày',
      '75': 'Ngân hàng thanh toán đang bảo trì',
      '79': 'Nhập sai mật khẩu thanh toán quá số lần quy định',
      '99': 'Lỗi không xác định',
    };

    return errorMap[responseCode] || 'Lỗi không xác định';
  }


  createVNPayUrl(amount: number, orderId: string, ipAddr: string, returnUrlOverride?: string): string {
    const vnp_TmnCode = this.configService.get<string>('vnp_TmnCode');
    const vnp_HashSecret = this.configService.get<string>('vnp_HashSecret');
    const vnp_Url = this.configService.get<string>('vnp_Url');
    
    // Read returnUrl from .env or use override from query param
    const configReturnUrl = this.configService.get<string>('vnp_ReturnUrl') || 'http://localhost:5173/transactions/vnpay/return';
    const vnp_ReturnUrl = returnUrlOverride || configReturnUrl;

    if (!vnp_TmnCode || !vnp_HashSecret || !vnp_Url) {
      this.logger.error('VNPay configuration is missing. Please check environment variables.');
      throw new BadRequestException('Payment configuration error');
    }
    
    // Trim whitespace from config values to prevent signature errors
    const tmnCode = vnp_TmnCode.trim();
    const hashSecret = vnp_HashSecret.trim();
    const vnpayUrl = vnp_Url.trim();
    
    this.logger.debug(`[VNPay Config] TMN Code: ${tmnCode}`);
    this.logger.debug(`[VNPay Config] Hash Secret Length: ${hashSecret.length}`);
    this.logger.debug(`[VNPay Config] URL: ${vnpayUrl}`);
    
    const date = new Date();
    const createDate = `${date.getFullYear()}${(date.getMonth() + 1)
      .toString()
      .padStart(2, '0')}${date.getDate().toString().padStart(2, '0')}${date
        .getHours()
        .toString()
        .padStart(2, '0')}${date.getMinutes().toString().padStart(2, '0')}${date
          .getSeconds()
          .toString()
          .padStart(2, '0')}`;

    const vnp_Params: Record<string, string> = {
      vnp_Version: '2.1.0',
      vnp_Command: 'pay',
      vnp_TmnCode: tmnCode,
      vnp_Locale: 'vn',
      vnp_CurrCode: 'VND',
      vnp_TxnRef: orderId,
      vnp_OrderInfo: `Thanh toan don hang ${orderId}`,
      vnp_OrderType: 'other',
      vnp_Amount: (amount * 100).toString(),
      vnp_ReturnUrl: vnp_ReturnUrl,
      vnp_IpAddr: ipAddr,
      vnp_CreateDate: createDate,
    };

    // Sort parameters alphabetically
    const sorted = Object.keys(vnp_Params)
      .sort()
      .reduce((acc, key) => {
        acc[key] = vnp_Params[key];
        return acc;
      }, {} as Record<string, string>);

    // Create sign data - DO NOT encode
    const signData = qs.stringify(sorted, { encode: false });
    
    // Create HMAC SHA512 signature
    const hmac = crypto.createHmac('sha512', hashSecret);
    const signed = hmac.update(Buffer.from(signData, 'utf-8')).digest('hex');

    sorted['vnp_SecureHash'] = signed;

    // Build final URL - DO NOT encode
    const finalUrl = `${vnpayUrl}?${qs.stringify(sorted, { encode: false })}`;
    
    // Debug logging
    this.logger.log(`[VNPay URL] Created payment URL for order ${orderId}`);
    this.logger.debug(`[VNPay URL] Sign data: ${signData}`);
    this.logger.debug(`[VNPay URL] Signature: ${signed}`);
    this.logger.debug(`[VNPay URL] Final URL (first 150 chars): ${finalUrl.substring(0, 150)}...`);
    
    return finalUrl;
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
    bookingId: string;
    refundAmount: number;
    originalAmount: number;
    refundPaymentId: string;
    refundedAt: string;
  }> {
    // Get original transaction
    const originalTransaction = await this.transactionModel
      .findById(transactionId)
      .populate('booking')
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
      booking: originalTransaction.booking,
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
      bookingId: (originalTransaction.booking as any)?.toString?.() || originalTransaction.booking,
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
    const transactions = await this.transactionModel
      .find(query)
      .populate('booking', 'fieldId date startTime endTime totalPrice status')
      .populate('user', 'fullName email')
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(offset)
      .exec();

    const formattedPayments = transactions.map((transaction) => {
      // Extract refund information from notes if exists
      const refundInfo = this.extractRefundInfo(transaction.notes);

      return {
        paymentId: (transaction._id as any).toString(),
        bookingId: (transaction.booking as any)?._id?.toString() || transaction.booking,
        booking: transaction.booking,
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
   * Returns transaction records with full VNPay data and filters
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
      .populate('booking')
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
   * Get transaction by ID
   */
  async getTransactionById(transactionId: string): Promise<Transaction | null> {
    return await this.transactionModel
      .findById(transactionId)
      .populate('booking')
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
      .populate('booking')
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
        booking: new Types.ObjectId(bookingId),
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
        booking: new Types.ObjectId(bookingId),
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
}
