import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { User } from 'src/modules/users/entities/user.entity';
import { SportType } from 'src/common/enums/sport-type.enum';

@Schema({ timestamps: true })
export class CoachProfile extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, unique: true })
  user: Types.ObjectId;

  @Prop({ type: [String], enum: SportType, required: true })
  sports: SportType[];

  @Prop({ required: true })
  certification: string;

  @Prop({ required: true, min: 0 })
  hourlyRate: number;

  @Prop({ required: true })
  bio: string;

  @Prop({ type: Number, default: 0, min: 0, max: 5 })
  rating: number;

  @Prop({ type: Number, default: 0 })
  totalReviews: number;
}

export const CoachProfileSchema = SchemaFactory.createForClass(CoachProfile);