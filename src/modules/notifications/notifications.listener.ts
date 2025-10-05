import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationsService } from './notifications.service';
import { NotificationType } from 'src/common/enums/notification-type.enum';
import { Types } from 'mongoose';

@Injectable()
export class NotificationListener {
  constructor(
    private readonly notificationsService: NotificationsService,
  ) { }

  @OnEvent('booking.coach.accept')
  async handleBookingAccepted(payload: {
    bookingId: string;
    userId: string;
    coachId: string;
    coachName?: string;
    fieldId?: string;
    fieldName?: string;
    fieldLocation?: string;
    date?: string;     
    startTime?: string;
    endTime?: string;
  }) {
    const messageParts = [
      payload.coachName ? `${payload.coachName}` : 'Your coach',
      'has accepted your booking request',
    ];

    if (payload.startTime && payload.endTime && payload.date) {
      messageParts.push(`from ${payload.startTime} to ${payload.endTime} on ${payload.date}`);
    }

    if (payload.fieldName && payload.fieldLocation) {
      messageParts.push(`at ${payload.fieldName} (${payload.fieldLocation})`);
    }

    const message = messageParts.join(' ') + '.';

    await this.notificationsService.create({
      recipient: new Types.ObjectId(payload.userId),
      type: NotificationType.BOOKING_CONFIRMED,
      title: 'Booking Accepted',
      message,
      metadata: {
        bookingId: payload.bookingId,
        coachId: payload.coachId,
        fieldId: payload.fieldId || null,
      },
    });
  }

  // Handle coach declining a booking
  @OnEvent('booking.coach.decline')
  async handleBookingDeclined(payload: {
    bookingId: string;
    userId: string;
    coachId: string;
    coachName?: string;
    fieldId?: string;
    fieldName?: string;
    fieldLocation?: string;
    date?: string;
    startTime?: string;
    endTime?: string;
    reason?: string;
  }) {
    const messageParts = [
      payload.coachName ? `${payload.coachName}` : 'Your coach',
      'has declined your booking request',
    ];

    if (payload.startTime && payload.endTime && payload.date) {
      messageParts.push(`from ${payload.startTime} to ${payload.endTime} on ${payload.date}`);
    }

    if (payload.fieldName && payload.fieldLocation) {
      messageParts.push(`at ${payload.fieldName} (${payload.fieldLocation})`);
    }

    if (payload.reason) {
      messageParts.push(`Reason: ${payload.reason}`);
    }

    const message = messageParts.join(' ') + '.';

    await this.notificationsService.create({
      recipient: new Types.ObjectId(payload.userId),
      type: NotificationType.BOOKING_CANCELLED,
      title: 'Booking Declined',
      message,
      metadata: {
        bookingId: payload.bookingId,
        coachId: payload.coachId,
        fieldId: payload.fieldId || null,
        reason: payload.reason || null,
      },
    });
  }

  //for accepted booking that was affect in holiday set by coach
  @OnEvent('schedule.holiday.set')
  async handleScheduleHoliday(payload: {
    bookingId: string;
    userId: string;
    scheduleId: string;
    slot: string;
    date: Date;
  }) {
    const message = `Your booking for ${payload.date.toISOString().slice(0, 10)} at ${payload.slot} has been cancelled due to holiday.`;

    await this.notificationsService.create({
      recipient: new Types.ObjectId(payload.userId),
      type: NotificationType.BOOKING_CANCELLED,
      title: 'Booking Cancelled',
      message,
      metadata: {
        bookingId: payload.bookingId,
        scheduleId: payload.scheduleId,
        slot: payload.slot,
        date: payload.date,
      },
    });
  }
}