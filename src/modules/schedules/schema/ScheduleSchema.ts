import { Schedule } from "../entities/schedule.entity";
import { SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument } from "mongoose";
import { timeToMinutes } from "src/utils/utils";

export const ScheduleSchema = SchemaFactory.createForClass(Schedule);
ScheduleSchema.index({ date: 1 });

// Virtual slots approach: availableSlots generated from Field config
// Only validate bookedSlots if needed
ScheduleSchema.pre('save', async function (this: HydratedDocument<Schedule>, next) {
    const field = await this.model('Field').findById(this.field) as HydratedDocument<any> & { slotDuration: number; operatingHours: { start: string; end: string } };
    if (!field) {
        return next(new Error('Field not found'));
    }

    // Optional: validate bookedSlots are within operating hours
    const operatingStart = timeToMinutes(field.operatingHours.start);
    const operatingEnd = timeToMinutes(field.operatingHours.end);

    for (const slot of this.bookedSlots) {
        const startMin = timeToMinutes(slot.startTime);
        const endMin = timeToMinutes(slot.endTime);
        if (startMin < operatingStart || endMin > operatingEnd) {
            return next(new Error('Booked slots must be within field operating hours'));
        }
    }

    next();
});
