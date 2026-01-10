import { IsOptional, IsEnum, IsNumber, Min, Max, IsIn } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { BookingStatus, BookingType } from '@common/enums/booking.enum';

/**
 * DTO cho query parameters khi lấy danh sách booking của user
 */
export class GetUserBookingsDto {
  /**
   * Filter theo trạng thái booking (lifecycle)
   * @example "confirmed"
   */
  @ApiPropertyOptional({
    enum: BookingStatus,
    description: 'Filter theo trạng thái booking (lifecycle)',
    example: 'confirmed'
  })
  @IsOptional()
  @IsEnum(BookingStatus)
  status?: BookingStatus;

  /**
   * Filter theo trạng thái thanh toán
   * @example "paid"
   */
  @ApiPropertyOptional({
    enum: ['unpaid', 'paid', 'refunded'],
    description: 'Filter theo trạng thái thanh toán',
    example: 'paid'
  })
  @IsOptional()
  @IsIn(['unpaid', 'paid', 'refunded'])
  paymentStatus?: 'unpaid' | 'paid' | 'refunded';

  /**
   * Filter theo trạng thái duyệt ghi chú (owner)
   * @example "pending"
   */
  @ApiPropertyOptional({
    enum: ['pending', 'approved', 'rejected'],
    description: 'Filter theo trạng thái duyệt ghi chú (owner)',
    example: 'pending'
  })
  @IsOptional()
  @IsIn(['pending', 'approved', 'rejected'])
  approvalStatus?: 'pending' | 'approved' | 'rejected';

  /**
   * Filter theo trạng thái phản hồi coach
   * @example "accepted"
   */
  @ApiPropertyOptional({
    enum: ['pending', 'accepted', 'declined'],
    description: 'Filter theo trạng thái phản hồi coach',
    example: 'accepted'
  })
  @IsOptional()
  @IsIn(['pending', 'accepted', 'declined'])
  coachStatus?: 'pending' | 'accepted' | 'declined';

  /**
   * Filter theo loại booking
   * @example "field"
   */
  @ApiPropertyOptional({
    enum: BookingType,
    description: 'Filter theo loại booking',
    example: 'field'
  })
  @IsOptional()
  @IsEnum(BookingType)
  type?: BookingType;

  /**
   * Filter theo recurring status
   * @example "none" - chỉ single bookings, "only" - chỉ recurring bookings, "all" - tất cả
   */
  @ApiPropertyOptional({
    enum: ['none', 'only', 'all'],
    description: 'Filter theo recurring status: none (single), only (recurring), all (all)',
    example: 'none'
  })
  @IsOptional()
  @IsIn(['none', 'only', 'all'])
  recurringFilter?: 'none' | 'only' | 'all';

  /**
   * Filter theo ngày bắt đầu (YYYY-MM-DD)
   * @example "2025-01-01"
   */
  @ApiPropertyOptional({
    type: String,
    description: 'Filter theo ngày bắt đầu (YYYY-MM-DD)',
    example: '2025-01-01'
  })
  @IsOptional()
  startDate?: string;

  /**
   * Filter theo ngày kết thúc (YYYY-MM-DD)
   * @example "2025-12-31"
   */
  @ApiPropertyOptional({
    type: String,
    description: 'Filter theo ngày kết thúc (YYYY-MM-DD)',
    example: '2025-12-31'
  })
  @IsOptional()
  endDate?: string;

  /**
   * Search query (tìm kiếm theo field name, note, booking ID)
   * @example "Sân bóng"
   */
  @ApiPropertyOptional({
    type: String,
    description: 'Search query (tìm kiếm theo field name, note, booking ID)',
    example: 'Sân bóng'
  })
  @IsOptional()
  search?: string;

  /**
   * Số lượng booking trả về
   * @example 10
   */
  @ApiPropertyOptional({
    type: Number,
    minimum: 1,
    maximum: 100,
    default: 10,
    description: 'Số lượng booking trả về (1-100)',
    example: 10
  })
  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number = 10;

  /**
   * Trang hiện tại (bắt đầu từ 1)
   * @example 1
   */
  @ApiPropertyOptional({
    type: Number,
    minimum: 1,
    default: 1,
    description: 'Trang hiện tại (bắt đầu từ 1)',
    example: 1
  })
  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsNumber()
  @Min(1)
  page?: number = 1;
}

/**
 * DTO cho response pagination info
 */
export class PaginationDto {
    @ApiPropertyOptional({ example: 25, description: 'Tổng số booking' })
    total: number;

    @ApiPropertyOptional({ example: 1, description: 'Trang hiện tại' })
    page: number;

    @ApiPropertyOptional({ example: 10, description: 'Số booking mỗi trang' })
    limit: number;

    @ApiPropertyOptional({ example: 3, description: 'Tổng số trang' })
    totalPages: number;

    @ApiPropertyOptional({ example: true, description: 'Có trang tiếp theo không' })
    hasNextPage: boolean;

    @ApiPropertyOptional({ example: false, description: 'Có trang trước không' })
    hasPrevPage: boolean;
}

/**
 * DTO cho response danh sách booking của user
 */
export class UserBookingsResponseDto {
    @ApiPropertyOptional({
        type: 'array',
        description: 'Danh sách booking',
        items: {
            type: 'object',
            properties: {
                _id: { type: 'string', example: '507f1f77bcf86cd799439011' },
                field: {
                    type: 'object',
                    properties: {
                        _id: { type: 'string' },
                        name: { type: 'string', example: 'Sân bóng Phú Nhuận' },
                        location: { type: 'object' },
                        images: { type: 'array' },
                        sportType: { type: 'string', example: 'football' },
                        owner: {
                            type: 'object',
                            properties: {
                                fullName: { type: 'string', example: 'Nguyễn Văn A' },
                                phoneNumber: { type: 'string', example: '0987654321' },
                                email: { type: 'string', example: 'owner@example.com' }
                            }
                        }
                    }
                },
                requestedCoach: {
                    type: 'object',
                    nullable: true,
                    properties: {
                        user: {
                            type: 'object',
                            properties: {
                                fullName: { type: 'string', example: 'Coach Nguyễn' },
                                phoneNumber: { type: 'string', example: '0987654322' },
                                email: { type: 'string', example: 'coach@example.com' }
                            }
                        },
                        hourlyRate: { type: 'number', example: 200000 },
                        sports: { type: 'array', example: ['football'] }
                    }
                },
                date: { type: 'string', example: '2025-10-15T00:00:00.000Z' },
                startTime: { type: 'string', example: '09:00' },
                endTime: { type: 'string', example: '11:00' },
                numSlots: { type: 'number', example: 2 },
                type: { type: 'string', example: 'field' },
                status: { type: 'string', example: 'confirmed' },
                totalPrice: { type: 'number', example: 300000 },
                selectedAmenities: { type: 'array', example: [] },
                amenitiesFee: { type: 'number', example: 0 },
                cancellationReason: { type: 'string', nullable: true },
                createdAt: { type: 'string' },
                updatedAt: { type: 'string' }
            }
        }
    })
    bookings: any[];

    @ApiPropertyOptional({ 
        type: PaginationDto,
        description: 'Thông tin phân trang' 
    })
    pagination: PaginationDto;
}