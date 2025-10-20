import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsEnum, IsString, IsNumber, Min } from 'class-validator';
import { Transform } from 'class-transformer';
import { SportType, AmenityType } from 'src/common/enums/sport-type.enum';

export class QueryAmenityDto {
  @ApiProperty({ 
    description: 'Loại thể thao để lọc', 
    enum: SportType, 
    required: false 
  })
  @IsOptional()
  @IsEnum(SportType)
  sportType?: SportType;

  @ApiProperty({ 
    description: 'Loại tiện ích để lọc', 
    enum: AmenityType, 
    required: false 
  })
  @IsOptional()
  @IsEnum(AmenityType)
  type?: AmenityType;

  @ApiProperty({ 
    description: 'Tìm kiếm theo tên', 
    required: false 
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiProperty({ 
    description: 'Chỉ lấy tiện ích đang hoạt động', 
    required: false, 
    default: true 
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true')
  isActive?: boolean;

  @ApiProperty({ 
    description: 'Số trang', 
    required: false, 
    default: 1, 
    minimum: 1 
  })
  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @ApiProperty({ 
    description: 'Số lượng item mỗi trang', 
    required: false, 
    default: 10, 
    minimum: 1 
  })
  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsNumber()
  @Min(1)
  limit?: number = 10;
}
