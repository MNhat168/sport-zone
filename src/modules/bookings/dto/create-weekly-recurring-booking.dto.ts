import { IsString, IsDateString, IsOptional, IsArray, IsEnum, MaxLength, IsEmail, IsInt, Min, Max, ArrayMinSize, ArrayMaxSize } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentMethod } from 'src/common/enums/payment-method.enum';

/**
 * Valid weekday names
 */
const VALID_WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

/**
 * DTO for creating weekly recurring bookings
 * Example: "Book court every Monday and Wednesday for 4 weeks"
 */
export class CreateWeeklyRecurringBookingDto {
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
     * Các ngày trong tuần cần đặt
     */
    @ApiProperty({
        type: [String],
        example: ['monday', 'wednesday', 'friday'],
        description: 'Danh sách các ngày trong tuần (monday-sunday)'
    })
    @IsArray()
    @ArrayMinSize(1, { message: 'Phải chọn ít nhất 1 ngày trong tuần' })
    @ArrayMaxSize(7, { message: 'Không thể chọn quá 7 ngày trong tuần' })
    @IsString({ each: true })
    @IsEnum(VALID_WEEKDAYS, { each: true, message: 'Ngày trong tuần không hợp lệ. Phải là: monday, tuesday, wednesday, thursday, friday, saturday, sunday' })
    weekdays: string[];

    /**
     * Số tuần cần đặt
     */
    @ApiProperty({
        example: 4,
        description: 'Số tuần cần đặt (1-12 tuần)',
        minimum: 1,
        maximum: 12
    })
    @IsInt()
    @Min(1, { message: 'Số tuần phải từ 1 trở lên' })
    @Max(12, { message: 'Số tuần không được vượt quá 12' })
    numberOfWeeks: number;

    /**
     * Ngày bắt đầu (tuần đầu tiên)
     */
    @ApiProperty({
        example: '2025-01-13',
        description: 'Ngày bắt đầu tuần đầu tiên (YYYY-MM-DD)'
    })
    @IsDateString()
    startDate: string;

    /**
     * Thời gian bắt đầu mỗi ngày (HH:MM)
     */
    @ApiProperty({
        example: '09:00',
        description: 'Thời gian bắt đầu mỗi ngày (HH:MM)'
    })
    @IsString()
    startTime: string;

    /**
     * Thời gian kết thúc mỗi ngày (HH:MM)
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
        description: 'Danh sách ID tiện ích được chọn'
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

    /**
     * Danh sách ngày cần bỏ qua (ngày lễ, ngày nghỉ)
     * Turn 4: Holiday Skip Functionality
     */
    @ApiPropertyOptional({
        type: [String],
        example: ['2025-01-01', '2025-01-15'],
        description: 'Các ngày cần bỏ qua khi tạo booking (định dạng YYYY-MM-DD)'
    })
    @IsOptional()
    @IsArray()
    @IsDateString({}, { each: true })
    skipDates?: string[];

    /**
     * Override thông tin cho từng ngày cụ thể
     * Map<DateString, { startTime?: string, endTime?: string, courtId?: string }>
     */
    @ApiPropertyOptional({
        description: 'Override thông tin booking cho các ngày cụ thể (đổi giờ, đổi sân)',
        example: { '2025-01-15': { startTime: '15:00', endTime: '17:00' } }
    })
    @IsOptional()
    dateOverrides?: Record<string, any>;

    /**
     * Subtotal đã tính từ FE (tùy chọn - để tránh tính lại)
     * Nếu có, BE sẽ sử dụng giá trị này thay vì tính lại
     */
    @ApiPropertyOptional({
        example: 500000,
        description: 'Tổng tiền tạm tính đã được tính từ frontend (không bao gồm phí dịch vụ và giảm giá)'
    })
    @IsOptional()
    subtotal?: number;

    /**
     * Phí dịch vụ đã tính từ FE (tùy chọn)
     */
    @ApiPropertyOptional({
        example: 25000,
        description: 'Phí dịch vụ (5%) đã được tính từ frontend'
    })
    @IsOptional()
    systemFee?: number;

    /**
     * Tổng tiền cuối cùng đã tính từ FE (tùy chọn - sau khi trừ giảm giá)
     */
    @ApiPropertyOptional({
        example: 525000,
        description: 'Tổng tiền cuối cùng đã được tính từ frontend (bao gồm phí dịch vụ và giảm giá)'
    })
    @IsOptional()
    totalAmount?: number;
}
