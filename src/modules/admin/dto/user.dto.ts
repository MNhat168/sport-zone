import { UserRole } from 'src/modules/users/entities/user.entity';

export class UserRoleStatDto {
    role: UserRole;
    count: number;
}

export class UserMonthlyStatsDto {
  year: number;         
  month: number;        
  newUserCount: number; 
}