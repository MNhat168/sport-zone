import { IsString, IsDateString, IsNumber, IsOptional, IsArray, Min, IsEnum, IsInt } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentMethod } from 'src/common/enums/payment-method.enum';

/**
 * DTO for creating session booking (field + coach) with Pure Lazy Creation pattern
 * No scheduleId required - uses fieldId + coachId + date instead
 */
export class CreateSessionBookingLazyDto {
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
   * ID của huấn luyện viên
   * @example "507f1f77bcf86cd799439012"
   */
  @ApiProperty({
    example: '507f1f77bcf86cd799439012',
    description: 'ID của huấn luyện viên'
  })
  @IsString()
  coachId: string;

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
   * Thời gian bắt đầu sân (HH:MM)
   * @example "09:00"
   */
  @ApiProperty({
    example: '09:00',
    description: 'Thời gian bắt đầu sân (HH:MM)'
  })
  @IsString()
  fieldStartTime: string;

  /**
   * Thời gian kết thúc sân (HH:MM)
   * @example "11:00"
   */
  @ApiProperty({
    example: '11:00',
    description: 'Thời gian kết thúc sân (HH:MM)'
  })
  @IsString()
  fieldEndTime: string;

  /**
   * Thời gian bắt đầu huấn luyện viên (HH:MM)
   * @example "09:00"
   */
  @ApiProperty({
    example: '09:00',
    description: 'Thời gian bắt đầu huấn luyện viên (HH:MM)'
  })
  @IsString()
  coachStartTime: string;

  /**
   * Thời gian kết thúc huấn luyện viên (HH:MM)
   * @example "11:00"
   */
  @ApiProperty({
    example: '11:00',
    description: 'Thời gian kết thúc huấn luyện viên (HH:MM)'
  })
  @IsString()
  coachEndTime: string;

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
    example: PaymentMethod.BANK_TRANSFER,
    description: 'Phương thức thanh toán: 1=cash, 2=ebanking, 3=credit_card, 4=debit_card, 5=momo, 6=zalopay, 8=bank_transfer, 9=qr_code'
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
}
