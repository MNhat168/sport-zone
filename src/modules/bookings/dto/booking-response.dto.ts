import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BookingStatus, BookingType } from '../entities/booking.entity';

/**
 * DTO cho response booking với Vietnam timezone
 */
export class BookingResponseDto {
  @ApiProperty({ example: '507f1f77bcf86cd799439011', description: 'ID của booking' })
  _id: string;

  @ApiProperty({ example: '507f1f77bcf86cd799439012', description: 'ID người dùng' })
  user: string;

  @ApiProperty({ example: '507f1f77bcf86cd799439013', description: 'ID sân' })
  field: string;

  @ApiProperty({ example: '2025-10-15', description: 'Ngày đặt (YYYY-MM-DD)' })
  date: string;

  @ApiProperty({ example: '09:00', description: 'Giờ bắt đầu (HH:mm)' })
  startTime: string;

  @ApiProperty({ example: '11:00', description: 'Giờ kết thúc (HH:mm)' })
  endTime: string;

  @ApiProperty({ example: 2, description: 'Số slots đã đặt' })
  numSlots: number;

  @ApiProperty({ enum: BookingType, example: BookingType.FIELD, description: 'Loại booking' })
  type: BookingType;

  @ApiProperty({ enum: BookingStatus, example: BookingStatus.CONFIRMED, description: 'Trạng thái booking' })
  status: BookingStatus;

  @ApiProperty({ example: 300000, description: 'Tổng giá (VND)' })
  totalPrice: number;

  @ApiPropertyOptional({ example: 'User cancelled', description: 'Lý do hủy' })
  cancellationReason?: string;

  @ApiPropertyOptional({ example: '507f1f77bcf86cd799439014', description: 'ID huấn luyện viên được yêu cầu' })
  requestedCoach?: string;

  @ApiProperty({ example: '2025-10-02T23:32:00.000+07:00', description: 'Thời gian tạo (Vietnam time)' })
  createdAt: Date;

  @ApiProperty({ example: '2025-10-02T23:32:00.000+07:00', description: 'Thời gian cập nhật (Vietnam time)' })
  updatedAt: Date;
}