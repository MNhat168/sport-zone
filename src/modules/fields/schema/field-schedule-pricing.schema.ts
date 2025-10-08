import { Types } from 'mongoose';

/**
 * Interface định nghĩa cấu trúc pricing cho Field
 * Sử dụng để tái sử dụng và dễ quản lý
 */
export interface FieldSchedulePricing {
    operatingHours: { day: string; start: string; end: string; duration: number }[];
    priceRanges: { day: string; start: string; end: string; multiplier: number }[];
    basePrice: number;
    pendingPriceUpdates: Array<{
        newOperatingHours: { day: string; start: string; end: string; duration: number }[];
        newPriceRanges: { day: string; start: string; end: string; multiplier: number }[];
        newBasePrice: number;
        effectiveDate: Date;
        applied: boolean;
        createdBy: Types.ObjectId;
    }>;
}

/**
 * Mongoose schema definitions cho pricing properties
 * Sử dụng để tái sử dụng trong các entity khác
 */
export const FieldSchedulePricingSchema = {
    operatingHours: {
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
    priceRanges: {
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
        default: [],
    },
    basePrice: { type: Number, required: true, min: 0 },
    pendingPriceUpdates: {
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
    },
};