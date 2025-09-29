import { SetMetadata } from '@nestjs/common';
import { UserRole } from 'src/common/enums/user-role.enum';

export const ROLES_KEY = 'role';
export const Roles = (...role: UserRole[]) => SetMetadata(ROLES_KEY, role);
