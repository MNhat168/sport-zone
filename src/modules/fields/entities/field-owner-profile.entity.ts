import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { User } from '../../users/entities/user.entity';
import { SportType } from 'src/common/enums/sport-type.enum';
import { BaseEntity } from 'src/common/entities/base.entity';

@Schema()
export class FieldOwnerProfile extends BaseEntity {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, unique: true })
  user: Types.ObjectId;

  @Prop({ required: true })
  facilityName: string;

  @Prop({ required: true })
  facilityLocation: string;

  @Prop({ type: [String], enum: SportType, required: true })
  supportedSports: SportType[];

  @Prop({ required: true })
  description: string;

  @Prop({ type: [String] })
  amenities: string[];
  @Prop({ type: Number, default: 0, min: 0, max: 5 })
  rating: number;

  @Prop({ type: Number, default: 0 })
  totalReviews: number;

  @Prop({ type: Boolean, default: false })
  isVerified: boolean;

  @Prop({ type: String })
  verificationDocument?: string;  // URL to business license or verification doc

  @Prop({ type: String })
  businessHours?: string;

  @Prop({ type: String })
  contactPhone: string;

  @Prop({ type: String })
  website?: string;
}

