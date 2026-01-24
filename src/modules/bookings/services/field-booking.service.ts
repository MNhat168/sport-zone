import { Injectable, NotFoundException, BadRequestException, Logger, InternalServerErrorException } from '@nestjs/common';
import { InjectModel, InjectConnection } from '@nestjs/mongoose';
import { Model, Types, Connection, ClientSession } from 'mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Booking } from '../entities/booking.entity';
import { BookingStatus, BookingType } from '@common/enums/booking.enum';
import { Schedule } from '../../schedules/entities/schedule.entity';
import { Field } from '../../fields/entities/field.entity';
import { Court } from '../../courts/entities/court.entity';
import { FieldOwnerProfile } from '../../field-owner/entities/field-owner-profile.entity';
import { User } from '../../users/entities/user.entity';
import { TransactionsService } from '../../transactions/transactions.service';
import { EmailService } from '../../email/email.service';
import { PaymentMethod } from '@common/enums/payment-method.enum';
import { CreateFieldBookingLazyDto } from '../dto/create-field-booking-lazy.dto';
import { CreateFieldBookingV2Dto } from '../dto/create-field-booking-v2.dto';
import { AvailabilityService } from './availability.service';
import { BookingEmailService } from './booking-email.service';
import { UserRole } from '@common/enums/user.enum';
import { CoachProfile } from '../../coaches/entities/coach-profile.entity';
import { CoachesService } from '../../coaches/coaches.service';
import { CreateCombinedBookingDto } from '../dto/create-combined-booking.dto';
import { generatePayOSOrderCode } from '../../transactions/utils/payos.utils';

/**
 * Field Booking Service
 * Handles field booking creation and management
 */
@Injectable()
export class FieldBookingService {
  private readonly logger = new Logger(FieldBookingService.name);

  constructor(
    @InjectModel(Booking.name) private readonly bookingModel: Model<Booking>,
    @InjectModel(Schedule.name) private readonly scheduleModel: Model<Schedule>,
    @InjectModel(Field.name) private readonly fieldModel: Model<Field>,
    @InjectModel(Court.name) private readonly courtModel: Model<Court>,
    @InjectModel(FieldOwnerProfile.name) private readonly fieldOwnerProfileModel: Model<FieldOwnerProfile>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(CoachProfile.name) private readonly coachProfileModel: Model<CoachProfile>,
    @InjectConnection() private readonly connection: Connection,
    private readonly eventEmitter: EventEmitter2,
    private readonly transactionsService: TransactionsService,
    private readonly emailService: EmailService,
    private readonly availabilityService: AvailabilityService,
    private readonly bookingEmailService: BookingEmailService,
    private readonly coachesService: CoachesService,
  ) { }

  /**
   * Create field booking with Pure Lazy Creation pattern
   * Uses atomic upsert for Schedule creation with optimistic locking
   * ✅ SECURITY: Race condition protected, no Redis needed
   */
  async createFieldBookingLazy(
    userId: string,
    bookingData: CreateFieldBookingLazyDto
  ): Promise<Booking> {
    const session: ClientSession = await this.connection.startSession();

    // Store values outside transaction for email sending
    let booking: Booking;

    try {
      booking = await session.withTransaction(async () => {
        // Validate field
        const field = await this.fieldModel.findById(bookingData.fieldId).session(session);
        if (!field || !field.isActive) {
          throw new NotFoundException('Field not found or inactive');
        }
        const fieldId = (field._id as Types.ObjectId).toString();

        // Validate court belongs to field
        const court = await this.validateCourt(bookingData.courtId, fieldId, session);

        // Parse booking date
        const bookingDate = new Date(bookingData.date);

        // Validate time slots
        this.availabilityService.validateTimeSlots(bookingData.startTime, bookingData.endTime, field, bookingDate);

        // Calculate slots and pricing
        const numSlots = this.availabilityService.calculateNumSlots(bookingData.startTime, bookingData.endTime, field.slotDuration);
        const pricingInfo = this.availabilityService.calculatePricing(
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
              // ❌ Không set version ở đây - sẽ conflict với $inc
            },
            // ✅ Increment version: insert sẽ tạo version=1, update sẽ increment
            $inc: { version: 1 }
          },
          {
            upsert: true,
            new: true,
            session
            // ❌ writeConcern không được phép trong transaction - chỉ dùng ở transaction level
          }
        ).exec();

        // Validate slot availability and not holiday
        if (scheduleUpdate.isHoliday) {
          throw new BadRequestException(`Cannot book on holiday: ${scheduleUpdate.holidayReason}`);
        }

        // ✅ CRITICAL SECURITY: Re-check conflicts with LATEST data from transaction
        // This prevents race conditions where 2 requests pass the check simultaneously
        const hasConflict = this.availabilityService.checkSlotConflict(
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

        // Calculate booking amount and platform fee
        const bookingAmount = pricingInfo.totalPrice + amenitiesFee; // Court fee + amenities
        const platformFeeRate = 0.05; // 5% platform fee
        const platformFee = Math.round(bookingAmount * platformFeeRate);
        const totalPrice = bookingAmount + platformFee; // For backward compatibility

        // Determine booking status based on payment method and note
        // ✅ CRITICAL: Online payments (PayOS, etc.) must be PENDING until payment succeeds
        // Only CASH payments can be CONFIRMED immediately (if no note)
        // Only CASH payments can be CONFIRMED immediately (if no note)
        const paymentMethod = bookingData.paymentMethod ?? PaymentMethod.BANK_TRANSFER;
        const isOnlinePayment = paymentMethod === PaymentMethod.PAYOS;

        // Booking status logic:
        // - Online payments (PayOS): Always PENDING (wait for payment confirmation via webhook)
        // - All other methods: CONFIRMED immediately (bank transfer, cash, etc.)
        // Note: Removed note-based PENDING logic - notes are informational only
        const bookingStatus = isOnlinePayment
          ? BookingStatus.PENDING
          : BookingStatus.CONFIRMED;

        // New explicit statuses per refactor plan (Phase 2)
        const initialPaymentStatus: 'unpaid' | 'paid' | 'refunded' = 'unpaid';
        const initialApprovalStatus: 'pending' | 'approved' | 'rejected' | undefined = bookingData.note ? 'pending' : undefined;

        // Create Booking with snapshot data
        const booking = new this.bookingModel({
          user: new Types.ObjectId(userId),
          field: new Types.ObjectId(bookingData.fieldId),
          court: court._id,
          date: bookingDate,
          type: BookingType.FIELD,
          startTime: bookingData.startTime,
          endTime: bookingData.endTime,
          numSlots,
          status: bookingStatus,
          paymentStatus: initialPaymentStatus,
          approvalStatus: initialApprovalStatus,
          bookingAmount: bookingAmount,
          platformFee: platformFee,
          totalPrice: totalPrice, // For backward compatibility
          amenitiesFee,
          selectedAmenities: bookingData.selectedAmenities?.map(id => new Types.ObjectId(id)) || [],
          note: bookingData.note,
          pricingSnapshot: {
            basePrice: field.basePrice,
            appliedMultiplier: pricingInfo.multiplier,
            priceBreakdown: pricingInfo.breakdown
          }
        });

        await booking.save({ session });

        // ✅ CRITICAL: Create Payment record WITHIN transaction session
        // This ensures payment is rolled back if booking fails
        // Use totalAmount (bookingAmount + platformFee) for payment amount
        const totalAmount = bookingAmount + platformFee;

        // ✅ CRITICAL: Generate PayOS orderCode if using PayOS payment method
        // This allows webhook/return URL to find the transaction later
        let externalTransactionId: string | undefined;
        if (bookingData.paymentMethod === PaymentMethod.PAYOS) {
          // Import generatePayOSOrderCode at top of file if not already imported
          const { generatePayOSOrderCode } = await import('../../transactions/utils/payos.utils');
          externalTransactionId = generatePayOSOrderCode().toString();
          this.logger.log(`Generated PayOS orderCode: ${externalTransactionId} for booking ${booking._id}`);
        }

        const payment = await this.transactionsService.createPayment({
          bookingId: (booking._id as Types.ObjectId).toString(),
          userId: userId,
          amount: totalAmount,
          method: bookingData.paymentMethod ?? PaymentMethod.BANK_TRANSFER,
          paymentNote: bookingData.paymentNote,
          externalTransactionId, // ✅ Pass PayOS orderCode
        }, session);

        // ✅ Link transaction to booking (for single booking)
        booking.transaction = payment._id as Types.ObjectId;
        await booking.save({ session });

        // ✅ CRITICAL SECURITY: Atomic update with optimistic locking
        // Use current version from scheduleUpdate to prevent concurrent modifications
        const scheduleUpdateResult = await this.scheduleModel.findOneAndUpdate(
          {
            _id: scheduleUpdate._id,
            version: scheduleUpdate.version // ✅ Optimistic locking check
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
            session,
            new: true
            // ❌ writeConcern không được phép trong transaction - chỉ dùng ở transaction level
          }
        ).exec();

        // ✅ SECURITY: If version mismatch (another booking modified it), fail the transaction
        if (!scheduleUpdateResult) {
          throw new BadRequestException('Slot was booked by another user. Please refresh and try again.');
        }

        // Emit event for notifications (non-blocking, outside transaction)
        this.eventEmitter.emit('booking.created', {
          bookingId: booking._id,
          userId,
          fieldId: bookingData.fieldId,
          courtId: bookingData.courtId,
          date: bookingData.date,
          startTime: bookingData.startTime,
          endTime: bookingData.endTime
        });

        // ❌ Email sending moved OUTSIDE transaction to prevent timeout
        // Will be sent after transaction commits successfully

        return booking;
      }, {
        // ✅ SECURITY: Transaction options for data integrity
        readConcern: { level: 'snapshot' },      // Isolation level - prevents dirty reads
        writeConcern: { w: 'majority', j: true }, // Durability - ensures write to majority of replicas
        maxCommitTimeMS: 15000                     // 15 second timeout for the entire transaction
      });

    } catch (error) {
      this.logger.error('Error creating field booking', error);

      // Re-throw known exceptions as-is
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }

      // ✅ SECURITY: Detect optimistic locking failures (version mismatch)
      if (error.message?.includes('Slot was booked')) {
        throw new BadRequestException('Slot was booked by another user. Please refresh availability and try again.');
      }

      // Generic error for unexpected issues
      throw new InternalServerErrorException('Failed to create booking. Please try again.');
    } finally {
      await session.endSession();
    }

    // ✅ Send emails AFTER transaction commits successfully (non-blocking)
    // This prevents email delays from causing transaction timeouts
    const shouldSendNow = (bookingData.paymentMethod ?? PaymentMethod.BANK_TRANSFER) === PaymentMethod.BANK_TRANSFER;
    if (shouldSendNow) {
      // Unified confirmation emails via single handler
      const methodLabel = typeof bookingData.paymentMethod === 'number'
        ? PaymentMethod[bookingData.paymentMethod]
        : bookingData.paymentMethod;
      await this.bookingEmailService.sendConfirmationEmails((booking._id as Types.ObjectId).toString(), methodLabel);
    }

    return booking;
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

        // Query affected bookings (chỉ cần tìm CONFIRMED vì không còn PENDING)
        const affectedBookings = await this.bookingModel
          .find({
            field: new Types.ObjectId(fieldId),
            date: holidayDate,
            status: BookingStatus.CONFIRMED
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
   * Create field booking without payment (for bank transfer slot hold)
   * Creates booking and holds slots, but does NOT create payment transaction
   * Payment will be created later when user submits payment proof
   */
  async createFieldBookingWithoutPayment(
    userId: string | null,
    bookingData: CreateFieldBookingLazyDto | CreateFieldBookingV2Dto
  ): Promise<Booking> {
    const session: ClientSession = await this.connection.startSession();
    let booking: Booking;
    let finalUserId: string;

    try {
      // Validate guest info before starting transaction
      if (!userId) {
        const guestData = bookingData as any;
        if (!guestData.guestEmail) {
          throw new BadRequestException('Email is required for guest bookings');
        }
      }

      booking = await session.withTransaction(async () => {
        // Resolve userId - create guest user if needed (WITHIN transaction)
        if (!userId) {
          // Guest booking - create or find guest user within transaction
          const guestData = bookingData as any;
          const guestUser = await this.createOrFindGuestUser(
            guestData.guestEmail,
            guestData.guestName,
            guestData.guestPhone,
            session
          );
          finalUserId = (guestUser._id as Types.ObjectId).toString();
          this.logger.log(`Using guest user ID: ${finalUserId} for email: ${guestData.guestEmail}`);
        } else {
          finalUserId = userId;
        }

        // Validate field
        const field = await this.fieldModel.findById(bookingData.fieldId).session(session);
        if (!field || !field.isActive) {
          throw new NotFoundException('Field not found or inactive');
        }
        const fieldId = (field._id as Types.ObjectId).toString();

        // Validate court belongs to field
        const court = await this.validateCourt(bookingData.courtId, fieldId, session);

        // Parse booking date
        const bookingDate = new Date(bookingData.date);

        // Validate time slots
        this.availabilityService.validateTimeSlots(bookingData.startTime, bookingData.endTime, field, bookingDate);

        // Calculate slots and pricing
        const numSlots = this.availabilityService.calculateNumSlots(bookingData.startTime, bookingData.endTime, field.slotDuration);
        const pricingInfo = this.availabilityService.calculatePricing(
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
        const amenitiesFee = await this.calculateAmenitiesFee(
          bookingData.fieldId,
          bookingData.selectedAmenities || [],
          session
        );

        // Calculate booking amount and platform fee
        const bookingAmount = pricingInfo.totalPrice + amenitiesFee;
        const platformFeeRate = 0.05; // 5% platform fee
        const platformFee = Math.round(bookingAmount * platformFeeRate);
        const totalPrice = bookingAmount + platformFee;

        // For bank transfer without payment: Always PENDING, unpaid
        const bookingStatus = BookingStatus.PENDING;
        const initialPaymentStatus: 'unpaid' = 'unpaid';
        const initialApprovalStatus: 'pending' | 'approved' | 'rejected' | undefined = bookingData.note ? 'pending' : undefined;

        // Create Booking with snapshot data (NO payment transaction)
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
          approvalStatus: initialApprovalStatus,
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
          },
          // ✅ Mark as bank transfer hold booking
          metadata: {
            paymentMethod: PaymentMethod.BANK_TRANSFER,
            isSlotHold: true,
            slotsReleased: false
          }
        });

        await createdBooking.save({ session });

        // ✅ CRITICAL SECURITY: Atomic update with optimistic locking
        // Book slots in schedule (hold them)
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
            session,
            new: true
          }
        ).exec();

        if (!scheduleUpdateResult) {
          throw new BadRequestException('Slot was booked by another user. Please refresh and try again.');
        }

        // Emit event for notifications
        this.eventEmitter.emit('booking.created', {
          bookingId: createdBooking._id,
          userId: finalUserId,
          fieldId: bookingData.fieldId,
          courtId: bookingData.courtId,
          date: bookingData.date,
          startTime: bookingData.startTime,
          endTime: bookingData.endTime
        });

        return createdBooking;
      }, {
        readConcern: { level: 'snapshot' },
        writeConcern: { w: 'majority', j: true },
        maxCommitTimeMS: 15000
      });

    } catch (error) {
      this.logger.error('Error creating field booking without payment', {
        error: error.message,
        stack: error.stack,
        userId,
        bookingData: {
          fieldId: bookingData.fieldId,
          courtId: bookingData.courtId,
          date: bookingData.date,
          startTime: bookingData.startTime,
          endTime: bookingData.endTime,
        }
      });

      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }

      if (error.message?.includes('Slot was booked')) {
        throw new BadRequestException('Slot was booked by another user. Please refresh availability and try again.');
      }

      // Re-throw with more context if it's a known error
      const errorMessage = error.message || 'Failed to create booking. Please try again.';
      throw new InternalServerErrorException(errorMessage);
    } finally {
      await session.endSession();
    }

    return booking;
  }

  /**
   * Create or find guest user for anonymous bookings
   * Guest users are temporary users created from email/phone for booking purposes
   */
  private async createOrFindGuestUser(
    guestEmail: string,
    guestName?: string,
    guestPhone?: string,
    session?: ClientSession
  ): Promise<User> {
    if (!guestEmail) {
      throw new BadRequestException('Email is required for guest bookings');
    }

    const existingUser = await this.userModel.findOne({ email: guestEmail }).session(session || null);
    if (existingUser) {
      this.logger.log(`Found existing user for guest email: ${guestEmail}`);
      return existingUser;
    }

    const guestUser = new this.userModel({
      fullName: guestName || guestEmail.split('@')[0],
      email: guestEmail,
      phone: guestPhone || undefined,
      role: UserRole.USER,
      isVerified: false,
      isActive: true,
    });

    await guestUser.save({ session });
    this.logger.log(`Created guest user for email: ${guestEmail}`);
    return guestUser;
  }

  /**
   * Validate court existence, activity, and field ownership
   */
  private async validateCourt(courtId: string, fieldId: string, session: ClientSession): Promise<Court> {
    if (!Types.ObjectId.isValid(courtId)) {
      throw new BadRequestException('Invalid court ID format');
    }

    const court = await this.courtModel.findById(courtId).session(session);
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
    session: ClientSession
  ): Promise<number> {
    if (!amenityIds || amenityIds.length === 0) return 0;

    // Fetch field with amenities
    const field = await this.fieldModel
      .findById(fieldId)
      .select('amenities')
      .session(session)
      .lean();

    if (!field || !field.amenities || field.amenities.length === 0) return 0;

    // Calculate total from field's amenities that match selected IDs
    const amenityIdStrings = amenityIds.map(id => id.toString());
    const total = field.amenities
      .filter(a => amenityIdStrings.includes((a.amenity as Types.ObjectId).toString()))
      .reduce((sum, a) => sum + (a.price || 0), 0);

    return total;
  }

  // Note: Email sending is now handled by BookingEmailService after transaction commits
  // This prevents email delays from causing transaction timeouts

  /**
   * Create combined Field + Coach booking (Pure Lazy Creation)
   * Handles both field and coach slots reservation in a single transaction
   */
  async createCombinedBooking(
    userId: string | null,
    dto: CreateCombinedBookingDto
  ): Promise<Booking> {
    const session: ClientSession = await this.connection.startSession();
    let booking: Booking;
    let finalUserId: string;
    let coachName: string | undefined;
    let coachEmail: string | undefined;
    let coachPrice: number = 0;
    let fieldPrice: number = 0;
    let fieldName: string | undefined;
    let fieldAddress: string | undefined;
    let fieldOwnerEmail: string | undefined;
    let guestUser: any;

    try {
      // Step 0: Resolve userId
      if (!userId) {
        if (!dto.guestEmail) {
          throw new BadRequestException('Email is required for guest bookings');
        }
        // Guest user creation/lookup happens outside transaction first (optimization)
        guestUser = await this.createOrFindGuestUser(
          dto.guestEmail,
          dto.guestName,
          dto.guestPhone
        );
        finalUserId = (guestUser._id as Types.ObjectId).toString();
      } else {
        finalUserId = userId;
      }

      booking = await session.withTransaction(async () => {
        // --- 1. VALIDATE & LOCK FIELD ---
        const field = await this.fieldModel.findById(dto.fieldId).session(session);
        if (!field || !field.isActive) throw new NotFoundException('Field not found or inactive');

        fieldName = field.name;
        fieldAddress = field.location?.address || '';

        const court = await this.validateCourt(dto.courtId, dto.fieldId, session);
        const bookingDate = new Date(dto.date);

        // Validate Field Time Slots
        this.availabilityService.validateTimeSlots(dto.startTime, dto.endTime, field, bookingDate);

        // Upsert Field Schedule (Lazy)
        const fieldSchedule = await this.scheduleModel.findOneAndUpdate(
          { field: new Types.ObjectId(dto.fieldId), court: court._id, date: bookingDate },
          {
            $setOnInsert: {
              field: new Types.ObjectId(dto.fieldId),
              court: court._id,
              date: bookingDate,
              bookedSlots: [],
              isHoliday: false
            },
            $inc: { version: 1 }
          },
          { upsert: true, new: true, session }
        ).exec();

        if (fieldSchedule.isHoliday) throw new BadRequestException(`Field holiday: ${fieldSchedule.holidayReason}`);

        // ✅ CRITICAL FIX: Only check actual Booking records (source of truth)
        // Schedule.bookedSlots often contains the same slots as Booking records, causing false positive conflicts
        // The availability API uses Booking records as the primary source, so we should match that behavior
        this.logger.log(`[createCombinedBooking] Checking field availability for date: ${bookingDate.toISOString()}, court: ${(court as any)._id.toString()}, time: ${dto.startTime} - ${dto.endTime}`);

        const actualFieldBookings = await this.availabilityService.getExistingBookingsForDate(
          dto.fieldId,
          bookingDate,
          (court as any)._id.toString(),
          session // ✅ Pass session for transactional consistency
        );

        this.logger.log(`[createCombinedBooking] Found ${actualFieldBookings.length} existing bookings`);

        // Only use actualFieldBookings to check conflicts (avoid duplicate counting from Schedule.bookedSlots)
        const fieldBookedSlots = actualFieldBookings.map(b => ({
          startTime: b.startTime,
          endTime: b.endTime,
          bookingId: (b._id as any).toString(),
          status: b.status
        }));

        this.logger.log(`[createCombinedBooking] Field booked slots: ${JSON.stringify(fieldBookedSlots)}`);

        const fieldConflict = this.availabilityService.findSlotConflict(dto.startTime, dto.endTime, fieldBookedSlots);

        if (fieldConflict) {
          this.logger.error(`[createCombinedBooking] Conflict detected! Requested slot ${dto.startTime} - ${dto.endTime} conflicts with existing slot ${fieldConflict.startTime} - ${fieldConflict.endTime}`);
        }
        if (fieldConflict) {
          throw new BadRequestException(`Field slots are not available. Conflict with: ${fieldConflict.startTime} - ${fieldConflict.endTime}`);
        }

        // --- 2. VALIDATE & LOCK COACH ---
        const coachProfile = await this.coachProfileModel.findOne({ user: new Types.ObjectId(dto.coachId) }).session(session);
        if (!coachProfile) throw new NotFoundException('Coach not found');

        const coachUser = await this.userModel.findById(dto.coachId).session(session);
        if (coachUser) {
          coachName = coachUser.fullName;
          coachEmail = coachUser.email;
        }
        const coachConfig = await this.coachesService.getCoachById(dto.coachId); // Get config for pricing
        if (!coachConfig) throw new NotFoundException('Coach config not found');

        // Upsert Coach Schedule (Lazy)
        const coachSchedule = await this.scheduleModel.findOneAndUpdate(
          { coach: new Types.ObjectId(String(coachProfile._id)), date: bookingDate },
          {
            $setOnInsert: {
              field: new Types.ObjectId(dto.fieldId), // Associate with field context
              coach: new Types.ObjectId(String(coachProfile._id)),
              date: bookingDate,
              bookedSlots: [],
              isHoliday: false
            },
            $inc: { version: 1 }
          },
          { upsert: true, new: true, session }
        ).exec();

        if (coachSchedule.isHoliday) throw new BadRequestException(`Coach holiday: ${coachSchedule.holidayReason}`);
        const coachConflict = this.availabilityService.findSlotConflict(dto.startTime, dto.endTime, coachSchedule.bookedSlots);
        if (coachConflict) {
          throw new BadRequestException(`Coach slots are not available. Conflict with: ${coachConflict.startTime} - ${coachConflict.endTime}`);
        }

        // --- 3. CALCULATE PRICING ---
        // Field Price
        const fieldPricing = this.availabilityService.calculatePricing(
          dto.startTime, dto.endTime, field, bookingDate
        );
        fieldPrice = fieldPricing.totalPrice;

        // Amenities Fee - ✅ CALCULATE FROM FIELD
        const amenitiesFee = await this.calculateAmenitiesFee(
          dto.fieldId,
          dto.selectedAmenities || [],
          session
        );

        // Coach Price
        const startMin = this.availabilityService.timeStringToMinutes(dto.startTime);
        const endMin = this.availabilityService.timeStringToMinutes(dto.endTime);
        const hours = (endMin - startMin) / 60;
        coachPrice = Math.round((coachConfig.hourlyRate || coachProfile.hourlyRate || 0) * hours);

        // Total = Field + Amenities + Coach
        const bookingAmount = fieldPrice + amenitiesFee + coachPrice;
        const platformFee = Math.round(bookingAmount * 0.05);
        const totalAmount = bookingAmount + platformFee;

        // Determine payment method and handle PayOS specifics
        const paymentMethod = dto.paymentMethod ?? PaymentMethod.BANK_TRANSFER;
        let externalTransactionId: string | undefined;

        if (paymentMethod === PaymentMethod.PAYOS) {
          externalTransactionId = generatePayOSOrderCode().toString();
          this.logger.log(`Generated PayOS orderCode: ${externalTransactionId} for combined booking`);
        }

        // --- 4. CREATE BOOKING ---
        const createdBooking = new this.bookingModel({
          user: new Types.ObjectId(finalUserId),
          field: new Types.ObjectId(dto.fieldId),
          court: court._id,
          requestedCoach: new Types.ObjectId(String(coachProfile._id)),
          date: bookingDate,
          type: BookingType.FIELD_COACH, // Combined field + coach booking
          startTime: dto.startTime,
          endTime: dto.endTime,
          numSlots: this.availabilityService.calculateNumSlots(dto.startTime, dto.endTime, field.slotDuration),

          status: BookingStatus.PENDING,
          paymentStatus: 'unpaid',
          coachStatus: 'pending', // Pending coach acceptance
          approvalStatus: dto.note ? 'pending' : undefined, // Pending field owner acceptance if note

          bookingAmount,
          platformFee,
          totalPrice: totalAmount,
          amenitiesFee,  // ✅ Save amenities fee
          selectedAmenities: dto.selectedAmenities?.map(id => new Types.ObjectId(id)) || [],  // ✅ Save selected amenities
          note: dto.note,

          pricingSnapshot: {
            basePrice: field.basePrice,
            appliedMultiplier: fieldPricing.multiplier,
            priceBreakdown: `Field: ${fieldPrice} + Amenities: ${amenitiesFee} + Coach: ${coachPrice}`  // ✅ Updated breakdown
          },

          metadata: {
            paymentMethod: paymentMethod,
            isSlotHold: true, // Hold slots immediately
            slotsReleased: false
          }
        });

        await createdBooking.save({ session });

        // --- 5. CREATE PAYMENT ---
        // ⚠️ IMPORTANT: For FIELD_COACH bookings, transaction is NOT created immediately
        // Transaction will be created AFTER coach accepts and user proceeds to payment
        // This is handled by the coach acceptance flow and payment callback

        // REMOVED: Automatic transaction creation
        // const payment = await this.transactionsService.createPayment({...}, session);
        // createdBooking.transaction = payment._id as Types.ObjectId;

        // Transaction will be created later when:
        // 1. Coach accepts the booking (sends payment link)
        // 2. User completes payment (payment callback creates transaction)

        // --- 6. UPDATE SCHEDULES (Book Slots) ---
        // Book Field
        const fieldUpdateResult = await this.scheduleModel.findOneAndUpdate(
          { _id: fieldSchedule._id, version: fieldSchedule.version },
          { $push: { bookedSlots: { startTime: dto.startTime, endTime: dto.endTime } }, $inc: { version: 1 } },
          { session, new: true }
        ).exec();
        if (!fieldUpdateResult) throw new BadRequestException('Field slot booked by another user');

        // Book Coach
        const coachUpdateResult = await this.scheduleModel.findOneAndUpdate(
          { _id: coachSchedule._id, version: coachSchedule.version },
          { $push: { bookedSlots: { startTime: dto.startTime, endTime: dto.endTime } }, $inc: { version: 1 } },
          { session, new: true }
        ).exec();
        if (!coachUpdateResult) throw new BadRequestException('Coach slot booked by another user');

        return createdBooking;
      }, {
        readConcern: { level: 'snapshot' },
        writeConcern: { w: 'majority', j: true },
        maxCommitTimeMS: 15000
      });

      // --- 7. NOTIFICATIONS (Outside Transaction) ---
      // Emit event for real-time notifications
      this.eventEmitter.emit('booking.created', {
        bookingId: booking._id,
        userId: finalUserId,
        fieldId: dto.fieldId,
        courtId: dto.courtId,
        coachId: dto.coachId,
        date: dto.date,
        startTime: dto.startTime,
        endTime: dto.endTime,
        type: BookingType.FIELD_COACH
      });

      // Send email (outside transaction)
      try {
        let customerEmail: string | undefined;
        if (dto.guestEmail) {
          customerEmail = dto.guestEmail;
        } else if (finalUserId) {
          const user = await this.userModel.findById(finalUserId).select('email').lean();
          customerEmail = user?.email;
        }

        if (customerEmail && coachName) {
          // Re-fetch field for details
          const field = await this.fieldModel.findById(dto.fieldId).select('name location').lean();

          await this.emailService.sendCombinedBookingPendingConfirmation({
            to: customerEmail,
            field: {
              name: (field as any)?.name || 'Sân bóng',
              address: (field as any)?.location?.address || ''
            },
            coach: { name: coachName || 'HLV' },
            booking: {
              date: new Date(booking.date).toLocaleDateString('vi-VN'),
              startTime: booking.startTime,
              endTime: booking.endTime
            },
            pricing: {
              totalFormatted: (booking.totalPrice || 0).toLocaleString('vi-VN') + '₫'
            },
            paymentMethod: 11 // 11: PayOS (Fixed for combined bookings)
          });
        }

        // Send Email to Coach
        if (coachEmail) {
          await this.emailService.sendCoachNewRequest({
            to: coachEmail,
            customer: { fullName: dto.guestName || (guestUser ? guestUser.fullName : 'Khách hàng') },
            field: {
              name: fieldName || 'Sân bóng',
              address: fieldAddress || ''
            },
            booking: {
              date: new Date(booking.date).toLocaleDateString('vi-VN'),
              startTime: booking.startTime,
              endTime: booking.endTime
            },
            pricing: {
              coachPriceFormatted: (coachPrice).toLocaleString('vi-VN') + '₫'
            }
          });
        }

        // Send Email to Field Owner
        if (fieldOwnerEmail) {
          await this.emailService.sendFieldNewBookingPending({
            to: fieldOwnerEmail,
            field: { name: fieldName || 'Sân bóng' },
            customer: { fullName: dto.guestName || (guestUser ? guestUser.fullName : 'Khách hàng') },
            coach: { name: coachName || 'HLV' },
            booking: {
              date: new Date(booking.date).toLocaleDateString('vi-VN'),
              startTime: booking.startTime,
              endTime: booking.endTime
            },
            pricing: {
              fieldPriceFormatted: (fieldPrice).toLocaleString('vi-VN') + '₫'
            }
          });
        }
      } catch (error) {
        this.logger.warn('Failed to send combined booking confirmation email', error);
      }

    } catch (error) {
      this.logger.error('Error creating combined booking', error);
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      throw new InternalServerErrorException(error.message || 'Failed to create combined booking');
    } finally {
      await session.endSession();
    }

    return booking;
  }
}
