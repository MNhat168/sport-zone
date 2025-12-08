import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { BaseEntity } from 'src/common/entities/base.entity';

@Schema()
export class Schedule extends BaseEntity {
  @Prop({ type: Types.ObjectId, ref: 'Field', required: false }) // Optional for coach schedules without field
  field?: Types.ObjectId;

  // Specific court for field schedules (required for field schedules, optional for coach schedules)
  @Prop({ type: Types.ObjectId, ref: 'Court', required: false })
  court?: Types.ObjectId;

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
ScheduleSchema.index({ court: 1, date: 1 }, { unique: true, partialFilterExpression: { court: { $exists: true } } });
// Allow multiple courts per field by scoping uniqueness to court. Keep a legacy
// index for field-only schedules (e.g., coach schedules without a court).
ScheduleSchema.index(
  { field: 1, date: 1 },
  { partialFilterExpression: { field: { $exists: true }, court: { $exists: false } } }
);
// Index for coach schedules (coach + date should be unique)
ScheduleSchema.index({ coach: 1, date: 1 }, { unique: true, sparse: true });

