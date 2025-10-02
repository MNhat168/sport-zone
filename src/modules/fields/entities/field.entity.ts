import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { SportType } from 'src/common/enums/sport-type.enum';
import { BaseEntity } from 'src/common/entities/base.entity';

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

  @Prop({
    type: {
      start: { type: String, required: true },
      end: { type: String, required: true },
    },
    required: true,
  })
  operatingHours: { start: string; end: string };

  @Prop({ type: Number, required: true, min: 30, default: 60 })
  slotDuration: number;

  @Prop({ type: Number, required: true, min: 1, default: 1 })
  minSlots: number;

  @Prop({ type: Number, required: true, min: 1, default: 4 })
  maxSlots: number;

  @Prop({
    type: [
      {
        start: { type: String, required: true },
        end: { type: String, required: true },
        multiplier: { type: Number, required: true, min: 0 },
      },
    ],
    required: true,
  })
  priceRanges: { start: string; end: string; multiplier: number }[];

  @Prop({ type: Number, required: true, min: 0 })
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

  @Prop({ required: true })
  location: string;

  @Prop({
    type: [
      {
        newPriceRanges: {
          type: [
            {
              start: { type: String, required: true },
              end: { type: String, required: true },
              multiplier: { type: Number, required: true, min: 0 },
            },
          ],
          required: true,
        },
        newBasePrice: { type: Number, required: true, min: 0 },
        effectiveDate: { type: Date, required: true }, // áp dụng lúc 00:00 của ngày này
        applied: { type: Boolean, default: false },
        createdBy: { type: Types.ObjectId, ref: 'User', required: true },
      },
    ],
    default: [],
  })
  pendingPriceUpdates: Array<{
    newPriceRanges: { start: string; end: string; multiplier: number }[];
    newBasePrice: number;
    effectiveDate: Date;
    applied: boolean;
    createdBy: Types.ObjectId;
  }>;
}

export const FieldSchema = SchemaFactory.createForClass(Field);

