import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class CourtPriceRangeDto {
  @ApiProperty({ enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] })
  @IsEnum(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'])
  day: string;

  @ApiProperty({ example: '08:00' })
  @IsString()
  @IsNotEmpty()
  start: string;

  @ApiProperty({ example: '10:00' })
  @IsString()
  @IsNotEmpty()
  end: string;

  @ApiProperty({ example: 1.2, description: 'Pricing multiplier for the range' })
  @IsNumber()
  @Min(0)
  multiplier: number;
}

export class CourtPricingOverrideDto {
  @ApiPropertyOptional({ example: 200000, minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  basePrice?: number;

  @ApiPropertyOptional({ type: [CourtPriceRangeDto], description: 'Override price ranges for this court' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CourtPriceRangeDto)
  priceRanges?: CourtPriceRangeDto[];
}

export class CreateCourtDto {
  @ApiProperty({ example: 'Court A', description: 'Tên court' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiProperty({ example: 1, description: 'Số thứ tự court trong sân', minimum: 1 })
  @IsInt()
  @Min(1)
  courtNumber: number;

  @ApiPropertyOptional({ type: CourtPricingOverrideDto, description: 'Giá override cho court (tùy chọn)' })
  @IsOptional()
  @ValidateNested()
  @Type(() => CourtPricingOverrideDto)
  pricingOverride?: CourtPricingOverrideDto;
}

