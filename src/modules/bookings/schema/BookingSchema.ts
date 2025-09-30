import { SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument } from "mongoose";
import { Booking } from "../entities/booking.entity";

export const BookingSchema = SchemaFactory.createForClass(Booking);

// Thêm pre-save hook để validate numSlots, start/end, và populate field từ schedule nếu mismatch
// Lý do: Tránh redundant/mismatch giữa schedule.field và booking.field, validate slot hợp lệ để ngăn lỗi booking không khớp
BookingSchema.pre('save', async function (this: HydratedDocument<Booking>, next) {
    const schedule = await this.model('Schedule').findById(this.schedule) as HydratedDocument<any> & { field: any };
    if (!schedule) {
        return next(new Error('Schedule not found'));
    }

    // Populate field nếu chưa có (tránh conflict)
    if (!this.field) {
        this.field = schedule.field;
    } else if (this.field.toString() !== schedule.field.toString()) {
        return next(new Error('Field mismatch with schedule'));
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

// Helper timeToMinutes (tương tự)
function timeToMinutes(time: string): number {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
}