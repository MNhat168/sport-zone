import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { SportType } from 'src/common/enums/sport-type.enum';

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

@Schema({ timestamps: true })
export class Booking extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  user: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Schedule', required: true })
  schedule: Types.ObjectId;

  @Prop({ required: true, enum: BookingType })
  type: BookingType;

  @Prop({ required: true })
  slot: string;

  @Prop({
    required: true,
    enum: BookingStatus,
    default: BookingStatus.PENDING
  })
  status: BookingStatus;

  @Prop({ required: true, min: 0 })
  totalPrice: number;

  @Prop({ type: Types.ObjectId, ref: 'Payment' })
  payment?: Types.ObjectId;

  @Prop({ type: String })
  cancellationReason?: string;

  @Prop({ type: Types.ObjectId, ref: 'CoachProfile' })
  requestedCoach?: Types.ObjectId;

  @Prop({
    type: String,
    enum: ['pending', 'accepted', 'declined'],
    default: 'pending'
  })
  coachStatus?: string;
}

export const BookingSchema = SchemaFactory.createForClass(Booking);