import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export enum NotificationType {
  BOOKING_CONFIRMED = 'booking_confirmed',
  BOOKING_CANCELLED = 'booking_cancelled',
  NEW_TOURNAMENT = 'new_tournament',
  PAYMENT_SUCCESS = 'payment_success',
  NEW_REVIEW = 'new_review',
  COACH_REQUEST = 'coach_request',
  FIELD_APPROVAL = 'field_approval',
}

@Schema({ timestamps: true })
export class Notification extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  recipient: Types.ObjectId;

  @Prop({ required: true, enum: NotificationType })
  type: NotificationType;

  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  message: string;

  @Prop({ type: Boolean, default: false })
  isRead: boolean;

  @Prop({ type: Object })
  metadata?: Record<string, any>;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);