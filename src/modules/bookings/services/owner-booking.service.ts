import { Injectable, NotFoundException, BadRequestException, Logger, InternalServerErrorException, ForbiddenException } from '@nestjs/common';
import { InjectModel, InjectConnection } from '@nestjs/mongoose';
import { Model, Types, Connection, ClientSession } from 'mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Booking } from '../entities/booking.entity';
import { BookingStatus, BookingType } from '@common/enums/booking.enum';
import { Field } from '../../fields/entities/field.entity';
import { FieldOwnerProfile } from '../../field-owner/entities/field-owner-profile.entity';
import { Transaction } from '../../transactions/entities/transaction.entity';
import { CoachProfile } from '../../coaches/entities/coach-profile.entity';
import { TransactionStatus, TransactionType } from '@common/enums/transaction.enum';
import { PaymentMethod } from 'src/common/enums/payment-method.enum';
import { EmailService } from '../../email/email.service';
import { PayOSService } from '../../transactions/payos.service';
import { BookingEmailService } from './booking-email.service';
import { TransactionsService } from '../../transactions/transactions.service';
import { WalletService } from '../../wallet/wallet.service';
import { AvailabilityService } from './availability.service';
import { Court } from '../../courts/entities/court.entity';
import { Schedule } from '../../schedules/entities/schedule.entity';
import { CreateOwnerReservedBookingDto } from '../dto/create-owner-reserved-booking.dto';
import { WalletRole } from '@common/enums/wallet.enum';

/**
 * Owner Booking Service
 * Handles all field owner operations: note approval, booking approval, payment proof verification
 * Extracted from BookingsService for better code organization
 */
@Injectable()
export class OwnerBookingService {
    private readonly logger = new Logger(OwnerBookingService.name);

    constructor(
        @InjectModel(Booking.name) private readonly bookingModel: Model<Booking>,
        @InjectModel(Field.name) private readonly fieldModel: Model<Field>,
        @InjectModel(FieldOwnerProfile.name) private readonly fieldOwnerProfileModel: Model<FieldOwnerProfile>,
        @InjectModel(Transaction.name) private readonly transactionModel: Model<Transaction>,
        @InjectModel(CoachProfile.name) private readonly coachProfileModel: Model<CoachProfile>,
        @InjectModel(Court.name) private readonly courtModel: Model<Court>,
        @InjectModel(Schedule.name) private readonly scheduleModel: Model<Schedule>,
        @InjectConnection() private readonly connection: Connection,
        private readonly eventEmitter: EventEmitter2,
        private readonly emailService: EmailService,
        private readonly payOSService: PayOSService,
        private readonly bookingEmailService: BookingEmailService,
        private readonly transactionsService: TransactionsService,
        private readonly walletService: WalletService,
        private readonly availabilityService: AvailabilityService,
    ) { }

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
            .populate({
                path: 'court',
                select: 'name courtNumber',
            })
            .lean();
        if (!booking) throw new NotFoundException('Booking not found');

        const field = booking.field as any;
        const ownerProfile = await this.fieldOwnerProfileModel.findOne({ user: new Types.ObjectId(ownerUserId) }).lean();
        const ownerMatches = (field.owner?.toString?.() === ownerUserId) || (!!ownerProfile && field.owner?.toString?.() === ownerProfile._id.toString());
        if (!ownerMatches) throw new BadRequestException('Not authorized to view this booking');

        // ✅ Get transaction using TransactionsService instead of populate
        const transaction = await this.transactionsService.getPaymentByBookingId(bookingId);
        if (transaction) {
            (booking as any).transaction = {
                status: transaction.status,
                paymentProofImageUrl: transaction.paymentProofImageUrl,
                paymentProofStatus: transaction.paymentProofStatus,
                paymentProofRejectionReason: transaction.paymentProofRejectionReason,
            };
        }

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
        // ✅ Use TransactionsService instead of booking.transaction
        const transaction = await this.transactionsService.getPaymentByBookingId((booking._id as any).toString());

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

        // Send confirmation email
        try {
            await this.bookingEmailService.sendConfirmationEmails(booking.id);
        } catch (err) {
            this.logger.warn(`[OwnerAcceptBooking] Failed to send confirmation email for booking ${bookingId}`, err);
        }

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

                // ✅ Get transaction using TransactionsService query instead of booking.transaction
                const transaction = await this.transactionModel
                    .findOne({
                        booking: new Types.ObjectId(bookingId),
                        type: 'payment'
                    })
                    .session(session)
                    .exec();

                if (!transaction) {
                    throw new BadRequestException('Booking does not have an associated transaction');
                }

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

                // ✅ Get transaction using TransactionsService query instead of booking.transaction
                const transaction = await this.transactionModel
                    .findOne({
                        booking: new Types.ObjectId(bookingId),
                        type: 'payment'
                    })
                    .session(session)
                    .exec();

                if (!transaction) {
                    throw new BadRequestException('Booking does not have an associated transaction');
                }

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
                    paymentProofStatus: { $in: ['pending', 'rejected'] },
                    paymentProofImageUrl: { $exists: true, $ne: null },
                })
                .select('_id')
                .lean()
                .exec();

            const transactionIds = pendingTransactions.map(t => t._id);

            if (transactionIds.length === 0) {
                return [];
            }



            // Find bookings that:
            // 1. Belong to fields owned by this owner
            // 2. Have paymentStatus = 'unpaid'
            // 3. Are linked to one of the pending transactions
            const bookings = await this.bookingModel
                .find({
                    transaction: { $in: transactionIds },
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
                    paymentProofStatus: { $in: ['pending', 'rejected'] },
                    paymentProofImageUrl: { $exists: true, $ne: null },
                })
                .select('_id')
                .lean()
                .exec();

            const transactionIds = pendingTransactions.map(t => t._id);

            if (transactionIds.length === 0) {
                return [];
            }

            // Find bookings that:
            // 1. Are coach bookings (type = COACH)
            // 2. Requested coach matches this coach profile
            // 3. Have paymentStatus = 'unpaid'
            // 4. Are linked to one of the pending transactions
            const coachProfileId = new Types.ObjectId((coachProfile._id as any).toString());

            const bookings = await this.bookingModel
                .find({
                    transaction: { $in: transactionIds },
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
     * Create owner-reserved booking
     * Allows field owner to reserve their own slots with system fee deducted from pendingBalance
     */
    async createOwnerReservedBooking(
        ownerUserId: string,
        bookingData: CreateOwnerReservedBookingDto
    ): Promise<Booking> {
        const session: ClientSession = await this.connection.startSession();

        try {
            return await session.withTransaction(async () => {
                // 1. Verify field ownership
                const field = await this.fieldModel.findById(bookingData.fieldId).session(session).exec();
                if (!field || !field.isActive) {
                    throw new NotFoundException('Field not found or inactive');
                }

                const ownerProfile = await this.fieldOwnerProfileModel
                    .findOne({ user: new Types.ObjectId(ownerUserId) })
                    .session(session)
                    .exec();

                if (!ownerProfile) {
                    throw new ForbiddenException('You are not a field owner');
                }

                if (field.owner.toString() !== (ownerProfile._id as Types.ObjectId).toString()) {
                    throw new ForbiddenException('You do not own this field');
                }

                // 2. Validate court
                const court = await this.courtModel.findById(bookingData.courtId).session(session).exec();
                if (!court || !court.isActive) {
                    throw new NotFoundException('Court not found or inactive');
                }

                if (court.field.toString() !== bookingData.fieldId) {
                    throw new BadRequestException('Court does not belong to the specified field');
                }

                // 3. Parse booking date
                const bookingDate = new Date(bookingData.date);
                bookingDate.setHours(0, 0, 0, 0);

                // 4. Validate time slots
                this.availabilityService.validateTimeSlots(
                    bookingData.startTime,
                    bookingData.endTime,
                    field,
                    bookingDate
                );

                // 5. Check slot availability
                const existingBookings = await this.availabilityService.getExistingBookingsForDate(
                    bookingData.fieldId,
                    bookingDate,
                    bookingData.courtId,
                    session
                );

                const hasConflict = this.availabilityService.checkSlotConflict(
                    bookingData.startTime,
                    bookingData.endTime,
                    existingBookings.map(b => ({ startTime: b.startTime, endTime: b.endTime }))
                );

                if (hasConflict) {
                    throw new BadRequestException('Time slot is already booked');
                }

                // 6. Calculate pricing
                const pricingInfo = this.availabilityService.calculatePricing(
                    bookingData.startTime,
                    bookingData.endTime,
                    field,
                    bookingDate
                );

                const originalPrice = pricingInfo.totalPrice;
                const systemFeeRate = 0.05; // 5% system fee
                const systemFeeAmount = Math.round(originalPrice * systemFeeRate);

                // 7. Check pendingBalance
                const ownerWallet = await this.walletService.getOrCreateWallet(
                    ownerUserId,
                    WalletRole.FIELD_OWNER,
                    session
                );

                const pendingBalance = ownerWallet.pendingBalance || 0;
                if (pendingBalance < systemFeeAmount) {
                    throw new BadRequestException(
                        `Số dư chờ xử lý không đủ. Cần: ${systemFeeAmount.toLocaleString('vi-VN')}₫, Hiện có: ${pendingBalance.toLocaleString('vi-VN')}₫`
                    );
                }

                // 8. Calculate numSlots
                const numSlots = this.availabilityService.calculateNumSlots(
                    bookingData.startTime,
                    bookingData.endTime,
                    field.slotDuration
                );

                // 9. Create Schedule entry (Pure Lazy Creation)
                await this.scheduleModel.findOneAndUpdate(
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
                            version: 0
                        }
                    },
                    { upsert: true, session, new: true }
                );

                // 10. Create Booking
                const booking = new this.bookingModel({
                    user: new Types.ObjectId(ownerUserId),
                    field: new Types.ObjectId(bookingData.fieldId),
                    court: court._id,
                    date: bookingDate,
                    type: BookingType.FIELD,
                    startTime: bookingData.startTime,
                    endTime: bookingData.endTime,
                    numSlots,
                    status: BookingStatus.CONFIRMED,
                    paymentStatus: 'paid',
                    bookingAmount: 0,
                    platformFee: 0,
                    totalPrice: 0,
                    amenitiesFee: 0,
                    selectedAmenities: [],
                    metadata: {
                        isOwnerReserved: true,
                        originalPrice: originalPrice,
                        systemFeeAmount: systemFeeAmount
                    },
                    note: bookingData.note,
                    pricingSnapshot: {
                        basePrice: field.basePrice,
                        appliedMultiplier: pricingInfo.multiplier,
                        priceBreakdown: pricingInfo.breakdown
                    }
                });

                await booking.save({ session });

                // 11. Deduct system fee from pendingBalance
                ownerWallet.pendingBalance = pendingBalance - systemFeeAmount;
                ownerWallet.lastTransactionAt = new Date();
                await ownerWallet.save({ session });

                // 12. Create FEE transaction
                const feeTransaction = new this.transactionModel({
                    user: new Types.ObjectId(ownerUserId),
                    amount: systemFeeAmount,
                    direction: 'out',
                    type: TransactionType.FEE,
                    method: PaymentMethod.INTERNAL,
                    status: TransactionStatus.SUCCEEDED,
                    booking: booking._id,
                    notes: `Phí hệ thống cho owner-reserved booking`,
                    completedAt: new Date()
                });

                await feeTransaction.save({ session });

                this.logger.log(
                    `[Owner Reserved] Created booking ${booking._id} for owner ${ownerUserId}. ` +
                    `Original price: ${originalPrice}₫, System fee: ${systemFeeAmount}₫`
                );

                return booking;
            });
        } catch (error) {
            this.logger.error('Error creating owner-reserved booking', error);

            if (
                error instanceof NotFoundException ||
                error instanceof BadRequestException ||
                error instanceof ForbiddenException
            ) {
                throw error;
            }

            throw new InternalServerErrorException('Failed to create owner-reserved booking. Please try again.');
        } finally {
            await session.endSession();
        }
    }
}
