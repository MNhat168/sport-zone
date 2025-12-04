import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { SportType } from 'src/common/enums/sport-type.enum';
import { getCurrentVietnamTimeForDB } from 'src/utils/timezone.utils';

export enum ReviewType {
  FIELD = 'field',
  COACH = 'coach',
}

@Schema({
  timestamps: {
    createdAt: true,
    updatedAt: true,
    currentTime: () => getCurrentVietnamTimeForDB(),
  },
})
export class Review extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  user: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Booking', required: false })
  booking?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Field' })
  field?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'CoachProfile' })
  coach?: Types.ObjectId;

  @Prop({ type: String, maxlength: 120 })
  title?: string;

  @Prop({ required: true, enum: ReviewType })
  type: ReviewType;

  @Prop({ required: true, min: 1, max: 5 })
  rating: number;

  @Prop({ required: true, minlength: 10, maxlength: 500 })
  comment: string;

  @Prop({ type: String, maxlength: 500 })
  response?: string;

  @Prop({ type: Boolean, default: false })
  isModerated: boolean;

  @Prop({ type: String })
  moderationResult?: string;
}

export const ReviewSchema = SchemaFactory.createForClass(Review);