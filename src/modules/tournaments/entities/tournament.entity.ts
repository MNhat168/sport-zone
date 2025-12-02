import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { SportType, CompetitionFormat } from 'src/common/enums/sport-type.enum';
import { BaseEntity, configureBaseEntitySchema } from 'src/common/entities/base.entity';

export enum TournamentStatus {
  DRAFT = 'draft', // Initial creation, fields not reserved
  PENDING = 'pending', // Fields reserved, waiting for minimum participants
  CONFIRMED = 'confirmed', // Minimum threshold met, fields booked
  ONGOING = 'ongoing',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

@Schema()
export class Tournament extends BaseEntity {
  @Prop({ required: true })
  name: string;

   @Prop({ required: true, enum: SportType })
  sportType: SportType;

  @Prop({ required: true })
  category: string;

  @Prop({ required: true, enum: CompetitionFormat })
  competitionFormat: CompetitionFormat;

  @Prop({ required: true })
  location: string;

  // Tournament date (when it actually happens)
  @Prop({ required: true, type: Date })
  tournamentDate: Date;

  // Registration period
  @Prop({ required: true, type: Date })
  registrationStart: Date;

  @Prop({ required: true, type: Date })
  registrationEnd: Date;

  // Tournament time slot
  @Prop({ required: true })
  startTime: string;

  @Prop({ required: true })
  endTime: string;

  @Prop({ required: true, min: 1 })
  maxParticipants: number;

  @Prop({ required: true, min: 1 })
  minParticipants: number;

  @Prop({ required: true, min: 0 })
  registrationFee: number;

  @Prop({ required: true })
  description: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  organizer: Types.ObjectId;

  @Prop({ 
    type: [{ 
      user: { type: Types.ObjectId, ref: 'User', required: true },
      registeredAt: { type: Date, default: Date.now },
      transaction: { type: Types.ObjectId, ref: 'Transaction' }
    }],
    default: []
  })
  participants: Array<{
    user: Types.ObjectId;
    registeredAt: Date;
    transaction?: Types.ObjectId;
  }>;

  @Prop({ 
    enum: TournamentStatus, 
    default: TournamentStatus.DRAFT 
  })
  status: TournamentStatus;

  // Field Reservation
  @Prop({ 
    type: [{ 
      field: { type: Types.ObjectId, ref: 'Field', required: true },
      reservation: { type: Types.ObjectId, ref: 'TournamentFieldReservation' },
      booking: { type: Types.ObjectId, ref: 'Booking' }
    }],
    default: []
  })
  fields: Array<{
    field: Types.ObjectId;
    reservation?: Types.ObjectId;
    booking?: Types.ObjectId;
  }>;

  @Prop({ required: true, min: 1 })
  fieldsNeeded: number;

  @Prop({ required: true, min: 0 })
  totalFieldCost: number;

  // Confirmation deadline (e.g., 48 hours before tournament)
  @Prop({ required: true, type: Date })
  confirmationDeadline: Date;

  // Escrow tracking
  @Prop({ type: Number, default: 0 })
  totalRegistrationFeesCollected: number;

  @Prop({ type: Types.ObjectId, ref: 'Transaction' })
  organizerPaymentTransaction?: Types.ObjectId;

  // Commission
  @Prop({ type: Number, default: 0.1 }) // 10% default
  commissionRate: number;

  @Prop({ type: Number, default: 0 })
  commissionAmount: number;

  // Prize money or expenses
  @Prop({ type: Number, default: 0 })
  prizePool: number;

  @Prop({ type: String })
  cancellationReason?: string;

  @Prop({ type: String })
  rules?: string;

  @Prop({ type: [String], default: [] })
  images: string[];
}

export const TournamentSchema = SchemaFactory.createForClass(Tournament);
configureBaseEntitySchema(TournamentSchema);

TournamentSchema.index({ sportType: 1, status: 1 });
TournamentSchema.index({ tournamentDate: 1 });
TournamentSchema.index({ registrationEnd: 1 });
TournamentSchema.index({ organizer: 1 });