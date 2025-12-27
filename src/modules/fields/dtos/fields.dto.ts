import { IsString, IsNumber, IsArray, IsBoolean, IsOptional, IsEnum, ValidateNested, IsPositive, Min, Max, IsIn } from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SportType } from 'src/common/enums/sport-type.enum';

class FieldAmenityDto {
    @ApiProperty({ example: '507f1f77bcf86cd799439020', description: 'ID của tiện ích' })
    @IsString()
    amenityId: string;

    @ApiProperty({ example: 150000, description: 'Giá của tiện ích tại sân này (VND)', minimum: 0 })
    @IsNumber()
    @Min(0)
    price: number;
}

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

class GeoPointDto {
    @ApiProperty({ enum: ['Point'], example: 'Point', description: 'GeoJSON type' })
    @IsString()
    @IsIn(['Point'])
    type: 'Point';

    @ApiProperty({ example: [106.700981, 10.776889], description: '[longitude, latitude]' })
    @IsArray()
    @Type(() => Number)
    coordinates: [number, number];
}

export class LocationDto {
    @ApiProperty({ example: 'District 3, Ho Chi Minh City', description: 'Địa chỉ hiển thị' })
    @IsString()
    address: string;

    @ApiProperty({ type: GeoPointDto, description: 'GeoJSON point' })
    @ValidateNested()
    @Type(() => GeoPointDto)
    geo: GeoPointDto;
}

/**
 * DTO cho response thông tin sân
 */
export class FieldsDto {
    @ApiProperty({ example: '507f1f77bcf86cd799439011', description: 'ID của sân' })
    id: string;

    @ApiProperty({ example: '507f1f77bcf86cd799439012', description: 'ID chủ sân' })
    owner: string;

    @ApiPropertyOptional({ example: 'Nguyễn Văn A', description: 'Tên chủ sân' })
    ownerName?: string;

    @ApiPropertyOptional({ example: '0901234567', description: 'Số điện thoại chủ sân' })
    ownerPhone?: string;

    @ApiProperty({ example: 'Sân bóng Phú Nhuận', description: 'Tên sân' })
    name: string;

    @ApiProperty({ enum: SportType, example: SportType.FOOTBALL, description: 'Loại thể thao' })
    sportType: string;

    @ApiProperty({ example: 'Sân bóng đá 11 người, có đèn chiếu sáng', description: 'Mô tả sân' })
    description: string;

    @ApiProperty({ type: LocationDto, description: 'Địa điểm của sân (địa chỉ + toạ độ)' })
    @Type(() => LocationDto)
    location: LocationDto;

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

    @ApiPropertyOptional({ example: '200.000đ/giờ', description: 'Giá đã format để hiển thị (200.000đ/giờ, N/A)' })
    price?: string;

    @ApiProperty({ example: true, description: 'Trạng thái hoạt động' })
    isActive: boolean;

    @ApiProperty({ example: false, description: 'Trạng thái xác minh bởi admin' })
    isAdminVerify: boolean;

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

    @ApiPropertyOptional({
        description: 'Danh sách tiện ích đã populate (tên + giá + type)',
        type: 'array',
        example: [
            { amenityId: '652a7b1e1c9d440000a1b2c1', name: 'Bóng', price: 0, type: 'facility' },
            { amenityId: '652a7b1e1c9d440000a1b2c7', name: 'Thuê vợt', price: 50000, type: 'other' }
        ]
    })
    amenities?: { amenityId: string; name: string; price: number; type?: string }[];

    @ApiPropertyOptional({ description: 'Danh sách sân con (courts)', type: 'array', example: [] })
    courts?: any[];
}

/**
 * DTO cho việc tạo sân mới
 */
/**
 * DTO cho việc tạo sân mới - Hỗ trợ cả JSON và Multipart Form Data
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

    @ApiProperty({ type: LocationDto, description: 'Địa điểm của sân (địa chỉ + toạ độ)' })
    @Transform(({ value }) => typeof value === 'string' ? JSON.parse(value) : value)
    @ValidateNested()
    @Type(() => LocationDto)
    location: LocationDto;

    @ApiPropertyOptional({
        type: [String],
        example: ['https://example.com/field1.jpg'],
        description: 'URL hình ảnh đã có (nếu có)'
    })
    @IsOptional()
    @Transform(({ value }) => typeof value === 'string' ? JSON.parse(value) : value)
    @IsArray()
    @IsString({ each: true })
    images?: string[];

    @ApiProperty({ type: [DayOperatingHoursDto], description: 'Giờ hoạt động' })
    @Transform(({ value }) => typeof value === 'string' ? JSON.parse(value) : value)
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => DayOperatingHoursDto)
    operatingHours: DayOperatingHoursDto[];

    @ApiProperty({ example: 60, description: 'Thời lượng một slot (phút)', minimum: 30, maximum: 180 })
    @Transform(({ value }) => typeof value === 'string' ? parseInt(value, 10) : value)
    @IsNumber()
    @Min(30)
    @Max(180)
    slotDuration: number;

    @ApiProperty({ example: 1, description: 'Số slot tối thiểu', minimum: 1 })
    @Transform(({ value }) => typeof value === 'string' ? parseInt(value, 10) : value)
    @IsNumber()
    @Min(1)
    minSlots: number;

    @ApiProperty({ example: 4, description: 'Số slot tối đa', minimum: 1 })
    @Transform(({ value }) => typeof value === 'string' ? parseInt(value, 10) : value)
    @IsNumber()
    @Min(1)
    maxSlots: number;

    @ApiProperty({ type: [DayPriceRangeDto], description: 'Khung giá' })
    @Transform(({ value }) => typeof value === 'string' ? JSON.parse(value) : value)
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => DayPriceRangeDto)
    priceRanges: DayPriceRangeDto[];

    @ApiProperty({ example: 150000, description: 'Giá cơ bản', minimum: 1000 })
    @Transform(({ value }) => typeof value === 'string' ? parseInt(value, 10) : value)
    @IsNumber()
    @IsPositive()
    basePrice: number;

    @ApiPropertyOptional({ type: [FieldAmenityDto], description: 'Tiện ích' })
    @IsOptional()
    @Transform(({ value }) => typeof value === 'string' ? JSON.parse(value) : value)
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => FieldAmenityDto)
    amenities?: FieldAmenityDto[];

    @ApiPropertyOptional({ example: 1, description: 'Số lượng court', minimum: 0, maximum: 10, default: 1 })
    @IsOptional()
    @Transform(({ value }) => typeof value === 'string' ? parseInt(value, 10) : value)
    @IsNumber()
    @Min(0)
    @Max(10)
    @Type(() => Number)
    numberOfCourts?: number;

    @ApiPropertyOptional({
        type: 'array',
        items: { type: 'string', format: 'binary' },
        description: 'File hình ảnh đính kèm (Multipart)'
    })
    files?: any[];
}

/**
 * DTO cho việc cập nhật thông tin sân - Hỗ trợ cả JSON và Multipart Form Data
 */
export class UpdateFieldDto {
    @ApiPropertyOptional({ example: 'Tên sân được cập nhật', description: 'Tên sân' })
    @IsOptional()
    @IsString()
    name?: string;

    @ApiPropertyOptional({ enum: SportType, example: SportType.FOOTBALL, description: 'Loại thể thao' })
    @IsOptional()
    @IsEnum(SportType)
    sportType?: SportType;

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
    @Transform(({ value }) => typeof value === 'string' ? JSON.parse(value) : value)
    @IsArray()
    @IsString({ each: true })
    images?: string[];

    @ApiPropertyOptional({ type: [DayOperatingHoursDto], description: 'Giờ hoạt động mới' })
    @IsOptional()
    @Transform(({ value }) => typeof value === 'string' ? JSON.parse(value) : value)
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => DayOperatingHoursDto)
    operatingHours?: DayOperatingHoursDto[];

    @ApiPropertyOptional({ example: 90, description: 'Thời lượng slot mới', minimum: 30, maximum: 180 })
    @IsOptional()
    @Transform(({ value }) => typeof value === 'string' ? parseInt(value, 10) : value)
    @IsNumber()
    @Min(30)
    @Max(180)
    slotDuration?: number;

    @ApiPropertyOptional({ example: 2, description: 'Số slot tối thiểu mới', minimum: 1 })
    @IsOptional()
    @Transform(({ value }) => typeof value === 'string' ? parseInt(value, 10) : value)
    @IsNumber()
    @Min(1)
    minSlots?: number;

    @ApiPropertyOptional({ example: 6, description: 'Số slot tối đa mới', minimum: 1 })
    @IsOptional()
    @Transform(({ value }) => typeof value === 'string' ? parseInt(value, 10) : value)
    @IsNumber()
    @Min(1)
    maxSlots?: number;

    @ApiPropertyOptional({ type: [DayPriceRangeDto], description: 'Khung giá mới' })
    @IsOptional()
    @Transform(({ value }) => typeof value === 'string' ? JSON.parse(value) : value)
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => DayPriceRangeDto)
    priceRanges?: DayPriceRangeDto[];

    @ApiPropertyOptional({ example: 180000, description: 'Giá cơ bản mới', minimum: 1000 })
    @IsOptional()
    @Transform(({ value }) => typeof value === 'string' ? parseInt(value, 10) : value)
    @IsNumber()
    @IsPositive()
    basePrice?: number;

    @ApiPropertyOptional({ example: true, description: 'Trạng thái hoạt động' })
    @IsOptional()
    @Transform(({ value }) => value === 'true' ? true : value === 'false' ? false : value)
    @IsBoolean()
    isActive?: boolean;

    @ApiPropertyOptional({ example: 'Bảo trì định kỳ', description: 'Ghi chú bảo trì' })
    @IsOptional()
    @IsString()
    maintenanceNote?: string;

    @ApiPropertyOptional({ example: '2025-10-20', description: 'Ngày kết thúc bảo trì' })
    @IsOptional()
    @Type(() => Date)
    maintenanceUntil?: Date;

    @ApiPropertyOptional({ type: LocationDto, description: 'Địa điểm mới' })
    @IsOptional()
    @Transform(({ value }) => typeof value === 'string' ? JSON.parse(value) : value)
    @ValidateNested()
    @Type(() => LocationDto)
    location?: LocationDto;

    @ApiPropertyOptional({ type: [FieldAmenityDto], description: 'Tiện ích mới' })
    @IsOptional()
    @Transform(({ value }) => typeof value === 'string' ? JSON.parse(value) : value)
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => FieldAmenityDto)
    amenities?: FieldAmenityDto[];

    @ApiPropertyOptional({ example: 1, description: 'Số lượng court', minimum: 0, maximum: 10 })
    @IsOptional()
    @Transform(({ value }) => typeof value === 'string' ? parseInt(value, 10) : value)
    @IsNumber()
    @Min(0)
    @Max(10)
    @Type(() => Number)
    numberOfCourts?: number;

    @ApiPropertyOptional({ description: 'URL hình ảnh giữ lại (Multipart flow)', type: [String] })
    @IsOptional()
    @Transform(({ value }) => typeof value === 'string' ? JSON.parse(value) : value)
    @IsArray()
    @IsString({ each: true })
    keptImages?: string[];

    @ApiPropertyOptional({ description: 'Court IDs cần xóa (Multipart flow)', type: [String] })
    @IsOptional()
    @Transform(({ value }) => typeof value === 'string' ? JSON.parse(value) : value)
    @IsArray()
    @IsString({ each: true })
    courtsToDelete?: string[];

    @ApiPropertyOptional({
        type: 'array',
        items: { type: 'string', format: 'binary' },
        description: 'File hình ảnh mới đính kèm (Multipart)'
    })
    files?: any[];
}

/**
 * DTO cho pagination response
 */
export class PaginationDto {
    @ApiProperty({ example: 25, description: 'Tổng số bản ghi' })
    total: number;

    @ApiProperty({ example: 1, description: 'Trang hiện tại' })
    page: number;

    @ApiProperty({ example: 10, description: 'Số bản ghi trên mỗi trang' })
    limit: number;

    @ApiProperty({ example: 3, description: 'Tổng số trang' })
    totalPages: number;

    @ApiProperty({ example: true, description: 'Có trang tiếp theo không' })
    hasNextPage: boolean;

    @ApiProperty({ example: false, description: 'Có trang trước không' })
    hasPrevPage: boolean;
}

/**
 * DTO cho response danh sách field của owner
 */
export class OwnerFieldsResponseDto {
    @ApiProperty({ type: [FieldsDto], description: 'Danh sách sân của owner' })
    fields: FieldsDto[];

    @ApiProperty({ type: PaginationDto, description: 'Thông tin phân trang' })
    pagination: PaginationDto;
}

/**
 * DTO cho response thông tin FieldOwnerProfile
 */
// FieldOwnerProfile DTOs have been moved to field-owner-profile.dto.ts