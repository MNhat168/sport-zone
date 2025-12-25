import { IsOptional, IsString, IsArray } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { SportType } from 'src/common/enums/sport-type.enum';

export class UpdateCoachDto {
  @ApiPropertyOptional({ description: 'Biography / description' })
  @IsOptional()
  @IsString()
  bio?: string;
  @ApiPropertyOptional({ description: 'List of sports', enum: SportType })
  @IsOptional()
  @IsArray()
  sports?: SportType[];

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
}
