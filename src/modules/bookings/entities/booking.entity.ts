import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { SportType } from 'src/common/enums/sport-type.enum';
import { BaseEntity, configureBaseEntitySchema } from 'src/common/entities/base.entity';
import { HydratedDocument } from 'mongoose';
import { BookingType, BookingStatus } from '@common/enums/booking.enum';



@Schema()
export class Booking extends BaseEntity {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  user: Types.ObjectId;

  // Pure Lazy Creation: Remove schedule reference, use fieldId + date instead
  // Field is optional for coach bookings (can be null)
  @Prop({ type: Types.ObjectId, ref: 'Field' })
  field?: Types.ObjectId;

  // Add date field for tracing and easier queries (replaces schedule dependency)
  @Prop({ required: true, type: Date })
  date: Date;

  @Prop({ required: true, enum: BookingType })
  type: BookingType;

  @Prop({ type: Types.ObjectId, ref: 'CoachProfile' })
  requestedCoach?: Types.ObjectId;

  // Specific court for field bookings (required for field bookings, optional for coach bookings)
  @Prop({ type: Types.ObjectId, ref: 'Court' })
  court?: Types.ObjectId;

  @Prop({
    type: String,
    enum: ['pending', 'accepted', 'declined'],
    // ✅ Removed default: 'pending' - only set for coach bookings (type: 'coach')
    // This prevents field bookings from having coachStatus
  })
  coachStatus?: string;

  @Prop({
    default: 0,
    min: 0,
    max: 4,
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

  /**
   * New, explicit status dimensions (Stage 1: fields only, no behavior change)
   */
  @Prop({ type: String, enum: ['unpaid', 'paid', 'refunded'] })
  paymentStatus?: 'unpaid' | 'paid' | 'refunded';

  @Prop({ type: String, enum: ['pending', 'approved', 'rejected'] })
  approvalStatus?: 'pending' | 'approved' | 'rejected';

  // New price structure: bookingAmount + platformFee = totalAmount
  @Prop({ required: true, min: 0 })
  bookingAmount: number; // Court fee + amenities (base amount before platform fee)

  @Prop({ required: true, min: 0, default: 0 })
  platformFee: number; // System/platform fee (5% of bookingAmount)

  // @deprecated Use bookingAmount + platformFee instead. Kept for backward compatibility
  @Prop({ min: 0 })
  totalPrice?: number;

  /**
   * @deprecated Use TransactionsService.getPaymentByBookingId(bookingId) instead
   * This bidirectional reference will be removed in future version
   * Transaction.booking is the source of truth
   */
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

  // Metadata for tracking booking state (slot hold, payment method, etc.)
  @Prop({ type: Object })
  metadata?: {
    paymentMethod?: number;
    isSlotHold?: boolean;
    slotsReleased?: boolean;
    slotsReleasedAt?: Date;
    [key: string]: any;
  };

  /**
   * Recurring Group ID - Links bookings created from same recurring request
   * All bookings from "Book Mon-Fri for 3 weeks" will share same recurringGroupId
   */
  @Prop({ type: Types.ObjectId, required: false })
  recurringGroupId?: Types.ObjectId;
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

  // ✅ Cleanup: Only coach bookings should have coachStatus
  // Remove coachStatus from field bookings (type: BookingType.FIELD)
  if (this.type === BookingType.FIELD && this.coachStatus !== undefined) {
    this.coachStatus = undefined;
  }

  next();
});

// Add compound index for efficient field + date queries
BookingSchema.index({ field: 1, date: 1 });
BookingSchema.index({ court: 1, date: 1, status: 1 });
BookingSchema.index({ user: 1, status: 1 });

