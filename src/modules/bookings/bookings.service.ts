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

  /**
   * Owner: list bookings that have user notes for fields owned by current user
   */
  async listOwnerNoteBookings(ownerUserId: string, options?: { status?: 'pending' | 'accepted' | 'denied'; limit?: number; page?: number }) {
    const limit = options?.limit ?? 10;
    const page = options?.page ?? 1;
    const skip = (page - 1) * limit;

    // Find fields owned by this user (owner can be stored as profile or user ID)
    const ownerProfile = await this.fieldOwnerProfileModel.findOne({ user: new Types.ObjectId(ownerUserId) }).lean();
    const ownerIdCandidates = [new Types.ObjectId(ownerUserId)];
    if (ownerProfile?._id) ownerIdCandidates.push(ownerProfile._id as any);

    const fieldIds = await this.fieldModel.find({ owner: { $in: ownerIdCandidates } }).select('_id').lean();
    const fieldIdList = fieldIds.map((f: any) => f._id);

    const filter: any = {
      field: { $in: fieldIdList },
      note: { $exists: true, $ne: '' },
    };

    // Support both legacy noteStatus and new approvalStatus
    if (options?.status) {
      const approvalMap: Record<string, string> = { pending: 'pending', accepted: 'approved', denied: 'rejected' };
      const mapped = approvalMap[options.status] || options.status;
      filter.$or = [
        { noteStatus: options.status },
        { approvalStatus: mapped }
      ];
    }

    const total = await this.bookingModel.countDocuments(filter);
    const bookings = await this.bookingModel
      .find(filter)
      .populate('user', 'fullName email phone')
      .populate('field', 'name location')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    return {
      bookings,
      pagination: {
        total,
        limit,
        page,
        totalPages: Math.ceil(total / limit),
      }
    };
  }

  /**
   * Owner: get detail of a booking with note ensuring ownership
   */
  async getOwnerBookingDetail(ownerUserId: string, bookingId: string) {
    const booking = await this.bookingModel
      .findById(bookingId)
      .populate('user', 'fullName email phone')
      .populate('field', 'name location owner')
      .lean();
    if (!booking) throw new NotFoundException('Booking not found');

    const field = booking.field as any;
    const ownerProfile = await this.fieldOwnerProfileModel.findOne({ user: new Types.ObjectId(ownerUserId) }).lean();
    const ownerMatches = (field.owner?.toString?.() === ownerUserId) || (!!ownerProfile && field.owner?.toString?.() === ownerProfile._id.toString());
    if (!ownerMatches) throw new BadRequestException('Not authorized to view this booking');
    return booking;
  }

  /**
   * Owner: accept user's special note and (for online methods) send payment link to user via email
   */
  async ownerAcceptNote(ownerUserId: string, bookingId: string, clientIp?: string) {
    const booking = await this.bookingModel
      .findById(bookingId)
      .populate('user', 'fullName email phone')
      .populate('field', 'name location owner')
      .exec();
    if (!booking) throw new NotFoundException('Booking not found');

    const field = booking.field as any;
    const ownerProfile = await this.fieldOwnerProfileModel.findOne({ user: new Types.ObjectId(ownerUserId) }).lean();
    const ownerMatches = (field.owner?.toString?.() === ownerUserId) || (!!ownerProfile && field.owner?.toString?.() === ownerProfile._id.toString());
    if (!ownerMatches) throw new BadRequestException('Not authorized to update this booking');

    // Update noteStatus and new approvalStatus (Phase 2)
    (booking as any).noteStatus = 'accepted';
    (booking as any).approvalStatus = 'approved';
    await booking.save();

    // Send payment link if method is online (PayOS)
    let paymentLink: string | undefined;
    const transaction = booking.transaction ? await this.transactionsService.getPaymentById((booking.transaction as any).toString()) : await this.transactionsService.getPaymentByBookingId((booking._id as any).toString());

    const amountTotal = (booking as any).bookingAmount !== undefined && (booking as any).platformFee !== undefined
      ? (booking as any).bookingAmount + (booking as any).platformFee
      : booking.totalPrice || 0;

    // Define expiry window for payment links
    const expiresInMinutes = 10;
    const expiresAtDate = new Date(Date.now() + expiresInMinutes * 60 * 1000);

    if (transaction) {
      if (transaction.method === PaymentMethod.PAYOS) {
        const orderCode = transaction.externalTransactionId ? Number(transaction.externalTransactionId) : undefined;
        const payosRes = await this.payOSService.createPaymentUrl({
          orderId: (booking._id as any).toString(),
          amount: amountTotal,
          description: `Thanh toán đặt sân ${field.name}`,
          items: [{ name: field.name, quantity: 1, price: amountTotal }],
          buyerName: (booking.user as any).fullName,
          buyerEmail: (booking.user as any).email,
          orderCode,
          expiredAt: expiresInMinutes, // minutes
        });
        paymentLink = payosRes.checkoutUrl;
      }
    }

    // Send payment request email if link available
    if (paymentLink) {
      const toVnd = (amount: number) => amount.toLocaleString('vi-VN') + '₫';
      await this.emailService.sendBookingPaymentRequest({
        to: ((booking.user as any).email),
        field: { name: field.name, address: field.location?.address },
        customer: { fullName: (booking.user as any).fullName },
        booking: {
          date: booking.date.toLocaleDateString('vi-VN'),
          startTime: booking.startTime,
          endTime: booking.endTime,
        },
        pricing: { totalFormatted: toVnd(amountTotal) },
        paymentLink,
        paymentMethod: transaction?.method as any,
        expiresAt: expiresAtDate.toLocaleString('vi-VN'),
        expiresInMinutes,
      });
    }

    return booking.toJSON();
  }

  /**
   * Owner: deny user's special note
   */
  async ownerDenyNote(ownerUserId: string, bookingId: string, reason?: string) {
    const booking = await this.bookingModel
      .findById(bookingId)
      .populate('field', 'owner')
      .exec();
    if (!booking) throw new NotFoundException('Booking not found');

    const field = booking.field as any;
    const ownerProfile = await this.fieldOwnerProfileModel.findOne({ user: new Types.ObjectId(ownerUserId) }).lean();
    const ownerMatches = (field.owner?.toString?.() === ownerUserId) || (!!ownerProfile && field.owner?.toString?.() === ownerProfile._id.toString());
    if (!ownerMatches) throw new BadRequestException('Not authorized to update this booking');

    (booking as any).noteStatus = 'denied';
    (booking as any).approvalStatus = 'rejected';
    if (reason) booking.cancellationReason = reason; // store reason if provided
    await booking.save();
    return booking.toJSON();
  }

  /**
   * Owner: accept a booking (approve booking request)
   */
  async ownerAcceptBooking(ownerUserId: string, bookingId: string) {
    const booking = await this.bookingModel
      .findById(bookingId)
      .populate('field', 'owner')
      .populate('user', 'fullName email phone')
      .exec();
    if (!booking) throw new NotFoundException('Booking not found');

    const field = booking.field as any;
    const ownerProfile = await this.fieldOwnerProfileModel.findOne({ user: new Types.ObjectId(ownerUserId) }).lean();
    const ownerMatches = (field.owner?.toString?.() === ownerUserId) || (!!ownerProfile && field.owner?.toString?.() === ownerProfile._id.toString());
    if (!ownerMatches) throw new BadRequestException('Not authorized to update this booking');

    // Update approval status
    (booking as any).approvalStatus = 'approved';
    // If booking was pending, update status to confirmed
    if (booking.status === BookingStatus.PENDING) {
      booking.status = BookingStatus.CONFIRMED;
    }
    await booking.save();
    return booking.toJSON();
  }

  /**
   * Owner: reject a booking
   */
  async ownerRejectBooking(ownerUserId: string, bookingId: string, reason?: string) {
    const booking = await this.bookingModel
      .findById(bookingId)
      .populate('field', 'owner')
      .exec();
    if (!booking) throw new NotFoundException('Booking not found');

    const field = booking.field as any;
    const ownerProfile = await this.fieldOwnerProfileModel.findOne({ user: new Types.ObjectId(ownerUserId) }).lean();
    const ownerMatches = (field.owner?.toString?.() === ownerUserId) || (!!ownerProfile && field.owner?.toString?.() === ownerProfile._id.toString());
    if (!ownerMatches) throw new BadRequestException('Not authorized to update this booking');

    // Update approval status
    (booking as any).approvalStatus = 'rejected';
    // Cancel the booking
    booking.status = BookingStatus.CANCELLED;
    if (reason) booking.cancellationReason = reason;
    await booking.save();
    return booking.toJSON();
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

  /**
   * Create coach booking (lazy) – separate payment per booking
   * ✅ FIXED: Added schedule locking, email sending, PayOS support, approvalStatus
   */
  async createCoachBookingLazy(
    userId: string,
    dto: CreateCoachBookingLazyDto
  ): Promise<Booking> {
    const session: ClientSession = await this.connection.startSession();

    // Store values outside transaction for email sending
    let booking: Booking;

    try {
      booking = await session.withTransaction(async () => {
        // Validate field
        const field = await this.fieldModel.findById(dto.fieldId).session(session);
        if (!field || !field.isActive) {
          throw new NotFoundException('Field not found or inactive');
        }

        // Validate coach - get coach profile for schedule locking
        const coachUser = await this.userModel.findById(dto.coachId).session(session);
        if (!coachUser) {
          throw new NotFoundException('Coach user not found');
        }

        const coachProfile = await this.coachProfileModel.findOne({ user: new Types.ObjectId(dto.coachId) }).session(session);
        if (!coachProfile) {
          throw new NotFoundException('Coach profile not found');
        }

        // Get coach data from service for pricing
        const coach = await this.coachesService.getCoachById(dto.coachId);
        if (!coach) {
          throw new NotFoundException('Coach not found');
        }

        // Parse date and validate time using existing helpers
        const bookingDate = new Date(dto.date);
        this.availabilityService.validateTimeSlots(dto.startTime, dto.endTime, field as any, bookingDate);

        // ✅ SECURITY: Atomic upsert with version initialization (Pure Lazy Creation)
        // For coach schedule, we use coach field in Schedule entity
        const scheduleUpdate = await this.scheduleModel.findOneAndUpdate(
          {
            coach: new Types.ObjectId(String(coachProfile._id)),
            date: bookingDate
          },
          {
            $setOnInsert: {
              field: new Types.ObjectId(dto.fieldId), // Coach booking still needs field reference
              coach: new Types.ObjectId(String(coachProfile._id)),
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
        // This prevents race conditions where 2 requests pass the check simultaneously
        const hasConflict = this.availabilityService.checkSlotConflict(
          dto.startTime,
          dto.endTime,
          scheduleUpdate.bookedSlots
        );

        if (hasConflict) {
          throw new BadRequestException('Selected time slots are not available');
        }

        // Pricing: hourlyRate * hours (rounded)
        const startMin = this.availabilityService.timeStringToMinutes(dto.startTime);
        const endMin = this.availabilityService.timeStringToMinutes(dto.endTime);
        const hours = (endMin - startMin) / 60;
        const bookingAmount = Math.round((coach.hourlyRate || coachProfile.hourlyRate || 0) * hours);
        const platformFeeRate = 0.05; // 5% platform fee
        const platformFee = Math.round(bookingAmount * platformFeeRate);
        const totalPrice = bookingAmount + platformFee;

        // Determine booking status based on payment method and note
        // ✅ CRITICAL: Online payments (PayOS, etc.) must be PENDING until payment succeeds
        // Only CASH payments can be CONFIRMED immediately (if no note)
        const paymentMethod = dto.paymentMethod ?? PaymentMethod.CASH;
        const isOnlinePayment = [
          PaymentMethod.PAYOS,
          PaymentMethod.MOMO,
          PaymentMethod.ZALOPAY,
          PaymentMethod.EBANKING,
          PaymentMethod.CREDIT_CARD,
          PaymentMethod.DEBIT_CARD,
          PaymentMethod.QR_CODE,
        ].includes(paymentMethod as any);

        // Booking status logic:
        // - Online payments: Always PENDING (wait for payment confirmation)
        // - Cash with note: PENDING (needs confirmation)
        // - Cash without note: CONFIRMED (immediate confirmation)
        const bookingStatus = (isOnlinePayment || dto.note)
          ? BookingStatus.PENDING
          : BookingStatus.CONFIRMED;

        // New explicit statuses per refactor plan (Phase 2)
        const initialPaymentStatus: 'unpaid' | 'paid' | 'refunded' = 'unpaid';
        const initialApprovalStatus: 'pending' | 'approved' | 'rejected' | undefined = dto.note ? 'pending' : undefined;

        // Create Booking with snapshot data
        const created = new this.bookingModel({
          user: new Types.ObjectId(userId),
          field: new Types.ObjectId(dto.fieldId),
          requestedCoach: new Types.ObjectId(String(coachProfile._id)),
          date: bookingDate,
          type: BookingType.COACH,
          startTime: dto.startTime,
          endTime: dto.endTime,
          numSlots: this.availabilityService.calculateNumSlots(dto.startTime, dto.endTime, (field as any).slotDuration || 60),
          status: bookingStatus,
          coachStatus: 'pending',
          paymentStatus: initialPaymentStatus,
          approvalStatus: initialApprovalStatus,
          bookingAmount,
          platformFee,
          totalPrice,
          note: dto.note,
          pricingSnapshot: {
            basePrice: coach.hourlyRate || coachProfile.hourlyRate,
            appliedMultiplier: Number((hours).toFixed(2)),
            priceBreakdown: `Coach ${coach.fullName || coachUser.fullName || ''}: ${hours}h x ${coach.hourlyRate || coachProfile.hourlyRate}₫`,
          },
        });

        await created.save({ session });

        // ✅ CRITICAL: Create Payment record WITHIN transaction session
        // This ensures payment is rolled back if booking fails
        // Use totalAmount (bookingAmount + platformFee) for payment amount
        const totalAmount = bookingAmount + platformFee;

        // ✅ CRITICAL: Generate PayOS orderCode if using PayOS payment method
        // This allows webhook/return URL to find the transaction later
        let externalTransactionId: string | undefined;
        if (paymentMethod === PaymentMethod.PAYOS) {
          const { generatePayOSOrderCode } = await import('../transactions/utils/payos.utils');
          externalTransactionId = generatePayOSOrderCode().toString();
          this.logger.log(`Generated PayOS orderCode: ${externalTransactionId} for coach booking ${created._id}`);
        }

        const payment = await this.transactionsService.createPayment({
          bookingId: (created._id as Types.ObjectId).toString(),
          userId,
          amount: totalAmount,
          method: paymentMethod,
          paymentNote: dto.paymentNote,
          externalTransactionId, // ✅ Pass PayOS orderCode
        }, session);

        // Update booking with transaction reference
        created.transaction = payment._id as Types.ObjectId;
        await created.save({ session });

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
                startTime: dto.startTime,
                endTime: dto.endTime
              }
            },
            $inc: { version: 1 }
          },
          {
            session,
            new: true
          }
        ).exec();

        // ✅ SECURITY: If version mismatch (another booking modified it), fail the transaction
        if (!scheduleUpdateResult) {
          throw new BadRequestException('Slot was booked by another user. Please refresh and try again.');
        }

        // Emit event for notifications (non-blocking, outside transaction)
        this.eventEmitter.emit('booking.created', {
          bookingId: created._id,
          userId,
          fieldId: dto.fieldId,
          coachId: dto.coachId,
          date: dto.date,
          startTime: dto.startTime,
          endTime: dto.endTime,
          type: 'coach',
        });

        return created;
      }, {
        // ✅ SECURITY: Transaction options for data integrity
        readConcern: { level: 'snapshot' },      // Isolation level - prevents dirty reads
        writeConcern: { w: 'majority', j: true }, // Durability - ensures write to majority of replicas
        maxCommitTimeMS: 15000                     // 15 second timeout for the entire transaction
      });

    } catch (error) {
      this.logger.error('Error creating coach booking', error);
      
      // Re-throw known exceptions as-is
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      
      // ✅ SECURITY: Detect optimistic locking failures (version mismatch)
      if (error.message?.includes('Slot was booked')) {
        throw new BadRequestException('Slot was booked by another user. Please refresh availability and try again.');
      }
      
      // Generic error for unexpected issues
      throw new InternalServerErrorException('Failed to create coach booking. Please try again.');
    } finally {
      await session.endSession();
    }

    // ✅ Send emails AFTER transaction commits successfully (non-blocking)
    // This prevents email delays from causing transaction timeouts
    const shouldSendNow = (dto.paymentMethod ?? PaymentMethod.CASH) === PaymentMethod.CASH;
    if (shouldSendNow) {
      // Unified confirmation emails via single handler
      const methodLabel = typeof dto.paymentMethod === 'number'
        ? PaymentMethod[dto.paymentMethod]
        : dto.paymentMethod;
      try {
        await this.bookingEmailService.sendConfirmationEmails((booking._id as Types.ObjectId).toString(), methodLabel);
      } catch (emailError) {
        this.logger.warn('Failed to send coach booking confirmation email', emailError);
        // Don't fail the booking if email fails
      }
    }

    return booking;
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

  /**
   * Submit payment proof for existing booking (created via field-booking-hold)
   * Creates payment transaction and links it to the booking
   * Does NOT release slots (they remain booked)
   */
  async submitPaymentProof(
    bookingId: string,
    proofImageBuffer: Buffer,
    mimetype: string
  ): Promise<Booking> {
    const session: ClientSession = await this.connection.startSession();
    let paymentProofImageUrl: string;

    try {
      // Step 1: Upload payment proof image to S3 (before transaction)
      try {
        paymentProofImageUrl = await this.awsS3Service.uploadImageFromBuffer(proofImageBuffer, mimetype);
        this.logger.log(`Payment proof image uploaded: ${paymentProofImageUrl}`);
      } catch (uploadError) {
        this.logger.error('Failed to upload payment proof image', uploadError);
        throw new BadRequestException('Failed to upload payment proof image. Please try again.');
      }

      const booking = await session.withTransaction(async () => {
        // Validate booking exists
        const existingBooking = await this.bookingModel.findById(bookingId).session(session);
        if (!existingBooking) {
          throw new NotFoundException('Booking not found');
        }

        // Validate booking is PENDING
        if (existingBooking.status !== BookingStatus.PENDING) {
          throw new BadRequestException(`Cannot submit payment proof for booking with status: ${existingBooking.status}`);
        }

        // Validate booking doesn't already have a payment
        if (existingBooking.transaction) {
          throw new BadRequestException('Payment proof has already been submitted for this booking');
        }

        // Validate booking is for bank transfer (check metadata)
        const metadata = existingBooking.metadata || {};
        if (metadata.paymentMethod !== PaymentMethod.BANK_TRANSFER) {
          throw new BadRequestException('This booking is not for bank transfer payment');
        }

        // Calculate total amount
        const totalAmount = existingBooking.bookingAmount + existingBooking.platformFee;

        // Create Payment transaction with payment proof info
        const payment = await this.transactionsService.createPayment({
          bookingId: bookingId,
          userId: existingBooking.user.toString(),
          amount: totalAmount,
          method: PaymentMethod.BANK_TRANSFER,
          paymentNote: existingBooking.note,
        }, session);

        // Update transaction with payment proof information (within transaction)
        payment.paymentProofImageUrl = paymentProofImageUrl;
        payment.paymentProofStatus = 'pending';
        await payment.save({ session });

        // Update booking with transaction reference and payment status
        // For BANK_TRANSFER, transaction is created with SUCCEEDED status,
        // so we should update paymentStatus to 'paid' immediately
        existingBooking.transaction = payment._id as Types.ObjectId;
        if (payment.status === TransactionStatus.SUCCEEDED) {
          existingBooking.paymentStatus = 'paid';
          // Keep status as PENDING until field owner verifies payment proof
          // Status will be updated to CONFIRMED when payment proof is approved
        }
        await existingBooking.save({ session });

        // Emit event for notifications
        this.eventEmitter.emit('payment.proof.submitted', {
          bookingId: existingBooking._id,
          paymentId: payment._id,
          userId: existingBooking.user.toString(),
          fieldId: existingBooking.field?.toString() || null,
        });

        return existingBooking;
      }, {
        readConcern: { level: 'snapshot' },
        writeConcern: { w: 'majority', j: true },
        maxCommitTimeMS: 15000
      });

      // Send confirmation email (outside transaction)
      try {
        await this.bookingEmailService.sendConfirmationEmails(bookingId, PaymentMethodLabels[PaymentMethod.BANK_TRANSFER]);
      } catch (emailError) {
        this.logger.warn('Failed to send booking confirmation email', emailError);
        // Don't fail the booking if email fails
      }

      return booking;
    } catch (error) {
      this.logger.error('Error submitting payment proof', error);

      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }

      throw new InternalServerErrorException('Failed to submit payment proof. Please try again.');
    } finally {
      await session.endSession();
    }
  }

  /**
   * Create coach booking V2 with bank transfer payment proof
   * Similar to createFieldBookingV2 but for coach bookings:
   * - Always uses PaymentMethod.BANK_TRANSFER
   * - Uploads payment proof image to S3
   * - Sets paymentProofStatus = 'pending' in transaction
   * - Booking status is PENDING until coach verifies proof
   */
  async createCoachBookingV2(
    userId: string | null,
    bookingData: CreateCoachBookingV2Dto,
    proofImageBuffer: Buffer,
    mimetype: string
  ): Promise<Booking> {
    const session: ClientSession = await this.connection.startSession();

    // Store values outside transaction for email sending
    let booking: Booking;
    let field: any;
    let coach: any;
    let coachProfile: any;
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

        // Validate field (optional for coach bookings)
        if (bookingData.fieldId) {
          field = await this.fieldModel.findById(bookingData.fieldId).session(session);
          if (!field || !field.isActive) {
            throw new NotFoundException('Field not found or inactive');
          }
        }

        // Validate coach - get coach profile
        const coachUser = await this.userModel.findById(bookingData.coachId).session(session);
        if (!coachUser) {
          throw new NotFoundException('Coach user not found');
        }

        coachProfile = await this.coachProfileModel.findOne({ user: new Types.ObjectId(bookingData.coachId) }).session(session);
        if (!coachProfile) {
          throw new NotFoundException('Coach profile not found');
        }

        // Get coach data from service for pricing
        coach = await this.coachesService.getCoachById(bookingData.coachId);
        if (!coach) {
          throw new NotFoundException('Coach not found');
        }

        // Parse booking date
        const bookingDate = new Date(bookingData.date);

        // Validate time slots (only if field is provided)
        if (field) {
          this.availabilityService.validateTimeSlots(bookingData.startTime, bookingData.endTime, field, bookingDate);
        }

        // Calculate hours and pricing
        const startMin = this.availabilityService.timeStringToMinutes(bookingData.startTime);
        const endMin = this.availabilityService.timeStringToMinutes(bookingData.endTime);
        const hours = (endMin - startMin) / 60;
        const bookingAmount = Math.round((coach.hourlyRate || coachProfile.hourlyRate || 0) * hours);
        const platformFeeRate = 0.05; // 5% platform fee
        const platformFee = Math.round(bookingAmount * platformFeeRate);
        const totalPrice = bookingAmount + platformFee;

        // Calculate numSlots (for consistency with field booking)
        // Use default slotDuration (60 minutes) if field is not provided
        const slotDuration = field ? ((field as any).slotDuration || 60) : 60;
        const numSlots = this.availabilityService.calculateNumSlots(bookingData.startTime, bookingData.endTime, slotDuration);

        // ✅ SECURITY: Atomic upsert with version initialization (Pure Lazy Creation)
        // For coach schedule, we use coach field in Schedule entity
        const scheduleUpdate = await this.scheduleModel.findOneAndUpdate(
          {
            coach: new Types.ObjectId(String(coachProfile._id)),
            date: bookingDate
          },
          {
            $setOnInsert: {
              ...(bookingData.fieldId ? { field: new Types.ObjectId(bookingData.fieldId) } : {}), // Field is optional for coach bookings
              coach: new Types.ObjectId(String(coachProfile._id)),
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

        // V2: Always use BANK_TRANSFER and set status to PENDING (waiting for coach verification)
        const paymentMethod = PaymentMethod.BANK_TRANSFER;
        const bookingStatus = BookingStatus.PENDING;
        const initialPaymentStatus: 'unpaid' = 'unpaid';

        // Create Booking with snapshot data
        const createdBooking = new this.bookingModel({
          user: new Types.ObjectId(finalUserId),
          ...(bookingData.fieldId ? { field: new Types.ObjectId(bookingData.fieldId) } : {}), // Field is optional for coach bookings
          requestedCoach: new Types.ObjectId(String(coachProfile._id)),
          date: bookingDate,
          type: BookingType.COACH,
          startTime: bookingData.startTime,
          endTime: bookingData.endTime,
          numSlots,
          status: bookingStatus,
          paymentStatus: initialPaymentStatus,
          coachStatus: 'pending',
          bookingAmount: bookingAmount,
          platformFee: platformFee,
          totalPrice: totalPrice,
          note: bookingData.note,
          pricingSnapshot: {
            basePrice: coach.hourlyRate || coachProfile.hourlyRate,
            appliedMultiplier: Number(hours.toFixed(2)),
            priceBreakdown: `Coach ${coach.name || coachUser.fullName || ''}: ${hours}h x ${coach.hourlyRate || coachProfile.hourlyRate}₫`,
          },
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
      this.logger.error('Error creating coach booking V2', error);

      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }

      throw new InternalServerErrorException('Failed to create coach booking. Please try again.');
    } finally {
      await session.endSession();
    }
  }

  /**
   * Create coach booking without payment (for bank transfer slot hold)
   * Creates booking and holds slots, but does NOT create payment transaction
   * Payment will be created later when user submits payment proof
   * Similar to createFieldBookingWithoutPayment but for coach bookings
   */
  async createCoachBookingWithoutPayment(
    userId: string | null,
    bookingData: CreateCoachBookingV2Dto
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

        // Validate field (optional for coach bookings)
        let field: any = null;
        if (bookingData.fieldId) {
          field = await this.fieldModel.findById(bookingData.fieldId).session(session);
          if (!field || !field.isActive) {
            throw new NotFoundException('Field not found or inactive');
          }
        }

        // Validate coach - get coach profile
        const coachUser = await this.userModel.findById(bookingData.coachId).session(session);
        if (!coachUser) {
          throw new NotFoundException('Coach user not found');
        }

        const coachProfile = await this.coachProfileModel.findOne({ user: new Types.ObjectId(bookingData.coachId) }).session(session);
        if (!coachProfile) {
          throw new NotFoundException('Coach profile not found');
        }

        // Get coach data from service for pricing
        const coach = await this.coachesService.getCoachById(bookingData.coachId);
        if (!coach) {
          throw new NotFoundException('Coach not found');
        }

        // Parse booking date
        const bookingDate = new Date(bookingData.date);

        // Validate time slots (only if field is provided)
        if (field) {
          this.availabilityService.validateTimeSlots(bookingData.startTime, bookingData.endTime, field, bookingDate);
        }

        // Calculate hours and pricing
        const startMin = this.availabilityService.timeStringToMinutes(bookingData.startTime);
        const endMin = this.availabilityService.timeStringToMinutes(bookingData.endTime);
        const hours = (endMin - startMin) / 60;
        const bookingAmount = Math.round((coach.hourlyRate || coachProfile.hourlyRate || 0) * hours);
        const platformFeeRate = 0.05; // 5% platform fee
        const platformFee = Math.round(bookingAmount * platformFeeRate);
        const totalPrice = bookingAmount + platformFee;

        // Calculate numSlots (for consistency with field booking)
        // Use default slotDuration (60 minutes) if field is not provided
        const slotDuration = field ? ((field as any).slotDuration || 60) : 60;
        const numSlots = this.availabilityService.calculateNumSlots(bookingData.startTime, bookingData.endTime, slotDuration);

        // ✅ SECURITY: Atomic upsert with version initialization (Pure Lazy Creation)
        // For coach schedule, we use coach field in Schedule entity
        const scheduleUpdate = await this.scheduleModel.findOneAndUpdate(
          {
            coach: new Types.ObjectId(String(coachProfile._id)),
            date: bookingDate
          },
          {
            $setOnInsert: {
              ...(bookingData.fieldId ? { field: new Types.ObjectId(bookingData.fieldId) } : {}), // Field is optional for coach bookings
              coach: new Types.ObjectId(String(coachProfile._id)),
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

        // For bank transfer without payment: Always PENDING, unpaid
        const bookingStatus = BookingStatus.PENDING;
        const initialPaymentStatus: 'unpaid' = 'unpaid';
        const initialApprovalStatus: 'pending' | 'approved' | 'rejected' | undefined = bookingData.note ? 'pending' : undefined;

        // Create Booking with snapshot data (NO payment transaction)
        const createdBooking = new this.bookingModel({
          user: new Types.ObjectId(finalUserId),
          ...(bookingData.fieldId ? { field: new Types.ObjectId(bookingData.fieldId) } : {}), // Field is optional for coach bookings
          requestedCoach: new Types.ObjectId(String(coachProfile._id)),
          date: bookingDate,
          type: BookingType.COACH,
          startTime: bookingData.startTime,
          endTime: bookingData.endTime,
          numSlots,
          status: bookingStatus,
          paymentStatus: initialPaymentStatus,
          approvalStatus: initialApprovalStatus,
          coachStatus: 'pending',
          bookingAmount: bookingAmount,
          platformFee: platformFee,
          totalPrice: totalPrice,
          note: bookingData.note,
          pricingSnapshot: {
            basePrice: coach.hourlyRate || coachProfile.hourlyRate,
            appliedMultiplier: Number(hours.toFixed(2)),
            priceBreakdown: `Coach ${coach.name || coachUser.fullName || ''}: ${hours}h x ${coach.hourlyRate || coachProfile.hourlyRate}₫`,
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
          coachId: bookingData.coachId,
          date: bookingData.date,
          startTime: bookingData.startTime,
          endTime: bookingData.endTime,
          type: 'coach',
        });

        return createdBooking;
      }, {
        readConcern: { level: 'snapshot' },
        writeConcern: { w: 'majority', j: true },
        maxCommitTimeMS: 15000
      });

    } catch (error) {
      this.logger.error('Error creating coach booking without payment', error);
      
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

  async getByRequestedCoachId(coachId: string): Promise<Booking[]> {
    return this.sessionBookingService.getByRequestedCoachId(coachId);
  }

  /**
   * Lấy danh sách booking của user với pagination và filter
   * @param userId - ID của user
   * @param options - Options để filter và paginate
   * @returns Danh sách booking với pagination info
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
    try {

      // Build filter query
      const filter: any = { user: new Types.ObjectId(userId) };

      if (options.status) {
        filter.status = options.status.toLowerCase();
      }

      if (options.paymentStatus) {
        filter.paymentStatus = options.paymentStatus;
      }

      if (options.approvalStatus) {
        filter.approvalStatus = options.approvalStatus;
      }

      if (options.coachStatus) {
        filter.coachStatus = options.coachStatus;
      }

      if (options.type) {
        filter.type = options.type.toLowerCase();
      }

      // Calculate skip for pagination
      const skip = (options.page - 1) * options.limit;

      // Get total count for pagination
      const total = await this.bookingModel.countDocuments(filter);

      // Get bookings with population (không dùng .lean() để tận dụng BaseEntity toJSON transform)
      const rawBookings = await this.bookingModel
        .find(filter)
        .populate({
          path: 'field',
          select: 'name location images sportType owner',
          populate: {
            path: 'owner',
            select: 'fullName phoneNumber email'
          }
        })
        .populate({
          path: 'requestedCoach',
          select: 'user hourlyRate sports',
          populate: {
            path: 'user',
            select: 'fullName phoneNumber email'
          }
        })
        .populate('selectedAmenities', 'name price')
        .populate('user', 'fullName email phoneNumber')
        // Include timestamp fields so paidOn can be determined from transaction
        .populate('transaction', 'amount method status notes createdAt paidAt updatedAt')
        .sort({ createdAt: -1 }) // Newest first
        .skip(skip)
        .limit(options.limit)
        .exec();

      // Convert to JSON để trigger BaseEntity toJSON transform
      const bookings = rawBookings.map(booking => booking.toJSON());

      const totalPages = Math.ceil(total / options.limit);


      return {
        bookings,
        pagination: {
          total,
          page: options.page,
          limit: options.limit,
          totalPages,
          hasNextPage: options.page < totalPages,
          hasPrevPage: options.page > 1
        }
      };

    } catch (error) {
      this.logger.error(`Error getting user bookings for ${userId}:`, error);
      throw new InternalServerErrorException('Failed to get user bookings');
    }
  }

  /**
   * Get simplified booking invoice list for a user
   * Returns fields: bookingId, name, date, time, payment, paidOn, status
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
    const { bookings, pagination } = await this.getUserBookings(userId, options);

    const invoices = bookings.map(b => {
      const bookingId = b._id || b.id || b.bookingId;
      const fieldName = (b.field && (b.field.name || b.field.title)) || b.fieldName || 'Unknown Field';
      const fieldImage = (b.field && (b.field.images?.[0] || b.field.image)) || b.fieldImage || '-';
      // date may be string or Date
      const dateIso = b.date ? new Date(b.date).toISOString().split('T')[0] : null;
      const timeRange = `${b.startTime || ''}${b.startTime && b.endTime ? ' - ' : ''}${b.endTime || ''}`;

      // Prefer transaction amount if exists, otherwise fall back to totalPrice
      const payment = (b.transaction && (b.transaction.amount ?? b.transaction.total)) ?? (b.totalPrice ?? 0);

      // Try common transaction timestamp fields
      const paidOn = (b.transaction && (b.transaction.createdAt || b.transaction.paidAt || b.transaction.updatedAt)) || null;

      return {
        bookingId,
        name: fieldName,
        fieldImage,
        date: dateIso,
        time: timeRange,
        payment,
        paidOn,
        status: b.status || 'unknown',
        paymentStatus: b.paymentStatus || 'unpaid',
        approvalStatus: b.approvalStatus || (b.noteStatus === 'accepted' ? 'approved' : b.noteStatus === 'denied' ? 'rejected' : b.note ? 'pending' : undefined),
        coachStatus: b.coachStatus || 'pending',
      };
    });

    return { invoices, pagination };
  }

  /**
   * Get the next upcoming booking for the user (for the Upcoming Appointment card)
   * Returns the nearest booking with status CONFIRMED and date >= today
   */
  async getUpcomingBooking(userId: string): Promise<any | null> {
    try {
      // ✅ CRITICAL: Use UTC methods to normalize date
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);

      const booking = await this.bookingModel
        .findOne({
          user: new Types.ObjectId(userId),
          status: 'confirmed',
          date: { $gte: today },
        })
        .populate({
          path: 'field',
          select: 'name owner',
          populate: {
            path: 'owner',
            select: 'fullName',
          },
        })
        .sort({ date: 1, startTime: 1 })
        .exec();

      if (!booking) return null;

      const b = booking.toJSON ? booking.toJSON() : booking;

      const bookingId = b._id || b.id;
      const fieldObj = (b.field as any) || {};
      const ownerObj = (fieldObj.owner as any) || {};
      const fieldName = fieldObj.name || fieldObj.title || 'Sân';
      const academyName = ownerObj.fullName || ownerObj.name || 'Unknown Academy';
      const dateIso = b.date ? new Date(b.date).toISOString().split('T')[0] : null;
      const timeRange = `${b.startTime || ''}${b.startTime && b.endTime ? ' đến ' : ''}${b.endTime || ''}`;

      return {
        bookingId,
        academyName,
        fieldName,
        date: dateIso,
        time: timeRange,
      };
    } catch (error) {
      this.logger.error('Error getting upcoming booking', error);
      throw new InternalServerErrorException('Failed to get upcoming booking');
    }
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

  /**
   * Get field owner profile by user ID
   */
  async getFieldOwnerProfileByUserId(userId: string): Promise<{ id: string } | null> {
    try {
      const profile = await this.fieldOwnerProfileModel
        .findOne({ user: new Types.ObjectId(userId) })
        .select('_id')
        .lean()
        .exec();

      if (!profile) {
        return null;
      }

      return { id: profile._id.toString() };
    } catch (error) {
      this.logger.error('Error getting field owner profile by user ID', error);
      return null;
    }
  }

  /**
   * Verify payment proof for booking (Field Owner only)
   * Updates transaction paymentProofStatus and booking status accordingly
   */
  async verifyPaymentProof(
    bookingId: string,
    ownerId: string,
    action: 'approve' | 'reject',
    rejectionReason?: string
  ): Promise<Booking> {
    const session: ClientSession = await this.connection.startSession();

    try {
      return await session.withTransaction(async () => {
        // Validate booking ID
        if (!Types.ObjectId.isValid(bookingId)) {
          throw new BadRequestException(`Invalid booking ID format: "${bookingId}"`);
        }

        // Get booking with field
        const booking = await this.bookingModel
          .findById(bookingId)
          .populate('field')
          .session(session)
          .exec();

        if (!booking) {
          throw new NotFoundException(`Booking with ID ${bookingId} not found`);
        }

        // Verify that the booking belongs to a field owned by this owner
        const field = booking.field as any;
        const fieldOwnerId = field?.owner?.toString();
        
        if (!fieldOwnerId || fieldOwnerId !== ownerId) {
          throw new BadRequestException('You do not have permission to verify payment proof for this booking');
        }

        // Get transaction directly using transactionModel
        if (!booking.transaction) {
          throw new BadRequestException('Booking does not have an associated transaction');
        }

        const transaction = await this.transactionModel
          .findById(booking.transaction)
          .session(session)
          .exec();

        if (!transaction) {
          throw new BadRequestException('Transaction not found');
        }

        // Check if payment proof exists
        if (!transaction.paymentProofImageUrl) {
          throw new BadRequestException('Booking does not have a payment proof image');
        }

        // Check if already verified
        if (transaction.paymentProofStatus && transaction.paymentProofStatus !== 'pending') {
          throw new BadRequestException(`Payment proof has already been ${transaction.paymentProofStatus}`);
        }

        // Update transaction with verification result
        transaction.paymentProofStatus = action === 'approve' ? 'approved' : 'rejected';
        transaction.paymentProofVerifiedBy = new Types.ObjectId(ownerId);
        transaction.paymentProofVerifiedAt = new Date();
        
        if (action === 'reject' && rejectionReason) {
          transaction.paymentProofRejectionReason = rejectionReason;
        }

        await transaction.save({ session });

        // Update booking based on action
        if (action === 'approve') {
          // Approve: Update booking to CONFIRMED and paymentStatus to paid
          booking.status = BookingStatus.CONFIRMED;
          booking.paymentStatus = 'paid';
          
          // Update transaction status to succeeded
          transaction.status = TransactionStatus.SUCCEEDED;
          transaction.completedAt = new Date();
          await transaction.save({ session });
        } else {
          // Reject: Keep booking as PENDING, paymentStatus as unpaid
          // Optionally add rejection reason to booking note
          if (rejectionReason) {
            booking.note = booking.note 
              ? `${booking.note}\n[Payment Proof Rejected: ${rejectionReason}]`
              : `[Payment Proof Rejected: ${rejectionReason}]`;
          }
        }

        await booking.save({ session });

        // Emit payment success event if approved (to trigger balance updates)
        if (action === 'approve') {
          this.eventEmitter.emit('payment.success', {
            paymentId: (transaction._id as Types.ObjectId).toString(),
            bookingId: (booking._id as Types.ObjectId).toString(),
            userId: booking.user.toString(),
            amount: transaction.amount,
            method: transaction.method,
          });
        }

        return booking;
      });
    } catch (error) {
      this.logger.error('Error verifying payment proof', error);
      
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }

      throw new InternalServerErrorException('Failed to verify payment proof. Please try again.');
    } finally {
      await session.endSession();
    }
  }

  /**
   * Verify payment proof for coach booking (Coach only)
   * Updates transaction paymentProofStatus and booking status accordingly
   */
  async verifyCoachPaymentProof(
    bookingId: string,
    coachUserId: string,
    action: 'approve' | 'reject',
    rejectionReason?: string
  ): Promise<Booking> {
    const session: ClientSession = await this.connection.startSession();

    try {
      return await session.withTransaction(async () => {
        // Validate booking ID
        if (!Types.ObjectId.isValid(bookingId)) {
          throw new BadRequestException(`Invalid booking ID format: "${bookingId}"`);
        }

        // Get booking with requestedCoach
        const booking = await this.bookingModel
          .findById(bookingId)
          .populate('requestedCoach')
          .session(session)
          .exec();

        if (!booking) {
          throw new NotFoundException(`Booking with ID ${bookingId} not found`);
        }

        // Verify that this is a coach booking
        if (booking.type !== BookingType.COACH) {
          throw new BadRequestException('This is not a coach booking');
        }

        // Get coach profile from userId
        const coachProfile = await this.coachProfileModel
          .findOne({ user: new Types.ObjectId(coachUserId) })
          .session(session)
          .exec();

        if (!coachProfile) {
          throw new NotFoundException('Coach profile not found');
        }

        // Verify that the booking is for this coach
        const requestedCoachId = (booking.requestedCoach as any)?._id?.toString() || (booking.requestedCoach as any)?.toString();
        const coachProfileId = (coachProfile._id as Types.ObjectId).toString();
        
        if (!requestedCoachId || requestedCoachId !== coachProfileId) {
          throw new BadRequestException('You do not have permission to verify payment proof for this booking');
        }

        // Get transaction directly using transactionModel
        if (!booking.transaction) {
          throw new BadRequestException('Booking does not have an associated transaction');
        }

        const transaction = await this.transactionModel
          .findById(booking.transaction)
          .session(session)
          .exec();

        if (!transaction) {
          throw new BadRequestException('Transaction not found');
        }

        // Check if payment proof exists
        if (!transaction.paymentProofImageUrl) {
          throw new BadRequestException('Booking does not have a payment proof image');
        }

        // Check if already verified
        if (transaction.paymentProofStatus && transaction.paymentProofStatus !== 'pending') {
          throw new BadRequestException(`Payment proof has already been ${transaction.paymentProofStatus}`);
        }

        // Update transaction with verification result
        transaction.paymentProofStatus = action === 'approve' ? 'approved' : 'rejected';
        transaction.paymentProofVerifiedBy = new Types.ObjectId(coachUserId);
        transaction.paymentProofVerifiedAt = new Date();
        
        if (action === 'reject' && rejectionReason) {
          transaction.paymentProofRejectionReason = rejectionReason;
        }

        await transaction.save({ session });

        // Update booking based on action
        if (action === 'approve') {
          // Approve: Update booking to CONFIRMED and paymentStatus to paid
          booking.status = BookingStatus.CONFIRMED;
          booking.paymentStatus = 'paid';
          booking.coachStatus = 'accepted';
          
          // Update transaction status to succeeded
          transaction.status = TransactionStatus.SUCCEEDED;
          transaction.completedAt = new Date();
          await transaction.save({ session });
        } else {
          // Reject: Keep booking as PENDING, paymentStatus as unpaid
          // Optionally add rejection reason to booking note
          if (rejectionReason) {
            booking.note = booking.note 
              ? `${booking.note}\n[Payment Proof Rejected: ${rejectionReason}]`
              : `[Payment Proof Rejected: ${rejectionReason}]`;
          }
          booking.coachStatus = 'declined';
        }

        await booking.save({ session });

        // Emit payment success event if approved (to trigger balance updates)
        if (action === 'approve') {
          this.eventEmitter.emit('payment.success', {
            paymentId: (transaction._id as Types.ObjectId).toString(),
            bookingId: (booking._id as Types.ObjectId).toString(),
            userId: booking.user.toString(),
            amount: transaction.amount,
            method: transaction.method,
          });
        }

        return booking;
      });
    } catch (error) {
      this.logger.error('Error verifying coach payment proof', error);
      
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }

      throw new InternalServerErrorException('Failed to verify payment proof. Please try again.');
    } finally {
      await session.endSession();
    }
  }

  /**
   * Get pending payment proofs for field owner
   * Returns bookings that have payment proof status = 'pending' and paymentStatus = 'unpaid'
   */
  async getPendingPaymentProofs(ownerId: string): Promise<Booking[]> {
    try {
      // Find all fields owned by this owner
      const fields = await this.fieldModel
        .find({ owner: new Types.ObjectId(ownerId) })
        .select('_id')
        .lean()
        .exec();

      const fieldIds = fields.map(f => f._id);

      if (fieldIds.length === 0) {
        return [];
      }

      // Find transactions with pending payment proof
      const pendingTransactions = await this.transactionModel
        .find({
          paymentProofStatus: 'pending',
          paymentProofImageUrl: { $exists: true, $ne: null },
        })
        .select('_id booking')
        .lean()
        .exec();

      const bookingIds = pendingTransactions
        .map(t => t.booking)
        .filter(id => id !== null && id !== undefined)
        .map(id => new Types.ObjectId(id.toString()));

      if (bookingIds.length === 0) {
        return [];
      }

      // Find bookings that:
      // 1. Belong to fields owned by this owner
      // 2. Have paymentStatus = 'unpaid'
      // 3. Have transaction with pending payment proof
      const bookings = await this.bookingModel
        .find({
          _id: { $in: bookingIds },
          field: { $in: fieldIds },
          paymentStatus: 'unpaid',
          type: BookingType.FIELD,
        })
        .populate('user', 'fullName email phone')
        .populate('field', 'name')
        .populate('transaction')
        .sort({ createdAt: -1 })
        .exec();

      return bookings;
    } catch (error) {
      this.logger.error('Error getting pending payment proofs', error);
      throw new InternalServerErrorException('Failed to get pending payment proofs. Please try again.');
    }
  }

  /**
   * Get pending payment proofs for coach
   * Returns bookings that have payment proof status = 'pending' and paymentStatus = 'unpaid' for this coach
   */
  async getPendingPaymentProofsForCoach(coachUserId: string): Promise<Booking[]> {
    try {
      // Find coach profile by user ID
      const coachProfile = await this.coachProfileModel
        .findOne({ user: new Types.ObjectId(coachUserId) })
        .lean()
        .exec();

      if (!coachProfile) {
        return [];
      }

      // Find transactions with pending payment proof
      const pendingTransactions = await this.transactionModel
        .find({
          paymentProofStatus: 'pending',
          paymentProofImageUrl: { $exists: true, $ne: null },
        })
        .select('_id booking')
        .lean()
        .exec();

      const bookingIds = pendingTransactions
        .map(t => t.booking)
        .filter(id => id !== null && id !== undefined)
        .map(id => new Types.ObjectId(id.toString()));

      if (bookingIds.length === 0) {
        return [];
      }

      // Find bookings that:
      // 1. Are coach bookings (type = COACH)
      // 2. Requested coach matches this coach profile
      // 3. Have paymentStatus = 'unpaid'
      // 4. Have transaction with pending payment proof
      const coachProfileId = coachProfile._id instanceof Types.ObjectId 
        ? coachProfile._id 
        : new Types.ObjectId(coachProfile._id.toString());
      
      const bookings = await this.bookingModel
        .find({
          _id: { $in: bookingIds },
          type: BookingType.COACH,
          requestedCoach: coachProfileId,
          paymentStatus: 'unpaid',
        })
        .populate('user', 'fullName email phone')
        .populate('field', 'name')
        .populate('transaction')
        .sort({ createdAt: -1 })
        .exec();

      return bookings;
    } catch (error) {
      this.logger.error('Error getting pending payment proofs for coach', error);
      throw new InternalServerErrorException('Failed to get pending payment proofs. Please try again.');
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
        this.logger.error(`[Payment Success] Invalid booking ID: ${event.bookingId}`);
        return;
      }

      // ✅ SECURITY: Atomic update with condition check (prevents race condition)
      // This ensures only ONE update happens even if webhook is called multiple times
      // Determine booking type to decide lifecycle change
      const current = await this.bookingModel.findById(event.bookingId).select('type status').exec();
      const isCoach = current && String((current as any).type) === String(BookingType.COACH);

      const updateResult = await this.bookingModel.findOneAndUpdate(
        {
          _id: new Types.ObjectId(event.bookingId),
        },
        {
          $set: {
            paymentStatus: 'paid',
            ...(isCoach ? {} : { status: BookingStatus.CONFIRMED }),
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
}
