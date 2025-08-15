import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { SportType, SportConfig } from '../../common/enums/sport-type.enum';

@Schema({ _id: false }) 
export class TournamentSportConfig {
  @Prop({ 
    required: true,
    enum: Object.values(SportType)
  })
  type: SportType;

  @Prop({ type: Object })
  pointSystem?: SportConfig['pointSystem'];

  @Prop()
  customRules?: string;

  @Prop()
  minPlayers?: number;

  @Prop()
  maxPlayers?: number;
}

export const TournamentSportConfigSchema = SchemaFactory.createForClass(TournamentSportConfig);