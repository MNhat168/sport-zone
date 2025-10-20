import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNumber, IsOptional, IsEnum, IsBoolean, Min } from 'class-validator';
import { SportType, AmenityType } from 'src/common/enums/sport-type.enum';

export class CreateAmenityDto {
  @ApiProperty({ description: 'Tên của tiện ích', example: 'Huấn luyện viên bóng đá' })
  @IsString()
  name: string;

  @ApiProperty({ description: 'Mô tả chi tiết về tiện ích', example: 'Huấn luyện viên chuyên nghiệp với 5 năm kinh nghiệm', required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ 
    description: 'Loại thể thao', 
    enum: SportType, 
    example: SportType.FOOTBALL 
  })
  @IsEnum(SportType)
  sportType: SportType;


  @ApiProperty({ description: 'Trạng thái hoạt động', example: true, required: false, default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiProperty({ description: 'URL hình ảnh của tiện ích', required: false })
  @IsOptional()
  @IsString()
  imageUrl?: string;

  @ApiProperty({ 
    description: 'Loại tiện ích', 
    enum: AmenityType, 
    example: AmenityType.COACH 
  })
  @IsEnum(AmenityType)
  type: AmenityType;
}
