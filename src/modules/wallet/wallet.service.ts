import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { CreateWalletDto } from './dto/create-wallet.dto';
import { AdjustWalletBalanceDto } from './dto/adjust-wallet-balance.dto';
import { 
  Wallet, 
  WalletDocument, 
  WalletStatus, 
  WalletRole 
} from './entities/wallet.entity';
import {
  FieldOwnerWalletDto,
  UserWalletDto,
  AdminWalletDto,
} from './dto/wallet-response.dto';

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
  ) {}

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

