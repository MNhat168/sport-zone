import { BadRequestException, Injectable, Logger, NotFoundException, Inject, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { CreateWalletDto } from './dto/create-wallet.dto';
import { AdjustWalletBalanceDto } from './dto/adjust-wallet-balance.dto';
import {
  Wallet,
  WalletDocument
} from './entities/wallet.entity';
import { WithdrawalRequest, WithdrawalRequestDocument, WithdrawalRequestStatus } from './entities/withdrawal-request.entity';
import { WalletStatus, WalletRole } from '@common/enums/wallet.enum';
import {
  FieldOwnerWalletDto,
  UserWalletDto,
  AdminWalletDto,
} from './dto/wallet-response.dto';
import { WithdrawalRequestResponseDto } from './dto/withdrawal-request-response.dto';
import { PaymentHandlerService } from '../bookings/services/payment-handler.service';

/**
 * Wallet Service V2
 * Implements new wallet logic:
 * - Lazy wallet creation
 * - Role-based wallet management
 * - No pre-funding for users
 */
@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  // Admin System Wallet ID - constant
  private readonly ADMIN_SYSTEM_ID = 'ADMIN_SYSTEM_ID';

  constructor(
    @InjectModel(Wallet.name)
    private readonly walletModel: Model<WalletDocument>,
    @InjectModel(WithdrawalRequest.name)
    private readonly withdrawalRequestModel: Model<WithdrawalRequest>,
    @Inject(forwardRef(() => PaymentHandlerService))
    private readonly paymentHandlerService: PaymentHandlerService,
  ) { }

  // ===================================================================
  // CORE METHOD - ALWAYS USE THIS FOR WALLET ACCESS
  // ===================================================================

  /**
   * [CRITICAL] Lazy wallet creation - REUSE EVERYWHERE
   * Tự động tạo wallet nếu chưa tồn tại
   * MUST use this method for ANY wallet access to ensure lazy creation
   * 
   * @param userId - User ID (can be admin, field_owner, or user)
   * @param role - Wallet role (admin, field_owner, user)
   * @param session - MongoDB session for transaction support
   * @returns Wallet document
   */
  async getOrCreateWallet(
    userId: string,
    role: WalletRole,
    session?: ClientSession,
  ): Promise<WalletDocument> {
    // ✅ CRITICAL FIX: Handle admin wallet specially
    // Admin wallet uses ADMIN_SYSTEM_ID which is not a valid ObjectId
    // We need to find/create it by role instead
    if (userId === this.ADMIN_SYSTEM_ID && role === WalletRole.ADMIN) {
      let wallet = await this.walletModel
        .findOne({ role: WalletRole.ADMIN })
        .session(session || null);

      if (!wallet) {
        this.logger.log(`Creating new admin system wallet`);

        // Use a fixed ObjectId for admin wallet (24 hex chars)
        // This is a constant ObjectId that represents the admin system
        const adminObjectId = new Types.ObjectId('000000000000000000000001');

        wallet = new this.walletModel({
          user: adminObjectId,
          role: WalletRole.ADMIN,
          currency: 'VND',
          systemBalance: 0,
          status: WalletStatus.ACTIVE,
        });

        await wallet.save({ session });
        this.logger.log(`✅ Admin system wallet created`);
      }

      return wallet;
    }

    // Normal wallet lookup for regular users
    let wallet = await this.walletModel
      .findOne({ user: this.toObjectId(userId) })
      .session(session || null);

    if (!wallet) {
      this.logger.log(`Creating new wallet for user ${userId} with role ${role}`);

      wallet = new this.walletModel({
        user: this.toObjectId(userId),
        role,
        currency: 'VND',
        // Initialize balance fields based on role
        systemBalance: role === WalletRole.ADMIN ? 0 : undefined,
        pendingBalance: role === WalletRole.FIELD_OWNER ? 0 : undefined,
        availableBalance: role === WalletRole.FIELD_OWNER ? 0 : undefined,
        refundBalance: role === WalletRole.USER ? 0 : undefined,
        status: WalletStatus.ACTIVE,
      });

      await wallet.save({ session });
      this.logger.log(`✅ Wallet created for user ${userId}`);
    }

    return wallet;
  }

  // ===================================================================
  // ROLE-SPECIFIC WALLET GETTERS
  // ===================================================================

  /**
   * Get field-owner wallet for UI display
   * Shows pendingBalance (UI display only)
   * 
   * @param userId - Field owner user ID
   * @returns FieldOwnerWalletDto
   */
  async getFieldOwnerWallet(userId: string): Promise<FieldOwnerWalletDto> {
    const wallet = await this.getOrCreateWallet(userId, WalletRole.FIELD_OWNER);
    this.logger.log(`[GetFieldOwnerWallet] UserId: ${userId}, PendingBalance: ${wallet.pendingBalance}, AvailableBalance: ${wallet.availableBalance}`);
    return FieldOwnerWalletDto.fromWallet(wallet);
  }

  /**
   * Get user wallet (returns null if no refund)
   * 99% users will have null wallet (lazy creation)
   * Only created when admin approves refund as credit
   * 
   * @param userId - User ID
   * @returns UserWalletDto or null
   */
  async getUserWallet(userId: string): Promise<UserWalletDto | null> {
    const wallet = await this.walletModel.findOne({
      user: this.toObjectId(userId),
      role: WalletRole.USER,
    });

    // Return null if wallet doesn't exist or has no refund balance
    if (!wallet || !wallet.refundBalance || wallet.refundBalance === 0) {
      return null;
    }

    return UserWalletDto.fromWallet(wallet);
  }

  /**
   * Get admin system wallet
   * Holds all real money in systemBalance
   * 
   * @returns AdminWalletDto
   */
  async getAdminWallet(): Promise<AdminWalletDto> {
    const wallet = await this.getOrCreateWallet(
      this.ADMIN_SYSTEM_ID,
      WalletRole.ADMIN,
    );
    return AdminWalletDto.fromWallet(wallet);
  }

  // ===================================================================
  // LEGACY METHODS (DEPRECATED - Keep for backward compatibility)
  // ===================================================================

  /**
   * @deprecated Use getOrCreateWallet() instead
   * Lấy thông tin ví theo userId
   */
  async getWalletByUserId(userId: string): Promise<WalletDocument> {
    const wallet = await this.walletModel.findOne({ user: this.toObjectId(userId) });

    if (!wallet) {
      throw new NotFoundException(`Wallet for user ${userId} not found`);
    }

    return wallet;
  }

  /**
   * @deprecated Use getOrCreateWallet() instead
   * Khởi tạo ví cho user (nếu chưa tồn tại)
   */
  async createWalletForUser(userId: string, dto: CreateWalletDto): Promise<WalletDocument> {
    const existingWallet = await this.walletModel.findOne({ user: this.toObjectId(userId) });

    if (existingWallet) {
      return existingWallet;
    }

    const wallet = new this.walletModel({
      user: this.toObjectId(userId),
      currency: dto.currency ?? 'VND',
      status: WalletStatus.ACTIVE,
      // TODO: Add role field based on user type
      role: WalletRole.FIELD_OWNER, // Default for backward compatibility
    });

    return wallet.save();
  }

  /**
   * @deprecated OLD LOGIC - No longer used in V2
   * Use payment flow handlers instead
   * 
   * Điều chỉnh số dư khả dụng của ví
   * amount > 0: nạp tiền | amount < 0: trừ tiền
   */
  async adjustAvailableBalance(userId: string, dto: AdjustWalletBalanceDto): Promise<WalletDocument> {
    if (!dto.amount || dto.amount === 0) {
      throw new BadRequestException('Amount must be non-zero');
    }

    const wallet = await this.walletModel.findOne({ user: this.toObjectId(userId) });
    if (!wallet) {
      throw new NotFoundException(`Wallet for user ${userId} not found`);
    }

    if (wallet.status !== WalletStatus.ACTIVE) {
      throw new BadRequestException(`Wallet status ${wallet.status} does not allow balance adjustments`);
    }

    // Note: This method uses old fields (availableBalance, totalEarned, totalWithdrawn)
    // which are deprecated in V2
    // Keep for backward compatibility but should not be used in new code

    throw new BadRequestException(
      'This method is deprecated. Please use payment flow handlers instead.'
    );
  }

  /**
   * Đánh dấu ví bị khóa/tạm dừng
   */
  async updateWalletStatus(userId: string, status: WalletStatus): Promise<WalletDocument> {
    const wallet = await this.walletModel.findOneAndUpdate(
      { user: this.toObjectId(userId) },
      { status },
      { new: true },
    );

    if (!wallet) {
      throw new NotFoundException(`Wallet for user ${userId} not found`);
    }

    return wallet;
  }

  // ===================================================================
  // UTILITY METHODS
  // ===================================================================

  /**
   * Check if user has sufficient refund balance
   * Used for booking with refund credit or withdrawing
   * 
   * @param userId - User ID
   * @param amount - Amount to check
   * @returns boolean
   */
  async hasRefundBalance(userId: string, amount: number): Promise<boolean> {
    const wallet = await this.walletModel.findOne({
      user: this.toObjectId(userId),
      role: WalletRole.USER,
    });

    if (!wallet) {
      return false;
    }

    return (wallet.refundBalance || 0) >= amount;
  }

  /**
   * Get wallet by ID (internal use)
   * 
   * @param walletId - Wallet document ID
   * @returns WalletDocument
   */
  async getWalletById(walletId: string): Promise<WalletDocument> {
    const wallet = await this.walletModel.findById(walletId);

    if (!wallet) {
      throw new NotFoundException(`Wallet ${walletId} not found`);
    }

    return wallet;
  }

  /**
   * Transfer funds from pending to available balance
   * Called when booking is checked-in via QR code
   * 
   * @param fieldOwnerId - Field owner user ID
   * @param amount - Amount to transfer
   * @param bookingId - Booking ID for reference
   * @param transactionId - Original transaction ID
   * @returns Updated wallet document
   */
  async transferPendingToAvailable(
    fieldOwnerId: string,
    amount: number,
    bookingId: string,
    transactionId: string
  ): Promise<WalletDocument> {
    if (!fieldOwnerId || !amount || amount <= 0) {
      throw new BadRequestException('Invalid parameters for wallet transfer');
    }

    // Get field owner wallet
    const wallet = await this.getOrCreateWallet(fieldOwnerId, WalletRole.FIELD_OWNER);

    // Check if pending balance is sufficient
    const currentPending = wallet.pendingBalance || 0;
    if (currentPending < amount) {
      throw new BadRequestException(
        `Insufficient pending balance. Required: ${amount}, Available: ${currentPending}`
      );
    }

    // Perform atomic transfer
    wallet.pendingBalance = currentPending - amount;
    wallet.availableBalance = (wallet.availableBalance || 0) + amount;

    await wallet.save();

    this.logger.log(
      `[Wallet Transfer] Transferred ${amount} from pending to available for field owner ${fieldOwnerId}. ` +
      `Booking: ${bookingId}, Transaction: ${transactionId}`
    );

    return wallet;
  }

  // ===================================================================
  // WITHDRAWAL REQUEST METHODS
  // ===================================================================

  /**
   * Get withdrawal requests with filters and pagination
   * Used by admin to view all withdrawal requests
   * 
   * @param filters - Filter options (status, userRole)
   * @param page - Page number (default: 1)
   * @param limit - Items per page (default: 10)
   * @returns Paginated withdrawal requests with user info
   */
  async getWithdrawalRequests(
    filters: {
      status?: WithdrawalRequestStatus;
      userRole?: 'field_owner' | 'coach';
      userId?: string;
    } = {},
    page: number = 1,
    limit: number = 10,
  ): Promise<{
    data: WithdrawalRequestResponseDto[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const query: any = {};

    if (filters.status) {
      query.status = filters.status;
    }

    if (filters.userRole) {
      query.userRole = filters.userRole;
    }

    if (filters.userId) {
      query.userId = new Types.ObjectId(filters.userId);
    }

    const skip = (page - 1) * limit;

    const [requests, total] = await Promise.all([
      this.withdrawalRequestModel
        .find(query)
        .populate('userId', 'fullName email phone')
        .sort({ createdAt: -1 }) // Mới nhất lên đầu
        .skip(skip)
        .limit(limit)
        .lean(),
      this.withdrawalRequestModel.countDocuments(query),
    ]);

    const data = requests.map((req: any) => ({
      _id: req._id.toString(),
      userId: req.userId._id?.toString() || req.userId.toString(),
      userRole: req.userRole,
      amount: req.amount,
      status: req.status,
      bankAccount: req.bankAccount,
      bankName: req.bankName,
      rejectionReason: req.rejectionReason,
      approvedBy: req.approvedBy?.toString(),
      approvedAt: req.approvedAt,
      rejectedBy: req.rejectedBy?.toString(),
      rejectedAt: req.rejectedAt,
      adminNotes: req.adminNotes,
      createdAt: req.createdAt,
      updatedAt: req.updatedAt,
      user: req.userId && typeof req.userId === 'object' ? {
        _id: req.userId._id.toString(),
        fullName: req.userId.fullName,
        email: req.userId.email,
        phone: req.userId.phone,
      } : undefined,
    }));

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Approve withdrawal request
   * Processes the withdrawal (trừ balance, tạo transaction, gọi PayOS)
   * 
   * @param requestId - Withdrawal request ID
   * @param adminId - Admin user ID
   * @param notes - Admin notes (optional)
   * @returns Updated withdrawal request
   */
  async approveWithdrawalRequest(
    requestId: string,
    adminId: string,
    notes?: string,
  ): Promise<WithdrawalRequestDocument> {
    const request = await this.withdrawalRequestModel.findById(requestId);

    if (!request) {
      throw new NotFoundException('Yêu cầu rút tiền không tồn tại');
    }

    if (request.status !== WithdrawalRequestStatus.PENDING) {
      throw new BadRequestException(`Yêu cầu đã được xử lý. Trạng thái hiện tại: ${request.status}`);
    }

    // Process withdrawal (trừ balance, tạo transaction, etc.)
    await this.paymentHandlerService.processWithdrawalRequest(requestId, adminId, notes);

    // Reload request to get updated status
    const updatedRequest = await this.withdrawalRequestModel.findById(requestId);
    if (!updatedRequest) {
      throw new NotFoundException('Yêu cầu rút tiền không tồn tại sau khi xử lý');
    }

    return updatedRequest;
  }

  /**
   * Reject withdrawal request
   * Updates request status to rejected
   * 
   * @param requestId - Withdrawal request ID
   * @param adminId - Admin user ID
   * @param reason - Rejection reason
   * @returns Updated withdrawal request
   */
  async rejectWithdrawalRequest(
    requestId: string,
    adminId: string,
    reason: string,
  ): Promise<WithdrawalRequestDocument> {
    const request = await this.withdrawalRequestModel.findById(requestId);

    if (!request) {
      throw new NotFoundException('Yêu cầu rút tiền không tồn tại');
    }

    if (request.status !== WithdrawalRequestStatus.PENDING) {
      throw new BadRequestException(`Yêu cầu đã được xử lý. Trạng thái hiện tại: ${request.status}`);
    }

    request.status = WithdrawalRequestStatus.REJECTED;
    request.rejectedBy = new Types.ObjectId(adminId);
    request.rejectedAt = new Date();
    request.rejectionReason = reason;

    await request.save();

    this.logger.log(`[Withdrawal Request] Rejected request ${requestId} by admin ${adminId}`);

    // Emit event for notification
    // this.eventEmitter.emit('withdrawal.request.rejected', { ... });

    return request;
  }

  /**
   * Get user's withdrawal requests
   * Used by field-owner/coach to view their own requests
   * 
   * @param userId - User ID
   * @returns List of withdrawal requests
   */
  async getUserWithdrawalRequests(userId: string): Promise<WithdrawalRequestResponseDto[]> {
    const requests = await this.withdrawalRequestModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .lean();

    return requests.map((req: any) => ({
      _id: req._id.toString(),
      userId: req.userId.toString(),
      userRole: req.userRole,
      amount: req.amount,
      status: req.status,
      bankAccount: req.bankAccount,
      bankName: req.bankName,
      rejectionReason: req.rejectionReason,
      approvedBy: req.approvedBy?.toString(),
      approvedAt: req.approvedAt,
      rejectedBy: req.rejectedBy?.toString(),
      rejectedAt: req.rejectedAt,
      adminNotes: req.adminNotes,
      createdAt: req.createdAt,
      updatedAt: req.updatedAt,
    }));
  }

  /**
   * Convert string to MongoDB ObjectId
   * 
   * @param id - String ID
   * @returns ObjectId
   */
  private toObjectId(id: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException(`Invalid ObjectId: ${id}`);
    }
    return new Types.ObjectId(id);
  }
}

