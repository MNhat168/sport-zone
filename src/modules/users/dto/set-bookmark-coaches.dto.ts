import { IsArray, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SetBookmarkCoachesDto {
  @ApiProperty({
    type: [String],
    example: ['64b8f1c2a1e4f2d3c4b5a6e7'],
    description: 'Danh sách coach ids (ObjectId strings) để thêm vào mục bookmark',
  })
  @IsArray()
  @IsString({ each: true })
  bookmarkCoaches: string[];
}
