import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class UpdateCourtDto {
  @ApiPropertyOptional({ example: 'Court B', description: 'Tên court' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ example: 2, description: 'Số thứ tự court trong sân', minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  courtNumber?: number;

  @ApiPropertyOptional({ description: 'Kích hoạt / vô hiệu hóa court' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

