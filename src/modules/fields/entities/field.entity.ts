import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { User } from 'src/modules/users/entities/user.entity';
import { SportType } from 'src/common/enums/sport-type.enum';

@Schema({ timestamps: true })
export class Field extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  owner: Types.ObjectId;

  @Prop({ required: true })
  name: string;

  @Prop({ required: true, enum: SportType })
  sportType: SportType;

  @Prop({ required: true })
  description: string;

  @Prop({ required: true })
  location: string;

  @Prop({ type: [String], required: true })
  images: string[];

  @Prop({ type: Number, required: true, min: 0 })
  pricePerHour: number;

  @Prop({ required: true, default: '08:00' })
  openTime: string;

  @Prop({ required: true, default: '22:00' })
  closeTime: string;

  @Prop({ type: Number, required: true, min: 1, max: 24, default: 1 })
  minBookingHours: number;

  @Prop({ type: Number, required: true, min: 1, max: 24, default: 3 })
  maxBookingHours: number;

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
}

export const FieldSchema = SchemaFactory.createForClass(Field);