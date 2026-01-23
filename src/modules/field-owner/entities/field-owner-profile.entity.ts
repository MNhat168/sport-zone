import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { BaseEntity } from 'src/common/entities/base.entity';
import { FacilityInfo, FacilityInfoSchema } from './facility-info.entity';

@Schema()
export class FieldOwnerProfile extends BaseEntity {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, unique: true })
  user: Types.ObjectId;

  @Prop({ type: FacilityInfoSchema, required: true })
  facility: FacilityInfo;

  @Prop({ type: Number, default: 0, min: 0, max: 5 })
  rating?: number;

  @Prop({ type: Number, default: 0 })
  totalReviews?: number;

  @Prop({ type: Boolean, default: false })
  isVerified: boolean;

  @Prop({ type: Date })
  verifiedAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  verifiedBy?: Types.ObjectId;

  @Prop({ type: String })
  verificationDocument?: string;  // URL to business license or verification doc

  @Prop({ type: [{ type: Types.ObjectId, ref: 'User' }], default: [] })
  staffAccounts: Types.ObjectId[];  // Staff members who can manage this owner's fields

  @Prop({ type: Boolean, default: false })
  hasReadPolicy: boolean;

  @Prop({ type: Date })
  policyReadAt?: Date;
}

export const FieldOwnerProfileSchema = SchemaFactory.createForClass(FieldOwnerProfile);
