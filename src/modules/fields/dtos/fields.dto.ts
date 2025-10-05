import { IsString, IsNumber, IsArray, IsBoolean, IsOptional, IsEnum, ValidateNested, IsPositive, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SportType } from 'src/common/enums/sport-type.enum';

class DayOperatingHoursDto {
    @ApiProperty({ 
        enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
        example: 'monday', 
        description: 'Ngày trong tuần' 
    })
    @IsString()
    day: string;

    @ApiProperty({ example: '06:00', description: 'Giờ mở cửa (HH:mm)' })
    @IsString()
    start: string;

    @ApiProperty({ example: '22:00', description: 'Giờ đóng cửa (HH:mm)' })
    @IsString()
    end: string;

    @ApiProperty({ example: 60, description: 'Thời lượng slot (phút)', minimum: 30 })
    @IsNumber()
    @Min(30)
    duration: number;
}

class DayPriceRangeDto {
    @ApiProperty({ 
        enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
        example: 'monday', 
        description: 'Ngày trong tuần' 
    })
    @IsString()
    day: string;

    @ApiProperty({ example: '06:00', description: 'Giờ bắt đầu khung giá (HH:mm)' })
    @IsString()
    start: string;

    @ApiProperty({ example: '10:00', description: 'Giờ kết thúc khung giá (HH:mm)' })
    @IsString()
    end: string;

    @ApiProperty({ example: 1.0, description: 'Hệ số nhân giá (1.0 = giá gốc, 1.5 = tăng 50%)' })
    @IsNumber()
    @IsPositive()
    multiplier: number;
}

/**
 * DTO cho response thông tin sân
 */
export class FieldsDto {
    @ApiProperty({ example: '507f1f77bcf86cd799439011', description: 'ID của sân' })
    id: string;

    @ApiProperty({ example: '507f1f77bcf86cd799439012', description: 'ID chủ sân' })
    owner: string;

    @ApiProperty({ example: 'Sân bóng Phú Nhuận', description: 'Tên sân' })
    name: string;

    @ApiProperty({ enum: SportType, example: SportType.FOOTBALL, description: 'Loại thể thao' })
    sportType: string;

    @ApiProperty({ example: 'Sân bóng đá 11 người, có đèn chiếu sáng', description: 'Mô tả sân' })
    description: string;

    @ApiProperty({ example: 'District 3, Ho Chi Minh City', description: 'Địa điểm' })
    location: string;

    @ApiProperty({ type: [String], example: ['https://example.com/field1.jpg'], description: 'Danh sách hình ảnh' })
    images: string[];

    @ApiProperty({ type: [DayOperatingHoursDto], description: 'Giờ hoạt động theo ngày' })
    operatingHours: { day: string; start: string; end: string; duration: number }[];

    @ApiProperty({ example: 60, description: 'Thời lượng một slot (phút)' })
    slotDuration: number;

    @ApiProperty({ example: 1, description: 'Số slot tối thiểu có thể đặt' })
    minSlots: number;

    @ApiProperty({ example: 4, description: 'Số slot tối đa có thể đặt' })
    maxSlots: number;

    @ApiProperty({ type: [DayPriceRangeDto], description: 'Khung giá theo thời gian và ngày' })
    priceRanges: { day: string; start: string; end: string; multiplier: number }[];

    @ApiProperty({ example: 150000, description: 'Giá cơ bản (VND)' })
    basePrice: number;

    @ApiProperty({ example: true, description: 'Trạng thái hoạt động' })
    isActive: boolean;

    @ApiPropertyOptional({ example: 'Bảo trì định kỳ', description: 'Ghi chú bảo trì' })
    maintenanceNote?: string;

    @ApiPropertyOptional({ example: '2025-10-15T00:00:00.000Z', description: 'Ngày kết thúc bảo trì' })
    maintenanceUntil?: Date;

    @ApiProperty({ example: 4.5, description: 'Đánh giá trung bình' })
    rating: number;

    @ApiProperty({ example: 128, description: 'Tổng số đánh giá' })
    totalReviews: number;

    @ApiPropertyOptional({ example: '2025-10-02T23:32:00.000+07:00', description: 'Thời gian tạo (Vietnam time)' })
    createdAt?: Date;

    @ApiPropertyOptional({ example: '2025-10-02T23:32:00.000+07:00', description: 'Thời gian cập nhật (Vietnam time)' })
    updatedAt?: Date;
}

/**
 * DTO cho việc tạo sân mới
 */
export class CreateFieldDto {
    @ApiProperty({ example: 'Sân bóng Phú Nhuận', description: 'Tên sân' })
    @IsString()
    name: string;

    @ApiProperty({ enum: SportType, example: SportType.FOOTBALL, description: 'Loại thể thao' })
    @IsEnum(SportType)
    sportType: SportType;

    @ApiProperty({ example: 'Sân bóng đá 11 người, có đèn chiếu sáng', description: 'Mô tả sân' })
    @IsString()
    description: string;

    @ApiProperty({ example: 'District 3, Ho Chi Minh City', description: 'Địa điểm của sân' })
    @IsString()
    location: string;

    @ApiPropertyOptional({ 
        type: [String], 
        example: ['https://example.com/field1.jpg', 'https://example.com/field2.jpg'], 
        description: 'Danh sách URL hình ảnh sân (optional - sẽ được upload nếu có files)' 
    })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    images?: string[];

    @ApiProperty({ type: [DayOperatingHoursDto], description: 'Giờ hoạt động của sân theo ngày' })
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => DayOperatingHoursDto)
    operatingHours: DayOperatingHoursDto[];

    @ApiProperty({ example: 60, description: 'Thời lượng một slot (phút)', minimum: 30, maximum: 180 })
    @IsNumber()
    @Min(30)
    @Max(180)
    slotDuration: number;

    @ApiProperty({ example: 1, description: 'Số slot tối thiểu có thể đặt', minimum: 1 })
    @IsNumber()
    @Min(1)
    minSlots: number;

    @ApiProperty({ example: 4, description: 'Số slot tối đa có thể đặt', minimum: 1 })
    @IsNumber()
    @Min(1)
    maxSlots: number;

    @ApiProperty({ 
        type: [DayPriceRangeDto], 
        description: 'Khung giá theo thời gian và ngày',
        example: [
            { day: 'monday', start: '06:00', end: '10:00', multiplier: 1.0 },
            { day: 'monday', start: '18:00', end: '22:00', multiplier: 1.5 }
        ]
    })
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => DayPriceRangeDto)
    priceRanges: DayPriceRangeDto[];

    @ApiProperty({ example: 150000, description: 'Giá cơ bản mỗi slot (VND)', minimum: 1000 })
    @IsNumber()
    @IsPositive()
    basePrice: number;
}

/**
 * DTO cho việc cập nhật thông tin sân
 */
export class UpdateFieldDto {
    @ApiPropertyOptional({ example: 'Tên sân được cập nhật', description: 'Tên sân' })
    @IsOptional()
    @IsString()
    name?: string;

    @ApiPropertyOptional({ example: 'Mô tả được cập nhật', description: 'Mô tả sân' })
    @IsOptional()
    @IsString()
    description?: string;

    @ApiPropertyOptional({ 
        type: [String], 
        example: ['https://example.com/new-image.jpg'], 
        description: 'Danh sách URL hình ảnh mới' 
    })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    images?: string[];

    @ApiPropertyOptional({ type: [DayOperatingHoursDto], description: 'Giờ hoạt động mới theo ngày' })
    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => DayOperatingHoursDto)
    operatingHours?: DayOperatingHoursDto[];

    @ApiPropertyOptional({ example: 90, description: 'Thời lượng slot mới (phút)', minimum: 30, maximum: 180 })
    @IsOptional()
    @IsNumber()
    @Min(30)
    @Max(180)
    slotDuration?: number;

    @ApiPropertyOptional({ example: 2, description: 'Số slot tối thiểu mới', minimum: 1 })
    @IsOptional()
    @IsNumber()
    @Min(1)
    minSlots?: number;

    @ApiPropertyOptional({ example: 6, description: 'Số slot tối đa mới', minimum: 1 })
    @IsOptional()
    @IsNumber()
    @Min(1)
    maxSlots?: number;

    @ApiPropertyOptional({ 
        type: [DayPriceRangeDto], 
        description: 'Khung giá mới theo thời gian và ngày',
        example: [
            { day: 'monday', start: '06:00', end: '12:00', multiplier: 1.0 },
            { day: 'monday', start: '12:00', end: '22:00', multiplier: 1.3 }
        ]
    })
    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => DayPriceRangeDto)
    priceRanges?: DayPriceRangeDto[];

    @ApiPropertyOptional({ example: 180000, description: 'Giá cơ bản mới (VND)', minimum: 1000 })
    @IsOptional()
    @IsNumber()
    @IsPositive()
    basePrice?: number;

    @ApiPropertyOptional({ example: true, description: 'Trạng thái hoạt động' })
    @IsOptional()
    @IsBoolean()
    isActive?: boolean;

    @ApiPropertyOptional({ example: 'Bảo trì định kỳ', description: 'Ghi chú bảo trì' })
    @IsOptional()
    @IsString()
    maintenanceNote?: string;

    @ApiPropertyOptional({ example: '2025-10-20', description: 'Ngày kết thúc bảo trì (YYYY-MM-DD)' })
    @IsOptional()
    maintenanceUntil?: Date;

    @ApiPropertyOptional({ example: 'Địa điểm mới', description: 'Địa điểm của sân' })
    @IsOptional()
    @IsString()
    location?: string;
}

/**
 * DTO cho việc tạo sân mới với hỗ trợ upload ảnh
 */
export class CreateFieldWithFilesDto {
    @ApiProperty({ example: 'Sân bóng Phú Nhuận', description: 'Tên sân' })
    @IsString()
    name: string;

    @ApiProperty({ enum: SportType, example: SportType.FOOTBALL, description: 'Loại thể thao' })
    @IsString()
    sportType: string;

    @ApiProperty({ example: 'Sân bóng đá 11 người, có đèn chiếu sáng', description: 'Mô tả sân' })
    @IsString()
    description: string;

    @ApiProperty({ example: 'District 3, Ho Chi Minh City', description: 'Địa điểm của sân' })
    @IsString()
    location: string;

    @ApiProperty({ 
        example: '[{"day":"monday","start":"06:00","end":"22:00","duration":60}]',
        description: 'Giờ hoạt động theo ngày (JSON string)' 
    })
    @IsString()
    operatingHours: string;

    @ApiProperty({ example: '60', description: 'Thời lượng một slot (phút)' })
    @IsString()
    slotDuration: string;

    @ApiProperty({ example: '1', description: 'Số slot tối thiểu có thể đặt' })
    @IsString()
    minSlots: string;

    @ApiProperty({ example: '4', description: 'Số slot tối đa có thể đặt' })
    @IsString()
    maxSlots: string;

    @ApiProperty({ 
        example: '[{"day":"monday","start":"06:00","end":"10:00","multiplier":1.0},{"day":"monday","start":"18:00","end":"22:00","multiplier":1.5}]',
        description: 'Khung giá theo thời gian và ngày (JSON string)' 
    })
    @IsString()
    priceRanges: string;

    @ApiProperty({ example: '150000', description: 'Giá cơ bản mỗi slot (VND)' })
    @IsString()
    basePrice: string;

    @ApiProperty({ 
        type: 'array',
        items: { type: 'string', format: 'binary' },
        description: 'Danh sách hình ảnh sân (tối đa 10 ảnh)',
        required: false
    })
    images?: Express.Multer.File[];
}