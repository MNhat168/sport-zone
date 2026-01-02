import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsEnum,
  IsArray,
  IsOptional,
  ValidateNested,
  IsNumber,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { RegistrationStatus } from '@common/enums/field-owner-registration.enum';

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

class LocationCoordinatesDto {
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

export class CreateCoachRegistrationDto {
  @ApiProperty({ description: 'Thông tin cá nhân' })
  @ValidateNested()
  @Type(() => PersonalInfoDto)
  personalInfo: PersonalInfoDto;

  @ApiPropertyOptional({ 
    example: 'ekyc-session-12345', 
    description: 'didit eKYC session ID (required for identity verification)' 
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

  // Coach Profile Information
  @ApiProperty({
    type: String,
    example: 'football',
    description: 'Môn thể thao có thể huấn luyện',
  })
  @IsString()
  sports: string;

  @ApiProperty({ example: 'AFC C License, UEFA B License', description: 'Chứng chỉ/bằng cấp huấn luyện viên' })
  @IsString()
  certification: string;

  @ApiProperty({ example: 300000, description: 'Giá theo giờ (VND)', minimum: 0 })
  @IsNumber()
  @Min(0)
  hourlyRate: number;

  @ApiProperty({ example: 'Huấn luyện viên bóng đá chuyên nghiệp với 10 năm kinh nghiệm...', description: 'Giới thiệu bản thân' })
  @IsString()
  bio: string;

  @ApiProperty({ example: '10 năm huấn luyện đội trẻ, 5 năm huấn luyện đội tuyển...', description: 'Kinh nghiệm làm việc' })
  @IsString()
  experience: string;

  // Location Information
  @ApiProperty({ example: 'Quận 1, TP.HCM', description: 'Địa chỉ hoạt động' })
  @IsString()
  locationAddress: string;

  @ApiPropertyOptional({
    description: 'Tọa độ địa điểm (latitude, longitude)',
    type: LocationCoordinatesDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => LocationCoordinatesDto)
  locationCoordinates?: LocationCoordinatesDto;

  // Photos/Documents
  @ApiPropertyOptional({
    example: 'https://s3.../profile-photo.jpg',
    description: 'Ảnh đại diện',
  })
  @IsOptional()
  @IsString()
  profilePhoto?: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['https://s3.../cert1.jpg', 'https://s3.../cert2.jpg'],
    description: 'Ảnh chứng chỉ/bằng cấp',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  certificationPhotos?: string[];
}

export class UpdateCoachRegistrationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @ValidateNested()
  @Type(() => PersonalInfoDto)
  personalInfo?: PersonalInfoDto;

  @ApiPropertyOptional({
    type: String,
    example: 'football',
    description: 'Môn thể thao có thể huấn luyện',
  })
  @IsOptional()
  @IsString()
  sports?: string;

  @ApiPropertyOptional({ example: 'AFC C License, UEFA B License', description: 'Chứng chỉ/bằng cấp' })
  @IsOptional()
  @IsString()
  certification?: string;

  @ApiPropertyOptional({ example: 300000, description: 'Giá theo giờ (VND)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  hourlyRate?: number;

  @ApiPropertyOptional({ example: 'Huấn luyện viên bóng đá...', description: 'Giới thiệu' })
  @IsOptional()
  @IsString()
  bio?: string;

  @ApiPropertyOptional({ example: '10 năm kinh nghiệm...', description: 'Kinh nghiệm' })
  @IsOptional()
  @IsString()
  experience?: string;

  @ApiPropertyOptional({ example: 'Quận 1, TP.HCM', description: 'Địa chỉ hoạt động' })
  @IsOptional()
  @IsString()
  locationAddress?: string;

  @ApiPropertyOptional({
    description: 'Tọa độ địa điểm',
    type: LocationCoordinatesDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => LocationCoordinatesDto)
  locationCoordinates?: LocationCoordinatesDto;

  @ApiPropertyOptional({ example: 'https://s3.../profile-photo.jpg', description: 'Ảnh đại diện' })
  @IsOptional()
  @IsString()
  profilePhoto?: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['https://s3.../cert1.jpg'],
    description: 'Ảnh chứng chỉ',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  certificationPhotos?: string[];
}

export class ApproveCoachRegistrationDto {
  @ApiPropertyOptional({
    type: String,
    example: 'football',
    description: 'Môn thể thao (admin có thể điều chỉnh)',
  })
  @IsOptional()
  @IsString()
  sports?: string;

  @ApiPropertyOptional({ example: 'AFC C License', description: 'Chứng chỉ' })
  @IsOptional()
  @IsString()
  certification?: string;

  @ApiPropertyOptional({ example: 300000, description: 'Giá theo giờ' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  hourlyRate?: number;

  @ApiPropertyOptional({ example: 'Huấn luyện viên...', description: 'Giới thiệu' })
  @IsOptional()
  @IsString()
  bio?: string;

  @ApiPropertyOptional({ example: '10 năm...', description: 'Kinh nghiệm' })
  @IsOptional()
  @IsString()
  experience?: string;

  @ApiPropertyOptional({ example: 'Quận 1, TP.HCM', description: 'Địa chỉ' })
  @IsOptional()
  @IsString()
  locationAddress?: string;

  @ApiPropertyOptional({
    description: 'Tọa độ',
    type: LocationCoordinatesDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => LocationCoordinatesDto)
  locationCoordinates?: LocationCoordinatesDto;

  @ApiPropertyOptional({ example: 'Đã xác minh chứng chỉ và kinh nghiệm', description: 'Ghi chú phê duyệt' })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class RejectCoachRegistrationDto {
  @ApiProperty({ example: 'Chứng chỉ không hợp lệ', description: 'Lý do từ chối' })
  @IsString()
  reason: string;
}

export class CoachRegistrationResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  userId: string;

  @ApiProperty()
  personalInfo: PersonalInfoDto;

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

  @ApiProperty({ type: String })
  sports: string;

  @ApiProperty()
  certification: string;

  @ApiProperty()
  hourlyRate: number;

  @ApiProperty()
  bio: string;

  @ApiProperty()
  experience: string;

  @ApiProperty()
  locationAddress: string;

  @ApiPropertyOptional()
  locationCoordinates?: LocationCoordinatesDto;

  @ApiPropertyOptional()
  profilePhoto?: string;

  @ApiPropertyOptional({ type: [String] })
  certificationPhotos?: string[];

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
