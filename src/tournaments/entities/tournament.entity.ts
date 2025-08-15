import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { SportType, SportConfigurations, SportConfig } from 'src/common/enums/sport-type.enum';
import { TournamentSportConfig, TournamentSportConfigSchema } from './tournament-sport.entity';

export enum TournamentStatus {
  UPCOMING = 'upcoming',
  ONGOING = 'ongoing',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

@Schema({ timestamps: true })
export class Tournament extends Document {
  @Prop({ required: true })
  name: string;

  @Prop({
    required: true,
    enum: Object.values(SportType)
  })
  sportType: SportType;

  @Prop({ type: TournamentSportConfigSchema })
  sportConfig?: TournamentSportConfig;

  // Computed property (virtual, not stored in DB)
  public get effectiveConfig(): SportConfig {
    const defaults = SportConfigurations[this.sportType];

    return {
      minPlayers: this.sportConfig?.minPlayers || defaults.minPlayers,
      maxPlayers: this.sportConfig?.maxPlayers || defaults.maxPlayers,
      pointSystem: this.sportConfig?.pointSystem || defaults.pointSystem,
      defaultRules: defaults.defaultRules,
      displayName: '',
      equipment: [],
      durationUnit: 'minutes',
      defaultDuration: 0
    };
  }

  @Prop({ required: true })
  location: string;

  @Prop({ required: true, type: Date })
  startDate: Date;

  @Prop({ required: true, type: Date })
  endDate: Date;

  @Prop({ required: true, min: 2 })
  maxTeams: number;

  @Prop({ required: true, min: 0 })
  registrationFee: number;

  @Prop({ required: true })
  description: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  organizer: Types.ObjectId;

  @Prop({ type: [{ type: Types.ObjectId, ref: 'User' }] })
  participants: Types.ObjectId[];

  @Prop({
    enum: TournamentStatus,
    default: TournamentStatus.UPCOMING
  })
  status: TournamentStatus;
}

export const TournamentSchema = SchemaFactory.createForClass(Tournament);