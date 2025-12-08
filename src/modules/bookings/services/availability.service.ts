import { Injectable, NotFoundException, BadRequestException, Logger, InternalServerErrorException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Schedule } from '../../schedules/entities/schedule.entity';
import { Field } from '../../fields/entities/field.entity';
import { Court } from '../../courts/entities/court.entity';
import { Booking } from '../entities/booking.entity';
import { BookingStatus } from '@common/enums/booking.enum';
import { FieldAvailabilityQueryDto } from '../dto/create-field-booking-lazy.dto';

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
  courtId?: string;
  courtName?: string;
  courtNumber?: number;
}

/**
 * Availability Service
 * Handles field availability calculation and slot generation
 */
@Injectable()
export class AvailabilityService {
  private readonly logger = new Logger(AvailabilityService.name);

  constructor(
    @InjectModel(Schedule.name) private readonly scheduleModel: Model<Schedule>,
    @InjectModel(Field.name) private readonly fieldModel: Model<Field>,
    @InjectModel(Court.name) private readonly courtModel: Model<Court>,
    @InjectModel(Booking.name) private readonly bookingModel: Model<Booking>,
  ) {}

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

      // Resolve target court (require when multiple courts)
      const courts = await this.courtModel
        .find({ field: new Types.ObjectId(fieldId), isActive: true })
        .exec();
      const courtsWithIds = courts as (Court & { _id: Types.ObjectId })[];

      if (!courts || courts.length === 0) {
        throw new BadRequestException('No active courts found for this field');
      }

      // Explicitly type courts with ObjectId to satisfy TS strictness
      let targetCourt: (Court & { _id: Types.ObjectId });
      if (query.courtId) {
        const foundCourt = courtsWithIds.find(c => c._id.toString() === query.courtId);
        if (!foundCourt) {
          throw new BadRequestException('Court not found or inactive for this field');
        }
        targetCourt = foundCourt as Court & { _id: Types.ObjectId };
      } else if (courts.length === 1) {
        targetCourt = courtsWithIds[0];
      } else {
        throw new BadRequestException('Field has multiple courts, please provide courtId');
      }

      const targetCourtId = targetCourt._id.toString();

      // Query existing Schedules in range (may be empty for Pure Lazy) for the target court
      const schedules = await this.scheduleModel
        .find({
          field: new Types.ObjectId(fieldId),
          court: targetCourt._id,
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
        const pricingOverride = targetCourt?.pricingOverride;
        const virtualSlots = this.generateVirtualSlots(field, currentDate, pricingOverride);
        
        // Apply schedule constraints if exists
        const availableSlots = schedule 
          ? await this.applyScheduleConstraints(
              virtualSlots,
              schedule,
              field,
              currentDate,
              targetCourtId
            )
          : await this.getAvailabilityWithBookings(
              virtualSlots,
              field,
              currentDate,
              targetCourtId
            );

        result.push({
          date: dateKey,
          isHoliday: schedule?.isHoliday || false,
          holidayReason: schedule?.holidayReason,
          slots: availableSlots,
          courtId: targetCourtId,
          courtName: targetCourt.name,
          courtNumber: targetCourt.courtNumber
        });
      }

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
   * Generate virtual slots from Field configuration
   */
  generateVirtualSlots(
    field: Field,
    date?: Date,
    pricingOverride?: { basePrice?: number; priceRanges?: { day: string; start: string; end: string; multiplier: number }[] }
  ): Omit<AvailabilitySlot, 'available'>[] {
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
      
      const pricing = this.calculateSlotPricing(startTime, endTime, field, date, pricingOverride);
      
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
  async applyScheduleConstraints(
    virtualSlots: Omit<AvailabilitySlot, 'available'>[], 
    schedule: Schedule, 
    field: Field,
    date: Date,
    courtId?: string
  ): Promise<AvailabilitySlot[]> {
    if (schedule.isHoliday) {
      return virtualSlots.map(slot => ({ ...slot, available: false }));
    }

    // Get actual bookings for this date
    const actualBookings = await this.getExistingBookingsForDate(
      (field as any)._id.toString(),
      date,
      courtId
    );
    
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
   * Get availability with only booking checks (no schedule)
   */
  async getAvailabilityWithBookings(
    virtualSlots: Omit<AvailabilitySlot, 'available'>[], 
    field: Field,
    date: Date,
    courtId?: string
  ): Promise<AvailabilitySlot[]> {
    // Get actual bookings for this date
    const actualBookings = await this.getExistingBookingsForDate(
      (field as any)._id.toString(),
      date,
      courtId
    );
    
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
   * Get existing bookings for a specific field and date
   */
  async getExistingBookingsForDate(fieldId: string, date: Date, courtId?: string): Promise<Booking[]> {
    try {
      // ✅ CRITICAL: Normalize date using UTC methods to avoid server timezone issues
      // setHours() uses LOCAL timezone → wrong on Singapore server (UTC+8)
      // Must use setUTCHours() to ensure consistency with how dates are stored
const startOfDay = new Date(date);
startOfDay.setUTCHours(0, 0, 0, 0); // Start of UTC day

const endOfDay = new Date(date);
endOfDay.setUTCHours(23, 59, 59, 999); // End of UTC day

      // Query Booking collection for confirmed and pending bookings
      const query: any = {
        field: new Types.ObjectId(fieldId),
        date: {
          $gte: startOfDay,
          $lte: endOfDay
        },
        status: { $in: [BookingStatus.CONFIRMED, BookingStatus.PENDING] }
      };

      if (courtId) {
        query.court = new Types.ObjectId(courtId);
      }

      const bookings = await this.bookingModel.find(query).exec();
      
      return bookings;
    } catch (error) {
      this.logger.error('Error getting existing bookings', error);
      return [];
    }
  }

  /**
   * Check if time slot conflicts with booked slots
   */
  checkSlotConflict(
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
   * Calculate pricing for a single slot
   */
  calculateSlotPricing(
    startTime: string,
    endTime: string,
    field: Field,
    date?: Date,
    pricingOverride?: { basePrice?: number; priceRanges?: { day: string; start: string; end: string; multiplier: number }[] }
  ): { 
    price: number; 
    multiplier: number; 
    breakdown: string 
  } {
    // Get day of week for the date (default to monday if no date provided)
    const dayOfWeek = date ? this.getDayOfWeek(date) : 'monday';
    
    // Find applicable price range for the specific day
    const priceRanges = pricingOverride?.priceRanges && pricingOverride.priceRanges.length > 0
      ? pricingOverride.priceRanges
      : field.priceRanges;

    const applicableRange = priceRanges.find(range => {
      if (range.day !== dayOfWeek) return false;
      
      const rangeStart = this.timeStringToMinutes(range.start);
      const rangeEnd = this.timeStringToMinutes(range.end);
      const slotStart = this.timeStringToMinutes(startTime);

      return slotStart >= rangeStart && slotStart < rangeEnd;
    });

    const multiplier = applicableRange?.multiplier || 1;
    const basePrice = pricingOverride?.basePrice ?? field.basePrice;
    const price = basePrice * multiplier;

    return {
      price,
      multiplier,
      breakdown: `${startTime}-${endTime}: ${multiplier}x base price (${dayOfWeek})`
    };
  }

  /**
   * Calculate number of slots needed
   */
  calculateNumSlots(startTime: string, endTime: string, slotDuration: number): number {
    const startMinutes = this.timeStringToMinutes(startTime);
    const endMinutes = this.timeStringToMinutes(endTime);
    const durationMinutes = endMinutes - startMinutes;

    return Math.ceil(durationMinutes / slotDuration);
  }

  /**
   * Calculate pricing for booking
   */
  calculatePricing(
    startTime: string,
    endTime: string,
    field: Field,
    date?: Date,
    pricingOverride?: { basePrice?: number; priceRanges?: { day: string; start: string; end: string; multiplier: number }[] }
  ): { 
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
      
      const slotPricing = this.calculateSlotPricing(slotStart, slotEnd, field, date, pricingOverride);
      totalPrice += slotPricing.price;

      if (breakdown) breakdown += ', ';
      breakdown += `${slotStart}-${slotEnd}: ${slotPricing.price}đ (${slotPricing.multiplier}x)`;
    }

    // Calculate average multiplier
    const numSlots = Math.ceil((endMinutes - startMinutes) / field.slotDuration);
    const basePrice = pricingOverride?.basePrice ?? field.basePrice;
    const avgMultiplier = basePrice > 0 ? totalPrice / (basePrice * numSlots) : 0;

    return {
      totalPrice,
      multiplier: parseFloat(avgMultiplier.toFixed(2)),
      breakdown
    };
  }

  /**
   * Validate time slots against field configuration
   */
  validateTimeSlots(startTime: string, endTime: string, field: Field, date?: Date): void {
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

  // ============================================================================
  // UTILITY METHODS
  // ============================================================================

  /**
   * Convert time string (HH:MM) to minutes since midnight
   */
  timeStringToMinutes(timeString: string): number {
    const [hours, minutes] = timeString.split(':').map(Number);
    return hours * 60 + minutes;
  }

  /**
   * Convert minutes since midnight to time string (HH:MM)
   */
  minutesToTimeString(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
  }

  /**
   * Get day of week from date
   */
  getDayOfWeek(date: Date): string {
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    return days[date.getDay()];
  }
}
