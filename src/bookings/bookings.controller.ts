import { Controller, Patch, Param, Body } from '@nestjs/common';
import { BookingsService } from './bookings.service';

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
}
