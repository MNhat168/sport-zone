import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { PaymentMethod } from 'src/common/enums/payment-method.enum';
import { BaseEntity } from 'src/common/entities/base.entity';

export enum PaymentStatus {
  PENDING = 'pending',
  SUCCEEDED = 'succeeded',
  FAILED = 'failed',
  REFUNDED = 'refunded',
}

@Schema()
export class Payment extends BaseEntity {
  @Prop({ type: Types.ObjectId, ref: 'Booking', required: true })
  booking: Types.ObjectId;

  @Prop({ required: true, min: 0 })
  amount: number;

  @Prop({ required: true, enum: PaymentMethod })
  method: PaymentMethod;

  @Prop({ 
    required: true, 
    enum: PaymentStatus, 
    default: PaymentStatus.PENDING 
  })
  status: PaymentStatus;

  @Prop({ type: String })
  transactionId?: string;

  @Prop({ type: String })
  receiptUrl?: string;

  @Prop({ type: String })
  paymentNote?: string; // Ghi chú thanh toán

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  paidBy: Types.ObjectId; // Người thanh toán
}

export const PaymentSchema = SchemaFactory.createForClass(Payment);