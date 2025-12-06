import { ApiProperty } from '@nestjs/swagger';
import { IsArray, ArrayNotEmpty, IsMongoId, ArrayMinSize } from 'class-validator';

export class SetFavouriteFieldsDto {
  @ApiProperty({
    description: 'Array of field IDs to add to favourites',
    example: ['64a7f1f77bcf86cd79943901', '64a7f1f77bcf86cd79943902'],
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMinSize(1)
  @IsMongoId({ each: true })
  favouriteFields: string[];
}
