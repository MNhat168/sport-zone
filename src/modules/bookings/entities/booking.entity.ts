import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { SportType } from 'src/common/enums/sport-type.enum';
import { BaseEntity, configureBaseEntitySchema } from 'src/common/entities/base.entity';
import { HydratedDocument } from 'mongoose';
export enum BookingType {
  FIELD = 'field',
  COACH = 'coach',
}

export enum BookingStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  CANCELLED = 'cancelled',
  COMPLETED = 'completed',
}



@Schema()
export class Booking extends BaseEntity {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  user: Types.ObjectId;

  // Pure Lazy Creation: Remove schedule reference, use fieldId + date instead
  @Prop({ type: Types.ObjectId, ref: 'Field', required: true })
  field: Types.ObjectId;

  // Add date field for tracing and easier queries (replaces schedule dependency)
  @Prop({ required: true, type: Date })
  date: Date;

  @Prop({ required: true, enum: BookingType })
  type: BookingType;

  @Prop({ type: Types.ObjectId, ref: 'CoachProfile' })
  requestedCoach?: Types.ObjectId;

  @Prop({
    type: String,
    enum: ['pending', 'accepted', 'declined'],
    default: 'pending',
  })
  coachStatus?: string;

  @Prop({
    default: 0,
    min: 0,
    max: 3,
  })
  retryAttempts?: number;

  @Prop({ required: true })
  startTime: string;

  @Prop({ required: true })
  endTime: string;

  @Prop({ type: Number, required: true, min: 1 }) // Thêm numSlots để dễ validate min/maxSlots mà không recalculate
  numSlots: number;

  @Prop({
    required: true,
    enum: BookingStatus,
    default: BookingStatus.PENDING,
  })
  status: BookingStatus;

  // New price structure: bookingAmount + platformFee = totalAmount
  @Prop({ required: true, min: 0 })
  bookingAmount: number; // Court fee + amenities (base amount before platform fee)

  @Prop({ required: true, min: 0, default: 0 })
  platformFee: number; // System/platform fee (5% of bookingAmount)

  // @deprecated Use bookingAmount + platformFee instead. Kept for backward compatibility
  @Prop({ required: false, min: 0 })
  totalPrice?: number;

  @Prop({ type: Types.ObjectId, ref: 'Transaction' })
  transaction?: Types.ObjectId;

  @Prop({ type: String })
  cancellationReason?: string;

  @Prop({ type: [{ type: Types.ObjectId, ref: 'Amenity' }] })
  selectedAmenities: Types.ObjectId[];

  @Prop({ type: Number, default: 0 })
  amenitiesFee: number;

  @Prop({ type: Boolean, default: false })
  holidayNotified?: boolean;

  @Prop({ type: String, maxlength: 200 })
  note?: string;

  // Note approval status from field owner when a note is provided by user
  @Prop({ type: String, enum: ['pending', 'accepted', 'denied'], default: 'pending' })
  noteStatus?: 'pending' | 'accepted' | 'denied';

  // Snapshot pricing data from Field at booking time (Pure Lazy Creation principle)
  @Prop({
    type: {
      basePrice: { type: Number, required: true },
      appliedMultiplier: { type: Number, required: true },
      priceBreakdown: { type: String } // Optional explanation of pricing calculation
    }
  })
  pricingSnapshot?: {
    basePrice: number;
    appliedMultiplier: number;
    priceBreakdown?: string;
  };
}

export type BookingDocument = HydratedDocument<Booking>;
export const BookingSchema = SchemaFactory.createForClass(Booking);

// Cấu hình timestamps từ BaseEntity
configureBaseEntitySchema(BookingSchema);

// Virtual getter for totalAmount (bookingAmount + platformFee)
BookingSchema.virtual('totalAmount').get(function () {
  return (this.bookingAmount || 0) + (this.platformFee || 0);
});

// Ensure virtual fields are included in JSON output
BookingSchema.set('toJSON', { virtuals: true });
BookingSchema.set('toObject', { virtuals: true });

// Pre-save hook: Calculate totalPrice from bookingAmount + platformFee for backward compatibility
BookingSchema.pre('save', function (next) {
  if (this.bookingAmount !== undefined && this.platformFee !== undefined) {
    // Auto-calculate totalPrice if not set (for backward compatibility)
    if (this.totalPrice === undefined || this.totalPrice === null) {
      this.totalPrice = this.bookingAmount + this.platformFee;
    }
  }
  next();
});

// Add compound index for efficient field + date queries
BookingSchema.index({ field: 1, date: 1 });
BookingSchema.index({ user: 1, status: 1 });

