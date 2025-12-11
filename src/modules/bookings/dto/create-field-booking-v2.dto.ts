import { IsString, IsDateString, IsOptional, IsArray, MaxLength, IsEmail, ValidateIf } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO for creating field booking V2 with bank transfer payment proof
 * Similar to CreateFieldBookingLazyDto but always uses BANK_TRANSFER payment method
 * Supports both authenticated and guest (anonymous) bookings
 */
export class CreateFieldBookingV2Dto {
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

  /**
   * Ghi chú của người dùng khi đặt sân (tối đa 200 ký tự)
   * @example "Gần lưới, chuẩn bị 2 bóng"
   */
  @ApiPropertyOptional({ description: 'Ghi chú khi đặt sân (tối đa 200 ký tự)', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;

  /**
   * Email của khách hàng (bắt buộc nếu không có userId từ authentication)
   * @example "guest@example.com"
   */
  @ApiPropertyOptional({ 
    example: 'guest@example.com',
    description: 'Email của khách hàng (bắt buộc nếu không đăng nhập)'
  })
  @ValidateIf((o) => !o.userId) // Required if no userId
  @IsEmail({}, { message: 'Email không hợp lệ' })
  guestEmail?: string;

  /**
   * Số điện thoại của khách hàng (tùy chọn)
   * @example "0123456789"
   */
  @ApiPropertyOptional({ 
    example: '0123456789',
    description: 'Số điện thoại của khách hàng (10 chữ số)'
  })
  @IsOptional()
  @IsString()
  @MaxLength(15)
  guestPhone?: string;

  /**
   * Tên của khách hàng (tùy chọn)
   * @example "Nguyễn Văn A"
   */
  @ApiPropertyOptional({ 
    example: 'Nguyễn Văn A',
    description: 'Tên của khách hàng'
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  guestName?: string;
}


