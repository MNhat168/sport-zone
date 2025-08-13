import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { SportType } from 'src/common/enums/sport-type.enum';

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

  @Prop({ required: true, enum: SportType })
  sportType: SportType;

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