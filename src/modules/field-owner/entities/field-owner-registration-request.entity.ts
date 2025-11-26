import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { User } from '../../users/entities/user.entity';
import { BaseEntity } from 'src/common/entities/base.entity';
import { SportType } from 'src/common/enums/sport-type.enum';

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

  // Documents
  // @deprecated idFront and idBack are deprecated - use eKYC instead
  @Prop({
    type: {
      idFront: { type: String, required: false }, // @deprecated - replaced by eKYC
      idBack: { type: String, required: false }, // @deprecated - replaced by eKYC
      businessLicense: { type: String, required: false },
    },
    required: false, // Made optional to support eKYC flow
    _id: false,
  })
  documents?: {
    idFront?: string; // @deprecated - URL to CCCD front image (replaced by eKYC)
    idBack?: string; // @deprecated - URL to CCCD back image (replaced by eKYC)
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
  @Prop({ type: String, required: true })
  
  facilityName: string;

  @Prop({ type: String, required: true })
  facilityLocation: string;

  @Prop({ type: [String], enum: SportType })
  supportedSports?: SportType[];

  @Prop({ type: String, required: true })
  description: string;

  @Prop({ type: [String] })
  amenities?: string[];

  @Prop({ type: String })
  verificationDocument?: string;

  @Prop({ type: String })
  businessHours?: string;

  @Prop({ type: String, required: true })
  contactPhone: string;

  @Prop({ type: String })
  website?: string;

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

