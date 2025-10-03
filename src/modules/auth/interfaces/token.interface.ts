import { UserRole } from '../../users/entities/user.entity';

export interface TokenPayload {
    userId: string;
    email: string;
    role: UserRole;
}
