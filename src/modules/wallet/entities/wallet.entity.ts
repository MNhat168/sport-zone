import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { BaseEntity, configureBaseEntitySchema } from 'src/common/entities/base.entity';
import { WalletStatus, WalletRole } from '@common/enums/wallet.enum';

export type WalletDocument = HydratedDocument<Wallet>;

/**
 * Wallet Entity V2
 * LOGIC MỚI:
 * - USER: Không nạp tiền trước, wallet chỉ tạo khi có refund credit (lazy creation)
 * - FIELD_OWNER/COACH: Chỉ có pendingBalance (UI display only), tiền tự động chuyển bank sau check-in
 * - ADMIN: Giữ tiền thật trong systemBalance, xử lý tất cả bank transfers
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
   * Role của wallet để phân biệt 3 loại:
   * - admin: System wallet giữ tiền thật
   * - field_owner: Wallet hiển thị pendingBalance (UI only)
   * - user: Wallet chỉ tạo khi có refund credit (lazy creation)
   */
  @Prop({ type: String, enum: WalletRole, required: true })
  role: WalletRole;

  /**
   * [ADMIN ONLY] Số dư thật trong hệ thống
   * Tiền từ PayOS → Admin wallet → Bank transfers
   */
  @Prop({ type: Number, default: 0 })
  systemBalance?: number;

  /**
   * [FIELD_OWNER/COACH ONLY] Số dư chờ check-in (UI display only)
   * Hiển thị: "Đang chờ check-in: X đồng"
   * Tự động về 0 sau khi bank transfer
   */
  @Prop({ type: Number, default: 0 })
  pendingBalance?: number;

  /**
   * [USER ONLY] Số dư hoàn tiền (lazy creation)
   * Chỉ tồn tại khi admin approve refund as credit
   * User có thể dùng để book lại hoặc withdraw
   */
  @Prop({ type: Number, default: 0 })
  refundBalance?: number;

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
}

export const WalletSchema = SchemaFactory.createForClass(Wallet);

configureBaseEntitySchema(WalletSchema);

// Index cho performance
WalletSchema.index({ status: 1 });
WalletSchema.index({ role: 1 });
WalletSchema.index({ createdAt: -1 });
WalletSchema.index({ user: 1, role: 1 }); // Composite index cho query by user + role

