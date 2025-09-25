import {
  Controller,
  Patch,
  Param,
  Body,
  Get,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { Booking } from './entities/booking.entity';
import { AuthGuard } from '@nestjs/passport';

export class CancelBookingDto {
  cancellationReason?: string;
}

export class CreateFieldBookingDto {
  scheduleId: string;
  slot: string;
  totalPrice: number;
}

export class CreateSessionBookingDto {
  fieldScheduleId: string;
  coachScheduleId: string;
  fieldSlot: string;
  coachSlot: string;
  fieldPrice: number;
  coachPrice: number;
}

export class CancelSessionBookingDto {
  fieldBookingId: string;
  coachBookingId: string;
  cancellationReason?: string;
}

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

// Create field booking
  @UseGuards(AuthGuard('jwt'))
  @Post('field')
  async createFieldBooking(
    @Request() req,
    @Body() body: CreateFieldBookingDto,
  ) {
    const userId = req.user._id || req.user.id;
    return this.bookingsService.createFieldBooking({
      user: userId,
      schedule: body.scheduleId,
      slot: body.slot,
      totalPrice: body.totalPrice,
    });
  }

  // Cancel field booking
  @UseGuards(AuthGuard('jwt'))
  @Patch(':id/cancel')
  async cancelBooking(
    @Request() req,
    @Param('id') bookingId: string,
    @Body() body: CancelBookingDto,
  ) {
    const userId = req.user._id || req.user.id;
    return this.bookingsService.cancelBooking({
      bookingId,
      userId,
      cancellationReason: body.cancellationReason,
    });
  }

  // Create booking session (field + coach)
  @UseGuards(AuthGuard('jwt'))
  @Post('session')
  async createSessionBooking(
    @Request() req,
    @Body() body: CreateSessionBookingDto,
  ) {
    const userId = req.user._id || req.user.id;
    return this.bookingsService.createSessionBooking({
      user: userId,
      fieldSchedule: body.fieldScheduleId,
      coachSchedule: body.coachScheduleId,
      fieldSlot: body.fieldSlot,
      coachSlot: body.coachSlot,
      fieldPrice: body.fieldPrice,
      coachPrice: body.coachPrice,
    });
  }

  // Cancel booking session (field + coach)
  @UseGuards(AuthGuard('jwt'))
  @Patch('session/cancel')
  async cancelSessionBooking(
    @Request() req,
    @Body() body: CancelSessionBookingDto,
  ) {
    const userId = req.user._id || req.user.id;
    return this.bookingsService.cancelSessionBooking({
      fieldBookingId: body.fieldBookingId,
      coachBookingId: body.coachBookingId,
      userId,
      cancellationReason: body.cancellationReason,
    });
  }
}
