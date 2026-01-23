import { IsString, IsDateString, IsOptional, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO for creating owner-reserved booking
 * Allows field owner to reserve their own slots with system fee
 */
export class CreateOwnerReservedBookingDto {
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
   * ID của court trong sân
   * @example "657f1f77bcf86cd799439011"
   */
  @ApiProperty({
    example: '657f1f77bcf86cd799439011',
    description: 'ID của court thuộc sân'
  })
  @IsString()
  courtId: string;

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
   * Ghi chú (tùy chọn) - Lý do khóa sân (bảo trì, giải đấu, etc.)
   * @example "Bảo trì hệ thống chiếu sáng"
   */
  @ApiPropertyOptional({
    description: 'Ghi chú về lý do khóa sân (bảo trì, giải đấu, etc.)',
    maxLength: 200
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}
