import { Injectable, NotFoundException, BadRequestException, Logger, InternalServerErrorException } from '@nestjs/common';
import { InjectModel, InjectConnection } from '@nestjs/mongoose';
import { Model, Types, Connection, ClientSession } from 'mongoose';
import { Booking, BookingStatus, BookingType } from './entities/booking.entity';
import { Schedule } from '../schedules/entities/schedule.entity';
import { Field } from '../fields/entities/field.entity';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PaymentsService } from '../payments/payments.service';
import { FieldsService } from '../fields/fields.service';
import { CoachesService } from '../coaches/coaches.service';
import { PaymentMethod } from 'src/common/enums/payment-method.enum';
import { CreateFieldBookingLazyDto, FieldAvailabilityQueryDto } from './dto/create-field-booking-lazy.dto';
import {
  CancelBookingPayload,
  CancelSessionBookingPayload,
  CreateFieldBookingPayload,
  CreateSessionBookingPayload,
} from './interfaces/booking-service.interfaces';

/**
 * Interface for availability slot
 */
export interface AvailabilitySlot {
  startTime: string;
  endTime: string;
  available: boolean;
  price: number;
  priceBreakdown?: string;
}

/**
 * Interface for daily availability
 */
export interface DailyAvailability {
  date: string;
  isHoliday: boolean;
  holidayReason?: string;
  slots: AvailabilitySlot[];
}

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  constructor(
    @InjectModel(Booking.name) private readonly bookingModel: Model<Booking>,
    @InjectModel(Schedule.name) private readonly scheduleModel: Model<Schedule>,
    @InjectModel(Field.name) private readonly fieldModel: Model<Field>,
    @InjectConnection() private readonly connection: Connection,
    private eventEmitter: EventEmitter2,
    private readonly paymentsService: PaymentsService,
    private readonly fieldsService: FieldsService,
    private readonly coachesService: CoachesService,

  ) { }



  // ============================================================================
  // PURE LAZY CREATION METHODS (NEW)
  // ============================================================================

  /**
   * Get field availability using Pure Lazy Creation
   * Generates virtual slots from Field config, applies Schedule constraints if exists
   */
  async getFieldAvailability(
    fieldId: string,
    query: FieldAvailabilityQueryDto
  ): Promise<DailyAvailability[]> {
    try {
      // Validate fieldId
      if (!Types.ObjectId.isValid(fieldId)) {
        throw new BadRequestException('Invalid field ID format');
      }

      // Fetch Field config (master source of truth)
      const field = await this.fieldModel.findById(fieldId).exec();
      if (!field || !field.isActive) {
        throw new NotFoundException('Field not found or inactive');
      }

      const startDate = new Date(query.startDate);
      const endDate = new Date(query.endDate);

      // Validate date range (max 30 days to prevent overload)
      const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      if (daysDiff > 30) {
        throw new BadRequestException('Date range cannot exceed 30 days');
      }

      // Query existing Schedules in range (may be empty for Pure Lazy)
      const schedules = await this.scheduleModel
        .find({
          field: new Types.ObjectId(fieldId),
          date: { $gte: startDate, $lte: endDate }
        })
        .exec();

      // Create schedule map for quick lookup
      const scheduleMap = new Map<string, Schedule>();
      schedules.forEach(schedule => {
        const dateKey = schedule.date.toISOString().split('T')[0];
        scheduleMap.set(dateKey, schedule);
      });

      const result: DailyAvailability[] = [];

      // Generate availability for each day in range
      for (let currentDate = new Date(startDate); currentDate <= endDate; currentDate.setDate(currentDate.getDate() + 1)) {
        const dateKey = currentDate.toISOString().split('T')[0];
        const schedule = scheduleMap.get(dateKey);

        // Generate virtual slots from Field config
        const virtualSlots = this.generateVirtualSlots(field, currentDate);
        
        // Apply schedule constraints if exists
        const availableSlots = schedule 
          ? await this.applyScheduleConstraints(virtualSlots, schedule, field, currentDate)
          : await this.getAvailabilityWithBookings(virtualSlots, field, currentDate);

        result.push({
          date: dateKey,
          isHoliday: schedule?.isHoliday || false,
          holidayReason: schedule?.holidayReason,
          slots: availableSlots
        });
      }

      this.logger.log(`Generated availability for field ${fieldId}, ${result.length} days`);
      return result;

    } catch (error) {
      this.logger.error('Error getting field availability', error);
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to retrieve field availability');
    }
  }

  /**
   * Create field booking with Pure Lazy Creation pattern
   * Uses atomic upsert for Schedule creation
   */
  async createFieldBookingLazy(
    userId: string,
    bookingData: CreateFieldBookingLazyDto
  ): Promise<Booking> {
    const session: ClientSession = await this.connection.startSession();

    try {
      return await session.withTransaction(async () => {
        // Validate field
        const field = await this.fieldModel.findById(bookingData.fieldId).session(session);
        if (!field || !field.isActive) {
          throw new NotFoundException('Field not found or inactive');
        }

        // Parse booking date
        const bookingDate = new Date(bookingData.date);

        // Validate time slots
        this.validateTimeSlots(bookingData.startTime, bookingData.endTime, field, bookingDate);
        
        // Calculate slots and pricing
        const numSlots = this.calculateNumSlots(bookingData.startTime, bookingData.endTime, field.slotDuration);
        const pricingInfo = this.calculatePricing(bookingData.startTime, bookingData.endTime, field, bookingDate);

        // Atomic upsert Schedule (Pure Lazy Creation)
        const scheduleUpdate = await this.scheduleModel.findOneAndUpdate(
          {
            field: new Types.ObjectId(bookingData.fieldId),
            date: bookingDate
          },
          {
            $setOnInsert: {
              field: new Types.ObjectId(bookingData.fieldId),
              date: bookingDate,
              bookedSlots: [],
              isHoliday: false,
              version: 0
            }
          },
          {
            upsert: true,
            new: true,
            session
          }
        ).exec();

        // Validate slot availability and not holiday
        if (scheduleUpdate.isHoliday) {
          throw new BadRequestException(`Cannot book on holiday: ${scheduleUpdate.holidayReason}`);
        }

        // Check slot conflicts
        const hasConflict = this.checkSlotConflict(
          bookingData.startTime,
          bookingData.endTime,
          scheduleUpdate.bookedSlots
        );

        if (hasConflict) {
          throw new BadRequestException('Selected time slots are not available');
        }

        // Calculate amenities fee if provided
        let amenitiesFee = 0;
        if (bookingData.selectedAmenities && bookingData.selectedAmenities.length > 0) {
          // TODO: Calculate amenities fee from Amenity model
          amenitiesFee = 0; // Placeholder
        }

        // Create Booking with snapshot data
        const booking = new this.bookingModel({
          user: new Types.ObjectId(userId),
          field: new Types.ObjectId(bookingData.fieldId),
          date: bookingDate,
          type: BookingType.FIELD,
          startTime: bookingData.startTime,
          endTime: bookingData.endTime,
          numSlots,
          status: BookingStatus.PENDING,
          totalPrice: pricingInfo.totalPrice + amenitiesFee,
          amenitiesFee,
          selectedAmenities: bookingData.selectedAmenities?.map(id => new Types.ObjectId(id)) || [],
          pricingSnapshot: {
            basePrice: field.basePrice,
            appliedMultiplier: pricingInfo.multiplier,
            priceBreakdown: pricingInfo.breakdown
          }
        });

        await booking.save({ session });

        // Create Payment record using PaymentsService
        const payment = await this.paymentsService.createPayment({
          bookingId: (booking._id as Types.ObjectId).toString(),
          userId: userId,
          amount: booking.totalPrice,
          method: bookingData.paymentMethod ?? PaymentMethod.CASH,
          paymentNote: bookingData.paymentNote
        });

        // Update booking with payment reference
        booking.payment = payment._id as Types.ObjectId;
        await booking.save({ session });

        // Update Schedule with new booked slot and increment version
        await this.scheduleModel.findByIdAndUpdate(
          scheduleUpdate._id,
          {
            $push: {
              bookedSlots: {
                startTime: bookingData.startTime,
                endTime: bookingData.endTime
              }
            },
            $inc: { version: 1 }
          },
          { session }
        ).exec();

        this.logger.log(`Created booking ${booking._id} for field ${bookingData.fieldId} on ${bookingData.date}`);

        // Emit event for notifications
        this.eventEmitter.emit('booking.created', {
          bookingId: booking._id,
          userId,
          fieldId: bookingData.fieldId,
          date: bookingData.date,
          startTime: bookingData.startTime,
          endTime: bookingData.endTime
        });

        return booking;
      });

    } catch (error) {
      this.logger.error('Error creating field booking', error);
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to create booking');
    } finally {
      await session.endSession();
    }
  }

  /**
   * Mark holiday with Pure Lazy Creation
   * Upserts Schedule and handles affected bookings
   */
  async markHoliday(
    fieldId: string,
    date: string,
    reason: string
  ): Promise<{ schedule: Schedule; affectedBookings: Booking[] }> {
    const session: ClientSession = await this.connection.startSession();

    try {
      return await session.withTransaction(async () => {
        // Validate field
        const field = await this.fieldModel.findById(fieldId).session(session);
        if (!field) {
          throw new NotFoundException('Field not found');
        }

        const holidayDate = new Date(date);

        // Atomic upsert Schedule for holiday
        const schedule = await this.scheduleModel.findOneAndUpdate(
          {
            field: new Types.ObjectId(fieldId),
            date: holidayDate
          },
          {
            $set: {
              isHoliday: true,
              holidayReason: reason
            },
            $setOnInsert: {
              field: new Types.ObjectId(fieldId),
              date: holidayDate,
              bookedSlots: [],
              version: 0
            },
            $inc: { version: 1 }
          },
          {
            upsert: true,
            new: true,
            session
          }
        ).exec();

        // Query affected bookings
        const affectedBookings = await this.bookingModel
          .find({
            field: new Types.ObjectId(fieldId),
            date: holidayDate,
            status: { $in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] }
          })
          .session(session)
          .exec();

        // Apply cancellation policy for affected bookings
        for (const booking of affectedBookings) {
          booking.status = BookingStatus.CANCELLED;
          booking.cancellationReason = `Holiday: ${reason}`;
          booking.holidayNotified = true;
          await booking.save({ session });

          // Emit notification event
          this.eventEmitter.emit('booking.cancelled.holiday', {
            bookingId: booking._id,
            userId: booking.user,
            fieldId,
            date,
            reason
          });
        }

        // Clear booked slots since all bookings are cancelled
        if (affectedBookings.length > 0) {
          schedule.bookedSlots = [];
          await schedule.save({ session });
        }

        this.logger.log(`Marked holiday for field ${fieldId} on ${date}, affected ${affectedBookings.length} bookings`);

        return { schedule, affectedBookings };
      });

    } catch (error) {
      this.logger.error('Error marking holiday', error);
      throw new InternalServerErrorException('Failed to mark holiday');
    } finally {
      await session.endSession();
    }
  }


  /**
   * Accept a booking request for a coach
   */
  async acceptCoachRequest(coachId: string, bookingId: string): Promise<Booking> {
    const booking = await this.bookingModel.findOne({
      _id: new Types.ObjectId(bookingId),
      requestedCoach: new Types.ObjectId(coachId),
    });

    if (!booking) throw new NotFoundException('Booking not found or not assigned to this coach');
    if (booking.coachStatus !== 'pending') throw new BadRequestException('Booking already responded');

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

  async getByRequestedCoachId(coachId: string): Promise<Booking[]> {
    const bookings = await this.bookingModel
      .find({ requestedCoach: new Types.ObjectId(coachId) })
      .populate('user')
      .populate('field')
      .lean()
      .exec();

    return bookings;
  }

  // ============================================================================
  // LEGACY/BACKWARD COMPATIBILITY METHODS
  // ============================================================================

  //Create field booking service (legacy - updated for Pure Lazy Creation)
  async createFieldBooking(data: CreateFieldBookingPayload) {
    if (!data.user || !data.field || !data.date || !data.startTime || !data.endTime || data.totalPrice < 0) {
      throw new BadRequestException('Missing or invalid booking data');
    }
    const booking = new this.bookingModel({
      user: data.user,
      field: data.field,
      date: data.date,
      startTime: data.startTime,
      endTime: data.endTime,
      type: BookingType.FIELD,
      status: BookingStatus.PENDING,
      totalPrice: data.totalPrice,
    });
    await booking.save();
    return booking;
  }

  // Create booking session service (field + coach) (legacy - updated for Pure Lazy Creation)
  async createSessionBooking(data: CreateSessionBookingPayload) {
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
      status: BookingStatus.PENDING,
      totalPrice: data.fieldPrice,
    });
    // Create coach booking
    const coachBooking = new this.bookingModel({
      user: data.user,
      field: data.field,  // Coach bookings also need field reference
      requestedCoach: data.coach, // Set the coach ID
      date: data.date,
      startTime: data.coachStartTime,
      endTime: data.coachEndTime,
      type: BookingType.COACH,
      status: BookingStatus.PENDING,
      totalPrice: data.coachPrice,
    });
    await fieldBooking.save();
    await coachBooking.save();
    return { fieldBooking, coachBooking };
  }

  // Cancel field booking service (legacy)
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
    return booking;
  }

  // Cancel booking session service (field + coach) (legacy)
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
    return { fieldBooking, coachBooking };
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  /**
   * Generate virtual slots from Field configuration
   */
  private generateVirtualSlots(field: Field, date?: Date): Omit<AvailabilitySlot, 'available'>[] {
    const slots: Omit<AvailabilitySlot, 'available'>[] = [];
    
    // Get day of week for the date (default to monday if no date provided)
    const dayOfWeek = date ? this.getDayOfWeek(date) : 'monday';
    
    // Find operating hours for the specific day
    const dayOperatingHours = field.operatingHours.find(oh => oh.day === dayOfWeek);
    if (!dayOperatingHours) {
      return slots; // No operating hours for this day
    }

    const startHour = parseInt(dayOperatingHours.start.split(':')[0]);
    const startMinute = parseInt(dayOperatingHours.start.split(':')[1]);
    const endHour = parseInt(dayOperatingHours.end.split(':')[0]);
    const endMinute = parseInt(dayOperatingHours.end.split(':')[1]);

    const startMinutes = startHour * 60 + startMinute;
    const endMinutes = endHour * 60 + endMinute;

    for (let currentMinutes = startMinutes; currentMinutes < endMinutes; currentMinutes += field.slotDuration) {
      const slotEndMinutes = currentMinutes + field.slotDuration;
      if (slotEndMinutes > endMinutes) break;

      const startTime = this.minutesToTimeString(currentMinutes);
      const endTime = this.minutesToTimeString(slotEndMinutes);
      
      const pricing = this.calculateSlotPricing(startTime, endTime, field, date);
      
      slots.push({
        startTime,
        endTime,
        price: pricing.price,
        priceBreakdown: pricing.breakdown
      });
    }

    return slots;
  }

  /**
   * Apply schedule constraints to virtual slots
   * Updated for Pure Lazy Creation: Check both Schedule bookedSlots AND Booking records
   */
  private async applyScheduleConstraints(
    virtualSlots: Omit<AvailabilitySlot, 'available'>[], 
    schedule: Schedule, 
    field: Field,
    date: Date
  ): Promise<AvailabilitySlot[]> {
    if (schedule.isHoliday) {
      return virtualSlots.map(slot => ({ ...slot, available: false }));
    }

    // Get actual bookings for this date
    const actualBookings = await this.getExistingBookingsForDate((field as any)._id.toString(), date);
    
    // Combine schedule bookedSlots with actual booking records
    const allBookedSlots = [
      ...schedule.bookedSlots,
      ...actualBookings.map(booking => ({
        startTime: booking.startTime,
        endTime: booking.endTime
      }))
    ];

    return virtualSlots.map(slot => ({
      ...slot,
      available: !this.checkSlotConflict(slot.startTime, slot.endTime, allBookedSlots)
    }));
  }

  /**
   * Get existing bookings for a specific field and date
   */
  private async getExistingBookingsForDate(fieldId: string, date: Date) {
    try {
      // Normalize date to start/end of day in Vietnam timezone (UTC+7)
      const startOfDay = new Date(date);
      startOfDay.setUTCHours(-7, 0, 0, 0); // Start of day in Vietnam = UTC-7

      const endOfDay = new Date(date);
      endOfDay.setUTCHours(16, 59, 59, 999); // End of day in Vietnam = UTC+17-1ms

      this.logger.log(`Searching bookings for field ${fieldId} on ${date.toISOString().split('T')[0]}`);

      // Query Booking collection for confirmed and pending bookings
      const bookings = await this.bookingModel.find({
        field: new Types.ObjectId(fieldId),
        date: {
          $gte: startOfDay,
          $lte: endOfDay
        },
        status: { $in: ['confirmed', 'pending'] }
      }).exec();

      this.logger.log(`Found ${bookings.length} bookings for field ${fieldId}`);
      
      return bookings;
    } catch (error) {
      this.logger.error('Error getting existing bookings', error);
      return [];
    }
  }

  /**
   * Get availability with only booking checks (no schedule)
   */
  private async getAvailabilityWithBookings(
    virtualSlots: Omit<AvailabilitySlot, 'available'>[], 
    field: Field,
    date: Date
  ): Promise<AvailabilitySlot[]> {
    // Get actual bookings for this date
    const actualBookings = await this.getExistingBookingsForDate((field as any)._id.toString(), date);
    
    // Convert bookings to slot format
    const bookedSlots = actualBookings.map(booking => ({
      startTime: booking.startTime,
      endTime: booking.endTime
    }));

    return virtualSlots.map(slot => ({
      ...slot,
      available: !this.checkSlotConflict(slot.startTime, slot.endTime, bookedSlots)
    }));
  }

  /**
   * Check if time slot conflicts with booked slots
   */
  private checkSlotConflict(
    startTime: string,
    endTime: string,
    bookedSlots: { startTime: string; endTime: string }[]
  ): boolean {
    const newStart = this.timeStringToMinutes(startTime);
    const newEnd = this.timeStringToMinutes(endTime);

    return bookedSlots.some(slot => {
      const bookedStart = this.timeStringToMinutes(slot.startTime);
      const bookedEnd = this.timeStringToMinutes(slot.endTime);

      // Check for overlap
      return newStart < bookedEnd && newEnd > bookedStart;
    });
  }

  /**
   * Calculate number of slots needed
   */
  private calculateNumSlots(startTime: string, endTime: string, slotDuration: number): number {
    const startMinutes = this.timeStringToMinutes(startTime);
    const endMinutes = this.timeStringToMinutes(endTime);
    const durationMinutes = endMinutes - startMinutes;

    return Math.ceil(durationMinutes / slotDuration);
  }

  /**
   * Calculate pricing for booking
   */
  private calculatePricing(startTime: string, endTime: string, field: Field, date?: Date): { 
    totalPrice: number; 
    multiplier: number; 
    breakdown: string 
  } {
    const startMinutes = this.timeStringToMinutes(startTime);
    const endMinutes = this.timeStringToMinutes(endTime);
    let totalPrice = 0;
    let breakdown = '';

    // Calculate price for each slot within the booking
    for (let currentMinutes = startMinutes; currentMinutes < endMinutes; currentMinutes += field.slotDuration) {
      const slotEndMinutes = Math.min(currentMinutes + field.slotDuration, endMinutes);
      const slotStart = this.minutesToTimeString(currentMinutes);
      const slotEnd = this.minutesToTimeString(slotEndMinutes);
      
      const slotPricing = this.calculateSlotPricing(slotStart, slotEnd, field, date);
      totalPrice += slotPricing.price;

      if (breakdown) breakdown += ', ';
      breakdown += `${slotStart}-${slotEnd}: ${slotPricing.price}đ (${slotPricing.multiplier}x)`;
    }

    // Calculate average multiplier
    const numSlots = Math.ceil((endMinutes - startMinutes) / field.slotDuration);
    const avgMultiplier = totalPrice / (field.basePrice * numSlots);

    return {
      totalPrice,
      multiplier: parseFloat(avgMultiplier.toFixed(2)),
      breakdown
    };
  }

  /**
   * Calculate pricing for a single slot
   */
  private calculateSlotPricing(startTime: string, endTime: string, field: Field, date?: Date): { 
    price: number; 
    multiplier: number; 
    breakdown: string 
  } {
    // Get day of week for the date (default to monday if no date provided)
    const dayOfWeek = date ? this.getDayOfWeek(date) : 'monday';
    
    // Find applicable price range for the specific day
    const applicableRange = field.priceRanges.find(range => {
      if (range.day !== dayOfWeek) return false;
      
      const rangeStart = this.timeStringToMinutes(range.start);
      const rangeEnd = this.timeStringToMinutes(range.end);
      const slotStart = this.timeStringToMinutes(startTime);

      return slotStart >= rangeStart && slotStart < rangeEnd;
    });

    const multiplier = applicableRange?.multiplier || 1;
    const price = field.basePrice * multiplier;

    return {
      price,
      multiplier,
      breakdown: `${startTime}-${endTime}: ${multiplier}x base price (${dayOfWeek})`
    };
  }

  /**
   * Validate time slots against field configuration
   */
  private validateTimeSlots(startTime: string, endTime: string, field: Field, date?: Date): void {
    const startMinutes = this.timeStringToMinutes(startTime);
    const endMinutes = this.timeStringToMinutes(endTime);
    
    // Get day of week for the date (default to monday if no date provided)
    const dayOfWeek = date ? this.getDayOfWeek(date) : 'monday';
    
    // Find operating hours for the specific day
    const dayOperatingHours = field.operatingHours.find(oh => oh.day === dayOfWeek);
    if (!dayOperatingHours) {
      throw new BadRequestException(`No operating hours defined for ${dayOfWeek}`);
    }

    const operatingStart = this.timeStringToMinutes(dayOperatingHours.start);
    const operatingEnd = this.timeStringToMinutes(dayOperatingHours.end);

    // Check if within operating hours
    if (startMinutes < operatingStart || endMinutes > operatingEnd) {
      throw new BadRequestException(
        `Booking time must be within operating hours ${dayOperatingHours.start} - ${dayOperatingHours.end} for ${dayOfWeek}`
      );
    }

    // Check if end time is after start time
    if (endMinutes <= startMinutes) {
      throw new BadRequestException('End time must be after start time');
    }

    // Check slot duration constraints
    const bookingDuration = endMinutes - startMinutes;
    const minDuration = field.minSlots * field.slotDuration;
    const maxDuration = field.maxSlots * field.slotDuration;

    if (bookingDuration < minDuration) {
      throw new BadRequestException(`Minimum booking duration is ${minDuration} minutes`);
    }

    if (bookingDuration > maxDuration) {
      throw new BadRequestException(`Maximum booking duration is ${maxDuration} minutes`);
    }

    // Check if booking aligns with slot boundaries
    if ((startMinutes - operatingStart) % field.slotDuration !== 0) {
      throw new BadRequestException('Start time must align with slot boundaries');
    }

    if (bookingDuration % field.slotDuration !== 0) {
      throw new BadRequestException('Booking duration must be multiple of slot duration');
    }
  }

  /**
   * Convert time string (HH:MM) to minutes since midnight
   */
  private timeStringToMinutes(timeString: string): number {
    const [hours, minutes] = timeString.split(':').map(Number);
    return hours * 60 + minutes;
  }

  /**
   * Convert minutes since midnight to time string (HH:MM)
   */
  private minutesToTimeString(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
  }

  /**
   * Get day of week from date
   */
  private getDayOfWeek(date: Date): string {
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    return days[date.getDay()];
  }
}
