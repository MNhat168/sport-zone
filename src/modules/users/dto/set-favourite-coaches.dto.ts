import { IsArray, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SetFavouriteCoachesDto {
  @ApiProperty({
    type: [String],
    example: ['64b8f1c2a1e4f2d3c4b5a6e7'],
    description: 'Danh sách coach ids (ObjectId strings) để thêm vào mục yêu thích',
  })
  @IsArray()
  @IsString({ each: true })
  favouriteCoaches: string[];
}
