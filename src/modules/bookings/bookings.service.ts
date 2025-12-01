import { Injectable, NotFoundException, BadRequestException, Logger, InternalServerErrorException } from '@nestjs/common';
import { InjectModel, InjectConnection } from '@nestjs/mongoose';
import { Model, Types, Connection, ClientSession } from 'mongoose';
import { Booking, BookingStatus, BookingType } from './entities/booking.entity';
import { Schedule } from '../schedules/entities/schedule.entity';
import { Field } from '../fields/entities/field.entity';
import { FieldOwnerProfile } from '../fields/entities/field-owner-profile.entity';
import { User } from '../users/entities/user.entity';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TransactionsService } from '../transactions/transactions.service';
import { FieldsService } from '../fields/fields.service';
import { CoachesService } from '../coaches/coaches.service';
import { EmailService } from '../email/email.service';
import { PaymentHandlerService } from './services/payment-handler.service';
import { BookingEmailService } from './services/booking-email.service';
import { CleanupService } from '../../service/cleanup.service';
import { PayOSService } from '../transactions/payos.service';
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
    @InjectModel(FieldOwnerProfile.name) private readonly fieldOwnerProfileModel: Model<FieldOwnerProfile>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectConnection() private readonly connection: Connection,
    private eventEmitter: EventEmitter2,
    private readonly transactionsService: TransactionsService,
    private readonly fieldsService: FieldsService,
    private readonly coachesService: CoachesService,
    private readonly emailService: EmailService,
    private readonly paymentHandlerService: PaymentHandlerService,
    private readonly bookingEmailService: BookingEmailService,
    private readonly cleanupService: CleanupService,
    private readonly payOSService: PayOSService,
  ) {
    // Setup payment event listeners - CRITICAL for booking confirmation
    this.setupPaymentEventListeners();
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
    if (options?.status) filter.noteStatus = options.status;

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

    // Update noteStatus
    (booking as any).noteStatus = 'accepted';
    await booking.save();

    // Send payment link if method is online (PayOS or VNPay)
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
      } else if (transaction.method === PaymentMethod.VNPAY) {
        const ip = clientIp || '127.0.0.1';
        paymentLink = this.transactionsService.createVNPayUrl(
          amountTotal,
          (transaction._id as any).toString(),
          ip,
          undefined,
          expiresInMinutes,
        );
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
    if (reason) booking.cancellationReason = reason; // store reason if provided
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
    let field: any;
    let pricingInfo: any;
    let amenitiesFee: number = 0;

    try {
      booking = await session.withTransaction(async () => {
        // Validate field
        field = await this.fieldModel.findById(bookingData.fieldId).session(session);
        if (!field || !field.isActive) {
          throw new NotFoundException('Field not found or inactive');
        }

        // Parse booking date
        const bookingDate = new Date(bookingData.date);

        // Validate time slots
        this.validateTimeSlots(bookingData.startTime, bookingData.endTime, field, bookingDate);

        // Calculate slots and pricing
        const numSlots = this.calculateNumSlots(bookingData.startTime, bookingData.endTime, field.slotDuration);
        pricingInfo = this.calculatePricing(bookingData.startTime, bookingData.endTime, field, bookingDate);

        // ✅ SECURITY: Atomic upsert with version initialization (Pure Lazy Creation)
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
        const hasConflict = this.checkSlotConflict(
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

        // Create Booking with snapshot data
        const createdBooking = new this.bookingModel({
          user: new Types.ObjectId(userId),
          field: new Types.ObjectId(bookingData.fieldId),
          date: bookingDate,
          type: BookingType.FIELD,
          startTime: bookingData.startTime,
          endTime: bookingData.endTime,
          numSlots,
          status: bookingStatus,
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

        await createdBooking.save({ session });

        // ✅ CRITICAL: Create Payment record WITHIN transaction session
        // This ensures payment is rolled back if booking fails
        // Use totalAmount (bookingAmount + platformFee) for payment amount
        const totalAmount = bookingAmount + platformFee;

        // ✅ CRITICAL: Generate PayOS orderCode if using PayOS payment method
        // This allows webhook/return URL to find the transaction later
        let externalTransactionId: string | undefined;
        if (bookingData.paymentMethod === PaymentMethod.PAYOS) {
          // Import generatePayOSOrderCode at top of file if not already imported
          const { generatePayOSOrderCode } = await import('../transactions/utils/payos.utils');
          externalTransactionId = generatePayOSOrderCode().toString();
          this.logger.log(`Generated PayOS orderCode: ${externalTransactionId} for booking ${createdBooking._id}`);
        }

        const payment = await this.transactionsService.createPayment({
          bookingId: (createdBooking._id as Types.ObjectId).toString(),
          userId: userId,
          amount: totalAmount,
          method: bookingData.paymentMethod ?? PaymentMethod.CASH,
          paymentNote: bookingData.paymentNote,
          externalTransactionId, // ✅ Pass PayOS orderCode
        }, session);

        // Update booking with transaction reference
        createdBooking.transaction = payment._id as Types.ObjectId;
        await createdBooking.save({ session });

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
          bookingId: createdBooking._id,
          userId,
          fieldId: bookingData.fieldId,
          date: bookingData.date,
          startTime: bookingData.startTime,
          endTime: bookingData.endTime
        });

        // ❌ Email sending moved OUTSIDE transaction to prevent timeout
        // Will be sent after transaction commits successfully

        return createdBooking;
      }, {
        // ✅ SECURITY: Transaction options for data integrity
        readConcern: { level: 'snapshot' },      // Isolation level - prevents dirty reads
        writeConcern: { w: 'majority', j: true }, // Durability - ensures write to majority of replicas
        maxCommitTimeMS: 15000                     // 15 second timeout for the entire transaction
      });

      // ✅ Send emails AFTER transaction commits successfully (non-blocking)
      // This prevents email delays from causing transaction timeouts
      const shouldSendNow = (bookingData.paymentMethod ?? PaymentMethod.CASH) === PaymentMethod.CASH;
      if (shouldSendNow) {
        // Unified confirmation emails via single handler
        const methodLabel = typeof bookingData.paymentMethod === 'number'
          ? PaymentMethod[bookingData.paymentMethod]
          : bookingData.paymentMethod;
        await this.bookingEmailService.sendConfirmationEmails((booking._id as any).toString(), methodLabel);
      }

      return booking;
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

    return bookings as unknown as Booking[];
  }

  /**
   * Lấy danh sách booking của user với pagination và filter
   * @param userId - ID của user
   * @param options - Options để filter và paginate
   * @returns Danh sách booking với pagination info
   */
  async getUserBookings(userId: string, options: {
    status?: string;
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
        .populate('transaction', 'amount method status notes')
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
      const updateResult = await this.bookingModel.findOneAndUpdate(
        {
          _id: new Types.ObjectId(event.bookingId),
          status: { $ne: BookingStatus.CONFIRMED } // ✅ Only update if NOT already confirmed
        },
        {
          $set: {
            status: BookingStatus.CONFIRMED,
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
        fieldId: updateResult.field.toString(),
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
