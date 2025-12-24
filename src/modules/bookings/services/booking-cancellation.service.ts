import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Booking } from '../entities/booking.entity';
import { BookingStatus } from '@common/enums/booking.enum';
import {
    CancelBookingPayload,
    CancelSessionBookingPayload,
} from '../interfaces/booking-service.interfaces';

/**
 * Booking Cancellation Service
 * Handles all booking cancellation operations
 * Extracted from BookingsService for better code organization
 */
@Injectable()
export class BookingCancellationService {
    private readonly logger = new Logger(BookingCancellationService.name);

    constructor(
        @InjectModel(Booking.name) private readonly bookingModel: Model<Booking>,
        private readonly eventEmitter: EventEmitter2,
    ) { }

    /**
     * Cancel field booking (legacy)
     */
    async cancelBooking(data: CancelBookingPayload) {
        const booking = await this.bookingModel.findById(data.bookingId);
        if (!booking) {
            throw new BadRequestException('Booking not found');
        }
        if (String(booking.user) !== String(data.userId)) {
            throw new BadRequestException(
                'You are not authorized to cancel this booking',
            );
        }
        booking.status = BookingStatus.CANCELLED;
        booking.cancellationReason = data.cancellationReason;
        await booking.save();

        // Emit notification with court info
        this.eventEmitter.emit('booking.cancelled', {
            bookingId: booking._id,
            userId: booking.user,
            fieldId: booking.field,
            courtId: (booking as any).court,
            date: booking.date,
            startTime: booking.startTime,
            endTime: booking.endTime,
            reason: data.cancellationReason
        });
        return booking;
    }

    /**
     * Cancel booking session (field + coach) (legacy)
     */
    async cancelSessionBooking(data: CancelSessionBookingPayload) {
        const fieldBooking = await this.bookingModel.findById(data.fieldBookingId);
        const coachBooking = await this.bookingModel.findById(data.coachBookingId);
        if (!fieldBooking || !coachBooking) {
            throw new BadRequestException('One or both bookings not found');
        }
        if (
            String(fieldBooking.user) !== String(data.userId) ||
            String(coachBooking.user) !== String(data.userId)
        ) {
            throw new BadRequestException(
                'You are not authorized to cancel these bookings',
            );
        }
        fieldBooking.status = BookingStatus.CANCELLED;
        coachBooking.status = BookingStatus.CANCELLED;
        fieldBooking.cancellationReason = data.cancellationReason;
        coachBooking.cancellationReason = data.cancellationReason;
        await fieldBooking.save();
        await coachBooking.save();

        // Emit notification with court info (for field booking)
        this.eventEmitter.emit('booking.cancelled', {
            bookingId: fieldBooking._id,
            userId: fieldBooking.user,
            fieldId: fieldBooking.field,
            courtId: (fieldBooking as any).court,
            date: fieldBooking.date,
            startTime: fieldBooking.startTime,
            endTime: fieldBooking.endTime,
            reason: data.cancellationReason
        });

        return { fieldBooking, coachBooking };
    }
}
