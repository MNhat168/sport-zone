import { UserRole } from '../entities/user.entity';

export class UserProfileDto {
    id: string;
    fullName: string;
    email: string;
    phone?: string;
    avatarUrl?: string;
    role: UserRole;
    isVerified: boolean;
}