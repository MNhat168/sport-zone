import { Controller, Patch, Param, Body, Get } from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { Booking } from './entities/booking.entity';

@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) { }

  @Patch(':id/coach-status')
  async setCoachStatus(
    @Param('id') bookingId: string,
    @Body() body: { coachId: string; status: 'accepted' | 'declined' },
  ) {
    return this.bookingsService.updateCoachStatus(
      bookingId,
      body.coachId,
      body.status,
    );
  }

  @Get('coach/:coachId')
async getBookingsByCoachId(@Param('coachId') coachId: string): Promise<Booking[]> {
    return this.bookingsService.getByRequestedCoachId(coachId);
}
}
