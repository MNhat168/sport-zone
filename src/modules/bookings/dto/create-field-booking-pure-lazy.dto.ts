import { IsString, IsDateString, IsNumber, IsOptional, IsArray, IsUUID, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

/**
 * DTO for creating field booking with Pure Lazy Creation pattern
 * No scheduleId required - uses fieldId + date instead
 */
export class CreateFieldBookingLazyDto {
  /**
   * ID của sân thể thao
   * @example "507f1f77bcf86cd799439011"
   */
  @ApiProperty({ 
    example: '507f1f77bcf86cd799439011',
    description: 'ID của sân thể thao'
  })
  @IsString()
  fieldId: string;

  /**
   * Ngày đặt sân (YYYY-MM-DD)
   * @example "2025-10-15"
   */
  @ApiProperty({ 
    example: '2025-10-15',
    description: 'Ngày đặt sân (YYYY-MM-DD)'
  })
  @IsDateString()
  date: string;

  /**
   * Thời gian bắt đầu (HH:MM)
   * @example "09:00"
   */
  @ApiProperty({ 
    example: '09:00',
    description: 'Thời gian bắt đầu (HH:MM)'
  })
  @IsString()
  startTime: string;

  /**
   * Thời gian kết thúc (HH:MM)
   * @example "11:00"
   */
  @ApiProperty({ 
    example: '11:00',
    description: 'Thời gian kết thúc (HH:MM)'
  })
  @IsString()
  endTime: string;

  /**
   * Danh sách tiện ích được chọn (tùy chọn)
   */
  @ApiPropertyOptional({ 
    type: [String],
    description: 'Danh sách ID tiện ích được chọn'
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  selectedAmenities?: string[];
}

/**
 * DTO for field availability query with Pure Lazy Creation
 */
export class FieldAvailabilityQueryDto {
  /**
   * Ngày bắt đầu query (YYYY-MM-DD)
   * @example "2025-10-01"
   */
  @ApiProperty({ 
    example: '2025-10-01',
    description: 'Ngày bắt đầu query (YYYY-MM-DD)'
  })
  @IsDateString()
  startDate: string;

  /**
   * Ngày kết thúc query (YYYY-MM-DD)
   * @example "2025-10-31"
   */
  @ApiProperty({ 
    example: '2025-10-31',
    description: 'Ngày kết thúc query (YYYY-MM-DD)'
  })
  @IsDateString()
  endDate: string;
}

/**
 * DTO for marking holiday/special day
 */
export class MarkHolidayDto {
  /**
   * Lý do đánh dấu ngày đặc biệt
   * @example "Bảo trì hệ thống chiếu sáng"
   */
  @ApiProperty({ 
    example: 'Bảo trì hệ thống chiếu sáng',
    description: 'Lý do đánh dấu ngày đặc biệt'
  })
  @IsString()
  reason: string;
}