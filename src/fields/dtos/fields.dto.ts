import { SportType } from "src/common/enums/sport-type.enum";

export class FieldsDto {
    id: string;
    owner: string;
    name: string;
    sportType: SportType;
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