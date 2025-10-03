import { Field } from "../entities/field.entity";
import { SchemaFactory } from "@nestjs/mongoose";
import { timeToMinutes } from "src/utils/utils";
export const FieldSchema = SchemaFactory.createForClass(Field);

// Thêm pre-save hook để validate priceRanges: tránh overlap và đảm bảo cover toàn operatingHours
// Lý do: Tránh conflict ambiguity khi tính giá (overlap) hoặc giá không định nghĩa (không cover hết)
FieldSchema.pre('save', function (next) {
    const operatingStart = timeToMinutes(this.operatingHours.start);
    const operatingEnd = timeToMinutes(this.operatingHours.end);

    if (operatingStart >= operatingEnd) {
        return next(new Error('operatingHours.start must be before end'));
    }

    // Sort priceRanges theo start time
    this.priceRanges.sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));

    let currentEnd = operatingStart;
    for (let i = 0; i < this.priceRanges.length; i++) {
        const range = this.priceRanges[i];
        const rangeStart = timeToMinutes(range.start);
        const rangeEnd = timeToMinutes(range.end);

        if (rangeStart >= rangeEnd) {
            return next(new Error('Price range start must be before end'));
        }
        if (rangeStart !== currentEnd) {
            return next(new Error('Price ranges do not cover entire operating hours or have gaps'));
        }
        if (i > 0 && timeToMinutes(this.priceRanges[i - 1].end) > rangeStart) {
            return next(new Error('Price ranges overlap'));
        }
        currentEnd = rangeEnd;
    }

    if (currentEnd !== operatingEnd) {
        return next(new Error('Price ranges do not cover entire operating hours'));
    }

    next();
});

