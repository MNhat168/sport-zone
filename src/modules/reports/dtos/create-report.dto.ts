import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsMongoId, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ReportCategory } from 'src/common/enums/report-category.enum';

export class CreateReportDto {
  @ApiProperty({ enum: ReportCategory })
  @IsEnum(ReportCategory)
  category: ReportCategory;

  @ApiPropertyOptional({ description: 'Field being reported' })
  @IsOptional()
  @IsMongoId()
  fieldId?: string;

  @ApiPropertyOptional({ description: 'Message required when category=other' })
  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  description?: string;
}