import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { BaseEntity, configureBaseEntitySchema } from 'src/common/entities/base.entity';
import { ReservationStatus } from '@common/enums/tournament-field-reservation.enum';

@Schema()
export class TournamentFieldReservation extends BaseEntity {
  @Prop({ type: Types.ObjectId, ref: 'Tournament', required: true })
  tournament: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Field', required: true })
  field: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Court', required: false })
  court?: Types.ObjectId;

  @Prop({ required: true, type: Date })
  date: Date;

  @Prop({ required: true })
  startTime: string;

  @Prop({ required: true })
  endTime: string;

  @Prop({ required: true, min: 0 })
  estimatedCost: number;

  @Prop({ 
    required: true, 
    enum: ReservationStatus,
    default: ReservationStatus.PENDING 
  })
  status: ReservationStatus;

  @Prop({ required: true, type: Date })
  expiresAt: Date;

  @Prop({ type: String })
  notes?: string;
}

export const TournamentFieldReservationSchema = SchemaFactory.createForClass(TournamentFieldReservation);
configureBaseEntitySchema(TournamentFieldReservationSchema);

TournamentFieldReservationSchema.index({ tournament: 1 });
TournamentFieldReservationSchema.index({ field: 1, date: 1 });
TournamentFieldReservationSchema.index({ court: 1, date: 1 });
TournamentFieldReservationSchema.index({ status: 1, expiresAt: 1 });