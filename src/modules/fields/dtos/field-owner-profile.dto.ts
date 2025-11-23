import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsEnum, IsOptional, IsString } from 'class-validator';
import { SportType } from 'src/common/enums/sport-type.enum';

export class FieldOwnerProfileDto {
    @ApiProperty({ example: '507f1f77bcf86cd799439011', description: 'ID của profile' })
    id: string;

    @ApiProperty({ example: '507f1f77bcf86cd799439012', description: 'ID của user' })
    user: string;

    @ApiPropertyOptional({ example: 'John Doe', description: 'Tên đầy đủ của chủ sân' })
    userFullName?: string;

    @ApiPropertyOptional({ example: 'owner@example.com', description: 'Email của chủ sân' })
    userEmail?: string;

    // Intentionally do not expose private user information

    @ApiProperty({ example: 'Sân bóng Phú Nhuận', description: 'Tên cơ sở vật chất' })
    facilityName: string;

    @ApiProperty({ example: 'District 3, Ho Chi Minh City', description: 'Địa điểm cơ sở vật chất' })
    facilityLocation: string;

    @ApiProperty({
        type: [String],
        enum: SportType,
        example: ['football', 'tennis'],
        description: 'Các môn thể thao được hỗ trợ'
    })
    supportedSports: SportType[];

    @ApiProperty({ example: 'Cơ sở vật chất hiện đại với sân bóng đá và tennis', description: 'Mô tả cơ sở vật chất' })
    description: string;

    @ApiProperty({
        type: [String],
        example: ['wifi', 'parking', 'changing_room'],
        description: 'Danh sách tiện ích có sẵn'
    })
    amenities: string[];

    @ApiProperty({ example: 4.5, description: 'Đánh giá trung bình', minimum: 0, maximum: 5 })
    rating: number;

    @ApiProperty({ example: 128, description: 'Tổng số đánh giá' })
    totalReviews: number;

    @ApiProperty({ example: false, description: 'Trạng thái xác minh' })
    isVerified: boolean;

    @ApiPropertyOptional({
        example: 'https://example.com/business-license.jpg',
        description: 'URL tài liệu xác minh (giấy phép kinh doanh)'
    })
    verificationDocument?: string;

    @ApiPropertyOptional({
        example: 'Monday-Sunday: 6:00-22:00',
        description: 'Giờ hoạt động của cơ sở vật chất'
    })
    businessHours?: string;

    @ApiProperty({ example: '0901234567', description: 'Số điện thoại liên hệ' })
    contactPhone: string;

    @ApiPropertyOptional({ example: 'https://example.com', description: 'Website của cơ sở vật chất' })
    website?: string;

    @ApiPropertyOptional({ example: '2025-10-02T23:32:00.000+07:00', description: 'Thời gian tạo' })
    createdAt?: Date;

    @ApiPropertyOptional({ example: '2025-10-02T23:32:00.000+07:00', description: 'Thời gian cập nhật' })
    updatedAt?: Date;
}

export class CreateFieldOwnerProfileDto {
    @ApiProperty({ example: 'Sân bóng Phú Nhuận', description: 'Tên cơ sở vật chất' })
    @IsString()
    facilityName: string;

    @ApiProperty({ example: 'District 3, Ho Chi Minh City', description: 'Địa điểm cơ sở vật chất' })
    @IsString()
    facilityLocation: string;

    @ApiProperty({
        type: [String],
        enum: SportType,
        example: ['football', 'tennis'],
        description: 'Các môn thể thao được hỗ trợ'
    })
    @IsArray()
    @IsEnum(SportType, { each: true })
    supportedSports: SportType[];

    @ApiProperty({ example: 'Cơ sở vật chất hiện đại với sân bóng đá và tennis', description: 'Mô tả cơ sở vật chất' })
    @IsString()
    description: string;

    @ApiPropertyOptional({
        type: [String],
        example: ['wifi', 'parking', 'changing_room'],
        description: 'Danh sách tiện ích có sẵn'
    })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    amenities?: string[];

    @ApiPropertyOptional({
        example: 'https://example.com/business-license.jpg',
        description: 'URL tài liệu xác minh (giấy phép kinh doanh)'
    })
    @IsOptional()
    @IsString()
    verificationDocument?: string;

    @ApiPropertyOptional({
        example: 'Monday-Sunday: 6:00-22:00',
        description: 'Giờ hoạt động của cơ sở vật chất'
    })
    @IsOptional()
    @IsString()
    businessHours?: string;

    @ApiProperty({ example: '0901234567', description: 'Số điện thoại liên hệ' })
    @IsString()
    contactPhone: string;

    @ApiPropertyOptional({ example: 'https://example.com', description: 'Website của cơ sở vật chất' })
    @IsOptional()
    @IsString()
    website?: string;
}

export class UpdateFieldOwnerProfileDto {
    @ApiPropertyOptional({ example: 'Sân bóng Phú Nhuận - Cập nhật', description: 'Tên cơ sở vật chất' })
    @IsOptional()
    @IsString()
    facilityName?: string;

    @ApiPropertyOptional({ example: 'District 3, Ho Chi Minh City', description: 'Địa điểm cơ sở vật chất' })
    @IsOptional()
    @IsString()
    facilityLocation?: string;

    @ApiPropertyOptional({
        type: [String],
        enum: SportType,
        example: ['football', 'tennis', 'badminton'],
        description: 'Các môn thể thao được hỗ trợ'
    })
    @IsOptional()
    @IsArray()
    @IsEnum(SportType, { each: true })
    supportedSports?: SportType[];

    @ApiPropertyOptional({ example: 'Cơ sở vật chất hiện đại với sân bóng đá, tennis và cầu lông', description: 'Mô tả cơ sở vật chất' })
    @IsOptional()
    @IsString()
    description?: string;

    @ApiPropertyOptional({
        type: [String],
        example: ['wifi', 'parking', 'changing_room', 'shower'],
        description: 'Danh sách tiện ích có sẵn'
    })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    amenities?: string[];

    @ApiPropertyOptional({
        example: 'https://example.com/new-business-license.jpg',
        description: 'URL tài liệu xác minh mới (giấy phép kinh doanh)'
    })
    @IsOptional()
    @IsString()
    verificationDocument?: string;

    @ApiPropertyOptional({
        example: 'Monday-Sunday: 5:00-23:00',
        description: 'Giờ hoạt động mới của cơ sở vật chất'
    })
    @IsOptional()
    @IsString()
    businessHours?: string;

    @ApiPropertyOptional({ example: '0909876543', description: 'Số điện thoại liên hệ mới' })
    @IsOptional()
    @IsString()
    contactPhone?: string;

    @ApiPropertyOptional({ example: 'https://new-website.com', description: 'Website mới của cơ sở vật chất' })
    @IsOptional()
    @IsString()
    website?: string;
}


