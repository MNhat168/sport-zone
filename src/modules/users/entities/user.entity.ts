import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { BaseEntity, configureBaseEntitySchema } from 'src/common/entities/base.entity';

export type UserDocument = HydratedDocument<User>;

export enum UserRole {
  USER = 'user',
  COACH = 'coach',
  FIELD_OWNER = 'field_owner',
  ADMIN = 'admin',
}

@Schema()
export class User extends BaseEntity {
  @Prop({ required: true })
  fullName: string;

  @Prop({ required: true, unique: true })
  email: string;

  @Prop({ required: false })
  phone: string;

  @Prop({ required: false, type: Date })
  date_of_birth?: Date;

  @Prop({ required: false })
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

  @Prop({ type: Boolean, default: true })
  isActive: boolean;
}

export const UserSchema = SchemaFactory.createForClass(User);

// Cấu hình timestamps từ BaseEntity
configureBaseEntitySchema(UserSchema);

UserSchema.index({ role: 1 });
