import { ApiProperty } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateCourtDto {
  @ApiProperty({ example: 'Court A', description: 'Tên court' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiProperty({ example: 1, description: 'Số thứ tự court trong sân', minimum: 1 })
  @IsInt()
  @Min(1)
  courtNumber: number;
}

