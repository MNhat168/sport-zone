import { IsArray, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SetFavouriteSportsDto {
  @ApiProperty({
    type: [String],
    example: ['football', 'badminton'],
    description: 'Danh sách các môn thể thao yêu thích',
  })
  @IsArray()
  @IsString({ each: true })
  favouriteSports: string[];
}
