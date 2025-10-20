import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { SportType } from 'src/common/enums/sport-type.enum';
import { BaseEntity, configureBaseEntitySchema } from 'src/common/entities/base.entity';
import { FieldSchedulePricingSchema } from '../schema/field-schedule-pricing.schema';

@Schema()
export class Field extends BaseEntity {
  @Prop({ type: Types.ObjectId, ref: 'FieldOwnerProfile', required: true })
  owner: Types.ObjectId;

  @Prop({ required: true })
  name: string;

  @Prop({ required: true, enum: SportType })
  sportType: SportType;

  @Prop({ required: true })
  description: string;

  @Prop({ type: [String], required: true })
  images: string[];

  @Prop(FieldSchedulePricingSchema.operatingHours)
  operatingHours: { day: string; start: string; end: string; duration: number }[];

  @Prop({ type: Number, required: true, min: 30, default: 60 })
  slotDuration: number;

  @Prop({ type: Number, required: true, min: 1, default: 1 })
  minSlots: number;

  @Prop({ type: Number, required: true, min: 1, default: 4 })
  maxSlots: number;

  @Prop(FieldSchedulePricingSchema.priceRanges)
  priceRanges: { day: string; start: string; end: string; multiplier: number }[];

  @Prop(FieldSchedulePricingSchema.basePrice)
  basePrice: number;

  @Prop({ type: Boolean, default: true })
  isActive: boolean;

  @Prop({ type: String })
  maintenanceNote?: string;

  @Prop({ type: Date })
  maintenanceUntil?: Date;

  @Prop({ type: Number, default: 0, min: 0, max: 5 })
  rating: number;

  @Prop({ type: Number, default: 0 })
  totalReviews: number;

  @Prop({
    _id: false,
    type: {
      address: { type: String, required: true },
      geo: {
        type: {
          type: String,
          enum: ['Point'],
          required: true,
        },
        coordinates: {
          type: [Number],
          required: true,
        },
      },
    },
    required: true,
  })
  location: {
    address: string;
    geo: {
      type: 'Point';
      coordinates: [number, number];
    };
  };

  @Prop(FieldSchedulePricingSchema.pendingPriceUpdates)
  pendingPriceUpdates: Array<{
    newOperatingHours: { day: string; start: string; end: string; duration: number }[];
    newPriceRanges: { day: string; start: string; end: string; multiplier: number }[];
    newBasePrice: number;
    effectiveDate: Date;
    applied: boolean;
    createdBy: Types.ObjectId;
  }>;

  @Prop({ 
    type: [{ 
      amenity: { type: Types.ObjectId, ref: 'Amenity' },
      price: { type: Number, required: true, min: 0 }
    }], 
    default: [] 
  })
  amenities: Array<{
    amenity: Types.ObjectId;
    price: number;
  }>;
}

export const FieldSchema = SchemaFactory.createForClass(Field);

// Cấu hình timestamps từ BaseEntity
configureBaseEntitySchema(FieldSchema);

FieldSchema.index({ 'location.geo': '2dsphere' });

