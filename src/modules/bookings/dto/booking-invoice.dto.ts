import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class BookingInvoiceDto {
  @ApiProperty({ description: 'Booking ID', example: '507f1f77bcf86cd799439011' })
  bookingId: string;

  @ApiProperty({ description: 'Field / venue name', example: 'Sân cầu lông A' })
  name: string;

  @ApiProperty({ description: 'Date of booking (ISO date)', example: '2025-11-29' })
  date: string;

  @ApiProperty({ description: 'Time range', example: '18:00 - 20:00' })
  time: string;

  @ApiProperty({ description: 'Payment amount in VND (integer, cents not used)', example: 150000 })
  payment: number;

  @ApiPropertyOptional({ description: 'Payment timestamp if available', example: '2025-11-29T12:34:56.000Z' })
  paidOn?: string | null;

  @ApiProperty({ description: 'Booking status', example: 'confirmed' })
  status: string;
}
