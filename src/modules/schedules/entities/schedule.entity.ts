import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true })
export class Schedule extends Document {
  @Prop({ type: Types.ObjectId, ref: 'Field', required: true }) // Làm required để tránh conflict thiếu field
  field: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'CoachProfile' })
  coach?: Types.ObjectId;

  @Prop({ required: true, type: Date })
  date: Date;

  @Prop({
    type: [
      {
        startTime: { type: String, required: true },
        endTime: { type: String, required: true },
      },
    ],
    default: [],
  })
  bookedSlots: { startTime: string; endTime: string }[];

  @Prop({ type: Boolean, default: false })
  isHoliday: boolean;

  @Prop({ type: String })
  holidayReason?: string;

  // Added for optimistic locking in Pure Lazy Creation pattern
  @Prop({ type: Number, default: 0 })
  version: number;
}

// Create compound index for efficient queries and upserts
export const ScheduleSchema = SchemaFactory.createForClass(Schedule);
ScheduleSchema.index({ field: 1, date: 1 }, { unique: true });

