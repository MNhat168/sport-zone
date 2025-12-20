import { IsString, IsNotEmpty, IsMongoId, IsNumber, IsPositive } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

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

  /**
   * Field id that this lesson type belongs to
   * @example "507f1f77bcf86cd799439011"
   */
  @ApiProperty({
    example: '507f1f77bcf86cd799439011',
    description: 'Field ID this lesson belongs to'
  })
  @IsMongoId()
  @IsNotEmpty()
  field: string;

  /**
   * Lesson price in smallest currency unit (e.g., VND)
   * @example 150000
   */
  @ApiProperty({
    example: 150000,
    description: 'Price for lesson in smallest currency unit'
  })
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  lessonPrice: number;
}