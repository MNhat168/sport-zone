import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CreateWalletDto } from './dto/create-wallet.dto';
import { AdjustWalletBalanceDto } from './dto/adjust-wallet-balance.dto';
import { Wallet, WalletDocument, WalletStatus } from './entities/wallet.entity';

@Injectable()
export class WalletService {
  constructor(
    @InjectModel(Wallet.name)
    private readonly walletModel: Model<WalletDocument>,
  ) {}

  /**
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
      metadata: dto.metadata ?? {},
      status: WalletStatus.ACTIVE,
    });

    return wallet.save();
  }

  /**
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

    const newBalance = wallet.availableBalance + dto.amount;
    if (newBalance < 0) {
      throw new BadRequestException('Insufficient balance');
    }

    wallet.availableBalance = newBalance;
    if (dto.amount > 0) {
      wallet.totalEarned += dto.amount;
    } else {
      wallet.totalWithdrawn += Math.abs(dto.amount);
    }
    wallet.lastTransactionAt = new Date();

    wallet.metadata = {
      ...(wallet.metadata || {}),
      lastAdjustment: {
        amount: dto.amount,
        reason: dto.reason,
        at: new Date(),
        metadata: dto.metadata,
      },
    };

    await wallet.save();
    return wallet;
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

  private toObjectId(id: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException(`Invalid ObjectId: ${id}`);
    }
    return new Types.ObjectId(id);
  }
}

