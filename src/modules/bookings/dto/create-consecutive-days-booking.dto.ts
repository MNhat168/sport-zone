import { IsString, IsDateString, IsOptional, IsArray, IsEnum, MaxLength, IsEmail } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentMethod } from 'src/common/enums/payment-method.enum';

/**
 * DTO for creating bookings for consecutive days
 * Same court, same time, multiple consecutive dates
 * Example: Book Court 1 from Monday to Friday, 09:00-11:00
 */
export class CreateConsecutiveDaysBookingDto {
    /**
     * ID của sân thể thao
     */
    @ApiProperty({
        example: '507f1f77bcf86cd799439011',
        description: 'ID của sân thể thao'
    })
    @IsString()
    fieldId: string;

    /**
     * ID của court trong sân
     */
    @ApiProperty({
        example: '657f1f77bcf86cd799439011',
        description: 'ID của court thuộc sân'
    })
    @IsString()
    courtId: string;

    /**
     * Ngày bắt đầu (YYYY-MM-DD)
     */
    @ApiProperty({
        example: '2025-01-13',
        description: 'Ngày bắt đầu đặt sân (YYYY-MM-DD)'
    })
    @IsDateString()
    startDate: string;

    /**
     * Ngày kết thúc (YYYY-MM-DD)
     */
    @ApiProperty({
        example: '2025-01-17',
        description: 'Ngày kết thúc đặt sân (YYYY-MM-DD)'
    })
    @IsDateString()
    endDate: string;

    /**
     * Thời gian bắt đầu (HH:MM)
     */
    @ApiProperty({
        example: '09:00',
        description: 'Thời gian bắt đầu mỗi ngày (HH:MM)'
    })
    @IsString()
    startTime: string;

    /**
     * Thời gian kết thúc (HH:MM)
     */
    @ApiProperty({
        example: '11:00',
        description: 'Thời gian kết thúc mỗi ngày (HH:MM)'
    })
    @IsString()
    endTime: string;

    /**
     * Danh sách tiện ích được chọn (tùy chọn)
     */
    @ApiPropertyOptional({
        type: [String],
        description: 'Danh sách ID tiện ích được chọn (áp dụng cho tất cả các ngày)'
    })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    selectedAmenities?: string[];

    /**
     * Phương thức thanh toán
     */
    @ApiPropertyOptional({
        enum: PaymentMethod,
        example: PaymentMethod.PAYOS,
        description: 'Phương thức thanh toán'
    })
    @IsOptional()
    @IsEnum(PaymentMethod)
    paymentMethod?: PaymentMethod;

    /**
     * Ghi chú
     */
    @ApiPropertyOptional({
        description: 'Ghi chú khi đặt sân (tối đa 200 ký tự)',
        maxLength: 200
    })
    @IsOptional()
    @IsString()
    @MaxLength(200)
    note?: string;

    /**
     * Email khách hàng (bắt buộc nếu không đăng nhập)
     */
    @ApiPropertyOptional({
        example: 'guest@example.com',
        description: 'Email của khách hàng (bắt buộc nếu không đăng nhập)'
    })
    @IsOptional()
    @IsEmail({}, { message: 'Email không hợp lệ' })
    guestEmail?: string;

    /**
     * Số điện thoại khách hàng
     */
    @ApiPropertyOptional({
        example: '0123456789',
        description: 'Số điện thoại của khách hàng'
    })
    @IsOptional()
    @IsString()
    @MaxLength(15)
    guestPhone?: string;

    /**
     * Tên khách hàng
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
