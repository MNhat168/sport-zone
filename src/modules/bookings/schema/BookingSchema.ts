import { SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument } from "mongoose";
import { Booking } from "../entities/booking.entity";
import { timeToMinutes } from "src/utils/utils";

export const BookingSchema = SchemaFactory.createForClass(Booking);

// Thêm pre-save hook để validate numSlots và start/end time
// Lý do: Validate slot hợp lệ để ngăn lỗi booking không khớp với field constraints
BookingSchema.pre('save', async function (this: HydratedDocument<Booking>, next) {
    // Since we use Pure Lazy Creation, field is directly referenced, no need to check schedule
    if (!this.field) {
        return next(new Error('Field is required'));
    }

    const field = await this.model('Field').findById(this.field) as HydratedDocument<any> & { slotDuration: number; minSlots: number; maxSlots: number };
    if (!field) {
        return next(new Error('Field not found'));
    }

    const startMin = timeToMinutes(this.startTime);
    const endMin = timeToMinutes(this.endTime);
    const calculatedNumSlots = (endMin - startMin) / field.slotDuration;

    if (!Number.isInteger(calculatedNumSlots) || calculatedNumSlots < field.minSlots || calculatedNumSlots > field.maxSlots) {
        return next(new Error('Booking slots must be integer multiple of slotDuration and within min/maxSlots'));
    }

    this.numSlots = calculatedNumSlots; // Auto-set numSlots

    next();
});
