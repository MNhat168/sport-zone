import { IsOptional, IsString, IsEnum, IsNumber, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { UserRole } from '../entities/user.entity';

export class GetAllUsersDto {
  @IsOptional()
  @IsString()
  search?: string; // Search by fullName or email

  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole; // Filter by role

  @IsOptional()
  @IsString()
  status?: 'active' | 'inactive'; // Filter by status (active/inactive)

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number; // Pagination: page number (default: 1)

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number; // Pagination: items per page (default: 10, max: 100)

  @IsOptional()
  @IsString()
  sortBy?: 'fullName' | 'email' | 'createdAt' | 'updatedAt'; // Sort field (default: createdAt)

  @IsOptional()
  @IsString()
  @IsEnum(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc'; // Sort order (default: desc)
}
