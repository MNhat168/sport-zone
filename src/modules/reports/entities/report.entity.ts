import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { ReportCategory } from 'src/common/enums/report-category.enum';
import { getCurrentVietnamTimeForDB } from 'src/utils/timezone.utils';

@Schema({
  timestamps: {
    createdAt: true,
    updatedAt: true,
    currentTime: () => getCurrentVietnamTimeForDB(),
  },
})
export class Report {
  _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  reporter: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Field' })
  field?: Types.ObjectId;

  @Prop({ type: String, enum: ReportCategory, required: true })
  category: ReportCategory;

  @Prop({ type: String })
  subject?: string;

  @Prop({ type: String })
  description?: string;

  @Prop({ type: [String], default: [] })
  initialAttachments: string[];

  @Prop({ type: String, enum: ['open', 'in_review', 'resolved', 'closed'], default: 'open' })
  status: 'open' | 'in_review' | 'resolved' | 'closed';

  @Prop({ type: Date, default: () => getCurrentVietnamTimeForDB() })
  lastActivityAt: Date;
}

export type ReportDocument = Report & Document;
export const ReportSchema = SchemaFactory.createForClass(Report);

ReportSchema.index({ reporter: 1, createdAt: -1 });
ReportSchema.index({ lastActivityAt: -1 });
ReportSchema.index({ status: 1, lastActivityAt: -1 });