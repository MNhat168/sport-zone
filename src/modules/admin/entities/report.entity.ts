import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { getCurrentVietnamTimeForDB } from 'src/utils/timezone.utils';
import { ReportType, ReportStatus } from '@common/enums/report.enum';

@Schema({
  timestamps: {
    createdAt: true,
    updatedAt: true,
    currentTime: () => getCurrentVietnamTimeForDB(),
  },
})
export class Report extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User' })
  reporter?: Types.ObjectId;

  @Prop({ required: true, enum: ReportType })
  type: ReportType;

  @Prop({ required: true })
  title: string;

  @Prop({ required: true, minlength: 20, maxlength: 1000 })
  description: string;

  @Prop({ required: true, type: Object })
  target: {
    id: string;
    type: string;
    name?: string;
  };

  @Prop({ 
    enum: ReportStatus, 
    default: ReportStatus.OPEN 
  })
  status: ReportStatus;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  assignedTo?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  resolvedBy?: Types.ObjectId;

  @Prop({ type: Date })
  resolvedAt?: Date;
}

export const ReportSchema = SchemaFactory.createForClass(Report);