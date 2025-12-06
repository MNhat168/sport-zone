import { SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument } from "mongoose";
import { Booking } from "../entities/booking.entity";
import { timeToMinutes } from "src/utils/utils";

export const BookingSchema = SchemaFactory.createForClass(Booking);

// Thêm pre-save hook để validate numSlots và start/end time
// Lý do: Validate slot hợp lệ để ngăn lỗi booking không khớp với field constraints
BookingSchema.pre('save', async function (this: HydratedDocument<Booking>, next) {
    // Skip field validation for coach bookings without field
    // Field is optional for coach bookings, required for field bookings
    if (!this.field) {
        // For coach bookings without field, use default slotDuration (60 minutes)
        if (this.type === 'coach') {
            const startMin = timeToMinutes(this.startTime);
            const endMin = timeToMinutes(this.endTime);
            const defaultSlotDuration = 60; // 60 minutes default
            const calculatedNumSlots = (endMin - startMin) / defaultSlotDuration;
            this.numSlots = Math.round(calculatedNumSlots); // Auto-set numSlots
            return next();
        }
        // Field bookings still require field
        return next(new Error('Field is required for field bookings'));
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
