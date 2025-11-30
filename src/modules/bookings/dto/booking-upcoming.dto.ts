import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO for upcoming appointment card
 */
export class BookingUpcomingDto {
  @ApiProperty({ example: '64a1f7a2b8e4f3c9d0e1f234', description: 'Booking ID' })
  bookingId: string;

  @ApiProperty({ example: 'Học viện thể thao Leap', description: 'Academy / owner name' })
  academyName: string;

  @ApiProperty({ example: 'Sân 1', description: 'Field / court name' })
  fieldName: string;

  @ApiProperty({ example: '2025-11-30', description: 'Booking date (YYYY-MM-DD)' })
  date: string;

  @ApiProperty({ example: '18:00 đến 20:00', description: 'Time range' })
  time: string;
}
