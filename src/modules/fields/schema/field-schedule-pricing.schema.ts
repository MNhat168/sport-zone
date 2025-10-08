// field-schedule-pricing.schema.ts
import { Prop, Schema } from '@nestjs/mongoose';
import { Types } from 'mongoose';

export class FieldSchedulePricing {
    @Prop({
        type: [
            {
                day: {
                    type: String,
                    enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
                    required: true,
                },
                start: { type: String, required: true },
                end: { type: String, required: true },
                duration: { type: Number, required: true, min: 30 },
            },
        ],
        required: true,
        default: undefined,
    })
    operatingHours: { day: string; start: string; end: string; duration: number }[];

    @Prop({
        type: [
            {
                day: {
                    type: String,
                    enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
                    required: true,
                },
                start: { type: String, required: true },
                end: { type: String, required: true },
                multiplier: { type: Number, required: true, min: 0 },
            },
        ],
        required: true,
    })
    priceRanges: { day: string; start: string; end: string; multiplier: number }[];

    @Prop({ type: Number, required: true, min: 0 })
    basePrice: number;

    @Prop({
        type: [
            {
                newOperatingHours: {
                    type: [
                        {
                            day: {
                                type: String,
                                enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
                                required: true,
                            },
                            start: { type: String, required: true },
                            end: { type: String, required: true },
                            duration: { type: Number, required: true, min: 30 },
                        },
                    ],
                    required: true,
                },
                newPriceRanges: {
                    type: [
                        {
                            day: {
                                type: String,
                                enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
                                required: true,
                            },
                            start: { type: String, required: true },
                            end: { type: String, required: true },
                            multiplier: { type: Number, required: true, min: 0 },
                        },
                    ],
                    required: true,
                },
                newBasePrice: { type: Number, required: true, min: 0 },
                effectiveDate: { type: Date, required: true },
                applied: { type: Boolean, default: false },
                createdBy: { type: Types.ObjectId, ref: 'User', required: true },
            },
        ],
        default: [],
    })
    pendingPriceUpdates: Array<{
        newOperatingHours: { day: string; start: string; end: string; duration: number }[];
        newPriceRanges: { day: string; start: string; end: string; multiplier: number }[];
        newBasePrice: number;
        effectiveDate: Date;
        applied: boolean;
        createdBy: Types.ObjectId;
    }>;
}