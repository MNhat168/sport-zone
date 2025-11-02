import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { SportType } from 'src/common/enums/sport-type.enum';
import { BaseEntity, configureBaseEntitySchema } from 'src/common/entities/base.entity';

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

  @Prop({ required: true, min: 0 })
  totalPrice: number;

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

export const BookingSchema = SchemaFactory.createForClass(Booking);

// Cấu hình timestamps từ BaseEntity
configureBaseEntitySchema(BookingSchema);

// Add compound index for efficient field + date queries
BookingSchema.index({ field: 1, date: 1 });
BookingSchema.index({ user: 1, status: 1 });

