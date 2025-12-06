import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { BaseEntity } from 'src/common/entities/base.entity';
import { getCurrentVietnamTimeForDB } from 'src/utils/timezone.utils';
import { FacilityInfo, FacilityInfoSchema } from './facility-info.entity';
import { RegistrationStatus } from '@common/enums/field-owner-registration.enum';

@Schema()
export class FieldOwnerRegistrationRequest extends BaseEntity {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

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
      idNumber: { type: String }, // Deprecated, use identityCardNumber
      identityCardNumber: { type: String },
      address: { type: String }, // Deprecated, use permanentAddress
      permanentAddress: { type: String },
      dateOfBirth: { type: String }, // Store as string or Date? User requirements said "dateOfBirth", often string from OCR. I'll use String for OCR data.
      expirationDate: { type: String },
    },
    required: false,
    _id: false,
  })
  ekycData?: {
    fullName: string;
    idNumber?: string;
    identityCardNumber?: string;
    address?: string;
    permanentAddress?: string;
    dateOfBirth?: string;
    expirationDate?: string;
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

  @Prop({ type: Date, default: () => getCurrentVietnamTimeForDB() })
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

