import { Injectable, NotFoundException, BadRequestException, Logger, InternalServerErrorException } from '@nestjs/common';
import { InjectModel, InjectConnection } from '@nestjs/mongoose';
import { Model, Types, Connection, ClientSession } from 'mongoose';
import { Booking } from './entities/booking.entity';
import { BookingStatus, BookingType } from '@common/enums/booking.enum';
import { Schedule } from '../schedules/entities/schedule.entity';
import { Field } from '../fields/entities/field.entity';
import { Court } from '../courts/entities/court.entity';
import { FieldOwnerProfile } from '../field-owner/entities/field-owner-profile.entity';
import { User } from '../users/entities/user.entity';
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
import { PaymentProofService } from './services/payment-proof.service';

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
    private readonly paymentProofService: PaymentProofService,
  ) {
    // Setup payment event listeners - CRITICAL for booking confirmation
    this.setupPaymentEventListeners();
  }

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
   * Setup payment event listeners
   * CRITICAL: These listeners update booking status when payment completes
   */
  private setupPaymentEventListeners() {
    this.eventEmitter.on('payment.success', this.handlePaymentSuccess.bind(this));
    this.eventEmitter.on('payment.failed', this.handlePaymentFailed.bind(this));

    this.logger.log('✅ Payment event listeners registered');
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

  // ============================================================================
  // PAYMENT EVENT HANDLERS - CRITICAL FOR BOOKING CONFIRMATION
  // ============================================================================

  /**
   * Handle payment success event
   * Updates booking status from PENDING to CONFIRMED
   * ✅ SECURITY: Idempotent with atomic update to prevent race conditions
   */
  private async handlePaymentSuccess(event: {
    paymentId: string;
    bookingId: string;
    userId: string;
    amount: number;
    method?: string;
    transactionId?: string;
  }) {
    try {
      this.logger.log(`[Payment Success] Processing for booking ${event.bookingId}`);

      // Validate bookingId format
      if (!Types.ObjectId.isValid(event.bookingId)) {
        // This might be a tournament payment or other type, so we just ignore it for bookings
        // instead of logging an error
        return;
      }

      // ✅ SECURITY: Atomic update with condition check (prevents race condition)
      // This ensures only ONE update happens even if webhook is called multiple times
      // Determine booking type to decide lifecycle change
      const current = await this.bookingModel.findById(event.bookingId).select('type status').exec();
      // COACH bookings stay PENDING until coach verifies
      // FIELD_COACH bookings stay CONFIRMED (already set when coach accepted)
      // Other bookings move to CONFIRMED
      const isCoachOnly = current && String((current as any).type) === String(BookingType.COACH);
      const isFieldCoach = current && String((current as any).type) === String(BookingType.FIELD_COACH);

      const updateResult = await this.bookingModel.findOneAndUpdate(
        {
          _id: new Types.ObjectId(event.bookingId),
        },
        {
          $set: {
            paymentStatus: 'paid',
            // Only update status to CONFIRMED for FIELD bookings (not COACH or FIELD_COACH)
            ...(isCoachOnly || isFieldCoach ? {} : { status: BookingStatus.CONFIRMED }),
            transaction: new Types.ObjectId(event.paymentId)
          }
        },
        {
          new: true, // Return updated document
          // ✅ SECURITY: Write concern for durability
          writeConcern: { w: 'majority', j: true }
        }
      ).exec();

      // ✅ SECURITY: Idempotency check - if no update, already processed
      if (!updateResult) {
        const booking = await this.bookingModel.findById(event.bookingId);
        if (!booking) {
          this.logger.error(`[Payment Success] Booking ${event.bookingId} not found`);
          return;
        }

        if (booking.status === BookingStatus.CONFIRMED) {
          this.logger.warn(`[Payment Success] Booking ${event.bookingId} already confirmed (idempotent)`);
          return;
        }

        this.logger.error(`[Payment Success] Failed to update booking ${event.bookingId}`);
        return;
      }

      this.logger.log(`[Payment Success] ✅ Booking ${event.bookingId} confirmed successfully`);

      // Emit booking confirmed event for other services
      this.eventEmitter.emit('booking.confirmed', {
        bookingId: event.bookingId,
        userId: event.userId,
        fieldId: updateResult.field?.toString() || null,
        date: updateResult.date,
      });

      // Send confirmation emails to field owner and customer
      try {
        // Populate booking with field and user details
        const populatedBooking = await this.bookingModel
          .findById(event.bookingId)
          .populate('field')
          .populate('user', 'fullName email phone')
          .exec();

        if (populatedBooking && populatedBooking.field && populatedBooking.user) {
          const field = populatedBooking.field as any;
          const customerUser = populatedBooking.user as any;

          const toVnd = (amount: number) => amount.toLocaleString('vi-VN') + '₫';
          const emailPayload = {
            field: { name: field.name, address: field.location?.address || '' },
            customer: { fullName: customerUser.fullName, phone: customerUser.phone, email: customerUser.email },
            booking: {
              date: populatedBooking.date.toLocaleDateString('vi-VN'),
              startTime: populatedBooking.startTime,
              endTime: populatedBooking.endTime,
              services: [],
            },
            pricing: {
              services: [],
              fieldPriceFormatted: toVnd(populatedBooking.totalPrice || 0),
              totalFormatted: toVnd(populatedBooking.totalPrice || 0),
            },
            paymentMethod: event.method,
          };          // Get field owner email (non-blocking)
          const ownerProfileId = field.owner?.toString();
          if (ownerProfileId) {
            let fieldOwnerProfile = await this.fieldOwnerProfileModel
              .findById(ownerProfileId)
              .lean()
              .exec();

            if (!fieldOwnerProfile) {
              fieldOwnerProfile = await this.fieldOwnerProfileModel
                .findOne({ user: new Types.ObjectId(ownerProfileId) })
                .lean()
                .exec();
            }

            let ownerEmail: string | undefined;
            if (fieldOwnerProfile?.user) {
              const ownerUser = await this.userModel
                .findById(fieldOwnerProfile.user)
                .select('email')
                .lean()
                .exec();
              ownerEmail = ownerUser?.email;
            }

            // Send emails (non-blocking, errors logged but don't fail the transaction)
            if (ownerEmail) {
              await this.emailService.sendFieldOwnerBookingNotification({
                ...emailPayload,
                to: ownerEmail,
              }).catch(err => this.logger.warn('Failed to send owner email', err));
            }

            if (customerUser.email) {
              await this.emailService.sendCustomerBookingConfirmation({
                ...emailPayload,
                to: customerUser.email,
                preheader: 'Thanh toán thành công - Xác nhận đặt sân',
              }).catch(err => this.logger.warn('Failed to send customer email', err));
            }
          }
        }
      } catch (mailErr) {
        // ✅ SECURITY: Email failures don't affect booking confirmation
        this.logger.warn('[Payment Success] Failed to send confirmation emails (non-critical)', mailErr);
      }

    } catch (error) {
      // ✅ SECURITY: Log errors but don't throw - payment webhooks shouldn't fail
      this.logger.error('[Payment Success] Error processing payment success event', error);
    }
  }

  /**
   * Handle payment failed event
   * Cancels booking and releases schedule slots
   */
  private async handlePaymentFailed(event: {
    paymentId: string;
    bookingId: string;
    userId: string;
    amount: number;
    method?: string;
    transactionId?: string;
    reason: string;
  }) {
    try {
      this.logger.log(`[Payment Failed] Processing for booking ${event.bookingId}`);

      // Cancel booking and release slots using centralized cleanup service
      // CleanupService handles all validation and idempotency checks
      await this.cleanupService.cancelBookingAndReleaseSlots(
        event.bookingId,
        event.reason || 'Payment failed',
        event.paymentId
      );

      this.logger.log(`[Payment Failed] ⚠️ Booking ${event.bookingId} cancelled due to payment failure`);

    } catch (error) {
      this.logger.error('[Payment Failed] Error handling payment failure', error);
      // Don't throw - we don't want to fail the payment update
    }
  }


  /**
   * Send booking emails asynchronously (outside transaction)
   * This prevents email delays from causing transaction timeouts
   */
  // Removed old sendBookingEmailsAsync in favor of unified BookingEmailService

  /**
   * Initiate PayOS payment for an existing booking (e.g. held booking)
   */
  async createPayOSPaymentForBooking(
    userId: string | null,
    bookingId: string
  ): Promise<{ checkoutUrl: string; paymentLinkId: string; orderCode: number }> {
    // 1. Find booking
    const booking = await this.bookingModel.findById(bookingId).populate('field').exec();
    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    // 2. Validate booking state
    // Allow if status is PENDING (held)
    // If it's cancelled or completed, reject
    if (booking.status === BookingStatus.CANCELLED || booking.status === BookingStatus.COMPLETED) {
      throw new BadRequestException(`Booking is ${booking.status}, cannot proceed with payment`);
    }

    // Check if already paid
    if (booking.paymentStatus === 'paid') {
      throw new BadRequestException('Booking is already paid');
    }

    // 3. Create Transaction
    // Generate a unique order code for this attempt
    const orderCode = Number(String(Date.now()).slice(-6) + Math.floor(Math.random() * 1000));
    const totalPrice = booking.totalPrice || booking.bookingAmount || 0;

    // Create pending transaction
    const transaction = await this.transactionsService.createPayment({
      bookingId: (booking._id as any).toString(),
      userId: userId || booking.user?.toString() || new Types.ObjectId().toString(), // handle guest or missing user
      amount: totalPrice,
      method: PaymentMethod.PAYOS,
      paymentNote: `Payment for booking ${bookingId}`,
      externalTransactionId: orderCode.toString(),
    });

    // 4. Create PayOS Link
    const fieldName = (booking.field as any)?.name || 'Field';
    const paymentLinkRes = await this.payOSService.createPaymentUrl({
      orderId: bookingId, // DTO requires orderId string
      orderCode: orderCode,
      amount: totalPrice,
      description: `Book ${bookingId.slice(-6)}`,
      items: [
        {
          name: `Booking ${fieldName} - ${new Date(booking.date).toLocaleDateString()}`,
          quantity: 1,
          price: totalPrice,
        }
      ],
      // Use defaults from PayOSService config
    });

    // 5. Update booking with transaction
    booking.transaction = transaction._id as any;
    await booking.save();

    return {
      checkoutUrl: paymentLinkRes.checkoutUrl,
      paymentLinkId: paymentLinkRes.paymentLinkId,
      orderCode: orderCode
    };
  }
}
