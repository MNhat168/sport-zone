export class FieldsDto {
    id: string;
    owner: string;
    name: string;
    sportType: string;
    description: string;
    location: string;
    images: string[];
    pricePerHour: number;
    isActive: boolean;
    maintenanceNote?: string;
    maintenanceUntil?: Date;
    rating: number;
    totalReviews: number;
}