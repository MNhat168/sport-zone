import {
  Controller,
  Patch,
  Param,
  Body,
  Get,
  Post,
  Request,
  UseGuards,
  BadRequestException 
} from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { Booking } from './entities/booking.entity';
import { CancelBookingDto } from './dto/cancel-booking.dto';
import { CreateFieldBookingDto } from './dto/create-field-booking.dto';
import { CreateSessionBookingDto } from './dto/create-session-booking.dto';
import { CancelSessionBookingDto } from './dto/cancel-session-booking.dto';
import { AuthGuard } from '@nestjs/passport';

@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) { }

  //accept decline coaching book
  @Patch(':id/coach-status')
  async setCoachStatus(
    @Param('id') bookingId: string,
    @Body() body: { coachId: string; status: 'accepted' | 'declined' },
  ) {
    if (!body || !body.coachId || !body.status) {
      throw new BadRequestException('coachId and status are required');
    }
    
    return this.bookingsService.updateCoachStatus(
      bookingId,
      body.coachId,
      body.status,
    );
  }

  //get all bookings of a coach
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
      startTime: body.startTime,
      endTime: body.endTime,
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
      fieldStartTime: body.fieldStartTime,
      fieldEndTime: body.fieldEndTime,
      coachStartTime: body.coachStartTime,
      coachEndTime: body.coachEndTime,
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
