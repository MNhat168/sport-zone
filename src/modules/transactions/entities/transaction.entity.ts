import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { PaymentMethod } from 'src/common/enums/payment-method.enum';
import { BaseEntity, configureBaseEntitySchema } from 'src/common/entities/base.entity';
import { HydratedDocument } from 'mongoose';
import { TransactionStatus, TransactionType } from '@common/enums/transaction.enum';

/**
 * Transaction Entity (former Payment + Transaction)
 */
@Schema({ collection: 'transactions' }) // Đổi collection name
export class Transaction extends BaseEntity {


  // Link to Invoice (for Host subscription)
  @Prop({ type: Types.ObjectId, ref: 'Invoice' })
  invoice?: Types.ObjectId;

  // Số tiền (dương = vào hệ thống, âm = ra hệ thống)
  @Prop({ required: true })
  amount: number;

  // Hướng tiền
  @Prop({ required: true, enum: ['in', 'out'] })
  direction: 'in' | 'out';

  // Phương thức
  @Prop({ required: true, enum: PaymentMethod })
  method: PaymentMethod;

  // Loại giao dịch
  @Prop({ required: true, enum: TransactionType, default: TransactionType.PAYMENT })
  type: TransactionType;

  // Trạng thái
  @Prop({ required: true, enum: TransactionStatus, default: TransactionStatus.PENDING })
  status: TransactionStatus;

  // Người thực hiện (khách, admin, coach, system)
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  user: Types.ObjectId;

  // Liên kết giao dịch gốc (refund → payment, payout → payment)
  @Prop({ type: Types.ObjectId, ref: 'Transaction' })
  relatedTransaction?: Types.ObjectId;

  // External ID từ gateway
  @Prop({ type: String, unique: true, sparse: true })
  externalTransactionId?: string;

  // Refund / Adjustment
  @Prop() refundReason?: string;
  @Prop({ type: Types.ObjectId, ref: 'User' }) refundedBy?: Types.ObjectId;
  @Prop() originalAmount?: number;

  // Payout specific
  @Prop({ type: Types.ObjectId, ref: 'User' }) payoutTo?: Types.ObjectId; // coach / owner
  @Prop() payoutBankAccount?: string;
  @Prop() payoutBankName?: string;

  // Fee specific
  @Prop() feeRate?: number; // % hoặc fixed

  // Common
  @Prop() receiptUrl?: string;
  @Prop() notes?: string;
  @Prop({ type: Object }) metadata?: Record<string, any>;

  // Timestamps
  @Prop() processedAt?: Date;
  @Prop() completedAt?: Date;
  @Prop() failedAt?: Date;

  // Error
  @Prop() errorCode?: string;
  @Prop() errorMessage?: string;

  // Payment Proof (for BANK_TRANSFER payment method)
  @Prop({ type: String })
  paymentProofImageUrl?: string;

  @Prop({ type: String, enum: ['pending', 'approved', 'rejected'] })
  paymentProofStatus?: 'pending' | 'approved' | 'rejected';

  @Prop({ type: Types.ObjectId, ref: 'User' })
  paymentProofVerifiedBy?: Types.ObjectId;

  @Prop({ type: Date })
  paymentProofVerifiedAt?: Date;

  @Prop({ type: String })
  paymentProofRejectionReason?: string;
}

export const TransactionSchema = SchemaFactory.createForClass(Transaction);
configureBaseEntitySchema(TransactionSchema);
export type TransactionDocument = HydratedDocument<Transaction>;
// Indexes

TransactionSchema.index({ user: 1 });
TransactionSchema.index({ type: 1, status: 1 });
TransactionSchema.index({ direction: 1 });
TransactionSchema.index({ relatedTransaction: 1 });
TransactionSchema.index({ createdAt: -1 });
