import { UserRole } from '@common/enums/user-role.enum';

export interface TokenPayload {
    userId: string;
    email: string;
    role: UserRole;
}
