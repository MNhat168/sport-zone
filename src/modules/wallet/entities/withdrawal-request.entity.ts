import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { BaseEntity, configureBaseEntitySchema } from 'src/common/entities/base.entity';

export type WithdrawalRequestDocument = HydratedDocument<WithdrawalRequest>;

export enum WithdrawalRequestStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

@Schema({ collection: 'withdrawalrequests' })
export class WithdrawalRequest extends BaseEntity {
  /**
   * User tạo yêu cầu rút tiền (field-owner hoặc coach)
   */
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  /**
   * Role của user (field_owner hoặc coach)
   */
  @Prop({ type: String, enum: ['field_owner', 'coach'], required: true })
  userRole: 'field_owner' | 'coach';

  /**
   * Số tiền muốn rút
   */
  @Prop({ type: Number, required: true, min: 1000 })
  amount: number;

  /**
   * Trạng thái yêu cầu
   */
  @Prop({
    type: String,
    enum: WithdrawalRequestStatus,
    default: WithdrawalRequestStatus.PENDING,
    index: true,
  })
  status: WithdrawalRequestStatus;

  /**
   * Số tài khoản ngân hàng
   */
  @Prop({ type: String })
  bankAccount?: string;

  /**
   * Tên ngân hàng
   */
  @Prop({ type: String })
  bankName?: string;

  /**
   * Lý do từ chối (nếu bị reject)
   */
  @Prop({ type: String })
  rejectionReason?: string;

  /**
   * Admin duyệt yêu cầu
   */
  @Prop({ type: Types.ObjectId, ref: 'User' })
  approvedBy?: Types.ObjectId;

  /**
   * Thời điểm duyệt
   */
  @Prop({ type: Date })
  approvedAt?: Date;

  /**
   * Admin từ chối yêu cầu
   */
  @Prop({ type: Types.ObjectId, ref: 'User' })
  rejectedBy?: Types.ObjectId;

  /**
   * Thời điểm từ chối
   */
  @Prop({ type: Date })
  rejectedAt?: Date;

  /**
   * Ghi chú từ admin khi approve
   */
  @Prop({ type: String })
  adminNotes?: string;
}

export const WithdrawalRequestSchema = SchemaFactory.createForClass(WithdrawalRequest);

configureBaseEntitySchema(WithdrawalRequestSchema);

// Indexes for performance
WithdrawalRequestSchema.index({ userId: 1, createdAt: -1 }); // Query requests của user, sort mới nhất
WithdrawalRequestSchema.index({ status: 1, createdAt: -1 }); // Admin query pending requests
WithdrawalRequestSchema.index({ createdAt: -1 }); // Default sort mới nhất
