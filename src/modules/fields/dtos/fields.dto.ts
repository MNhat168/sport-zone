export class FieldsDto {
    id: string;
    owner: string;
    name: string;
    sportType: string;
    description: string;
    location: string;
    images: string[];
    operatingHours: { start: string; end: string };
    slotDuration: number;
    minSlots: number;
    maxSlots: number;
    priceRanges: { start: string; end: string; multiplier: number }[];
    basePrice: number;
    isActive: boolean;
    maintenanceNote?: string;
    maintenanceUntil?: Date;
    rating: number;
    totalReviews: number;
}