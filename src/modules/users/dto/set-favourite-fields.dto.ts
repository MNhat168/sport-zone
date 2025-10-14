import { IsArray, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SetFavouriteFieldsDto {
  @ApiProperty({
    type: [String],
    example: ['football', 'badminton'],
    description: 'Danh sách các môn thể thao yêu thích',
  })
  @IsArray()
  @IsString({ each: true })
  favouriteFields: string[];
}
