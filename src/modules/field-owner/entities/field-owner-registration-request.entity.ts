import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { BaseEntity } from 'src/common/entities/base.entity';
import { FacilityInfo, FacilityInfoSchema } from './facility-info.entity';

export enum OwnerType {
  INDIVIDUAL = 'individual',
  BUSINESS = 'business',
  HOUSEHOLD = 'household',
}

export enum RegistrationStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

@Schema()
export class FieldOwnerRegistrationRequest extends BaseEntity {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ type: String, enum: OwnerType, default: OwnerType.INDIVIDUAL })
  ownerType: OwnerType;

  // Personal Information
  @Prop({
    type: {
      fullName: { type: String, required: true },
      idNumber: { type: String, required: true },
      address: { type: String, required: true },
    },
    required: true,
    _id: false,
  })
  personalInfo: {
    fullName: string;
    idNumber: string;
    address: string;
  };

  // Business documents (e.g. business license). Identity docs are handled by eKYC.
  @Prop({
    type: {
      businessLicense: { type: String, required: false },
    },
    required: false,
    _id: false,
  })
  documents?: {
    businessLicense?: string; // URL to business license (for business/household)
  };

  // eKYC Integration Fields
  @Prop({ type: String })
  ekycSessionId?: string; // ID session from didit eKYC

  @Prop({ type: String, enum: ['pending', 'verified', 'failed'] })
  ekycStatus?: 'pending' | 'verified' | 'failed'; // eKYC verification status

  @Prop({ type: Date })
  ekycVerifiedAt?: Date; // Timestamp when eKYC verification succeeded

  @Prop({
    type: {
      fullName: { type: String },
      idNumber: { type: String },
      address: { type: String },
    },
    required: false,
    _id: false,
  })
  ekycData?: {
    fullName: string; // Extracted from eKYC
    idNumber: string; // Extracted from eKYC
    address: string; // Extracted from eKYC
  };

  // Facility Information
  @Prop({ type: FacilityInfoSchema, required: true })
  facility: FacilityInfo;

  // Field Images - Array of all uploaded field image URLs
  @Prop({ type: [String] })
  fieldImages?: string[];

  // Status
  @Prop({ type: String, enum: RegistrationStatus, default: RegistrationStatus.PENDING, index: true })
  status: RegistrationStatus;

  @Prop({ type: String })
  rejectionReason?: string;

  @Prop({ type: Date, default: Date.now })
  submittedAt: Date;

  @Prop({ type: Date })
  processedAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  processedBy?: Types.ObjectId;

  @Prop({ type: Date })
  reviewedAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  reviewedBy?: Types.ObjectId;

  @Prop({ type: Boolean, default: false })
  isLatest: boolean; // Để mark request mới nhất của user (khi nộp lại)
}

export const FieldOwnerRegistrationRequestSchema = SchemaFactory.createForClass(FieldOwnerRegistrationRequest);

// Indexes
FieldOwnerRegistrationRequestSchema.index({ userId: 1, status: 1 });
FieldOwnerRegistrationRequestSchema.index({ status: 1, submittedAt: -1 });

