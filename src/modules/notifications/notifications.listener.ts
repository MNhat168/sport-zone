import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationsService } from './notifications.service';
import { NotificationType } from 'src/common/enums/notification-type.enum';
import { Types } from 'mongoose';

@Injectable()
export class NotificationListener {
  constructor(private readonly notificationsService: NotificationsService) {}

  @OnEvent('booking.status.updated')
  async handleBookingStatusUpdated(payload: {
    bookingId: string;
    userId: string;
    coachId: string;
    status: 'accepted' | 'declined';
  }) {
    const type =
    payload.status === 'accepted'
      ? NotificationType.BOOKING_CONFIRMED
      : NotificationType.BOOKING_CANCELLED;
    const title =
      payload.status === 'accepted'
        ? 'Booking Accepted'
        : 'Booking Declined';

    const message =
      payload.status === 'accepted'
        ? 'Your coach has accepted your booking.'
        : 'Your coach has declined your booking.';

    await this.notificationsService.create({
      recipient: new Types.ObjectId(payload.userId), 
      type,
      title,
      message,
      metadata: { bookingId: payload.bookingId, coachId: payload.coachId },
    });
  }
}