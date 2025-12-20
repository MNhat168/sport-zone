import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { BaseEntity, configureBaseEntitySchema } from 'src/common/entities/base.entity';
import { UserRole } from '@common/enums/user.enum';

export type UserDocument = HydratedDocument<User>;

@Schema()
export class User extends BaseEntity {
  @Prop({ required: true })
  fullName: string;

  @Prop({ required: true, unique: true })
  email: string;

  @Prop()
  phone: string;

  @Prop({ type: Date })
  date_of_birth?: Date;

  @Prop()
  password: string;

  @Prop({ type: String, enum: UserRole, default: UserRole.USER })
  role: UserRole;

  @Prop({ type: String })
  avatarUrl?: string;

  @Prop({ type: Boolean, default: false })
  isVerified: boolean;

  @Prop({ type: String })
  googleId?: string;

  @Prop({ type: [String] })
  favouriteSports?: string[];

  @Prop({ type: [{ type: Types.ObjectId, ref: 'User' }], default: [] })
  favouriteCoaches?: Types.ObjectId[];

  @Prop({ type: [{ type: Types.ObjectId, ref: 'Field' }], default: [] })
  favouriteFields?: Types.ObjectId[];

  @Prop({ type: Boolean, default: true })
  isActive: boolean;

  @Prop({ type: String })
  idNumber?: string; // Số CMND/CCCD từ EKYC

  @Prop({ type: String })
  address?: string; // Địa chỉ từ EKYC

  // Billing / Subscription Fields
  @Prop({ type: String, enum: ['active', 'grace_period', 'suspended'], default: 'active' })
  subscriptionStatus: 'active' | 'grace_period' | 'suspended';

  @Prop({ type: Date })
  nextPaymentDate?: Date;

  @Prop({ type: Date })
  lastPaymentDate?: Date;

  @Prop({ type: Date })
  gracePeriodEndDate?: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);

// Cấu hình timestamps từ BaseEntity
configureBaseEntitySchema(UserSchema);

UserSchema.index({ role: 1 });
