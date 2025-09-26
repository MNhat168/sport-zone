import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Booking, BookingType, BookingStatus } from './entities/booking.entity';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class BookingsService {
  constructor(
    @InjectModel(Booking.name)
    private readonly bookingModel: Model<Booking>,
    private eventEmitter: EventEmitter2,
  ) { }

  async updateCoachStatus(
    bookingId: string,
    coachId: string,
    newStatus: 'accepted' | 'declined',
  ) {
    if (!Types.ObjectId.isValid(bookingId) || !Types.ObjectId.isValid(coachId)) {
      throw new BadRequestException('Invalid ID format');
    }

    const booking = await this.bookingModel.findOne({
      _id: new Types.ObjectId(bookingId),
      requestedCoach: new Types.ObjectId(coachId),
    });

    if (!booking) {
      throw new NotFoundException('Booking not found for this coach');
    }

    if (booking.coachStatus !== 'pending') {
      throw new BadRequestException(
        `Coach status is already "${booking.coachStatus}"`,
      );
    }

    booking.coachStatus = newStatus;
    await booking.save();

    //create notification event
    this.eventEmitter.emit('booking.status.updated', {
      bookingId,
      userId: booking.user,
      coachId,
      status: newStatus,
    });

    return booking;
  }

  async getByRequestedCoachId(coachId: string): Promise<Booking[]> {
    return this.bookingModel
      .find({ requestedCoach: new Types.ObjectId(coachId) })
      .populate('user')
      .populate('schedule')
      //.populate('payment')
      .populate('requestedCoach')
      .exec();
  }

  //Create field booking service
  async createFieldBooking(data: {
    user: string;
    schedule: string;
    slot: string;
    totalPrice: number;
  }) {
    if (!data.user || !data.schedule || !data.slot || data.totalPrice < 0) {
      throw new BadRequestException('Missing or invalid booking data');
    }
    const booking = new this.bookingModel({
      user: data.user,
      schedule: data.schedule,
      slot: data.slot,
      type: BookingType.FIELD,
      status: BookingStatus.PENDING,
      totalPrice: data.totalPrice,
    });
    await booking.save();
    return booking;
  }

  // Create booking session service (field + coach)
  async createSessionBooking(data: {
    user: string;
    fieldSchedule: string;
    coachSchedule: string;
    fieldSlot: string;
    coachSlot: string;
    fieldPrice: number;
    coachPrice: number;
  }) {
    if (
      !data.user ||
      !data.fieldSchedule ||
      !data.coachSchedule ||
      !data.fieldSlot ||
      !data.coachSlot ||
      data.fieldPrice < 0 ||
      data.coachPrice < 0
    ) {
      throw new BadRequestException('Missing or invalid session booking data');
    }
    // Create field booking
    const fieldBooking = new this.bookingModel({
      user: data.user,
      schedule: data.fieldSchedule,
      slot: data.fieldSlot,
      type: BookingType.FIELD,
      status: BookingStatus.PENDING,
      totalPrice: data.fieldPrice,
    });
    // Create coach booking
    const coachBooking = new this.bookingModel({
      user: data.user,
      schedule: data.coachSchedule,
      slot: data.coachSlot,
      type: BookingType.COACH,
      status: BookingStatus.PENDING,
      totalPrice: data.coachPrice,
    });
    await fieldBooking.save();
    await coachBooking.save();
    return { fieldBooking, coachBooking };
  }

  // Cancel field booking service
  async cancelBooking(data: {
    bookingId: string;
    userId: string;
    cancellationReason?: string;
  }) {
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
    return booking;
  }

  // Cancel booking session service (field + coach)
  async cancelSessionBooking(data: {
    fieldBookingId: string;
    coachBookingId: string;
    userId: string;
    cancellationReason?: string;
  }) {
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
    return { fieldBooking, coachBooking };
  }
}
