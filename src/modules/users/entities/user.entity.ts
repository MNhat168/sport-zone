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

  @Prop({ type: [{ type: Types.ObjectId, ref: 'User' }], default: [] })
  bookmarkCoaches?: Types.ObjectId[];

  @Prop({ type: [{ type: Types.ObjectId, ref: 'Field' }], default: [] })
  bookmarkFields?: Types.ObjectId[];

  @Prop({ type: Boolean, default: true })
  isActive: boolean;


  @Prop({ type: String })
  idNumber?: string; // Số CMND/CCCD từ EKYC

  @Prop({ type: String })
  address?: string; // Địa chỉ từ EKYC

  @Prop({ type: Number, default: 0 })
  activeMatchesCount: number; // Renamed from activeTournamentsCount

  @Prop({ type: Number, default: 0 })
  weeklyGroupSessionsCount: number; // Renamed from weeklyTournamentCreationCount

  @Prop({ type: String, enum: ['FREE', 'PREMIUM'], default: 'FREE' })
  matchingTier: 'FREE' | 'PREMIUM'; // Renamed from tournamentTier

  @Prop({ type: Date })
  lastCancellationDate?: Date;

  @Prop({ type: Date })
  demeritUntil?: Date;

  // New Matching Fields
  @Prop({ type: Types.ObjectId, ref: 'MatchProfile' })
  matchProfileId?: Types.ObjectId;

  @Prop({ type: Number, default: 3 })
  superLikesRemaining: number; // Daily super likes (resets daily)

  @Prop({ type: Date })
  lastSuperLikeReset?: Date;

}

export const UserSchema = SchemaFactory.createForClass(User);

// Cấu hình timestamps từ BaseEntity
configureBaseEntitySchema(UserSchema);

UserSchema.index({ role: 1 });
