import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO cho việc tạo lesson type mới
 */
export class CreateLessonTypeDto {
  /**
   * Loại lesson
   * @example "single"
   */
  @ApiProperty({ 
    example: 'single',
    description: 'Loại lesson (single, pair, group)',
    enum: ['single', 'pair', 'group']
  })
  @IsString()
  @IsNotEmpty()
  type: string;

  /**
   * Tên lesson type
   * @example "Tennis Basic"
   */
  @ApiProperty({ 
    example: 'Tennis Basic',
    description: 'Tên của lesson type'
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  /**
   * Mô tả lesson type
   * @example "Basic tennis lesson for beginners"
   */
  @ApiProperty({ 
    example: 'Basic tennis lesson for beginners',
    description: 'Mô tả chi tiết về lesson type'
  })
  @IsString()
  @IsNotEmpty()
  description: string;
}