export class CoachesDto {
    id: string;
    fullName: string;
    email: string;
    avatarUrl?: string;
    isVerified: boolean;
    sports: string;
    certification: string;
    hourlyRate: number;
    bio: string;
    rating: number;
    totalReviews: number;
    rank?: string;
    isCoachActive?: boolean;
}