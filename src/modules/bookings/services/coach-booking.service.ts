import { Injectable, NotFoundException, BadRequestException, Logger, InternalServerErrorException } from '@nestjs/common';
import { InjectModel, InjectConnection } from '@nestjs/mongoose';
import { Model, Types, Connection, ClientSession } from 'mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Booking } from '../entities/booking.entity';
import { BookingStatus, BookingType } from '@common/enums/booking.enum';
import { Schedule } from '../../schedules/entities/schedule.entity';
import { Field } from '../../fields/entities/field.entity';
import { User } from '../../users/entities/user.entity';
import { CoachProfile } from '../../coaches/entities/coach-profile.entity';
import { Transaction } from '../../transactions/entities/transaction.entity';
import { PaymentMethod, PaymentMethodLabels } from 'src/common/enums/payment-method.enum';
import { CreateCoachBookingLazyDto } from '../dto/create-coach-booking-lazy.dto';
import { CreateCoachBookingV2Dto } from '../dto/create-coach-booking-v2.dto';
import { CoachesService } from '../../coaches/coaches.service';
import { TransactionsService } from '../../transactions/transactions.service';
import { AvailabilityService } from './availability.service';
import { BookingEmailService } from './booking-email.service';
import { PayOSService } from '../../transactions/payos.service';
import { AwsS3Service } from '../../../service/aws-s3.service';

/**
 * Coach Booking Service
 * Handles all coach booking creation and management operations
 * Extracted from BookingsService for better code organization
 */
@Injectable()
export class CoachBookingService {
    private readonly logger = new Logger(CoachBookingService.name);

    constructor(
        @InjectModel(Booking.name) private readonly bookingModel: Model<Booking>,
        @InjectModel(Schedule.name) private readonly scheduleModel: Model<Schedule>,
        @InjectModel(Field.name) private readonly fieldModel: Model<Field>,
        @InjectModel(User.name) private readonly userModel: Model<User>,
        @InjectModel(CoachProfile.name) private readonly coachProfileModel: Model<CoachProfile>,
        @InjectConnection() private readonly connection: Connection,
        private readonly eventEmitter: EventEmitter2,
        private readonly coachesService: CoachesService,
        private readonly transactionsService: TransactionsService,
        private readonly availabilityService: AvailabilityService,
        private readonly bookingEmailService: BookingEmailService,
        private readonly payOSService: PayOSService,
        private readonly awsS3Service: AwsS3Service,
    ) { }

    /**
     * Create or find guest user for anonymous bookings
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
            role: 'user',
            isVerified: false,
            isActive: true,
        });

        await guestUser.save({ session });
        this.logger.log(`Created guest user for email: ${guestEmail}`);
        return guestUser;
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
                    const { generatePayOSOrderCode } = await import('../../transactions/utils/payos.utils');
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
     * Get bookings for the currently authenticated coach
     */
    async getMyCoachBookings(userId: string): Promise<Booking[]> {
        // Find coach profile from user ID
        const coachProfile = await this.coachProfileModel.findOne({ user: new Types.ObjectId(userId) }).lean();

        if (!coachProfile) {
            throw new NotFoundException('Coach profile not found for this user');
        }

        // Get bookings by coach profile ID
        const bookings = await this.bookingModel
            .find({ requestedCoach: coachProfile._id })
            .populate('user')
            .populate('field')
            .lean()
            .exec();

        return bookings as unknown as Booking[];
    }

    /**
     * Get bookings for the currently authenticated coach filtered by type
     * @param userId - User ID of the coach
     * @param type - Optional booking type filter (COACH or FIELD_COACH)
     */
    async getMyCoachBookingsByType(
        userId: string,
        type?: BookingType
    ): Promise<Booking[]> {
        const coachProfile = await this.coachProfileModel
            .findOne({ user: new Types.ObjectId(userId) })
            .lean();

        if (!coachProfile) {
            throw new NotFoundException('Coach profile not found for this user');
        }

        const query: any = { requestedCoach: coachProfile._id };

        // Add type filter if provided
        if (type) {
            query.type = type;
        }

        const bookings = await this.bookingModel
            .find(query)
            .populate('user')
            .populate('field')
            .populate('court')
            .lean()
            .exec();

        return bookings as unknown as Booking[];
    }
}
