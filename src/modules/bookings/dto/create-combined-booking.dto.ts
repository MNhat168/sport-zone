import { IsString, IsDateString, IsOptional, IsArray, IsEnum, IsInt, MaxLength, IsEmail } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentMethod } from 'src/common/enums/payment-method.enum';

/**
 * DTO for creating combined field + coach booking (Pure Lazy Creation)
 * Handles both field and coach slots reservation in a single transaction
 */
export class CreateCombinedBookingDto {
    // ===== FIELD INFO =====
    @ApiProperty({ example: '507f1f77bcf86cd799439011', description: 'ID của sân thể thao' })
    @IsString()
    fieldId: string;

    @ApiProperty({ example: '657f1f77bcf86cd799439011', description: 'ID của court thuộc sân' })
    @IsString()
    courtId: string;

    @ApiProperty({ example: '2025-10-15', description: 'Ngày đặt (YYYY-MM-DD)' })
    @IsDateString()
    date: string;

    @ApiProperty({ example: '09:00', description: 'Thời gian bắt đầu (HH:MM)' })
    @IsString()
    startTime: string;

    @ApiProperty({ example: '11:00', description: 'Thời gian kết thúc (HH:MM)' })
    @IsString()
    endTime: string;

    @ApiPropertyOptional({ type: [String], description: 'Danh sách ID tiện ích được chọn' })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    selectedAmenities?: string[];

    // ===== COACH INFO =====
    @ApiProperty({ example: '507f1f77bcf86cd799439011', description: 'ID của huấn luyện viên' })
    @IsString()
    coachId: string;

    // ===== SHARED INFO =====
    @ApiPropertyOptional({
        enum: PaymentMethod,
        example: PaymentMethod.BANK_TRANSFER,
        description: 'Phương thức thanh toán'
    })
    @IsOptional()
    @IsInt()
    @IsEnum(PaymentMethod)
    paymentMethod?: PaymentMethod;

    @ApiPropertyOptional({ description: 'Ghi chú đặt sân/HLV', maxLength: 200 })
    @IsOptional()
    @IsString()
    @MaxLength(200)
    note?: string;

    @ApiPropertyOptional({ description: 'Ghi chú thanh toán' })
    @IsOptional()
    @IsString()
    paymentNote?: string;

    // ===== GUEST INFO =====
    @ApiPropertyOptional({ example: 'guest@example.com', description: 'Email khách hàng (nếu chưa đăng nhập)' })
    @IsOptional()
    @IsEmail()
    guestEmail?: string;

    @ApiPropertyOptional({ example: '0123456789', description: 'Số điện thoại khách hàng' })
    @IsOptional()
    @IsString()
    @MaxLength(15)
    guestPhone?: string;

    @ApiPropertyOptional({ example: 'Nguyen Van A', description: 'Tên khách hàng' })
    @IsOptional()
    @IsString()
    @MaxLength(100)
    guestName?: string;
}
