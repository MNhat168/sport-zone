import { IsString, IsDateString, IsNumber, IsOptional, IsArray, IsUUID, Min, IsEnum, IsInt, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { PaymentMethod } from 'src/common/enums/payment-method.enum';

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
   * Phương thức thanh toán
   * @example 1
   */
  @ApiPropertyOptional({ 
    enum: PaymentMethod,
    example: PaymentMethod.CASH,
    description: 'Phương thức thanh toán: 1=cash, 2=ebanking, 3=credit_card, 4=debit_card, 5=momo, 6=zalopay, 7=vnpay, 8=bank_transfer, 9=qr_code'
  })
  @IsOptional()
  @IsInt()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;

  /**
   * Ghi chú thanh toán (tùy chọn)
   * @example "Chuyển khoản qua Techcombank - STK: 1234567890"
   */
  @ApiPropertyOptional({ 
    description: 'Ghi chú về thanh toán (số tài khoản, mã giao dịch, etc.)'
  })
  @IsOptional()
  @IsString()
  paymentNote?: string;

  /**
   * Ghi chú của người dùng khi đặt sân (tối đa 200 ký tự)
   * @example "Gần lưới, chuẩn bị 2 bóng"
   */
  @ApiPropertyOptional({ description: 'Ghi chú khi đặt sân (tối đa 200 ký tự)', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
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
   * Court cần kiểm tra (tùy chọn, bắt buộc nếu field có nhiều court)
   * @example "657f1f77bcf86cd799439011"
   */
  @ApiPropertyOptional({
    example: '657f1f77bcf86cd799439011',
    description: 'Court ID. Nếu field có nhiều court, cần truyền courtId'
  })
  @IsOptional()
  @IsString()
  courtId?: string;

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