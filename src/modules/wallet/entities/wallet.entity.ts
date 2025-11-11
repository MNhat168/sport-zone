import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { BaseEntity, configureBaseEntitySchema } from 'src/common/entities/base.entity';

export type WalletDocument = HydratedDocument<Wallet>;

export enum WalletStatus {
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  CLOSED = 'closed',
}

/**
 * Wallet Entity
 * Lưu thông tin số dư ví của người dùng (user)
 */
@Schema({ collection: 'wallets' })
export class Wallet extends BaseEntity {
  /**
   * Tham chiếu user sở hữu ví
   * Mỗi user chỉ có một ví
   */
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, unique: true, index: true })
  user: Types.ObjectId;

  /**
   * Số dư khả dụng (đơn vị: đồng)
   * Dùng cho các giao dịch có thể chi tiêu ngay
   */
  @Prop({ type: Number, required: true, default: 0 })
  availableBalance: number;

  /**
   * Số dư đang bị giữ (pending) cho các giao dịch chưa hoàn tất
   * Ví dụ: thanh toán chờ xác nhận, rút tiền chờ duyệt
   */
  @Prop({ type: Number, required: true, default: 0 })
  pendingBalance: number;

  /**
   * Tổng số tiền người dùng đã nạp/nhận vào ví từ trước tới nay
   * Dùng cho mục đích thống kê
   */
  @Prop({ type: Number, required: true, default: 0 })
  totalEarned: number;

  /**
   * Tổng số tiền người dùng đã rút/chi ra từ ví
   * Dùng cho mục đích thống kê
   */
  @Prop({ type: Number, required: true, default: 0 })
  totalWithdrawn: number;

  /**
   * Đơn vị tiền tệ của ví (mặc định: VND)
   */
  @Prop({ type: String, required: true, default: 'VND' })
  currency: string;

  /**
   * Trạng thái hoạt động của ví
   */
  @Prop({ type: String, enum: WalletStatus, default: WalletStatus.ACTIVE })
  status: WalletStatus;

  /**
   * Thời điểm phát sinh giao dịch gần nhất ảnh hưởng tới ví
   */
  @Prop({ type: Date })
  lastTransactionAt?: Date;

  /**
   * Trường metadata để lưu các thông tin phụ trợ khác
   */
  @Prop({ type: Object })
  metadata?: Record<string, any>;
}

export const WalletSchema = SchemaFactory.createForClass(Wallet);

configureBaseEntitySchema(WalletSchema);

WalletSchema.index({ status: 1 });
WalletSchema.index({ createdAt: -1 });

