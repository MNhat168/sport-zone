import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class ReportMessage {
  _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Report', required: true, index: true })
  reportId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  sender?: Types.ObjectId;

  @Prop({ type: String, enum: ['user', 'admin'], required: true })
  senderRole: 'user' | 'admin';

  @Prop({ type: String })
  content?: string;

  @Prop({ type: [String], default: [] })
  attachments: string[];
}

export type ReportMessageDocument = ReportMessage & Document;
export const ReportMessageSchema = SchemaFactory.createForClass(ReportMessage);

ReportMessageSchema.index({ reportId: 1, createdAt: 1 });