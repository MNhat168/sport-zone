import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsEnum,
  IsObject,
  IsArray,
  IsOptional,
  ValidateNested,
  IsUrl,
  IsNumber,
  Min,
  Max,
  IsNotEmpty,
} from 'class-validator';
import { Type } from 'class-transformer';
import { RegistrationStatus } from '@common/enums/field-owner-registration.enum';
import { SportType } from 'src/common/enums/sport-type.enum';

class PersonalInfoDto {
  @ApiProperty({ example: 'Nguyễn Văn A', description: 'Họ tên đầy đủ' })
  @IsString()
  fullName: string;

  @ApiProperty({ example: '001234567890', description: 'Số CMND/CCCD' })
  @IsString()
  idNumber: string;

  @ApiProperty({ example: '123 Đường ABC, Quận 1, TP.HCM', description: 'Địa chỉ thường trú' })
  @IsString()
  address: string;
}

class EkycDataDto {
  @ApiProperty({ example: 'Nguyễn Văn A', description: 'Họ tên đầy đủ' })
  @IsString()
  fullName: string;

  @ApiPropertyOptional({ example: '001234567890', description: 'Số CMND/CCCD (deprecated, use identityCardNumber)' })
  @IsOptional()
  @IsString()
  idNumber?: string;

  @ApiPropertyOptional({ example: '001234567890', description: 'Số CMND/CCCD' })
  @IsOptional()
  @IsString()
  identityCardNumber?: string;

  @ApiPropertyOptional({ example: '123 Đường ABC, Quận 1, TP.HCM', description: 'Địa chỉ (deprecated, use permanentAddress)' })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({ example: '123 Đường ABC, Quận 1, TP.HCM', description: 'Địa chỉ thường trú' })
  @IsOptional()
  @IsString()
  permanentAddress?: string;

  @ApiPropertyOptional({ example: '1990-01-01', description: 'Ngày sinh' })
  @IsOptional()
  @IsString()
  dateOfBirth?: string;

  @ApiPropertyOptional({ example: '2030-01-01', description: 'Ngày hết hạn' })
  @IsOptional()
  @IsString()
  expirationDate?: string;
}

class DocumentsDto {
  @ApiPropertyOptional({ example: 'https://s3.../business-license.jpg', description: 'URL giấy ĐKKD (cho doanh nghiệp/hộ KD)' })
  @IsOptional()
  @IsUrl()
  businessLicense?: string;
}

class FacilityLocationCoordinatesDto {
  @ApiProperty({ example: 10.776889, description: 'Latitude (-90 to 90)' })
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat: number;

  @ApiProperty({ example: 106.700806, description: 'Longitude (-180 to 180)' })
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng: number;
}

export class RequestAdditionalInfoRegistrationDto {
  @ApiProperty({ description: 'Message from admin requesting additional info' })
  @IsString()
  @IsNotEmpty()
  message: string;
}

export class CreateFieldOwnerRegistrationDto {
  @ApiProperty({ description: 'Thông tin cá nhân' })
  @ValidateNested()
  @Type(() => PersonalInfoDto)
  personalInfo: PersonalInfoDto;

  @ApiPropertyOptional({ description: 'Giấy tờ pháp lý (giấy ĐKKD cho doanh nghiệp/hộ KD). Identity dùng eKYC.' })
  @IsOptional()
  @ValidateNested()
  @Type(() => DocumentsDto)
  documents?: DocumentsDto; // Business documents only; identity docs handled via eKYC

  @ApiPropertyOptional({
    example: 'ekyc-session-12345',
    description: 'didit eKYC session ID (required if not using deprecated documents)'
  })
  @IsOptional()
  @IsString()
  ekycSessionId?: string;

  @ApiPropertyOptional({
    description: 'Personal info extracted from eKYC (auto-filled from eKYC result)'
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => EkycDataDto)
  ekycData?: EkycDataDto;

  @ApiPropertyOptional({ example: 'Sân bóng Phú Nhuận', description: 'Tên cơ sở vật chất (có thể điền sau khi approve)' })
  @IsOptional()
  @IsString()
  facilityName?: string;

  @ApiPropertyOptional({ example: 'District 3, Ho Chi Minh City', description: 'Địa điểm cơ sở vật chất (có thể điền sau khi approve)' })
  @IsOptional()
  @IsString()
  facilityLocation?: string;

  @ApiPropertyOptional({
    description: 'Tọa độ địa điểm cơ sở vật chất (latitude, longitude)',
    type: FacilityLocationCoordinatesDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => FacilityLocationCoordinatesDto)
  facilityLocationCoordinates?: FacilityLocationCoordinatesDto;

  @ApiPropertyOptional({ example: 'Cơ sở vật chất hiện đại với sân bóng đá và tennis', description: 'Mô tả cơ sở vật chất (có thể điền sau khi approve)' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['wifi', 'parking', 'changing_room'],
    description: 'Danh sách tiện ích',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  amenities?: string[];

  @ApiPropertyOptional({
    example: 'Monday-Sunday: 6:00-22:00',
    description: 'Giờ hoạt động',
  })
  @IsOptional()
  @IsString()
  businessHours?: string;

  @ApiPropertyOptional({ example: '0901234567', description: 'Số điện thoại liên hệ (có thể điền sau khi approve)' })
  @IsOptional()
  @IsString()
  contactPhone?: string;

  @ApiPropertyOptional({ example: 'https://example.com', description: 'Website' })
  @IsOptional()
  @IsString()
  website?: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['https://s3.../field1.jpg', 'https://s3.../field2.jpg'],
    description: 'Danh sách URL ảnh sân (tối thiểu 5 ảnh)',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  fieldImages?: string[];
}

export class UpdateFieldOwnerRegistrationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @ValidateNested()
  @Type(() => PersonalInfoDto)
  personalInfo?: PersonalInfoDto;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateNested()
  @Type(() => DocumentsDto)
  documents?: DocumentsDto;

  @ApiPropertyOptional({ example: 'Sân bóng Phú Nhuận', description: 'Tên cơ sở vật chất' })
  @IsOptional()
  @IsString()
  facilityName?: string;

  @ApiPropertyOptional({ example: 'District 3, Ho Chi Minh City', description: 'Địa điểm cơ sở vật chất' })
  @IsOptional()
  @IsString()
  facilityLocation?: string;

  @ApiPropertyOptional({
    description: 'Tọa độ địa điểm cơ sở vật chất (latitude, longitude)',
    type: FacilityLocationCoordinatesDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => FacilityLocationCoordinatesDto)
  facilityLocationCoordinates?: FacilityLocationCoordinatesDto;

  @ApiPropertyOptional({ example: 'Cơ sở vật chất hiện đại với sân bóng đá và tennis', description: 'Mô tả cơ sở vật chất' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['wifi', 'parking', 'changing_room'],
    description: 'Danh sách tiện ích',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  amenities?: string[];

  @ApiPropertyOptional({
    example: 'Monday-Sunday: 6:00-22:00',
    description: 'Giờ hoạt động',
  })
  @IsOptional()
  @IsString()
  businessHours?: string;

  @ApiPropertyOptional({ example: '0901234567', description: 'Số điện thoại liên hệ' })
  @IsOptional()
  @IsString()
  contactPhone?: string;

  @ApiPropertyOptional({ example: 'https://example.com', description: 'Website' })
  @IsOptional()
  @IsString()
  website?: string;
}

export class ApproveFieldOwnerRegistrationDto {
  @ApiPropertyOptional({ example: 'Sân bóng Phú Nhuận', description: 'Tên cơ sở vật chất' })
  @IsOptional()
  @IsString()
  facilityName?: string;

  @ApiPropertyOptional({ example: 'District 3, Ho Chi Minh City', description: 'Địa điểm cơ sở vật chất' })
  @IsOptional()
  @IsString()
  facilityLocation?: string;

  @ApiPropertyOptional({
    description: 'Tọa độ địa điểm cơ sở vật chất (latitude, longitude)',
    type: FacilityLocationCoordinatesDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => FacilityLocationCoordinatesDto)
  facilityLocationCoordinates?: FacilityLocationCoordinatesDto;

  @ApiPropertyOptional({ example: 'Cơ sở vật chất hiện đại với sân bóng đá và tennis', description: 'Mô tả cơ sở vật chất' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['wifi', 'parking', 'changing_room'],
    description: 'Danh sách tiện ích',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  amenities?: string[];

  @ApiPropertyOptional({
    example: 'Monday-Sunday: 6:00-22:00',
    description: 'Giờ hoạt động',
  })
  @IsOptional()
  @IsString()
  businessHours?: string;

  @ApiPropertyOptional({ example: '0901234567', description: 'Số điện thoại liên hệ' })
  @IsOptional()
  @IsString()
  contactPhone?: string;

  @ApiPropertyOptional({ example: 'https://example.com', description: 'Website' })
  @IsOptional()
  @IsString()
  website?: string;

  @ApiPropertyOptional({ example: 'Đã xác minh giấy tờ và sân bóng', description: 'Ghi chú phê duyệt' })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class RejectFieldOwnerRegistrationDto {
  @ApiProperty({ example: 'Giấy tờ không hợp lệ', description: 'Lý do từ chối' })
  @IsString()
  reason: string;
}

export class FieldOwnerRegistrationResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  userId: string;


  @ApiProperty()
  personalInfo: PersonalInfoDto;

  @ApiPropertyOptional()
  documents?: DocumentsDto; // Business documents only; identity docs handled via eKYC

  @ApiPropertyOptional()
  ekycSessionId?: string;

  @ApiPropertyOptional({ enum: ['pending', 'verified', 'failed'] })
  ekycStatus?: 'pending' | 'verified' | 'failed';

  @ApiPropertyOptional()
  ekycVerifiedAt?: Date;

  @ApiPropertyOptional()
  ekycData?: EkycDataDto;

  @ApiProperty({ enum: RegistrationStatus })
  status: RegistrationStatus;

  @ApiProperty({ example: 'Sân bóng Phú Nhuận', description: 'Tên cơ sở vật chất' })
  facilityName: string;

  @ApiProperty({ example: 'District 3, Ho Chi Minh City', description: 'Địa điểm cơ sở vật chất' })
  facilityLocation: string;

  @ApiPropertyOptional({
    description: 'Tọa độ địa điểm cơ sở vật chất (latitude, longitude)',
    type: FacilityLocationCoordinatesDto,
  })
  facilityLocationCoordinates?: FacilityLocationCoordinatesDto;

  @ApiProperty({ example: 'Cơ sở vật chất hiện đại với sân bóng đá và tennis', description: 'Mô tả cơ sở vật chất' })
  description: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['wifi', 'parking', 'changing_room'],
    description: 'Danh sách tiện ích',
  })
  amenities?: string[];

  @ApiPropertyOptional({
    example: 'Monday-Sunday: 6:00-22:00',
    description: 'Giờ hoạt động',
  })
  businessHours?: string;

  @ApiProperty({ example: '0901234567', description: 'Số điện thoại liên hệ' })
  contactPhone: string;

  @ApiPropertyOptional({ example: 'https://example.com', description: 'Website' })
  website?: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['https://s3.../field1.jpg', 'https://s3.../field2.jpg'],
    description: 'Danh sách URL ảnh sân',
  })
  fieldImages?: string[];

  @ApiPropertyOptional()
  rejectionReason?: string;

  @ApiProperty()
  submittedAt: Date;

  @ApiPropertyOptional()
  processedAt?: Date;

  @ApiPropertyOptional()
  processedBy?: string;

  @ApiPropertyOptional()
  reviewedAt?: Date;

  @ApiPropertyOptional()
  reviewedBy?: string;
}

