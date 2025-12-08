import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator';
import { CourtPricingOverrideDto } from './create-court.dto';

export class UpdateCourtDto {
  @ApiPropertyOptional({ example: 'Court B', description: 'Tên court' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ example: 2, description: 'Số thứ tự court trong sân', minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  courtNumber?: number;

  @ApiPropertyOptional({ type: CourtPricingOverrideDto, description: 'Giá override cho court (tùy chọn)' })
  @IsOptional()
  @ValidateNested()
  @Type(() => CourtPricingOverrideDto)
  pricingOverride?: CourtPricingOverrideDto;

  @ApiPropertyOptional({ description: 'Kích hoạt / vô hiệu hóa court' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

