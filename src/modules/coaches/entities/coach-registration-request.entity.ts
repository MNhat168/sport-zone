import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { BaseEntity } from 'src/common/entities/base.entity';
import { getCurrentVietnamTimeForDB } from 'src/utils/timezone.utils';
import { RegistrationStatus } from '@common/enums/field-owner-registration.enum';

@Schema()
export class CoachRegistrationRequest extends BaseEntity {
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

    // eKYC Integration Fields
    @Prop({ type: String })
    ekycSessionId?: string;

    @Prop({ type: String, enum: ['pending', 'verified', 'failed'] })
    ekycStatus?: 'pending' | 'verified' | 'failed';

    @Prop({ type: Date })
    ekycVerifiedAt?: Date;

    @Prop({
        type: {
            fullName: { type: String },
            idNumber: { type: String },
            identityCardNumber: { type: String },
            address: { type: String },
            permanentAddress: { type: String },
            dateOfBirth: { type: String },
            expirationDate: { type: String },
        },
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

    // Coach Profile Information
    @Prop({ type: String, required: true })
    sports: string;

    @Prop({ type: String, required: true })
    certification: string;

    @Prop({ type: Number, required: true, min: 0 })
    hourlyRate: number;

    @Prop({ type: String, required: true })
    bio: string;

    @Prop({ type: String, required: true })
    experience: string;

    // Location Information
    @Prop({ type: String, required: true })
    locationAddress: string;

    @Prop({
        type: {
            type: { type: String, enum: ['Point'] },
            coordinates: { type: [Number] },
        },
        _id: false,
    })
    locationCoordinates?: {
        type: 'Point';
        coordinates: [number, number]; // [longitude, latitude]
    };

    // Photos/Documents
    @Prop({ type: String })
    profilePhoto?: string;

    @Prop({ type: [String] })
    certificationPhotos?: string[];

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
    isLatest: boolean; // Mark latest request when user resubmits
}

export const CoachRegistrationRequestSchema = SchemaFactory.createForClass(CoachRegistrationRequest);

// Indexes
CoachRegistrationRequestSchema.index({ userId: 1, status: 1 });
CoachRegistrationRequestSchema.index({ status: 1, submittedAt: -1 });
CoachRegistrationRequestSchema.index({ 'locationCoordinates': '2dsphere' });
