import { IsString, IsDateString, IsOptional, IsArray, IsEnum, IsInt, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentMethod } from 'src/common/enums/payment-method.enum';

export class CreateCoachBookingLazyDto {
  @ApiProperty({ example: '507f1f77bcf86cd799439011', description: 'ID của sân' })
  @IsString()
  fieldId: string;

  @ApiProperty({ example: '507f1f77bcf86cd799439012', description: 'ID của coach' })
  @IsString()
  coachId: string;

  @ApiProperty({ example: '2025-10-15', description: 'Ngày đặt (YYYY-MM-DD)' })
  @IsDateString()
  date: string;

  @ApiProperty({ example: '09:00', description: 'Thời gian bắt đầu (HH:MM)' })
  @IsString()
  startTime: string;

  @ApiProperty({ example: '10:00', description: 'Thời gian kết thúc (HH:MM)' })
  @IsString()
  endTime: string;

  @ApiPropertyOptional({ enum: PaymentMethod, example: PaymentMethod.BANK_TRANSFER, description: 'Phương thức thanh toán' })
  @IsOptional()
  @IsInt()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;

  @ApiPropertyOptional({ description: 'Ghi chú đặt coach (tối đa 200 ký tự)', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;

  @ApiPropertyOptional({ description: 'Ghi chú thanh toán (optional)' })
  @IsOptional()
  @IsString()
  paymentNote?: string;
}
