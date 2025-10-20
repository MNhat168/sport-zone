import { IsOptional, IsEnum, IsNumber, Min, Max } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { BookingStatus, BookingType } from '../entities/booking.entity';

/**
 * DTO cho query parameters khi lấy danh sách booking của user
 */
export class GetUserBookingsDto {
    /**
     * Filter theo trạng thái booking
     * @example "confirmed"
     */
    @ApiPropertyOptional({
        enum: BookingStatus,
        description: 'Filter theo trạng thái booking',
        example: 'confirmed'
    })
    @IsOptional()
    @IsEnum(BookingStatus)
    status?: BookingStatus;

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