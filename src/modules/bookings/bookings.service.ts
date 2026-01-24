import { Injectable, NotFoundException, BadRequestException, ForbiddenException, GoneException, Logger, InternalServerErrorException, HttpException, HttpStatus } from '@nestjs/common';
import { InjectModel, InjectConnection } from '@nestjs/mongoose';
import { Model, Types, Connection, ClientSession } from 'mongoose';
import { Booking } from './entities/booking.entity';
import { BookingStatus, BookingType } from '@common/enums/booking.enum';
import { Schedule } from '../schedules/entities/schedule.entity';
import { Field } from '../fields/entities/field.entity';
import { Court } from '../courts/entities/court.entity';
import { FieldOwnerProfile } from '../field-owner/entities/field-owner-profile.entity';
import { User } from '../users/entities/user.entity';
import { Match } from '../matching/entities/match.entity';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TransactionsService } from '../transactions/transactions.service';
import { Transaction } from '../transactions/entities/transaction.entity';
import { TransactionStatus } from '@common/enums/transaction.enum';
import { FieldsService } from '../fields/fields.service';
import { CoachesService } from '../coaches/coaches.service';
import { EmailService } from '../email/email.service';
import { PaymentHandlerService } from './services/payment-handler.service';
import { BookingEmailService } from './services/booking-email.service';
import { AvailabilityService } from './services/availability.service';
import { FieldBookingService } from './services/field-booking.service';
import { SessionBookingService } from './services/session-booking.service';
import { CleanupService } from '../../service/cleanup.service';
import { PayOSService } from '../transactions/payos.service';
import { PaymentMethod, PaymentMethodLabels } from 'src/common/enums/payment-method.enum';
import { CreateFieldBookingLazyDto, FieldAvailabilityQueryDto } from './dto/create-field-booking-lazy.dto';
import { CreateFieldBookingV2Dto } from './dto/create-field-booking-v2.dto';
import { CreateCoachBookingLazyDto } from './dto/create-coach-booking-lazy.dto';
import { CreateCoachBookingV2Dto } from './dto/create-coach-booking-v2.dto';
import { CoachProfile } from '../coaches/entities/coach-profile.entity';
import { AwsS3Service } from '../../service/aws-s3.service';
import { UserRole } from '@common/enums/user.enum';
import {
  CancelBookingPayload,
  CancelSessionBookingPayload,
  CreateFieldBookingPayload,
  CreateSessionBookingPayload,
} from './interfaces/booking-service.interfaces';
// ✅ NEW: Import refactored services
import { CoachBookingService } from './services/coach-booking.service';
import { OwnerBookingService } from './services/owner-booking.service';
import { BookingQueryService } from './services/booking-query.service';
import { BookingCancellationService } from './services/booking-cancellation.service';
import { CancellationValidatorService } from './services/cancellation-validator.service';
import { CancellationRole } from './config/cancellation-rules.config';
import { PaymentProofService } from './services/payment-proof.service';
import { QrCheckinService } from '../qr-checkin/qr-checkin.service';
import { CheckInLog } from '../qr-checkin/entities/check-in-log.entity';
import { WalletService } from '../wallet/wallet.service';

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

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  constructor(
    @InjectModel(Booking.name) private readonly bookingModel: Model<Booking>,
    @InjectModel(Schedule.name) private readonly scheduleModel: Model<Schedule>,
    @InjectModel(Field.name) private readonly fieldModel: Model<Field>,
    @InjectModel(FieldOwnerProfile.name) private readonly fieldOwnerProfileModel: Model<FieldOwnerProfile>,
    @InjectModel(Court.name) private readonly courtModel: Model<Court>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(Transaction.name) private readonly transactionModel: Model<Transaction>,
    @InjectModel(CoachProfile.name) private readonly coachProfileModel: Model<CoachProfile>,
    @InjectModel(Match.name) private readonly matchModel: Model<Match>,
    @InjectConnection() private readonly connection: Connection,
    private eventEmitter: EventEmitter2,
    private readonly transactionsService: TransactionsService,
    private readonly fieldsService: FieldsService,
    private readonly coachesService: CoachesService,
    private readonly emailService: EmailService,
    private readonly paymentHandlerService: PaymentHandlerService,
    private readonly bookingEmailService: BookingEmailService,
    private readonly availabilityService: AvailabilityService,
    private readonly fieldBookingService: FieldBookingService,
    private readonly sessionBookingService: SessionBookingService,
    private readonly cleanupService: CleanupService,
    private readonly payOSService: PayOSService,
    private readonly awsS3Service: AwsS3Service,
    // ✅ NEW: Inject refactored services
    private readonly coachBookingService: CoachBookingService,
    private readonly ownerBookingService: OwnerBookingService,
    private readonly bookingQueryService: BookingQueryService,
    private readonly bookingCancellationService: BookingCancellationService,
    private readonly cancellationValidator: CancellationValidatorService,
    private readonly paymentProofService: PaymentProofService,
    private readonly qrCheckinService: QrCheckinService,
    private readonly walletService: WalletService,
    @InjectModel(CheckInLog.name) private readonly checkInLogModel: Model<CheckInLog>,
  ) { }

  /**
   * Create or find guest user for anonymous bookings
   * Guest users are temporary users created from email/phone for booking purposes
   * If user already exists with that email, return existing user
   */
  private async createOrFindGuestUser(
    guestEmail: string,
    guestName?: string,
    guestPhone?: string,
    session?: ClientSession
  ): Promise<User> {
    // Validate email is provided
    if (!guestEmail) {
      throw new BadRequestException('Email is required for guest bookings');
    }

    // Check if user already exists with this email
    const existingUser = await this.userModel.findOne({ email: guestEmail }).session(session || null);
    if (existingUser) {
      this.logger.log(`Found existing user for guest email: ${guestEmail}`);
      return existingUser;
    }

    // Create new guest user
    const guestUser = new this.userModel({
      fullName: guestName || guestEmail.split('@')[0], // Use email prefix if no name
      email: guestEmail,
      phone: guestPhone || undefined,
      role: UserRole.USER,
      isVerified: false, // Guest users are not verified
      isActive: true,
      // No password - guest users cannot login
    });

    await guestUser.save({ session });
    this.logger.log(`Created guest user for email: ${guestEmail}`);
    return guestUser;
  }

  /**
   * Validate court existence, activity, and field ownership
   */
  private async validateCourt(courtId: string, fieldId: string, session?: ClientSession): Promise<Court> {
    if (!Types.ObjectId.isValid(courtId)) {
      throw new BadRequestException('Invalid court ID format');
    }

    const court = await this.courtModel.findById(courtId).session(session || null);
    if (!court || !court.isActive) {
      throw new NotFoundException('Court not found or inactive');
    }

    if (court.field.toString() !== fieldId.toString()) {
      throw new BadRequestException('Court does not belong to the specified field');
    }

    return court;
  }

  /**
   * Calculate total amenities fee from selected amenity IDs
   * Fetches amenity prices from Field's amenities array
   */
  private async calculateAmenitiesFee(
    fieldId: string,
    amenityIds: string[],
    session?: ClientSession
  ): Promise<number> {
    if (!amenityIds || amenityIds.length === 0) return 0;

    // Fetch field with amenities
    const field = await this.fieldModel
      .findById(fieldId)
      .select('amenities')
      .session(session || null)
      .lean();

    if (!field || !field.amenities || field.amenities.length === 0) return 0;

    // Calculate total from field's amenities that match selected IDs
    const amenityIdStrings = amenityIds.map(id => id.toString());
    const total = field.amenities
      .filter((a: any) => amenityIdStrings.includes((a.amenity || a.amenityId)?.toString()))
      .reduce((sum: number, a: any) => sum + (a.price || 0), 0);

    return total;
  }

  // ============================================================================
  // OWNER OPERATIONS - Delegated to OwnerBookingService
  // ============================================================================

  /**
   * Owner: list bookings that have user notes for fields owned by current user
   */
  async listOwnerNoteBookings(ownerUserId: string, options?: { status?: 'pending' | 'accepted' | 'denied'; limit?: number; page?: number }) {
    return this.ownerBookingService.listOwnerNoteBookings(ownerUserId, options);
  }

  /**
   * Owner: get detail of a booking with note ensuring ownership
   */
  async getOwnerBookingDetail(ownerUserId: string, bookingId: string) {
    return this.ownerBookingService.getOwnerBookingDetail(ownerUserId, bookingId);
  }

  /**
   * Owner: accept user's special note and (for online methods) send payment link to user via email
   */
  async ownerAcceptNote(ownerUserId: string, bookingId: string, clientIp?: string) {
    return this.ownerBookingService.ownerAcceptNote(ownerUserId, bookingId, clientIp);
  }

  /**
   * Owner: deny user's special note
   */
  async ownerDenyNote(ownerUserId: string, bookingId: string, reason?: string) {
    return this.ownerBookingService.ownerDenyNote(ownerUserId, bookingId, reason);
  }

  /**
   * Owner: accept a booking (approve booking request)
   */
  async ownerAcceptBooking(ownerUserId: string, bookingId: string) {
    return this.ownerBookingService.ownerAcceptBooking(ownerUserId, bookingId);
  }

  /**
   * Owner: reject a booking
   */
  async ownerRejectBooking(ownerUserId: string, bookingId: string, reason?: string) {
    return this.ownerBookingService.ownerRejectBooking(ownerUserId, bookingId, reason);
  }



  /**
   * Cancel hold booking via CleanupService
   */
  async cancelHoldBooking(bookingId: string, reason: string, maxAgeMinutes: number | null = 10) {
    return this.cleanupService.cancelHoldBooking(bookingId, reason, maxAgeMinutes);
  }

  // ============================================================================
  // PURE LAZY CREATION METHODS (NEW)
  // ============================================================================

  /**
   * Get field availability using Pure Lazy Creation
   * Delegates to AvailabilityService
   */
  async getFieldAvailability(
    fieldId: string,
    query: FieldAvailabilityQueryDto
  ): Promise<DailyAvailability[]> {
    return this.availabilityService.getFieldAvailability(fieldId, query);
  }

  /**
   * Create bookings for consecutive days (Turn 1: Simple Recurring Booking)
   * Same court, same time, multiple consecutive dates
   * Uses all-or-nothing approach: if any date conflicts, entire request fails
   */
  async createConsecutiveDaysBooking(
    dto: any, // CreateConsecutiveDaysBookingDto
    userId?: string
  ) {
    const session: ClientSession = await this.connection.startSession();

    try {
      return await session.withTransaction(async () => {
        // 1. Generate date range
        const allDates = this.generateDateRange(dto.startDate, dto.endDate);

        if (allDates.length === 0) {
          throw new BadRequestException('Invalid date range');
        }

        if (allDates.length > 30) {
          throw new BadRequestException('Cannot book more than 30 consecutive days at once');
        }

        // 2. Resolve userId (handle guest bookings)
        let finalUserId: string;
        if (!userId) {
          if (!dto.guestEmail) {
            throw new BadRequestException('Email is required for guest bookings');
          }
          const guestUser = await this.createOrFindGuestUser(
            dto.guestEmail,
            dto.guestName,
            dto.guestPhone,
            session
          );
          finalUserId = (guestUser._id as Types.ObjectId).toString();
        } else {
          finalUserId = userId;
        }

        // 3. Validate field and court
        const field = await this.fieldModel.findById(dto.fieldId).session(session);
        if (!field || !field.isActive) {
          throw new NotFoundException('Field not found or inactive');
        }

        const court = await this.validateCourt(dto.courtId, dto.fieldId, session);

        // 3.5 Filter dates based on operating hours
        const operatingDays = (field.operatingHours || [])
          .filter(h => h && h.day)
          .map(h => h.day.toLowerCase());

        const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const skippedDates: string[] = [];
        let dates = allDates.filter(date => {
          const dayName = dayNames[date.getDay()];
          const isOperating = operatingDays.length === 0 || operatingDays.includes(dayName);
          if (!isOperating) {
            skippedDates.push(date.toISOString().split('T')[0]);
          }
          return isOperating;
        });

        // 3.6 Filter out user-specified skipDates (from conflict resolution)
        const userSkipDates = new Set((dto.skipDates || []).map((d: string) => d.split('T')[0]));
        if (userSkipDates.size > 0) {
          dates = dates.filter(date => {
            const dateStr = date.toISOString().split('T')[0];
            if (userSkipDates.has(dateStr)) {
              skippedDates.push(dateStr);
              return false;
            }
            return true;
          });
          this.logger.debug(`[createConsecutiveDaysBooking] Skipping ${userSkipDates.size} user-specified dates`);
        }

        // 3.7 Prepare dateOverrides map (from conflict resolution - reschedule/switch)
        const dateOverrides: Record<string, { courtId?: string; startTime?: string; endTime?: string }> = dto.dateOverrides || {};
        if (Object.keys(dateOverrides).length > 0) {
          this.logger.debug(`[createConsecutiveDaysBooking] DateOverrides: ${JSON.stringify(dateOverrides)}`);
        }

        if (dates.length === 0) {
          throw new BadRequestException('No operating days in the selected date range. The venue is closed on all selected dates.');
        }

        // 4. Batch availability check
        // For dates WITH overrides, check using the overridden time/court
        // For dates WITHOUT overrides, check using original time/court
        const datesWithoutOverrides = dates.filter(d => !dateOverrides[d.toISOString().split('T')[0]]);
        const datesWithOverrides = dates.filter(d => !!dateOverrides[d.toISOString().split('T')[0]]);

        // Check availability for dates without overrides (using original time/court)
        let conflicts: Array<{ date: Date; existingStartTime?: string; existingEndTime?: string; reason?: string }> = [];
        if (datesWithoutOverrides.length > 0) {
          conflicts = await this.checkBatchAvailability(
            dto.fieldId,
            dto.courtId,
            datesWithoutOverrides,
            dto.startTime,
            dto.endTime,
            session
          );
        }

        // Check availability for dates WITH overrides (using overridden time/court)
        for (const date of datesWithOverrides) {
          const dateStr = date.toISOString().split('T')[0];
          const override = dateOverrides[dateStr];
          const overrideConflicts = await this.checkBatchAvailability(
            dto.fieldId,
            override.courtId || dto.courtId,
            [date],
            override.startTime || dto.startTime,
            override.endTime || dto.endTime,
            session
          );
          conflicts.push(...overrideConflicts);
        }

        if (conflicts.length > 0) {
          throw new BadRequestException({
            message: 'Some dates are not available. Please select different dates or court.',
            conflicts: conflicts.map(c => ({
              date: c.date.toISOString().split('T')[0],
              reason: c.reason || `Already booked ${c.existingStartTime}-${c.existingEndTime}`
            }))
          });
        }

        // 5. Calculate amenities fee (constant per day)
        const amenitiesFee = await this.calculateAmenitiesFee(
          dto.fieldId,
          dto.selectedAmenities || [],
          session
        );

        // Validate time slots once
        const sampleDate = dates[0];
        this.availabilityService.validateTimeSlots(dto.startTime, dto.endTime, field, sampleDate);

        const numSlots = this.availabilityService.calculateNumSlots(
          dto.startTime,
          dto.endTime,
          field.slotDuration
        );

        // 6. Create recurring group ID (link all bookings)
        const recurringGroupId = new Types.ObjectId();

        // 7. Create all bookings
        let totalPrice = 0;
        let firstPricePerBooking = 0; // For summary
        const bookings: Booking[] = [];

        for (const date of dates) {
          const dateStr = date.toISOString().split('T')[0];

          // Check if there's an override for this date (from conflict resolution)
          const override = dateOverrides[dateStr];
          const effectiveStartTime = override?.startTime || dto.startTime;
          const effectiveEndTime = override?.endTime || dto.endTime;

          // If courtId is overridden, validate and use the new court
          let effectiveCourt = court;
          if (override?.courtId && override.courtId !== dto.courtId) {
            const overriddenCourt = await this.validateCourt(override.courtId, dto.fieldId, session);
            effectiveCourt = overriddenCourt;
          }

          // Calculate price for THIS specific date with effective times
          const pricingInfo = this.availabilityService.calculatePricing(
            effectiveStartTime,
            effectiveEndTime,
            field,
            date
          );

          // Recalculate numSlots for this specific booking if time changed
          const effectiveNumSlots = this.availabilityService.calculateNumSlots(
            effectiveStartTime,
            effectiveEndTime,
            field.slotDuration
          );

          const bookingAmount = pricingInfo.totalPrice + amenitiesFee;
          const platformFeeRate = 0.05;
          const platformFee = Math.round(bookingAmount * platformFeeRate);
          const pricePerBooking = bookingAmount + platformFee;

          if (totalPrice === 0) firstPricePerBooking = pricePerBooking;
          totalPrice += pricePerBooking;

          // Upsert schedule for this date (use effective court)
          await this.scheduleModel.findOneAndUpdate(
            {
              field: new Types.ObjectId(dto.fieldId),
              court: effectiveCourt._id,
              date: date
            },
            {
              $setOnInsert: {
                field: new Types.ObjectId(dto.fieldId),
                court: effectiveCourt._id,
                date: date,
                bookedSlots: [],
                isHoliday: false
              }
            },
            {
              upsert: true,
              session
            }
          );

          // Create booking with effective values
          const booking = new this.bookingModel({
            user: new Types.ObjectId(finalUserId),
            field: new Types.ObjectId(dto.fieldId),
            court: effectiveCourt._id,
            date: date,
            type: BookingType.FIELD,
            startTime: effectiveStartTime,
            endTime: effectiveEndTime,
            numSlots: effectiveNumSlots,
            status: BookingStatus.PENDING,
            paymentStatus: 'unpaid',
            bookingAmount,
            platformFee,
            totalPrice: pricePerBooking,
            amenitiesFee,
            selectedAmenities: dto.selectedAmenities?.map(id => new Types.ObjectId(id)) || [],
            note: dto.note,
            recurringGroupId, // Link to group
            recurringType: 'CONSECUTIVE', // Mark as consecutive days booking
            pricingSnapshot: {
              basePrice: field.basePrice,
              appliedMultiplier: pricingInfo.multiplier,
              priceBreakdown: pricingInfo.breakdown
            }
          });

          await booking.save({ session });
          bookings.push(booking);

          // Update schedule slots with effective times and court
          await this.scheduleModel.findOneAndUpdate(
            {
              field: new Types.ObjectId(dto.fieldId),
              court: effectiveCourt._id,
              date: date
            },
            {
              $push: {
                bookedSlots: {
                  startTime: effectiveStartTime,
                  endTime: effectiveEndTime
                }
              }
            },
            { session }
          );
        }

        // 8. Calculate bulk discount (NO transaction created here - will be created at PayOS step)
        // Transaction will be created when user initiates PayOS payment via createPayOSPaymentForRecurringGroup
        // Collect daily prices for progressive discount calculation
        // Note: bookings[] contains 'totalPrice' which is pricePerBooking
        const dailyPrices = bookings.map(b => b.totalPrice || 0);
        const bulkDiscount = this.calculateBulkDiscount(dates.length, dailyPrices);

        return {
          success: true,
          bookings: bookings.map(b => b.toObject()),
          // Note: No transaction returned - will be created at payment step
          summary: {
            totalBookings: dates.length,
            datesBooked: dates.length,
            pricePerDay: firstPricePerBooking,
            subtotal: totalPrice,
            discount: {
              rate: bulkDiscount.discountRate * 100, // percentage
              amount: bulkDiscount.discountAmount
            },
            totalPrice: bulkDiscount.finalTotal,
            totalAmount: bulkDiscount.finalTotal, // Alias for frontend compatibility
            dates: dates.map(d => d.toISOString().split('T')[0]),
            skippedDates, // Days that were not operating
            recurringGroupId: recurringGroupId.toString()
          }
        };
      });
    } catch (error) {
      this.logger.error('Error creating consecutive days booking', error);
      throw error;
    } finally {
      await session.endSession();
    }
  }

  /**
   * Create bookings for weekly recurring pattern (Turn 2: Weekly Recurring Booking)
   * Book specific weekdays for multiple weeks
   * Example: Book every Monday and Wednesday for 4 weeks
   * Reuses batch booking logic from Turn 1
   */
  async createWeeklyRecurringBooking(
    dto: any, // CreateWeeklyRecurringBookingDto
    userId?: string
  ) {
    const session: ClientSession = await this.connection.startSession();

    try {
      return await session.withTransaction(async () => {
        // 1. Generate dates based on weekdays pattern (Turn 4: pass skipDates)
        const dates = this.generateWeeklyDates(
          dto.weekdays,
          dto.numberOfWeeks,
          dto.startDate,
          dto.skipDates || [] // Turn 4: Holiday Skip
        );

        if (dates.length === 0) {
          throw new BadRequestException('No valid dates generated from weekdays pattern');
        }

        if (dates.length > 84) { // 7 days * 12 weeks max
          throw new BadRequestException('Cannot book more than 84 dates at once (max 12 weeks with all weekdays)');
        }

        // 2. Resolve userId (handle guest bookings)
        let finalUserId: string;
        if (!userId) {
          if (!dto.guestEmail) {
            throw new BadRequestException('Email is required for guest bookings');
          }
          const guestUser = await this.createOrFindGuestUser(
            dto.guestEmail,
            dto.guestName,
            dto.guestPhone,
            session
          );
          finalUserId = (guestUser._id as Types.ObjectId).toString();
        } else {
          finalUserId = userId;
        }

        // 3. Validate field and court
        const field = await this.fieldModel.findById(dto.fieldId).session(session);
        if (!field || !field.isActive) {
          throw new NotFoundException('Field not found or inactive');
        }

        const court = await this.validateCourt(dto.courtId, dto.fieldId, session);

        // 3.5 Prepare dateOverrides map (from conflict resolution - reschedule/switch)
        const dateOverrides: Record<string, { courtId?: string; startTime?: string; endTime?: string }> = dto.dateOverrides || {};
        if (Object.keys(dateOverrides).length > 0) {
          this.logger.debug(`[createWeeklyRecurringBooking] DateOverrides: ${JSON.stringify(dateOverrides)}`);
        }

        // 4. Batch availability check
        // For dates WITH overrides, check using the overridden time/court
        // For dates WITHOUT overrides, check using original time/court
        const datesWithoutOverrides = dates.filter(d => !dateOverrides[d.toISOString().split('T')[0]]);
        const datesWithOverrides = dates.filter(d => !!dateOverrides[d.toISOString().split('T')[0]]);

        // Check availability for dates without overrides (using original time/court)
        let conflicts: Array<{ date: Date; existingStartTime?: string; existingEndTime?: string; reason?: string }> = [];
        if (datesWithoutOverrides.length > 0) {
          conflicts = await this.checkBatchAvailability(
            dto.fieldId,
            dto.courtId,
            datesWithoutOverrides,
            dto.startTime,
            dto.endTime,
            session
          );
        }

        // Check availability for dates WITH overrides (using overridden time/court)
        for (const date of datesWithOverrides) {
          const dateStr = date.toISOString().split('T')[0];
          const override = dateOverrides[dateStr];
          const overrideConflicts = await this.checkBatchAvailability(
            dto.fieldId,
            override.courtId || dto.courtId,
            [date],
            override.startTime || dto.startTime,
            override.endTime || dto.endTime,
            session
          );
          conflicts.push(...overrideConflicts);
        }

        if (conflicts.length > 0) {
          throw new BadRequestException({
            message: 'Some dates are not available. Please select different pattern or court.',
            conflicts: conflicts.map(c => ({
              date: c.date.toISOString().split('T')[0],
              reason: c.reason || `Already booked ${c.existingStartTime}-${c.existingEndTime}`
            }))
          });
        }

        // 5. Calculate amenities fee (constant per day)
        const amenitiesFee = await this.calculateAmenitiesFee(
          dto.fieldId,
          dto.selectedAmenities || [],
          session
        );

        // Validate time slots once (using base time, overrides will be validated per date)
        const sampleDate = dates[0];
        this.availabilityService.validateTimeSlots(dto.startTime, dto.endTime, field, sampleDate);

        // 6. Create recurring group ID (link all bookings)
        const recurringGroupId = new Types.ObjectId();

        // 7. Create all bookings - Calculate price for EACH date individually (like consecutive)
        let totalPrice = 0;
        let firstPricePerBooking = 0; // For summary
        const bookings: Booking[] = [];

        for (const date of dates) {
          const dateStr = date.toISOString().split('T')[0];

          // Check if there's an override for this date (from conflict resolution)
          const override = dateOverrides[dateStr];
          const effectiveStartTime = override?.startTime || dto.startTime;
          const effectiveEndTime = override?.endTime || dto.endTime;

          // If courtId is overridden, validate and use the new court
          let effectiveCourt = court;
          if (override?.courtId && override.courtId !== dto.courtId) {
            const overriddenCourt = await this.validateCourt(override.courtId, dto.fieldId, session);
            effectiveCourt = overriddenCourt;
          }

          // Validate time slots for this specific date with effective times
          this.availabilityService.validateTimeSlots(effectiveStartTime, effectiveEndTime, field, date);

          // Recalculate numSlots for this specific booking if time changed
          const effectiveNumSlots = this.availabilityService.calculateNumSlots(
            effectiveStartTime,
            effectiveEndTime,
            field.slotDuration
          );

          // Calculate price for THIS specific date with effective times
          const pricingInfo = this.availabilityService.calculatePricing(
            effectiveStartTime,
            effectiveEndTime,
            field,
            date
          );

          const bookingAmount = pricingInfo.totalPrice + amenitiesFee;
          const platformFeeRate = 0.05;
          const platformFee = Math.round(bookingAmount * platformFeeRate);
          const pricePerBooking = bookingAmount + platformFee;

          if (totalPrice === 0) firstPricePerBooking = pricePerBooking;
          totalPrice += pricePerBooking;

          // Upsert schedule for this date (use effective court)
          await this.scheduleModel.findOneAndUpdate(
            {
              field: new Types.ObjectId(dto.fieldId),
              court: effectiveCourt._id,
              date: date
            },
            {
              $setOnInsert: {
                field: new Types.ObjectId(dto.fieldId),
                court: effectiveCourt._id,
                date: date,
                bookedSlots: [],
                isHoliday: false
              }
            },
            {
              upsert: true,
              session
            }
          );

          // Create booking with effective values
          const booking = new this.bookingModel({
            user: new Types.ObjectId(finalUserId),
            field: new Types.ObjectId(dto.fieldId),
            court: effectiveCourt._id,
            date: date,
            type: BookingType.FIELD,
            startTime: effectiveStartTime,
            endTime: effectiveEndTime,
            numSlots: effectiveNumSlots,
            status: BookingStatus.PENDING,
            paymentStatus: 'unpaid',
            bookingAmount,
            platformFee,
            totalPrice: pricePerBooking,
            amenitiesFee,
            selectedAmenities: dto.selectedAmenities?.map(id => new Types.ObjectId(id)) || [],
            note: dto.note,
            recurringGroupId, // Link to group
            recurringType: 'WEEKLY', // Mark as weekly recurring booking
            pricingSnapshot: {
              basePrice: field.basePrice,
              appliedMultiplier: pricingInfo.multiplier,
              priceBreakdown: pricingInfo.breakdown
            }
          });

          await booking.save({ session });
          bookings.push(booking);

          // Update schedule slots with effective times and court
          await this.scheduleModel.findOneAndUpdate(
            {
              field: new Types.ObjectId(dto.fieldId),
              court: effectiveCourt._id,
              date: date
            },
            {
              $push: {
                bookedSlots: {
                  startTime: effectiveStartTime,
                  endTime: effectiveEndTime
                }
              }
            },
            { session }
          );
        }

        // 8. Validate pricing from FE if provided (optional - for verification)
        // If FE sent pricing data, we can log it for comparison but still use our calculated values
        // This ensures backend is source of truth while allowing FE to display accurate preview
        if (dto.subtotal !== undefined || dto.totalAmount !== undefined) {
          this.logger.debug('[WEEKLY BOOKING] FE pricing data received:', {
            feSubtotal: dto.subtotal,
            feSystemFee: dto.systemFee,
            feTotalAmount: dto.totalAmount,
            beCalculatedTotal: totalPrice
          });
          // Note: We still use BE calculated values for consistency and security
        }

        // 9. Build pattern summary (NO transaction created here - will be created at PayOS step)
        // Transaction will be created when user initiates PayOS payment via createPayOSPaymentForRecurringGroup
        const patternDescription = `Every ${dto.weekdays.join(', ')} for ${dto.numberOfWeeks} ${dto.numberOfWeeks === 1 ? 'week' : 'weeks'}`;

        // Turn 4 Feature 3: Calculate bulk discount
        // Collect daily prices. 'bookings' array matches 'dates' order which is sorted.
        const dailyPrices = bookings.map(b => b.totalPrice || 0);
        const bulkDiscount = this.calculateBulkDiscount(dates.length, dailyPrices);

        return {
          success: true,
          bookings: bookings.map(b => b.toObject()),
          // Note: No transaction returned - will be created at payment step
          summary: {
            totalBookings: dates.length,
            pricePerBooking: firstPricePerBooking,
            subtotal: totalPrice,
            discount: {
              rate: bulkDiscount.discountRate * 100, // percentage
              amount: bulkDiscount.discountAmount
            },
            totalAmount: bulkDiscount.finalTotal,
            dates: dates.map(d => d.toISOString().split('T')[0]),
            skippedDates: dto.skipDates || [], // Turn 4: Show skipped dates
            pattern: patternDescription,
            weekdays: dto.weekdays,
            numberOfWeeks: dto.numberOfWeeks,
            recurringGroupId: recurringGroupId.toString()
          }
        };
      });
    } catch (error) {
      this.logger.error('Error creating weekly recurring booking', error);
      throw error;
    } finally {
      await session.endSession();
    }
  }

  /**
   * Validate consecutive days booking availability WITHOUT creating bookings
   * Used for dry-run validation at booking step
   */
  async validateConsecutiveDaysBooking(dto: any) {
    // 1. Generate date range
    const allDates = this.generateDateRange(dto.startDate, dto.endDate);

    if (allDates.length === 0) {
      throw new BadRequestException('Invalid date range');
    }

    if (allDates.length > 30) {
      throw new BadRequestException('Cannot book more than 30 consecutive days at once');
    }

    // 2. Validate field and court
    const field = await this.fieldModel.findById(dto.fieldId);
    if (!field || !field.isActive) {
      throw new NotFoundException('Field not found or inactive');
    }

    if (!Types.ObjectId.isValid(dto.courtId)) {
      throw new BadRequestException('Invalid court ID format');
    }

    const court = await this.courtModel.findById(dto.courtId);
    if (!court || !court.isActive) {
      throw new NotFoundException('Court not found or inactive');
    }

    if (court.field.toString() !== dto.fieldId.toString()) {
      throw new BadRequestException('Court does not belong to the specified field');
    }

    // 3. Filter dates based on operating hours
    const operatingDays = (field.operatingHours || [])
      .filter(h => h && h.day)
      .map(h => h.day.toLowerCase());

    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const skippedDates: string[] = [];
    const dates = allDates.filter(date => {
      const dayName = dayNames[date.getDay()];
      const isOperating = operatingDays.length === 0 || operatingDays.includes(dayName);
      if (!isOperating) {
        skippedDates.push(date.toISOString().split('T')[0]);
      }
      return isOperating;
    });

    if (dates.length === 0) {
      throw new BadRequestException('No operating days in the selected date range');
    }

    // 4. Check availability (without transaction/session for validation)
    const conflictsList = await this.checkBatchAvailability(
      dto.fieldId,
      dto.courtId,
      dates,
      dto.startTime,
      dto.endTime,
      null as any
    );

    // 5. Build conflicts list
    const conflicts = conflictsList.map(c => {
      return {
        date: c.date.toISOString().split('T')[0],
        reason: c.reason || `Already booked ${c.existingStartTime}-${c.existingEndTime}`,
      };
    });

    // 5. Calculate pricing preview
    const sampleDate = dates[0];
    const pricingInfo = this.availabilityService.calculatePricing(
      dto.startTime,
      dto.endTime,
      field,
      sampleDate
    );

    const amenitiesFee = 0;
    const bookingAmount = pricingInfo.totalPrice + amenitiesFee;
    const platformFeeRate = 0.05;
    const platformFee = Math.round(bookingAmount * platformFeeRate);
    const pricePerBooking = bookingAmount + platformFee;
    const totalPrice = pricePerBooking * dates.length;

    // Create array of prices for validation preview (e.g. [120k, 120k, ...])
    const dailyPrices = new Array(dates.length).fill(pricePerBooking);
    const bulkDiscount = this.calculateBulkDiscount(dates.length, dailyPrices);

    return {
      valid: conflicts.length === 0,
      conflicts: conflicts.length > 0 ? conflicts : undefined,
      summary: {
        totalDates: dates.length,
        validDates: dates.length - conflicts.length,
        skippedDates,
        dates: dates.map(d => d.toISOString().split('T')[0]),
        pricePerDay: pricePerBooking,
        subtotal: totalPrice,
        discount: {
          rate: bulkDiscount.discountRate * 100,
          amount: bulkDiscount.discountAmount
        },
        totalAmount: bulkDiscount.finalTotal
      }
    };
  }

  /**
   * Validate weekly recurring booking availability WITHOUT creating bookings
   * Used for dry-run validation at booking step
   */
  async validateWeeklyRecurringBooking(dto: any) {
    // 1. Generate dates based on weekdays pattern
    const dates = this.generateWeeklyDates(
      dto.weekdays,
      dto.numberOfWeeks,
      dto.startDate,
      dto.skipDates || []
    );

    if (dates.length === 0) {
      throw new BadRequestException('No valid dates generated from weekdays pattern');
    }

    if (dates.length > 84) {
      throw new BadRequestException('Cannot book more than 84 dates at once');
    }

    // 2. Validate field and court
    const field = await this.fieldModel.findById(dto.fieldId);
    if (!field || !field.isActive) {
      throw new NotFoundException('Field not found or inactive');
    }

    if (!Types.ObjectId.isValid(dto.courtId)) {
      throw new BadRequestException('Invalid court ID format');
    }

    const court = await this.courtModel.findById(dto.courtId);
    if (!court || !court.isActive) {
      throw new NotFoundException('Court not found or inactive');
    }

    if (court.field.toString() !== dto.fieldId.toString()) {
      throw new BadRequestException('Court does not belong to the specified field');
    }

    // 3. Check availability (without transaction/session for validation)
    const conflictsList = await this.checkBatchAvailability(
      dto.fieldId,
      dto.courtId,
      dates,
      dto.startTime,
      dto.endTime,
      null as any
    );

    // 4. Build conflicts list
    const conflicts = conflictsList.map(c => {
      return {
        date: c.date.toISOString().split('T')[0],
        reason: c.reason || `Already booked ${c.existingStartTime}-${c.existingEndTime}`,
      };
    });

    // 4. Calculate pricing preview
    const sampleDate = dates[0];
    const pricingInfo = this.availabilityService.calculatePricing(
      dto.startTime,
      dto.endTime,
      field,
      sampleDate
    );

    const amenitiesFee = 0;
    const bookingAmount = pricingInfo.totalPrice + amenitiesFee;
    const platformFeeRate = 0.05;
    const platformFee = Math.round(bookingAmount * platformFeeRate);
    const pricePerBooking = bookingAmount + platformFee;
    const totalPrice = pricePerBooking * dates.length;

    // Create array of prices for validation preview
    const dailyPrices = new Array(dates.length).fill(pricePerBooking);
    const bulkDiscount = this.calculateBulkDiscount(dates.length, dailyPrices);

    const patternDescription = `Every ${dto.weekdays.join(', ')} for ${dto.numberOfWeeks} ${dto.numberOfWeeks === 1 ? 'week' : 'weeks'}`;

    return {
      valid: conflicts.length === 0,
      conflicts: conflicts.length > 0 ? conflicts : undefined,
      summary: {
        totalDates: dates.length,
        validDates: dates.length - conflicts.length,
        skippedDates: dto.skipDates || [],
        dates: dates.map(d => d.toISOString().split('T')[0]),
        pattern: patternDescription,
        weekdays: dto.weekdays,
        numberOfWeeks: dto.numberOfWeeks,
        pricePerBooking,
        subtotal: totalPrice,
        discount: {
          rate: bulkDiscount.discountRate * 100,
          amount: bulkDiscount.discountAmount
        },
        totalAmount: bulkDiscount.finalTotal
      }
    };
  }

  /**
   * Get detailed schedule for a specific conflict date
   * Returns all available time slots with their status for TimeSlotPickerModal
   * @param fieldId - Field ID
   * @param courtId - Court ID  
   * @param date - Date string (YYYY-MM-DD)
   * @param duration - Required duration in minutes (to filter slots that can accommodate)
   */
  async getConflictDateSchedule(
    fieldId: string,
    courtId: string,
    dateStr: string,
    duration: number
  ): Promise<{
    operatingHours: { start: string; end: string };
    slotDuration: number;
    requiredSlots: number; // Number of consecutive slots needed (duration / slotDuration)
    allSlots: Array<{
      startTime: string;
      endTime: string;
      status: 'available' | 'booked' | 'blocked' | 'past';
      reason?: string;
    }>;
  }> {
    // 1. Validate field
    const field = await this.fieldModel.findById(fieldId);
    if (!field || !field.isActive) {
      throw new NotFoundException('Field not found or inactive');
    }

    // 2. Validate court
    if (!Types.ObjectId.isValid(courtId)) {
      throw new BadRequestException('Invalid court ID format');
    }
    const court = await this.courtModel.findById(courtId);
    if (!court || !court.isActive) {
      throw new NotFoundException('Court not found or inactive');
    }

    // 3. Parse date and get day name
    // Use UTC to avoid timezone issues when parsing date string
    const dateParts = dateStr.split('-');
    const date = new Date(Date.UTC(parseInt(dateParts[0]), parseInt(dateParts[1]) - 1, parseInt(dateParts[2])));
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const dayName = dayNames[date.getUTCDay()];

    // 4. Get operating hours for this day
    let operatingHour = field.operatingHours?.find(h => h.day.toLowerCase() === dayName);
    if (!operatingHour) {
      operatingHour = field.operatingHours?.[0];
      if (!operatingHour) {
        throw new BadRequestException('No operating hours configured for this field');
      }
    }

    const slotDuration = field.slotDuration || 60;
    const requiredSlots = Math.ceil(duration / slotDuration);
    const [opStartH, opStartM] = operatingHour.start.split(':').map(Number);
    const [opEndH, opEndM] = operatingHour.end.split(':').map(Number);
    const opStartMinutes = opStartH * 60 + (opStartM || 0);
    const opEndMinutes = opEndH * 60 + (opEndM || 0);

    // 5. Get existing bookings for this court on this date
    // Use UTC dates to ensure we only get bookings for the exact date, avoiding timezone issues
    const dateStart = new Date(Date.UTC(parseInt(dateParts[0]), parseInt(dateParts[1]) - 1, parseInt(dateParts[2]), 0, 0, 0, 0));
    const dateEnd = new Date(Date.UTC(parseInt(dateParts[0]), parseInt(dateParts[1]) - 1, parseInt(dateParts[2]), 23, 59, 59, 999));

    const existingBookings = await this.bookingModel.find({
      court: new Types.ObjectId(courtId),
      date: { $gte: dateStart, $lte: dateEnd },
      status: { $in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] }
    });

    // 6. Get schedule for blocked slots
    const schedule = await this.scheduleModel.findOne({
      field: new Types.ObjectId(fieldId),
      court: new Types.ObjectId(courtId),
      date: { $gte: dateStart, $lte: dateEnd }
    });

    // 7. Generate all possible time blocks with the required duration
    const allSlots: Array<{
      startTime: string;
      endTime: string;
      status: 'available' | 'booked' | 'blocked' | 'past';
      reason?: string;
    }> = [];

    // Check if holiday
    if (schedule?.isHoliday) {
      return {
        operatingHours: { start: operatingHour.start, end: operatingHour.end },
        slotDuration,
        requiredSlots,
        allSlots: [] // No slots available on holiday
      };
    }

    // Current time for past slot detection
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const isToday = date.toDateString() === now.toDateString();

    // DEBUG: Log operating hours and slot generation parameters
    this.logger.debug(`[getConflictDateSchedule] Field: ${field.name}, Date: ${dateStr}, Day: ${dayName}`);
    this.logger.debug(`[getConflictDateSchedule] Operating hours: ${operatingHour.start} - ${operatingHour.end}`);
    this.logger.debug(`[getConflictDateSchedule] slotDuration: ${slotDuration}, requested duration: ${duration}, requiredSlots: ${requiredSlots}`);
    this.logger.debug(`[getConflictDateSchedule] opStartMinutes: ${opStartMinutes}, opEndMinutes: ${opEndMinutes}`);
    this.logger.debug(`[getConflictDateSchedule] Date range: ${dateStart.toISOString()} to ${dateEnd.toISOString()}`);
    this.logger.debug(`[getConflictDateSchedule] Existing bookings: ${existingBookings.length}, Schedule blocked slots: ${schedule?.bookedSlots?.length || 0}`);
    if (existingBookings.length > 0) {
      this.logger.debug(`[getConflictDateSchedule] Existing bookings details: ${JSON.stringify(existingBookings.map(b => ({
        id: (b._id as any).toString(),
        date: b.date,
        startTime: b.startTime,
        endTime: b.endTime,
        status: b.status
      })))}`);
    }

    // Generate individual slots (slotDuration) instead of large slots (duration)
    // This allows frontend to display a timeline and let users select consecutive slots
    for (let m = opStartMinutes; m + slotDuration <= opEndMinutes; m += slotDuration) {
      const slotStart = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      const endMin = m + slotDuration;
      const slotEnd = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;

      let status: 'available' | 'booked' | 'blocked' | 'past' = 'available';
      let reason: string | undefined;

      // Check if past (for today)
      if (isToday && m < nowMinutes) {
        status = 'past';
        reason = 'Slot already passed';
      }
      // Check booking conflicts (check if this individual slot overlaps with any booking)
      else {
        const hasBookingConflict = existingBookings.some(b => {
          const bStartMin = this.timeToMinutes(b.startTime);
          const bEndMin = this.timeToMinutes(b.endTime);
          // Check if this slot overlaps with the booking
          return m < bEndMin && endMin > bStartMin;
        });

        if (hasBookingConflict) {
          status = 'booked';
          const conflictingBooking = existingBookings.find(b => {
            const bStartMin = this.timeToMinutes(b.startTime);
            const bEndMin = this.timeToMinutes(b.endTime);
            return m < bEndMin && endMin > bStartMin;
          });
          reason = `Trùng lịch: ${conflictingBooking?.startTime}-${conflictingBooking?.endTime}`;
        }
        // Check schedule blocked slots
        else if (schedule?.bookedSlots?.length) {
          const hasScheduleConflict = schedule.bookedSlots.some(s => {
            const sStartMin = this.timeToMinutes(s.startTime);
            const sEndMin = this.timeToMinutes(s.endTime);
            return m < sEndMin && endMin > sStartMin;
          });
          if (hasScheduleConflict) {
            status = 'blocked';
            reason = 'Slot blocked by owner';
          }
        }
      }

      allSlots.push({
        startTime: slotStart,
        endTime: slotEnd,
        status,
        reason
      });
    }

    // DEBUG: Log slot generation results
    const statusCounts = allSlots.reduce((acc, slot) => {
      acc[slot.status] = (acc[slot.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    this.logger.debug(`[getConflictDateSchedule] Generated ${allSlots.length} slots: ${JSON.stringify(statusCounts)}`);

    return {
      operatingHours: { start: operatingHour.start, end: operatingHour.end },
      slotDuration,
      requiredSlots,
      allSlots
    };
  }

  /**
   * Helper: Generate array of dates from startDate to endDate (inclusive)
   */
  private generateDateRange(startDateStr: string, endDateStr: string): Date[] {
    const start = new Date(startDateStr);
    const end = new Date(endDateStr);

    if (start > end) {
      throw new BadRequestException('Start date must be before or equal to end date');
    }

    const dates: Date[] = [];
    const current = new Date(start);

    while (current <= end) {
      dates.push(new Date(current));
      current.setDate(current.getDate() + 1);
    }

    return dates;
  }

  /**
   * Turn 4 Feature 3: Calculate bulk discount based on BOOKED DAYS count (Progressive Tiers)
   * Tiers (based on Day Index 1-based):
   * - Days 1-5: 0% off
   * - Days 6-10: 10% off
   * - Days 11+: 20% off
   *
   * @param dailyPrices - Array of prices for each booked day (should be sorted chronologically if prices differ, though usually constant)
   */
  private calculateBulkDiscount(numberOfBookings: number, dailyPrices: number[]): {
    discountRate: number; // Overall effective rate (for info)
    discountAmount: number;
    finalTotal: number;
  } {
    // If we only have dates.length but no prices (should not happen in new logic), return 0
    if (!dailyPrices || dailyPrices.length === 0) {
      return { discountRate: 0, discountAmount: 0, finalTotal: 0 };
    }

    let discountAmount = 0;
    let totalBasePrice = 0;

    // Iterate through each day's price and apply tier based on index
    dailyPrices.forEach((price, index) => {
      totalBasePrice += price;
      const dayNumber = index + 1; // 1-based index

      if (dayNumber >= 11) {
        // Tier 3: 20% off
        discountAmount += Math.round(price * 0.20);
      } else if (dayNumber >= 6) {
        // Tier 2: 10% off
        discountAmount += Math.round(price * 0.10);
      } else {
        // Tier 1: 0% off
        // discountAmount += 0;
      }
    });

    const finalTotal = totalBasePrice - discountAmount;
    // Calculate effective overall rate for display
    const discountRate = totalBasePrice > 0 ? Number((discountAmount / totalBasePrice).toFixed(4)) : 0;

    return { discountRate, discountAmount, finalTotal };
  }

  /**
   * ✅ OPTIMIZED: Find bookings linked to a transaction with priority order
   * This method centralizes the logic to find bookings from a transaction,
   * avoiding code duplication across webhook handlers and payment handlers.
   * 
   * Priority order:
   * 1. Direct link via booking.transaction (fastest - single query)
   * 2. Recurring group via metadata.recurringGroupId (for recurring bookings)
   * 3. Single booking via metadata.bookingId
   * 4. Fallback: Extract bookingId from transaction notes
   * 
   * @param transaction - Transaction object or transaction ID string
   * @param session - Optional MongoDB session for transactional queries
   * @returns Array of bookings found, empty array if none found
   */
  async findBookingsByTransaction(
    transaction: Transaction | string,
    session?: ClientSession
  ): Promise<Booking[]> {
    try {
      // Resolve transaction if ID string provided
      let tx: Transaction | null = null;
      if (typeof transaction === 'string') {
        tx = await this.transactionModel.findById(transaction).exec();
        if (!tx) {
          this.logger.warn(`[findBookingsByTransaction] Transaction ${transaction} not found`);
          return [];
        }
      } else {
        tx = transaction;
      }

      // ✅ Priority 0: Direct link via transaction.booking (New source of truth)
      if (tx.booking) {
        const directBooking = await this.bookingModel.findById(tx.booking);
        if (directBooking) {
          this.logger.log(`[findBookingsByTransaction] 🚀 Found booking ${directBooking._id} via transaction.booking`);
          return [directBooking];
        }
      }

      // ✅ Priority 1: Direct link via booking.transaction (Legacy)
      const queryBuilder = this.bookingModel.find({ transaction: tx._id });
      if (session) {
        queryBuilder.session(session);
      }
      let bookings = await queryBuilder.exec();

      if (bookings.length > 0) {
        this.logger.log(`[findBookingsByTransaction] 🔔 Found ${bookings.length} booking(s) by transaction link`);
        return bookings;
      } else {
        this.logger.warn(`[findBookingsByTransaction] ⚠️ No bookings found by direct link for transaction ${tx._id}`);
      }

      // ✅ Priority 2: Recurring bookings via metadata.recurringGroupId
      if (tx.metadata?.recurringGroupId) {
        const recurringGroupId = tx.metadata.recurringGroupId;
        const recurringQuery = this.bookingModel.find({
          recurringGroupId: new Types.ObjectId(recurringGroupId)
        });
        if (session) {
          recurringQuery.session(session);
        }
        bookings = await recurringQuery.exec();

        if (bookings.length > 0) {
          this.logger.log(`[findBookingsByTransaction] 🔔 Found ${bookings.length} booking(s) in recurring group ${recurringGroupId}`);
          return bookings;
        }
      }

      // ✅ Priority 3: Single booking via metadata.bookingId
      if (tx.metadata?.bookingId && Types.ObjectId.isValid(String(tx.metadata.bookingId))) {
        const bookingId = String(tx.metadata.bookingId);
        const singleQuery = this.bookingModel.findById(bookingId);
        if (session) {
          singleQuery.session(session);
        }
        const singleBooking = await singleQuery.exec();

        if (singleBooking) {
          this.logger.log(`[findBookingsByTransaction] 🔔 Found single booking ${bookingId} from metadata`);
          return [singleBooking];
        }
      }

      // ✅ Priority 4: Fallback - Extract bookingId from notes
      if (tx.notes) {
        const bookingIdMatch = tx.notes.match(/Payment for booking\s+([a-f0-9]{24})/i);
        if (bookingIdMatch && Types.ObjectId.isValid(bookingIdMatch[1])) {
          const extractedBookingId = bookingIdMatch[1];
          const fallbackQuery = this.bookingModel.findById(extractedBookingId);
          if (session) {
            fallbackQuery.session(session);
          }
          const fallbackBooking = await fallbackQuery.exec();

          if (fallbackBooking) {
            this.logger.log(`[findBookingsByTransaction] 🔔 Extracted bookingId ${extractedBookingId} from transaction notes`);
            return [fallbackBooking];
          }
        }
      }

      this.logger.warn(`[findBookingsByTransaction] ❌ No bookings found for transaction ${tx._id}`);
      return [];
    } catch (error) {
      this.logger.error(`[findBookingsByTransaction] Error finding bookings: ${error.message}`, error);
      return [];
    }
  }

  /**
   * Helper: Generate array of dates for weekly recurring pattern (Turn 2)
   * Turn 4 Update: Added skipDates parameter for Holiday Skip Functionality
   * Example: weekdays=['monday', 'wednesday'], numberOfWeeks=4, startDate='2025-01-13'
   * Returns: All Mondays and Wednesdays for the next 4 weeks (excluding skipDates)
   */
  private generateWeeklyDates(
    weekdays: string[],
    numberOfWeeks: number,
    startDateStr: string,
    skipDates: string[] = [] // Turn 4: Holiday Skip
  ): Date[] {
    const startDate = new Date(startDateStr);
    const dates: Date[] = [];

    // Normalize skipDates to YYYY-MM-DD format for comparison
    const skipDateSet = new Set(
      skipDates.map(d => d.split('T')[0])
    );

    // Map weekday names to JavaScript day numbers (0=Sunday, 1=Monday, ..., 6=Saturday)
    const dayMap: Record<string, number> = {
      sunday: 0,
      monday: 1,
      tuesday: 2,
      wednesday: 3,
      thursday: 4,
      friday: 5,
      saturday: 6
    };

    // For each week
    for (let week = 0; week < numberOfWeeks; week++) {
      // For each weekday in the pattern
      for (const weekday of weekdays) {
        const targetDayNumber = dayMap[weekday.toLowerCase()];
        if (targetDayNumber === undefined) {
          throw new BadRequestException(`Invalid weekday: ${weekday}`);
        }

        // Calculate the date for this weekday in this week
        // Start from the beginning of the current week
        const weekStart = new Date(startDate);
        weekStart.setDate(startDate.getDate() + (week * 7));

        // Find the target weekday within this week
        const currentDayNumber = weekStart.getDay();
        let daysToAdd = targetDayNumber - currentDayNumber;

        // If target day is before current day in the week, go to next week
        if (daysToAdd < 0) {
          daysToAdd += 7;
        }

        const targetDate = new Date(weekStart);
        targetDate.setDate(weekStart.getDate() + daysToAdd);

        const targetDateStr = targetDate.toISOString().split('T')[0];

        // Only add if:
        // 1. This date is >= startDate (don't include past dates)
        // 2. This date is NOT in skipDates (Turn 4: Holiday Skip)
        if (targetDate >= startDate && !skipDateSet.has(targetDateStr)) {
          dates.push(targetDate);
        }
      }
    }

    // Sort dates chronologically
    return dates.sort((a, b) => a.getTime() - b.getTime());
  }

  /**
   * Helper: Check availability for batch of dates
   * Returns array of conflicts (empty if all available)
   */
  /**
   * Helper: Check availability for batch of dates
   * Returns array of conflicts (empty if all available)
   * Checks both Booking table and Schedule table (Source of Truth)
   */
  private async checkBatchAvailability(
    fieldId: string,
    courtId: string,
    dates: Date[],
    startTime: string,
    endTime: string,
    session: ClientSession
  ): Promise<Array<{ date: Date; existingStartTime?: string; existingEndTime?: string; reason?: string }>> {

    const dateStrings = dates.map(d => d.toISOString().split('T')[0]);

    // 1. Check existing Bookings (Source 1)
    // We use an $or of range queries for each date to be timezone-robust
    const dateQueryOr = dates.map(d => {
      const start = new Date(d);
      start.setHours(0, 0, 0, 0);
      const end = new Date(d);
      end.setHours(23, 59, 59, 999);
      return { date: { $gte: start, $lte: end } };
    });

    const existingBookings = await this.bookingModel.find({
      $and: [
        { court: new Types.ObjectId(courtId) },
        { $or: dateQueryOr },
        { status: { $in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] } },
        {
          $or: [
            { startTime: { $lt: endTime }, endTime: { $gt: startTime } }
          ]
        }
      ]
    }).session(session);

    const conflicts: Array<{ date: Date; existingStartTime?: string; existingEndTime?: string; reason?: string }> = [];

    // Map booking conflicts
    for (const booking of existingBookings) {
      const bookingDateStr = new Date(booking.date).toISOString().split('T')[0];
      const matchingDate = dates.find(d => d.toISOString().split('T')[0] === bookingDateStr);

      if (matchingDate) {
        conflicts.push({
          date: matchingDate,
          existingStartTime: booking.startTime,
          existingEndTime: booking.endTime,
          reason: `Already booked ${booking.startTime}-${booking.endTime}`
        });
      }
    }

    // 2. Check Schedule Table (Source 2 - Holidays & Blocked Slots)
    // Important: Even if no booking exists, the schedule might have the slot blocked
    const schedules = await this.scheduleModel.find({
      field: new Types.ObjectId(fieldId),
      court: new Types.ObjectId(courtId),
      date: { $in: dates }
    }).session(session);

    for (const schedule of schedules) {
      const scheduleDateStr = new Date(schedule.date).toISOString().split('T')[0];
      const matchingDate = dates.find(d => d.toISOString().split('T')[0] === scheduleDateStr);

      if (!matchingDate) continue;

      // Check if already in conflict list (optimization)
      if (conflicts.some(c => c.date.toISOString().split('T')[0] === scheduleDateStr)) {
        continue;
      }

      // Check Holiday
      if (schedule.isHoliday) {
        conflicts.push({
          date: matchingDate,
          reason: `Holiday: ${schedule.holidayReason || 'Venue closed'}`
        });
        continue;
      }

      // Check Blocked Slots in Schedule
      if (schedule.bookedSlots && schedule.bookedSlots.length > 0) {
        const conflictSlot = this.availabilityService.findSlotConflict(
          startTime,
          endTime,
          schedule.bookedSlots
        );

        if (conflictSlot) {
          conflicts.push({
            date: matchingDate,
            existingStartTime: conflictSlot.startTime,
            existingEndTime: conflictSlot.endTime,
            reason: `Slot blocked ${conflictSlot.startTime}-${conflictSlot.endTime}`
          });
        }
      }
    }

    return conflicts;
  }


  /**
   * Helper: Convert time string HH:MM to minutes
   */
  private timeToMinutes(time: string): number {
    const [h, m] = (time || '00:00').split(':').map(Number);
    return h * 60 + (m || 0);
  }


  // ============================================================================
  // COACH BOOKING OPERATIONS - Delegated to CoachBookingService
  // ============================================================================

  /**
   * Create coach booking (lazy) – separate payment per booking
   */
  async createCoachBookingLazy(
    userId: string,
    dto: CreateCoachBookingLazyDto
  ): Promise<Booking> {
    return this.coachBookingService.createCoachBookingLazy(userId, dto);
  }


  /**
   * Create field booking with Pure Lazy Creation pattern
   * Delegates to FieldBookingService
   */
  async createFieldBookingLazy(
    userId: string,
    bookingData: CreateFieldBookingLazyDto
  ): Promise<Booking> {
    return this.fieldBookingService.createFieldBookingLazy(userId, bookingData);
  }

  /**
   * Create field booking without payment (for bank transfer slot hold)
   * Creates booking and holds slots, but does NOT create payment transaction
   * Payment will be created later when user submits payment proof
   */
  async createFieldBookingWithoutPayment(
    userId: string | null,
    bookingData: CreateFieldBookingV2Dto
  ): Promise<Booking> {
    return this.fieldBookingService.createFieldBookingWithoutPayment(userId, bookingData);
  }

  /**
   * Create field booking V2 with bank transfer payment proof
   * Similar to createFieldBookingLazy but:
   * - Always uses PaymentMethod.BANK_TRANSFER
   * - Uploads payment proof image to S3
   * - Sets paymentProofStatus = 'pending' in transaction
   * - Booking status is PENDING until owner verifies proof
   */
  async createFieldBookingV2(
    userId: string | null,
    bookingData: CreateFieldBookingV2Dto,
    proofImageBuffer: Buffer,
    mimetype: string
  ): Promise<Booking> {
    const session: ClientSession = await this.connection.startSession();

    // Store values outside transaction for email sending
    let booking: Booking;
    let field: any;
    let court: any;
    let pricingInfo: any;
    let amenitiesFee: number = 0;
    let paymentProofImageUrl: string;
    let finalUserId: string;

    try {
      // Step 0: Resolve userId - create guest user if needed
      if (!userId) {
        // Guest booking - validate guest info
        if (!bookingData.guestEmail) {
          throw new BadRequestException('Email is required for guest bookings');
        }

        // Create or find guest user (outside transaction first to check existence)
        const guestUser = await this.createOrFindGuestUser(
          bookingData.guestEmail,
          bookingData.guestName,
          bookingData.guestPhone
        );
        finalUserId = (guestUser._id as Types.ObjectId).toString();
        this.logger.log(`Using guest user ID: ${finalUserId} for email: ${bookingData.guestEmail}`);
      } else {
        finalUserId = userId;
      }

      // Step 1: Upload payment proof image to S3 (before transaction)
      try {
        paymentProofImageUrl = await this.awsS3Service.uploadImageFromBuffer(proofImageBuffer, mimetype);
        this.logger.log(`Payment proof image uploaded: ${paymentProofImageUrl}`);
      } catch (uploadError) {
        this.logger.error('Failed to upload payment proof image', uploadError);
        throw new BadRequestException('Failed to upload payment proof image. Please try again.');
      }

      booking = await session.withTransaction(async () => {
        // If guest user was created outside transaction, ensure it exists in this session
        if (!userId && bookingData.guestEmail) {
          const guestUserInSession = await this.userModel.findById(finalUserId).session(session);
          if (!guestUserInSession) {
            // Re-create guest user within transaction
            const guestUser = await this.createOrFindGuestUser(
              bookingData.guestEmail,
              bookingData.guestName,
              bookingData.guestPhone,
              session
            );
            finalUserId = (guestUser._id as Types.ObjectId).toString();
          }
        }
        // Validate field
        field = await this.fieldModel.findById(bookingData.fieldId).session(session);
        if (!field || !field.isActive) {
          throw new NotFoundException('Field not found or inactive');
        }

        // Validate court belongs to field
        court = await this.validateCourt(bookingData.courtId, bookingData.fieldId, session);

        // Parse booking date
        const bookingDate = new Date(bookingData.date);

        // Validate time slots
        this.availabilityService.validateTimeSlots(bookingData.startTime, bookingData.endTime, field, bookingDate);

        // Calculate slots and pricing
        const numSlots = this.availabilityService.calculateNumSlots(bookingData.startTime, bookingData.endTime, field.slotDuration);
        pricingInfo = this.availabilityService.calculatePricing(
          bookingData.startTime,
          bookingData.endTime,
          field,
          bookingDate
        );

        // ✅ SECURITY: Atomic upsert with version initialization (Pure Lazy Creation)
        const scheduleUpdate = await this.scheduleModel.findOneAndUpdate(
          {
            field: new Types.ObjectId(bookingData.fieldId),
            court: court._id,
            date: bookingDate
          },
          {
            $setOnInsert: {
              field: new Types.ObjectId(bookingData.fieldId),
              court: court._id,
              date: bookingDate,
              bookedSlots: [],
              isHoliday: false
            },
            $inc: { version: 1 }
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

        // ✅ CRITICAL SECURITY: Re-check conflicts with LATEST data from transaction
        const hasConflict = this.availabilityService.checkSlotConflict(
          bookingData.startTime,
          bookingData.endTime,
          scheduleUpdate.bookedSlots
        );

        if (hasConflict) {
          throw new BadRequestException('Selected time slots are not available');
        }

        // Calculate amenities fee if provided
        amenitiesFee = 0;
        if (bookingData.selectedAmenities && bookingData.selectedAmenities.length > 0) {
          // TODO: Calculate amenities fee from Amenity model
          amenitiesFee = 0; // Placeholder
        }

        // Calculate booking amount and platform fee
        const bookingAmount = pricingInfo.totalPrice + amenitiesFee;
        const platformFeeRate = 0.05; // 5% platform fee
        const platformFee = Math.round(bookingAmount * platformFeeRate);
        const totalPrice = bookingAmount + platformFee;

        // V2: Always use BANK_TRANSFER and set status to PENDING (waiting for owner verification)
        const paymentMethod = PaymentMethod.BANK_TRANSFER;
        const bookingStatus = BookingStatus.PENDING;
        const initialPaymentStatus: 'unpaid' = 'unpaid';

        // Create Booking with snapshot data
        // ✅ Use finalUserId which is guaranteed to be non-null at this point
        const createdBooking = new this.bookingModel({
          user: new Types.ObjectId(finalUserId),
          field: new Types.ObjectId(bookingData.fieldId),
          court: court._id,
          date: bookingDate,
          type: BookingType.FIELD,
          startTime: bookingData.startTime,
          endTime: bookingData.endTime,
          numSlots,
          status: bookingStatus,
          paymentStatus: initialPaymentStatus,
          bookingAmount: bookingAmount,
          platformFee: platformFee,
          totalPrice: totalPrice,
          amenitiesFee,
          selectedAmenities: bookingData.selectedAmenities?.map(id => new Types.ObjectId(id)) || [],
          note: bookingData.note,
          pricingSnapshot: {
            basePrice: field.basePrice,
            appliedMultiplier: pricingInfo.multiplier,
            priceBreakdown: pricingInfo.breakdown
          }
        });

        await createdBooking.save({ session });

        // Create Payment transaction with payment proof info
        const totalAmount = bookingAmount + platformFee;

        const payment = await this.transactionsService.createPayment({
          bookingId: (createdBooking._id as Types.ObjectId).toString(),
          userId: finalUserId,
          amount: totalAmount,
          method: paymentMethod,
          paymentNote: bookingData.note,
        }, session);

        // Update transaction with payment proof information (within transaction)
        payment.paymentProofImageUrl = paymentProofImageUrl;
        payment.paymentProofStatus = 'pending';
        await payment.save({ session });

        // Update booking with transaction reference
        createdBooking.transaction = payment._id as Types.ObjectId;
        await createdBooking.save({ session });

        // ✅ CRITICAL SECURITY: Atomic update with optimistic locking
        const scheduleUpdateResult = await this.scheduleModel.findOneAndUpdate(
          {
            _id: scheduleUpdate._id,
            version: scheduleUpdate.version
          },
          {
            $push: {
              bookedSlots: {
                startTime: bookingData.startTime,
                endTime: bookingData.endTime
              }
            },
            $inc: { version: 1 }
          },
          {
            new: true,
            session
          }
        ).exec();

        if (!scheduleUpdateResult) {
          throw new BadRequestException('Schedule was modified concurrently. Please try again.');
        }

        return createdBooking;
      });

      // Send confirmation email (outside transaction)
      try {
        await this.bookingEmailService.sendConfirmationEmails((booking._id as Types.ObjectId).toString(), PaymentMethodLabels[PaymentMethod.BANK_TRANSFER]);
      } catch (emailError) {
        this.logger.warn('Failed to send booking confirmation email', emailError);
        // Don't fail the booking if email fails
      }

      return booking;
    } catch (error) {
      this.logger.error('Error creating field booking V2', error);

      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }

      throw new InternalServerErrorException('Failed to create booking. Please try again.');
    } finally {
      await session.endSession();
    }
  }

  // ============================================================================
  // PAYMENT PROOF OPERATIONS - Delegated to PaymentProofService
  // ============================================================================

  /**
   * Submit payment proof for existing booking (created via field-booking-hold)
   */
  async submitPaymentProof(
    bookingId: string,
    proofImageBuffer: Buffer,
    mimetype: string
  ): Promise<Booking> {
    return this.paymentProofService.submitPaymentProof(bookingId, proofImageBuffer, mimetype);
  }

  /**
   * Mark holiday with Pure Lazy Creation
   * Delegates to FieldBookingService
   */
  async markHoliday(
    fieldId: string,
    date: string,
    reason: string
  ): Promise<{ schedule: Schedule; affectedBookings: Booking[] }> {
    return this.fieldBookingService.markHoliday(fieldId, date, reason);
  }

  /**
   * Create coach booking V2 with bank transfer payment proof
   */
  async createCoachBookingV2(
    userId: string | null,
    bookingData: CreateCoachBookingV2Dto,
    proofImageBuffer: Buffer,
    mimetype: string
  ): Promise<Booking> {
    return this.coachBookingService.createCoachBookingV2(userId, bookingData, proofImageBuffer, mimetype);
  }

  /**
   * Create coach booking without payment (for bank transfer slot hold)
   */
  async createCoachBookingWithoutPayment(
    userId: string | null,
    bookingData: CreateCoachBookingV2Dto
  ): Promise<Booking> {
    return this.coachBookingService.createCoachBookingWithoutPayment(userId, bookingData);
  }

  /**
   * Get bookings for the currently authenticated coach
   */
  async getMyCoachBookings(userId: string): Promise<Booking[]> {
    return this.coachBookingService.getMyCoachBookings(userId);
  }

  async getMyCoachBookingsByType(userId: string, type?: BookingType): Promise<Booking[]> {
    return this.coachBookingService.getMyCoachBookingsByType(userId, type);
  }

  /**
   * Accept a booking request for a coach
   * Delegates to SessionBookingService
   */
  async acceptCoachRequest(coachId: string, bookingId: string): Promise<Booking> {
    return this.sessionBookingService.acceptCoachRequest(coachId, bookingId);
  }

  /**
   * Decline a booking request for a coach
   * Delegates to SessionBookingService
   */
  async declineCoachRequest(
    coachId: string,
    bookingId: string,
    reason?: string,
  ): Promise<Booking> {
    return this.sessionBookingService.declineCoachRequest(coachId, bookingId, reason);
  }

  async completeCoachBooking(
    coachId: string,
    bookingId: string,
  ): Promise<Booking> {
    return this.sessionBookingService.completeCoachBooking(coachId, bookingId);
  }

  async cancelCoachBooking(
    coachId: string,
    bookingId: string,
  ): Promise<Booking> {
    return this.sessionBookingService.cancelCoachBooking(coachId, bookingId);
  }

  async getByRequestedCoachId(coachId: string): Promise<Booking[]> {
    return this.sessionBookingService.getByRequestedCoachId(coachId);
  }

  async getCoachStatistics(
    coachId: string,
    mode: 'month' | 'year',
  ) {
    return this.sessionBookingService.getCoachStatistics(coachId, mode)
  }
  // ============================================================================
  // USER QUERY OPERATIONS - Delegated to BookingQueryService
  // ============================================================================

  /**
   * Get user bookings with pagination and filters
   */
  async getUserBookings(userId: string, options: {
    status?: string;
    paymentStatus?: 'unpaid' | 'paid' | 'refunded';
    approvalStatus?: 'pending' | 'approved' | 'rejected';
    coachStatus?: 'pending' | 'accepted' | 'declined';
    type?: string;
    recurringFilter?: 'none' | 'only' | 'all';
    startDate?: string;
    endDate?: string;
    search?: string;
    limit: number;
    page: number;
  }): Promise<{ bookings: any[]; pagination: any }> {
    return this.bookingQueryService.getUserBookings(userId, options);
  }

  /**
   * Get simplified booking invoice list for a user
   */
  async getUserBookingSummaries(userId: string, options: {
    status?: string;
    paymentStatus?: 'unpaid' | 'paid' | 'refunded';
    approvalStatus?: 'pending' | 'approved' | 'rejected';
    coachStatus?: 'pending' | 'accepted' | 'declined';
    type?: string;
    limit: number;
    page: number;
  }): Promise<{ invoices: any[]; pagination: any }> {
    return this.bookingQueryService.getUserBookingSummaries(userId, options);
  }

  /**
   * Get the next upcoming booking for the user
   */
  async getUpcomingBooking(userId: string): Promise<any | null> {
    return this.bookingQueryService.getUpcomingBooking(userId);
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
      status: data.note ? BookingStatus.PENDING : BookingStatus.CONFIRMED,
      totalPrice: data.totalPrice,
      note: data.note,
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
      status: BookingStatus.CONFIRMED, // Đặt luôn thành CONFIRMED
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
      status: BookingStatus.CONFIRMED, // Đặt luôn thành CONFIRMED
      totalPrice: data.coachPrice,
    });
    await fieldBooking.save();
    await coachBooking.save();
    return { fieldBooking, coachBooking };
  }

  // ============================================================================
  // CANCELLATION OPERATIONS - Delegated to BookingCancellationService
  // ============================================================================

  /**
   * Cancel field booking (legacy)
   */
  async cancelBooking(data: CancelBookingPayload) {
    return this.bookingCancellationService.cancelBooking(data);
  }

  /**
   * Cancel booking session (field + coach) (legacy)
   */
  async cancelSessionBooking(data: CancelSessionBookingPayload) {
    return this.bookingCancellationService.cancelSessionBooking(data);
  }

  /**
   * Get cancellation info for a booking
   * Used by frontend to display refund/penalty information before cancellation
   */
  async getCancellationInfo(bookingId: string, role: 'user' | 'owner' | 'coach') {
    const booking = await this.bookingModel.findById(bookingId);
    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    const cancellationRole = role === 'user' 
      ? CancellationRole.USER 
      : role === 'owner' 
        ? CancellationRole.OWNER 
        : CancellationRole.COACH;

    return this.cancellationValidator.getCancellationInfo(booking, cancellationRole);
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
      startOfDay.setHours(0, 0, 0, 0); // Start of local day (Vietnam)

      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999); // End of local day (Vietnam)

      // Query Booking collection for confirmed and pending bookings
      const bookings = await this.bookingModel.find({
        field: new Types.ObjectId(fieldId),
        date: {
          $gte: startOfDay,
          $lte: endOfDay
        },
        status: { $in: ['confirmed', 'pending'] }
      }).exec();

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

  // ============================================================================
  // PAYMENT VERIFICATION OPERATIONS - Delegated to OwnerBookingService
  // ============================================================================

  /**
   * Get field owner profile by user ID
   */
  async getFieldOwnerProfileByUserId(userId: string): Promise<{ id: string } | null> {
    return this.ownerBookingService.getFieldOwnerProfileByUserId(userId);
  }

  /**
   * Verify payment proof for booking (Field Owner only)
   */
  async verifyPaymentProof(
    bookingId: string,
    ownerId: string,
    action: 'approve' | 'reject',
    rejectionReason?: string
  ): Promise<Booking> {
    return this.ownerBookingService.verifyPaymentProof(bookingId, ownerId, action, rejectionReason);
  }

  /**
   * Verify payment proof for coach booking (Coach only)
   */
  async verifyCoachPaymentProof(
    bookingId: string,
    coachUserId: string,
    action: 'approve' | 'reject',
    rejectionReason?: string
  ): Promise<Booking> {
    return this.ownerBookingService.verifyCoachPaymentProof(bookingId, coachUserId, action, rejectionReason);
  }

  /**
   * Get pending payment proofs for field owner
   */
  async getPendingPaymentProofs(ownerId: string): Promise<Booking[]> {
    return this.ownerBookingService.getPendingPaymentProofs(ownerId);
  }

  /**
   * Get pending payment proofs for coach
   */
  async getPendingPaymentProofsForCoach(coachUserId: string): Promise<Booking[]> {
    return this.ownerBookingService.getPendingPaymentProofsForCoach(coachUserId);
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




  /**
   * Send booking emails asynchronously (outside transaction)
   * This prevents email delays from causing transaction timeouts
   */
  // Removed old sendBookingEmailsAsync in favor of unified BookingEmailService

  /**
   * Initiate PayOS payment for an existing booking (e.g. held booking)
   * FIXED: Reuse existing transaction instead of creating duplicate
   */
  async createPayOSPaymentForBooking(
    userId: string | null,
    bookingId: string
  ): Promise<{ checkoutUrl: string; paymentLinkId: string; orderCode: number }> {
    if (!userId) {
      throw new BadRequestException('User ID is required for payment');
    }
    // 1. Find booking with transaction populated
    const booking = await this.bookingModel
      .findById(bookingId)
      .populate('field')
      .populate('transaction')
      .exec();
    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    // 2. Validate booking state
    // Allow if status is PENDING (held)
    // If it's cancelled or completed, reject
    if (booking.status === BookingStatus.CANCELLED || booking.status === BookingStatus.COMPLETED) {
      throw new BadRequestException(`Booking is ${booking.status}, cannot proceed with payment`);
    }

    const isSplit = booking.metadata?.splitPayment === true;

    // Check if already paid
    if (!isSplit && booking.paymentStatus === 'paid') {
      throw new BadRequestException('Booking is already paid');
    }

    if (isSplit) {
      // Find user status in payments map
      // Note: metadata.payments is a Map or Object.
      // Mongoose Map: use .get() if it's a Map, or [] if it's POJO.
      // Assuming POJO from previous inspection or .toJSON()
      // If booking is a Mongoose document, metadata is likely just an object if defined as Mixed or Object
      const userPayment = booking.metadata?.payments?.[userId];
      if (userPayment?.status === 'paid') {
        throw new BadRequestException('You have already paid your share for this booking');
      }
    }

    let totalPrice = booking.totalPrice || booking.bookingAmount || 0;

    // Handle Split Payment Amount
    if (isSplit) {
      const share = booking.metadata?.payments?.[userId];
      if (share && share.amount) {
        totalPrice = share.amount;
        this.logger.log(`[PayOS Single] Split payment detected for user ${userId}. Amount: ${totalPrice}`);
      } else {
        this.logger.warn(`[PayOS Single] Split payment metadata missing for user ${userId}. Using full price.`);
      }
    }

    // 3. Check if transaction already exists (created during booking creation)
    // FIXED: Reuse existing transaction instead of creating duplicate
    // For Split Payment: We must find/create a transaction specifically for THIS user
    let transaction: any;
    let orderCode: number;

    if (isSplit) {
      // Find transaction for this user and booking
      transaction = await this.transactionModel.findOne({
        $or: [
          { booking: new Types.ObjectId(bookingId) },
          { bookingId: bookingId }
        ],
        userId: new Types.ObjectId(userId),
        status: { $ne: TransactionStatus.FAILED }
      });
    } else {
      transaction = booking.transaction as any;
    }

    if (transaction && transaction._id) {
      // Transaction already exists, check if it has externalTransactionId (PayOS orderCode)
      this.logger.log(`[PayOS Single] Reusing existing transaction: ${transaction._id}`);

      if (transaction.externalTransactionId) {
        orderCode = parseInt(transaction.externalTransactionId, 10);
      } else {
        // Generate new order code and update existing transaction
        orderCode = Number(String(Date.now()).slice(-6) + Math.floor(Math.random() * 1000));
        await this.transactionsService.updateTransactionExternalId(
          transaction._id.toString(),
          orderCode.toString()
        );
      }

      // Update amount if changed (only update if pending)
      if (transaction.status === TransactionStatus.PENDING && transaction.amount !== totalPrice) {
        await this.transactionsService.updateTransactionAmount(transaction._id.toString(), totalPrice);
      }
    } else {
      // No transaction exists, create new one (for bookings created without transaction or new split payer)
      this.logger.log(`[PayOS Single] No existing transaction found, creating new one`);
      orderCode = Number(String(Date.now()).slice(-6) + Math.floor(Math.random() * 1000));

      transaction = await this.transactionsService.createPayment({
        bookingId: (booking._id as any).toString(),
        userId: userId || booking.user?.toString() || new Types.ObjectId().toString(),
        amount: totalPrice,
        method: PaymentMethod.PAYOS,
        paymentNote: isSplit ? `Split Payment for booking ${bookingId}` : `Payment for booking ${bookingId}`,
        externalTransactionId: orderCode.toString(),
      });

      // Link transaction to booking (ONLY if not split)
      if (!isSplit) {
        booking.transaction = transaction._id as Types.ObjectId;
        await booking.save();
      }
    }

    // Determine Return/Cancel URLs
    const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
    let returnUrl: string | undefined;
    let cancelUrl: string | undefined;

    if (isSplit && booking.metadata?.matchId) {
      try {
        const match = await this.matchModel.findById(booking.metadata.matchId);
        if (match) {
          // Redirect back to specific matching match detail page
          returnUrl = `${clientUrl}/matching/matches/${match._id}`;
          cancelUrl = `${clientUrl}/matching/matches/${match._id}`;
          this.logger.log(`[PayOS Single] Setting returnUrl/cancelUrl to match detail: ${returnUrl}`);
        }
      } catch (matchErr) {
        this.logger.error(`[PayOS Single] Failed to fetch match for redirect URL: ${matchErr}`);
      }
    }

    // 4. Create PayOS Link
    const fieldName = (booking.field as any)?.name || 'Field';
    // Description must be short (<25 chars) and clean
    const description = isSplit ? `Split ${bookingId.slice(-6)}` : `Book ${bookingId.slice(-6)}`;

    const paymentLinkRes = await this.payOSService.createPaymentUrl({
      orderId: bookingId, // DTO requires orderId string
      orderCode: orderCode,
      amount: totalPrice,
      description: description,
      items: [
        {
          name: `Booking ${fieldName} - ${new Date(booking.date).toLocaleDateString()} ${isSplit ? '(Share)' : ''}`,
          quantity: 1,
          price: totalPrice,
        }
      ],
      returnUrl,
      cancelUrl
      // Use defaults from PayOSService config if these are undefined
    });

    // 5. Booking transaction link already set above (if new transaction was created)
    if (!isSplit) await booking.save();

    return {
      checkoutUrl: paymentLinkRes.checkoutUrl,
      paymentLinkId: paymentLinkRes.paymentLinkId,
      orderCode: orderCode
    };
  }

  /**
   * Create PayOS payment for recurring/multiple bookings
   * Calculates total from all bookings in the recurring group
   * FIXED: Reuse existing transaction instead of creating duplicate
   */
  async createPayOSPaymentForRecurringGroup(
    userId: string | null,
    bookingId: string
  ): Promise<{ checkoutUrl: string; paymentLinkId: string; orderCode: number }> {
    // 1. Find the primary booking with transaction populated
    const booking = await this.bookingModel
      .findById(bookingId)
      .populate('field')
      .populate('transaction')
      .exec();
    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    // 2. Validate this is a recurring booking
    if (!booking.recurringGroupId) {
      throw new BadRequestException('This endpoint is for recurring bookings only. Use regular payment endpoint for single bookings.');
    }

    // 3. Validate booking state
    if (booking.status === BookingStatus.CANCELLED || booking.status === BookingStatus.COMPLETED) {
      throw new BadRequestException(`Booking is ${booking.status}, cannot proceed with payment`);
    }

    if (booking.paymentStatus === 'paid') {
      throw new BadRequestException('Booking is already paid');
    }

    // 4. Find all bookings in this recurring group
    this.logger.log(`[PayOS Recurring] Processing recurring group: ${booking.recurringGroupId}`);

    const allBookings = await this.bookingModel.find({
      recurringGroupId: booking.recurringGroupId,
      status: { $in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] }
    }).exec();

    if (allBookings.length === 0) {
      throw new NotFoundException('No bookings found in recurring group');
    }

    this.logger.log(`[PayOS Recurring] Found ${allBookings.length} bookings in group`);

    // 5. Calculate total price from all bookings
    const rawTotalPrice = allBookings.reduce((sum, b) => {
      const bookingPrice = b.totalPrice || b.bookingAmount || 0;
      return sum + bookingPrice;
    }, 0);

    this.logger.log(`[PayOS Recurring] Raw total price calculated: ${rawTotalPrice}`);

    // Apply bulk discount to match Frontend calculation
    // Collect daily prices. 'allBookings' array order doesn't strictly matter for sum but for tiered logic we should sort by date
    // Sort bookings by date just in case
    allBookings.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const dailyPrices = allBookings.map(b => b.totalPrice || 0);
    const bulkDiscount = this.calculateBulkDiscount(allBookings.length, dailyPrices);
    const totalPrice = bulkDiscount.finalTotal;

    this.logger.log(`[PayOS Recurring] Applied bulk discount: ${bulkDiscount.discountAmount} (${bulkDiscount.discountRate * 100}%), Final Amount: ${totalPrice}`);

    // 6. Check if transaction already exists (created during booking creation)
    // FIXED: Reuse existing transaction instead of creating duplicate
    let transaction = booking.transaction as any;
    let orderCode: number;

    if (transaction && transaction._id) {
      // Transaction already exists, check if it has externalTransactionId (PayOS orderCode)
      this.logger.log(`[PayOS Recurring] Reusing existing transaction: ${transaction._id}`);

      if (transaction.externalTransactionId) {
        orderCode = parseInt(transaction.externalTransactionId, 10);
      } else {
        // Generate new order code and update existing transaction
        orderCode = Number(String(Date.now()).slice(-6) + Math.floor(Math.random() * 1000));
        await this.transactionsService.updateTransactionExternalId(
          transaction._id.toString(),
          orderCode.toString()
        );
      }

      // Update transaction amount if it differs (e.g. if discount wasn't applied initially)
      if (transaction.amount !== totalPrice) {
        this.logger.log(`[PayOS Recurring] Updating transaction amount from ${transaction.amount} to ${totalPrice}`);
        await this.transactionsService.updateTransactionAmount(
          transaction._id.toString(),
          totalPrice
        );
      }

    } else {
      // No transaction exists, create new one (fallback for edge cases)
      this.logger.log(`[PayOS Recurring] No existing transaction found, creating new one`);
      orderCode = Number(String(Date.now()).slice(-6) + Math.floor(Math.random() * 1000));

      transaction = await this.transactionsService.createPayment({
        bookingId: (booking._id as any).toString(),
        userId: userId || booking.user?.toString() || new Types.ObjectId().toString(),
        amount: totalPrice,
        method: PaymentMethod.PAYOS,
        paymentNote: `Payment for ${allBookings.length} recurring bookings`,
        externalTransactionId: orderCode.toString(),
        // ✅ Add recurringGroupId to metadata for webhook lookup
        metadata: {
          recurringGroupId: booking.recurringGroupId.toString(),
          bookingCount: allBookings.length,
        },
      });

      // Link transaction to ALL bookings in the recurring group
      for (const b of allBookings) {
        b.transaction = transaction._id as Types.ObjectId;
        await b.save();
      }
      this.logger.log(`[PayOS Recurring] Linked transaction ${transaction._id} to ${allBookings.length} bookings`);
    }

    // 7. Create PayOS Link
    const fieldName = (booking.field as any)?.name || 'Field';
    const paymentLinkRes = await this.payOSService.createPaymentUrl({
      orderId: bookingId,
      orderCode: orderCode,
      amount: totalPrice,
      description: `Thanh toan ${allBookings.length} lich`, // Max 25 chars
      items: [
        {
          name: `${allBookings.length} sessions at ${fieldName}`,
          quantity: 1,
          price: totalPrice,
        }
      ],
    });

    // No need to save booking again since we already saved all bookings above

    return {
      checkoutUrl: paymentLinkRes.checkoutUrl,
      paymentLinkId: paymentLinkRes.paymentLinkId,
      orderCode: orderCode
    };
  }

  // ============================================================================
  // QR CHECK-IN SYSTEM METHODS
  // ============================================================================

  /**
   * @deprecated This method is deprecated. Users should scan field QR codes at the venue instead.
   * Generate QR check-in token for a booking
   * Only available within configured time window before match start
   */
  async generateCheckInQR(bookingId: string, userId: string) {
    // DEPRECATED: This method is no longer used
    // Users now scan field QR codes at the venue instead of generating booking-specific QR codes
    throw new GoneException(
      'Booking-specific QR generation is deprecated. Please scan the field QR code at the venue.'
    );

    /* LEGACY CODE - KEPT FOR REFERENCE, WILL BE REMOVED IN FUTURE
    // 1. Find and validate booking
    if (!Types.ObjectId.isValid(bookingId)) {
      throw new BadRequestException('Invalid booking ID format');
    }

    const booking = await this.bookingModel
      .findById(bookingId)
      .populate('field')
      .lean();

    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    // 2. Validate booking has required time fields
    if (!booking.startTime || !booking.endTime) {
      throw new BadRequestException('Vui lòng nhập giờ bắt đầu và kết thúc');
    }

    // 3. Validate booking.user exists
    if (!booking.user) {
      throw new BadRequestException('Booking không có thông tin người dùng');
    }

    // 4. Verify ownership - use ForbiddenException for auth errors
    if (booking.user.toString() !== userId) {
      throw new ForbiddenException('Bạn không có quyền tạo QR cho booking này');
    }

    // 5. Check if already checked in (check this BEFORE checking status)
    if (booking.status === BookingStatus.CHECKED_IN) {
      throw new BadRequestException('Đã check-in rồi');
    }

    // 6. Check booking status and payment
    if (booking.paymentStatus !== 'paid') {
      throw new BadRequestException('Booking must be paid to generate check-in QR');
    }

    if (booking.status !== BookingStatus.CONFIRMED) {
      throw new BadRequestException('Booking must be confirmed to generate check-in QR');
    }

    // 7. Get booking start time (combine date + startTime)
    const startDateTime = this.combineDateTime(booking.date, booking.startTime);

    // 8. Generate token (will throw if outside time window)
    const { token, expiresAt } = await this.qrCheckinService.generateCheckInToken(
      bookingId,
      startDateTime
    );

    this.logger.log(`[QR Check-in] Generated token for booking ${bookingId}, expires at ${expiresAt}`);

    return {
      token,
      expiresAt,
      bookingId,
      startTime: startDateTime,
      fieldName: (booking.field as any)?.name || 'Sân không xác định'
    };
    */
  }

  /**
   * Get user's bookings for a specific field today
   * Used for field QR check-in - user scans field QR, we show their bookings
   * @param userId - The user ID
   * @param fieldId - The field ID
   * @returns List of user's bookings for today at this field
   */
  async getUserBookingsForFieldToday(
    userId: string,
    fieldId: string,
  ): Promise<any[]> {
    // Get today's date in Vietnam timezone
    const vietnamTime = new Date();
    const vietnamDate = new Date(
      vietnamTime.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }),
    );
    vietnamDate.setHours(0, 0, 0, 0);

    const tomorrow = new Date(vietnamDate);
    tomorrow.setDate(tomorrow.getDate() + 1);

    this.logger.log(`[Field QR Check-in] Finding bookings for user ${userId} at field ${fieldId} on ${vietnamDate.toISOString()}`);

    // Find confirmed, paid bookings for this user, field, and today
    const bookings = await this.bookingModel.find({
      user: new Types.ObjectId(userId),
      field: new Types.ObjectId(fieldId),
      date: {
        $gte: vietnamDate,
        $lt: tomorrow
      },
      status: BookingStatus.CONFIRMED,
      paymentStatus: 'paid',
    })
      .populate('field', 'name')
      .populate('court', 'name courtNumber')
      .lean();

    this.logger.log(`[Field QR Check-in] Found ${bookings.length} bookings`);

    return bookings;
  }

  /**
   * Confirm check-in by validating QR token
   * Triggers wallet transaction to unlock funds
   */
  async confirmCheckIn(
    bookingId: string,
    token: string,
    staffId: string,
    ipAddress?: string
  ) {
    // 1. Validate token
    const tokenPayload = await this.qrCheckinService.validateCheckInToken(token);

    // 2. Handle different token types
    let booking: any;

    if (tokenPayload.type === 'field') {
      // Field QR code - need bookingId to be provided
      this.logger.log(`[QR Check-in] Field QR code detected for field ${tokenPayload.fieldId}`);

      if (!bookingId) {
        throw new BadRequestException('Booking ID is required when using field QR code');
      }

      // Verify booking belongs to this field
      booking = await this.bookingModel
        .findById(bookingId)
        .populate('field')
        .populate('transaction')
        .populate('user');

      if (!booking) {
        throw new NotFoundException('Booking not found');
      }

      // Verify booking belongs to the field from QR code
      const bookingFieldId = (booking.field as any)._id.toString();
      if (bookingFieldId !== tokenPayload.fieldId) {
        this.logger.warn(`[QR Check-in] Booking field mismatch: ${bookingFieldId} !== ${tokenPayload.fieldId}`);
        throw new BadRequestException('This booking does not belong to this field');
      }

      this.logger.log(`[QR Check-in] Field QR validated for booking ${bookingId}`);

    } else if (tokenPayload.recurringGroupId) {
      // This is a recurring group QR - find booking for TODAY's date
      this.logger.log(`[QR Check-in] Recurring group QR detected: ${tokenPayload.recurringGroupId}`);

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      // Find booking in this recurring group that matches today's date
      booking = await this.bookingModel
        .findOne({
          recurringGroupId: new Types.ObjectId(tokenPayload.recurringGroupId),
          date: {
            $gte: today,
            $lt: tomorrow
          }
        })
        .populate('field')
        .populate('transaction')
        .populate('user');

      if (!booking) {
        // Check if there are any bookings in this group for other dates
        const anyBookingInGroup = await this.bookingModel.findOne({
          recurringGroupId: new Types.ObjectId(tokenPayload.recurringGroupId)
        }).lean();

        if (anyBookingInGroup) {
          throw new BadRequestException(
            `Không tìm thấy booking cho ngày hôm nay (${today.toLocaleDateString('vi-VN')}). ` +
            `QR code này dùng cho nhóm booking hàng loạt - vui lòng quét vào đúng ngày đã đặt.`
          );
        } else {
          throw new NotFoundException('Không tìm thấy nhóm booking này');
        }
      }

      this.logger.log(`[QR Check-in] Found booking ${booking._id} for today in recurring group`);

    } else {
      // Single booking QR - get booking ID from token payload
      // ✅ FIX: Use bookingId from token, not from URL parameter
      // This allows field-owner to scan QR without knowing the booking ID
      const tokenBookingId = tokenPayload.bookingId;

      if (!tokenBookingId) {
        throw new BadRequestException('Token does not contain booking ID');
      }

      // Optional validation: if bookingId is provided in URL, verify it matches
      if (bookingId && bookingId !== tokenBookingId) {
        this.logger.warn(`[QR Check-in] URL bookingId (${bookingId}) doesn't match token bookingId (${tokenBookingId})`);
        throw new BadRequestException('Token does not match booking ID');
      }

      // 3. Find booking with all relations using the ID from token
      booking = await this.bookingModel
        .findById(tokenBookingId)
        .populate('field')
        .populate('transaction')
        .populate('user');

      if (!booking) {
        throw new NotFoundException('Booking not found');
      }
    }

    // 4. Check if already checked in
    if (booking.status === BookingStatus.CHECKED_IN) {
      throw new HttpException('Đã check-in rồi', HttpStatus.CONFLICT);
    }

    // 5. Verify booking is paid and confirmed
    if (booking.paymentStatus !== 'paid') {
      throw new BadRequestException('Booking must be  paid before check-in');
    }

    if (booking.status !== BookingStatus.CONFIRMED) {
      throw new BadRequestException('Booking must be confirmed before check-in');
    }

    // 6. Update booking status
    booking.status = BookingStatus.CHECKED_IN;
    booking.checkedInAt = new Date();
    booking.checkedInBy = new Types.ObjectId(staffId);
    await booking.save();

    this.logger.log(`[QR Check-in] Booking ${bookingId} checked in by staff ${staffId}`);

    // 7. Trigger wallet transaction (unlock funds)
    let walletTransaction: any = null;
    try {
      // Type-safe transaction access
      const transactionId = booking.transaction;
      if (transactionId) {
        const transaction = await this.transactionModel.findById(transactionId).lean();

        if (transaction && transaction.amount > 0) {
          const field = booking.field as any;
          const fieldOwner = field?.owner;

          if (fieldOwner) {
            walletTransaction = await this.walletService.transferPendingToAvailable(
              fieldOwner.toString(),
              transaction.amount,
              bookingId,
              transaction._id.toString()
            );

            this.logger.log(`[QR Check-in] Transferred ${transaction.amount} from pending to available for field owner ${fieldOwner}`);
          }
        }
      }
    } catch (error) {
      this.logger.error(`[QR Check-in] Failed to transfer wallet funds: ${error.message}`, error.stack);
      // Don't fail the check-in if wallet transfer fails - log for manual intervention
    }

    // 8. Create check-in log (audit trail)
    try {
      const checkInLog = new this.checkInLogModel({
        booking: booking._id,
        checkedInBy: new Types.ObjectId(staffId),
        checkedInAt: new Date(),
        ipAddress,
        tokenPayload,
        status: 'success'
      });
      await checkInLog.save();
    } catch (error) {
      // Log but don't fail
      this.logger.error(`[QR Check-in] Failed to create check-in log: ${error.message}`, error.stack);
    }

    // 9. Emit event for real-time updates
    this.eventEmitter.emit('booking.checkedIn', {
      bookingId: (booking._id as Types.ObjectId).toString(),
      userId: booking.user.toString(),
      fieldId: booking.field?.toString() || '',
      checkedInAt: booking.checkedInAt,
      staffId
    });

    return {
      success: true,
      booking: booking.toObject(),
      walletTransaction,
      checkedInAt: booking.checkedInAt
    };
  }

  /**
   * Get check-in time window information for a booking
   * Used for displaying countdown timers
   */
  async getCheckInWindow(bookingId: string, userId: string) {
    if (!Types.ObjectId.isValid(bookingId)) {
      throw new BadRequestException('Invalid booking ID format');
    }

    const booking = await this.bookingModel.findById(bookingId).lean();

    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    // Verify ownership
    if (booking.user.toString() !== userId) {
      throw new BadRequestException('You are not authorized to view this booking');
    }

    // Get booking start time
    const startDateTime = this.combineDateTime(booking.date, booking.startTime);

    // Get window info from QR service
    const windowInfo = this.qrCheckinService.getCheckInWindow(startDateTime);
    const timeUntilWindow = this.qrCheckinService.getTimeUntilWindow(startDateTime);
    const canGenerateResult = this.qrCheckinService.canGenerateQR(startDateTime);

    return {
      ...windowInfo,
      canGenerateNow: canGenerateResult.canGenerate,
      timeUntilWindowMs: timeUntilWindow,
      bookingStartTime: startDateTime,
      message: canGenerateResult.message
    };
  }

  /**
   * Helper: Combine date and time string to create DateTime
   * @param date - Date object or ISO string
   * @param timeString - Time string in format "HH:MM"
   */
  private combineDateTime(date: Date | string, timeString: string): Date {
    // Validate date
    const dateObj = typeof date === 'string' ? new Date(date) : date;
    if (isNaN(dateObj.getTime())) {
      throw new BadRequestException('Ngày đặt sân không hợp lệ');
    }

    // Validate timeString
    if (!timeString || typeof timeString !== 'string') {
      throw new BadRequestException('Vui lòng nhập giờ bắt đầu và kết thúc');
    }

    // Validate time format (HH:mm)
    if (!/^\d{2}:\d{2}$/.test(timeString)) {
      throw new BadRequestException('Định dạng giờ không hợp lệ. Vui lòng nhập theo định dạng HH:mm');
    }

    const [hours, minutes] = timeString.split(':').map(Number);

    // Validate hours and minutes
    if (isNaN(hours) || isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
      throw new BadRequestException('Giờ không hợp lệ');
    }

    // Convert to Vietnam Time (+07:00)
    // We explicitly construct the date with +07:00 timezone offset because:
    // 1. The booking times (HH:mm) are likely in Vietnam time
    // 2. The server might be running in UTC or another timezone
    // 3. We need a consistent absolute timestamp for QR validity checks
    const dateStr = dateObj.toISOString().split('T')[0];
    const timeStr = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:00`;

    // Construct ISO string with Vietnam timezone (+07:00)
    // This ensures that "22:00" is interpreted as "22:00 GMT+7" (15:00 UTC)
    // regardless of the server's local timezone
    return new Date(`${dateStr}T${timeStr}+07:00`);
  }
}
