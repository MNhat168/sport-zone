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
    @InjectConnection() private readonly connection: Connection,
    private readonly eventEmitter: EventEmitter2,
    private readonly transactionsService: TransactionsService,
    private readonly emailService: EmailService,
    private readonly availabilityService: AvailabilityService,
    private readonly bookingEmailService: BookingEmailService,
  ) {}

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
          bookingDate,
          court.pricingOverride
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
        // ✅ CRITICAL: Online payments (PayOS, VNPay, etc.) must be PENDING until payment succeeds
        // Only CASH payments can be CONFIRMED immediately (if no note)
        const paymentMethod = bookingData.paymentMethod ?? PaymentMethod.CASH;
        const isOnlinePayment = paymentMethod === PaymentMethod.PAYOS || 
                                paymentMethod === PaymentMethod.VNPAY ||
                                paymentMethod === PaymentMethod.MOMO ||
                                paymentMethod === PaymentMethod.ZALOPAY ||
                                paymentMethod === PaymentMethod.EBANKING ||
                                paymentMethod === PaymentMethod.CREDIT_CARD ||
                                paymentMethod === PaymentMethod.DEBIT_CARD ||
                                paymentMethod === PaymentMethod.QR_CODE;
        
        // Booking status logic:
        // - Online payments: Always PENDING (wait for payment confirmation)
        // - Cash with note: PENDING (needs confirmation)
        // - Cash without note: CONFIRMED (immediate confirmation)
        const bookingStatus = isOnlinePayment || bookingData.note
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
          method: bookingData.paymentMethod ?? PaymentMethod.CASH,
          paymentNote: bookingData.paymentNote,
          externalTransactionId, // ✅ Pass PayOS orderCode
        }, session);

        // Update booking with transaction reference
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
    const shouldSendNow = (bookingData.paymentMethod ?? PaymentMethod.CASH) === PaymentMethod.CASH;
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
      // Step 0: Resolve userId - create guest user if needed
      if (!userId) {
        // Guest booking - validate guest info
        const guestData = bookingData as any;
        if (!guestData.guestEmail) {
          throw new BadRequestException('Email is required for guest bookings');
        }
        
        // Create or find guest user (outside transaction first to check existence)
        const guestUser = await this.createOrFindGuestUser(
          guestData.guestEmail,
          guestData.guestName,
          guestData.guestPhone
        );
        finalUserId = (guestUser._id as Types.ObjectId).toString();
        this.logger.log(`Using guest user ID: ${finalUserId} for email: ${guestData.guestEmail}`);
      } else {
        finalUserId = userId;
      }

      booking = await session.withTransaction(async () => {
        // If guest user was created outside transaction, ensure it exists in this session
        if (!userId && (bookingData as any).guestEmail) {
          const guestUserInSession = await this.userModel.findById(finalUserId).session(session);
          if (!guestUserInSession) {
            // Re-create guest user within transaction
            const guestData = bookingData as any;
            const guestUser = await this.createOrFindGuestUser(
              guestData.guestEmail,
              guestData.guestName,
              guestData.guestPhone,
              session
            );
            finalUserId = (guestUser._id as Types.ObjectId).toString();
          }
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
          bookingDate,
          court.pricingOverride
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
        let amenitiesFee = 0;
        if (bookingData.selectedAmenities && bookingData.selectedAmenities.length > 0) {
          // TODO: Calculate amenities fee from Amenity model
          amenitiesFee = 0; // Placeholder
        }

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
      this.logger.error('Error creating field booking without payment', error);
      
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      
      if (error.message?.includes('Slot was booked')) {
        throw new BadRequestException('Slot was booked by another user. Please refresh availability and try again.');
      }
      
      throw new InternalServerErrorException('Failed to create booking. Please try again.');
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

  // Note: Email sending is now handled by BookingEmailService after transaction commits
  // This prevents email delays from causing transaction timeouts
}
