import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export enum RecommendationType {
  FIELD = 'field',
  COACH = 'coach',
  TOURNAMENT = 'tournament',
}

@Schema({ timestamps: true })
export class Recommendation extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  user: Types.ObjectId;

  @Prop({ type: Types.ObjectId, refPath: 'itemType' })
  item: Types.ObjectId;

  @Prop({ 
    required: true, 
    enum: RecommendationType
  })
  itemType: RecommendationType;

  @Prop({ required: true, min: 0, max: 1 })
  score: number;

  @Prop({ required: true })
  algorithm: string;

  @Prop({ type: Date, default: Date.now })
  expiresAt: Date;
}

export const RecommendationSchema = SchemaFactory.createForClass(Recommendation);
RecommendationSchema.index({ itemType: 1 }); 
RecommendationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); 