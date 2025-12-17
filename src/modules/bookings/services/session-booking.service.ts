import { Injectable, NotFoundException, BadRequestException, Logger, InternalServerErrorException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Booking } from '../entities/booking.entity';
import { BookingStatus, BookingType } from '@common/enums/booking.enum';
import { CoachesService } from '../../coaches/coaches.service';
import { FieldsService } from '../../fields/fields.service';
import {
  CreateSessionBookingPayload,
  CancelSessionBookingPayload,
} from '../interfaces/booking-service.interfaces';

/**
 * Session Booking Service
 * Handles coach session bookings (field + coach combo)
 */
@Injectable()
export class SessionBookingService {
  private readonly logger = new Logger(SessionBookingService.name);

  constructor(
    @InjectModel(Booking.name) private readonly bookingModel: Model<Booking>,
    private readonly eventEmitter: EventEmitter2,
    private readonly coachesService: CoachesService,
    private readonly fieldsService: FieldsService,
  ) {}

  /**
   * Get bookings by requested coach ID
   */
  async getByRequestedCoachId(coachId: string): Promise<Booking[]> {
    // Validate ObjectId format to prevent BSONError
    if (!coachId || !Types.ObjectId.isValid(coachId)) {
      throw new BadRequestException(`Invalid coach ID format: "${coachId}". Coach ID must be a valid MongoDB ObjectId.`);
    }

    const bookings = await this.bookingModel
      .find({ requestedCoach: new Types.ObjectId(coachId) })
      .populate('user')
      .populate('field')
      .lean()
      .exec();

    return bookings as unknown as Booking[];
  }

  /**
   * Accept a booking request for a coach
   */
  async acceptCoachRequest(coachId: string, bookingId: string): Promise<Booking> {
    // Validate ObjectId formats to prevent BSONError
    if (!coachId || !Types.ObjectId.isValid(coachId)) {
      throw new BadRequestException(`Invalid coach ID format: "${coachId}". Coach ID must be a valid MongoDB ObjectId.`);
    }
    if (!bookingId || !Types.ObjectId.isValid(bookingId)) {
      throw new BadRequestException(`Invalid booking ID format: "${bookingId}". Booking ID must be a valid MongoDB ObjectId.`);
    }

    const booking = await this.bookingModel.findOne({
      _id: new Types.ObjectId(bookingId),
      requestedCoach: new Types.ObjectId(coachId),
    });

    if (!booking) {
      throw new NotFoundException('Booking not found or not assigned to this coach');
    }
    
    if (booking.coachStatus !== 'pending') {
      throw new BadRequestException('Booking already responded');
    }

    const coach = await this.coachesService.getCoachById(coachId);
    const field = booking.field ? await this.fieldsService.findOne(booking.field.toString()) : null;

    try {
      this.eventEmitter.emit('booking.coach.accept', {
        bookingId: booking.id.toString(),
        userId: booking.user.toString(),
        coachId,
        fieldId: booking.field?.toString(),
        date: booking.date.toISOString().split('T')[0],
        startTime: booking.startTime,
        endTime: booking.endTime,
        coachName: coach?.fullName,
        fieldName: field?.name,
        fieldLocation: field?.location,
      });

      booking.coachStatus = 'accepted';
      await booking.save();
    } catch (err) {
      throw new InternalServerErrorException('Failed to process booking acceptance');
    }

    return booking;
  }

  /**
   * Decline a booking request for a coach
   */
  async declineCoachRequest(
    coachId: string,
    bookingId: string,
    reason?: string,
  ): Promise<Booking> {
    // Validate ObjectId formats to prevent BSONError
    if (!coachId || !Types.ObjectId.isValid(coachId)) {
      throw new BadRequestException(`Invalid coach ID format: "${coachId}". Coach ID must be a valid MongoDB ObjectId.`);
    }
    if (!bookingId || !Types.ObjectId.isValid(bookingId)) {
      throw new BadRequestException(`Invalid booking ID format: "${bookingId}". Booking ID must be a valid MongoDB ObjectId.`);
    }

    const booking = await this.bookingModel.findOne({
      _id: new Types.ObjectId(bookingId),
      requestedCoach: new Types.ObjectId(coachId),
    });

    if (!booking) {
      throw new NotFoundException('Booking not found or not assigned to this coach');
    }

    if (booking.coachStatus !== 'pending') {
      throw new BadRequestException('Booking already responded');
    }

    const coach = await this.coachesService.getCoachById(coachId);
    const field = booking.field ? await this.fieldsService.findOne(booking.field.toString()) : null;

    try {
      this.eventEmitter.emit('booking.coach.decline', {
        bookingId: booking.id.toString(),
        userId: booking.user.toString(),
        coachId,
        fieldId: booking.field?.toString(),
        date: booking.date.toISOString().split('T')[0],
        startTime: booking.startTime,
        endTime: booking.endTime,
        reason,
        coachName: coach?.fullName,
        fieldName: field?.name,
        fieldLocation: field?.location,
      });

      booking.coachStatus = 'declined';
      if (reason) booking.cancellationReason = reason;
      await booking.save();
    } catch (err) {
      throw new InternalServerErrorException('Failed to process booking decline');
    }

    return booking;
  }

  /**
   * Create booking session (field + coach) - LEGACY
   */
  async createSessionBooking(data: CreateSessionBookingPayload): Promise<{
    fieldBooking: Booking;
    coachBooking: Booking;
  }> {
    if (
      !data.user ||
      !data.field ||
      !data.coach ||
      !data.date ||
      !data.fieldStartTime ||
      !data.fieldEndTime ||
      !data.coachStartTime ||
      !data.coachEndTime ||
      data.fieldPrice < 0 ||
      data.coachPrice < 0
    ) {
      throw new BadRequestException('Missing or invalid session booking data');
    }

    // Create field booking
    const fieldBooking = new this.bookingModel({
      user: data.user,
      field: data.field,
      date: data.date,
      startTime: data.fieldStartTime,
      endTime: data.fieldEndTime,
      type: BookingType.FIELD,
      status: BookingStatus.CONFIRMED,
      totalPrice: data.fieldPrice,
    });

    // Create coach booking
    const coachBooking = new this.bookingModel({
      user: data.user,
      field: data.field,
      requestedCoach: data.coach,
      date: data.date,
      startTime: data.coachStartTime,
      endTime: data.coachEndTime,
      type: BookingType.COACH,
      status: BookingStatus.CONFIRMED,
      totalPrice: data.coachPrice,
    });

    await fieldBooking.save();
    await coachBooking.save();

    return { fieldBooking, coachBooking };
  }

  /**
   * Cancel booking session (field + coach) - LEGACY
   */
  async cancelSessionBooking(data: CancelSessionBookingPayload): Promise<{
    fieldBooking: Booking;
    coachBooking: Booking;
  }> {
    const fieldBooking = await this.bookingModel.findById(data.fieldBookingId);
    const coachBooking = await this.bookingModel.findById(data.coachBookingId);

    if (!fieldBooking || !coachBooking) {
      throw new BadRequestException('One or both bookings not found');
    }

    if (
      String(fieldBooking.user) !== String(data.userId) ||
      String(coachBooking.user) !== String(data.userId)
    ) {
      throw new BadRequestException('You are not authorized to cancel these bookings');
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
