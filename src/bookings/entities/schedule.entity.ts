import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true })
export class Schedule extends Document {
  @Prop({ type: Types.ObjectId, ref: 'Field' })
  field?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'CoachProfile' })
  coach?: Types.ObjectId;

  @Prop({ required: true, type: Date })
  date: Date;

  @Prop({ type: [String], required: true })
  availableSlots: string[];

  @Prop({ type: [String], default: [] })
  bookedSlots: string[];

  @Prop({ type: Boolean, default: false })
  isHoliday: boolean;

  @Prop({ type: String })
  holidayReason?: string;

  @Prop({ type: Number, required: true, min: 0 })
  basePrice: number;

  @Prop({ type: Number, min: 0 })
  peakPrice?: number;

  @Prop({ type: [String] })
  peakHours?: string[];
}

export const ScheduleSchema = SchemaFactory.createForClass(Schedule);
ScheduleSchema.index({ date: 1 }); 