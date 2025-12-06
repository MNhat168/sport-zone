import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { FieldOwnerProfile } from './field-owner-profile.entity';
import { CoachProfile } from '../../coaches/entities/coach-profile.entity';
import { User } from '../../users/entities/user.entity';
import { BaseEntity } from 'src/common/entities/base.entity';
import { BankAccountStatus } from '@common/enums/bank-account.enum';

@Schema()
export class BankAccount extends BaseEntity {
  // Owner can be either FieldOwner or Coach (only one should be set)
  @Prop({ type: Types.ObjectId, ref: 'FieldOwnerProfile', index: true })
  fieldOwner?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'CoachProfile', index: true })
  coach?: Types.ObjectId;

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

  @Prop({ type: String, enum: BankAccountStatus, default: BankAccountStatus.PENDING })
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

  // Verification payment tracking (PayOS payment transfer verification)
  @Prop({ type: String })
  verificationOrderCode?: string; // PayOS order code for verification payment

  @Prop({ type: Number, default: 10000 })
  verificationAmount?: number; // Verification amount (default: 10,000 VND)

  @Prop({ type: String })
  counterAccountNumber?: string; // Account number from payment (from PayOS webhook)

  @Prop({ type: String })
  counterAccountName?: string; // Account name from payment (from PayOS webhook)

  @Prop({ type: String, enum: ['pending', 'paid', 'failed'], default: 'pending' })
  verificationPaymentStatus?: 'pending' | 'paid' | 'failed'; // Payment status

  @Prop({ type: String })
  verificationUrl?: string; // Payment checkout URL

  @Prop({ type: String })
  verificationQrCode?: string; // Payment QR Code URL

  // QR Code URL for bank transfer (used for coach bookings)
  @Prop({ type: String })
  qrCodeUrl?: string; // QR Code URL for payment
}

export const BankAccountSchema = SchemaFactory.createForClass(BankAccount);

// Validation: Ensure either fieldOwner or coach is set, but not both
BankAccountSchema.pre('validate', function(next) {
  const hasFieldOwner = !!this.fieldOwner;
  const hasCoach = !!this.coach;
  
  if (!hasFieldOwner && !hasCoach) {
    return next(new Error('Either fieldOwner or coach must be set'));
  }
  
  if (hasFieldOwner && hasCoach) {
    return next(new Error('Cannot set both fieldOwner and coach'));
  }
  
  next();
});

// Indexes
BankAccountSchema.index({ fieldOwner: 1, status: 1 });
BankAccountSchema.index({ coach: 1, status: 1 });
BankAccountSchema.index({ status: 1 });
BankAccountSchema.index({ fieldOwner: 1, isDefault: 1 });
BankAccountSchema.index({ coach: 1, isDefault: 1 });
BankAccountSchema.index({ verificationOrderCode: 1 }); // For webhook lookup

