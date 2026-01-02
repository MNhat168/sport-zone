import { IsOptional, IsString, IsArray, IsNumber, IsBoolean, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateCoachDto {
  @ApiPropertyOptional({ description: 'Biography / description' })
  @IsOptional()
  @IsString()
  bio?: string;
  @ApiPropertyOptional({ description: 'Sport specialization', type: String })
  @IsOptional()
  @IsString()
  sports?: string;

  @ApiPropertyOptional({ description: 'Certification / level' })
  @IsOptional()
  @IsString()
  certification?: string;

  @ApiPropertyOptional({ description: 'Rank or level' })
  @IsOptional()
  @IsString()
  rank?: string;

  @ApiPropertyOptional({ description: 'Experience description' })
  @IsOptional()
  @IsString()
  experience?: string;

  @ApiPropertyOptional({ description: 'Gallery images URLs', type: [String] })
  @IsOptional()
  @IsArray()
  galleryImages?: string[];

  @ApiPropertyOptional({ description: 'Profile/avatar image URL' })
  @IsOptional()
  @IsString()
  profileImage?: string;

  @ApiPropertyOptional({ description: 'Hourly rate in VND' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  hourlyRate?: number;

  @ApiPropertyOptional({ description: 'Whether coach is active/available for bookings' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Whether coach account is active' })
  @IsOptional()
  @IsBoolean()
  isCoachActive?: boolean;
}
