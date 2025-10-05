import { Field } from "../entities/field.entity";
import { SchemaFactory } from "@nestjs/mongoose";
import { timeToMinutes } from "src/utils/utils";

export const FieldSchema = SchemaFactory.createForClass(Field);

// Thêm pre-save hook để validate priceRanges: tránh overlap và đảm bảo cover toàn operatingHours cho từng ngày
// Lý do: Tránh conflict ambiguity khi tính giá (overlap) hoặc giá không định nghĩa (không cover hết)
FieldSchema.pre('save', function (next) {
    const operatingHours = this.operatingHours;
    const priceRanges = this.priceRanges;
    
    if (!operatingHours || !priceRanges) {
        return next(new Error('operatingHours and priceRanges are required'));
    }

    // Validate operatingHours for provided days only
    const validDays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    
    for (const dayHours of operatingHours) {
        if (!validDays.includes(dayHours.day)) {
            return next(new Error(`Invalid day: ${dayHours.day}`));
        }
        
        const operatingStart = timeToMinutes(dayHours.start);
        const operatingEnd = timeToMinutes(dayHours.end);

        if (operatingStart >= operatingEnd) {
            return next(new Error(`Operating hours start must be before end for ${dayHours.day}`));
        }
    }

    if (priceRanges.length === 0) {
        return next(new Error('priceRanges must not be empty'));
    }

    // Group priceRanges by day
    const priceRangesByDay = priceRanges.reduce((acc, range) => {
        if (!validDays.includes(range.day)) {
            return next(new Error(`Invalid day in price range: ${range.day}`));
        }
        if (!acc[range.day]) {
            acc[range.day] = [];
        }
        acc[range.day].push(range);
        return acc;
    }, {} as Record<string, typeof priceRanges>);

    // Validate each operating day's price ranges
    for (const dayHours of operatingHours) {
        const dayRanges = priceRangesByDay[dayHours.day];
        
        if (!dayRanges || dayRanges.length === 0) {
            return next(new Error(`Price ranges must be defined for operating day: ${dayHours.day}`));
        }

        // Sort priceRanges theo start time for this day
        const sortedRanges = [...dayRanges].sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));

        const operatingStart = timeToMinutes(dayHours.start);
        const operatingEnd = timeToMinutes(dayHours.end);
        let currentEnd = operatingStart;
        
        for (let i = 0; i < sortedRanges.length; i++) {
            const range = sortedRanges[i];
            const rangeStart = timeToMinutes(range.start);
            const rangeEnd = timeToMinutes(range.end);

            if (rangeStart >= rangeEnd) {
                return next(new Error(`Price range start must be before end for ${dayHours.day}`));
            }
            if (rangeStart !== currentEnd) {
                return next(new Error(`Price ranges do not cover entire operating hours or have gaps for ${dayHours.day}`));
            }
            if (i > 0 && timeToMinutes(sortedRanges[i - 1].end) > rangeStart) {
                return next(new Error(`Price ranges overlap for ${dayHours.day}`));
            }
            currentEnd = rangeEnd;
        }

        if (currentEnd !== operatingEnd) {
            return next(new Error(`Price ranges do not cover entire operating hours for ${dayHours.day}`));
        }
    }

    next();
});

