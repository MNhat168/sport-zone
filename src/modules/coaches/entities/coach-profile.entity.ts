import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { User } from 'src/modules/users/entities/user.entity';
import { SportType } from 'src/common/enums/sport-type.enum';
import { BaseEntity } from 'src/common/entities/base.entity';

@Schema()
export class CoachProfile extends BaseEntity {
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

  @Prop({ type: Number, default: 0, min: 0 })
  completedSessions: number;

  @Prop({ type: String, default: '' })
  experience: string;

  @Prop({ type: Number, default: 0, min: 0, max: 5 })
  rating: number;

  @Prop({ type: Number, default: 0 })
  totalReviews: number;

  @Prop({ type: String, default: '', required: false })
  location?: string;
}

export const CoachProfileSchema = SchemaFactory.createForClass(CoachProfile);
