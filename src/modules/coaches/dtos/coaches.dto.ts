import { SportType } from 'src/common/enums/sport-type.enum';

export class CoachesDto {
    id: string;
    fullName: string;
    email: string;
    avatarUrl?: string;
    isVerified: boolean;
    sports: SportType[];
    certification: string;
    hourlyRate: number;
    bio: string;
    rating: number;
    totalReviews: number;
    rank?: string;
}