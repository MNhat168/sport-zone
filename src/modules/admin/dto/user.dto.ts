import { UserRole } from '@common/enums/user.enum';

export class UserRoleStatDto {
    role: UserRole;
    count: number;
}

export class UserMonthlyStatsDto {
  year: number;         
  month: number;        
  newUserCount: number; 
}