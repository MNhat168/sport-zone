import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsMongoId, IsNumberString, IsOptional, IsString } from 'class-validator';
import { ReportCategory } from 'src/common/enums/report-category.enum';

export class GetReportsQueryDto {
  @ApiPropertyOptional({ enum: ['open','in_review','resolved','closed'], isArray: true })
  @IsOptional()
  status?: ('open'|'in_review'|'resolved'|'closed')[];

  @ApiPropertyOptional({ enum: ReportCategory, isArray: true })
  @IsOptional()
  category?: ReportCategory[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumberString()
  page?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumberString()
  limit?: string;

  @ApiPropertyOptional({
    description: 'Filter reports by field',
  })
  @IsOptional()
  @IsMongoId()
  fieldId?: string;
}