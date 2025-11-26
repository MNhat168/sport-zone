import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { FieldOwnerProfile } from './field-owner-profile.entity';
import { User } from '../../users/entities/user.entity';
import { BaseEntity } from 'src/common/entities/base.entity';

export enum BankAccountStatus {
  PENDING = 'pending',
  VERIFIED = 'verified',
  REJECTED = 'rejected',
}

@Schema()
export class BankAccount extends BaseEntity {
  @Prop({ type: Types.ObjectId, ref: 'FieldOwnerProfile', required: true, index: true })
  fieldOwner: Types.ObjectId;

  @Prop({ required: true })
  accountName: string;

  @Prop({ required: true })
  accountNumber: string;

  @Prop({ required: true })
  bankCode: string; // Bank code for PayOS API

  @Prop({ required: true })
  bankName: string;

  @Prop({ type: String })
  branch?: string;

  @Prop({ type: String })
  verificationDocument?: string; // URL to Internet Banking screenshot

  @Prop({ type: String, enum: BankAccountStatus, default: BankAccountStatus.PENDING, index: true })
  status: BankAccountStatus;

  // PayOS validation result
  @Prop({ type: String })
  accountNameFromPayOS?: string; // Account name returned from PayOS validation

  @Prop({ type: Boolean, default: false })
  isValidatedByPayOS: boolean; // Whether PayOS validation was successful

  @Prop({ type: Date })
  verifiedAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  verifiedBy?: Types.ObjectId; // Admin who verified/rejected

  @Prop({ type: String })
  rejectionReason?: string;

  @Prop({ type: String })
  notes?: string;

  @Prop({ type: Boolean, default: true })
  isDefault: boolean; // Chủ sân có thể có nhiều tài khoản, cần biết cái nào rút mặc định
}

export const BankAccountSchema = SchemaFactory.createForClass(BankAccount);

// Indexes
BankAccountSchema.index({ fieldOwner: 1, status: 1 });
BankAccountSchema.index({ status: 1 });
BankAccountSchema.index({ fieldOwner: 1, isDefault: 1 });

