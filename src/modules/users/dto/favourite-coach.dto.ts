import { ApiProperty } from '@nestjs/swagger';

export class FavouriteCoachDto {
  @ApiProperty({ example: '507f1f77bcf86cd799439011', description: 'Coach user id' })
  _id: string;

  @ApiProperty({ example: 'Nguyen Van A', description: 'Coach full name' })
  name: string;

  @ApiProperty({ example: 'https://s3.amazonaws.com/.../avatar.jpg', description: 'Coach avatar url', nullable: true })
  avatar: string | null;

  @ApiProperty({ example: 23, description: 'Total bookings for this coach' })
  totalBookings: number;
}
