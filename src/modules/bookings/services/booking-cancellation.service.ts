import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { InjectModel, InjectConnection } from '@nestjs/mongoose'; // Added InjectConnection
import { Model, Connection, ClientSession } from 'mongoose'; // Added Connection, ClientSession
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Booking } from '../entities/booking.entity';
import { BookingStatus } from '@common/enums/booking.enum';
import {
    CancelBookingPayload,
    CancelSessionBookingPayload,
} from '../interfaces/booking-service.interfaces';
import { CancellationValidatorService } from './cancellation-validator.service';
import { CancellationRole } from '../config/cancellation-rules.config';
import { PaymentHandlerService } from './payment-handler.service';
import { WalletService } from '../../wallet/wallet.service'; // Added WalletService
import { WalletRole } from '@common/enums/wallet.enum'; // Added WalletRole

/**
 * Booking Cancellation Service
 * Handles all booking cancellation operations
 * Extracted from BookingsService for better code organization
 */
@Injectable()
export class BookingCancellationService {
    private readonly logger = new Logger(BookingCancellationService.name);

    constructor(
        @InjectModel(Booking.name) private readonly bookingModel: Model<Booking>,
        @InjectConnection() private readonly connection: Connection, // Injected Connection
        private readonly eventEmitter: EventEmitter2,
        private readonly cancellationValidator: CancellationValidatorService,
        private readonly paymentHandlerService: PaymentHandlerService,
        private readonly walletService: WalletService, // Injected WalletService
    ) { }

    /**
     * Cancel field booking with cancellation rules
     * Applies refund policy based on time until booking start
     */
    async cancelBooking(data: CancelBookingPayload) {
        const session: ClientSession = await this.connection.startSession();
        session.startTransaction();

        try {
            const booking = await this.bookingModel.findById(data.bookingId).session(session);
            if (!booking) {
                throw new BadRequestException('Booking not found');
            }

            // Check authorization
            if (String(booking.user) !== String(data.userId)) {
                throw new BadRequestException(
                    'You are not authorized to cancel this booking',
                );
            }

            // ✅ Handle Owner Reserved Booking Cancellation (Revert Fee)
            if (booking.metadata?.isOwnerReserved) {
                const feeToRefund = booking.platformFee || 0;

                // Credit back to owner wallet pendingBalance
                const ownerWallet = await this.walletService.getOrCreateWallet(
                    booking.user.toString(),
                    WalletRole.FIELD_OWNER,
                    session
                );

                ownerWallet.pendingBalance = (ownerWallet.pendingBalance || 0) + feeToRefund;
                ownerWallet.lastTransactionAt = new Date();
                await ownerWallet.save({ session });

                this.logger.log(
                    `[Owner Cancel] Reverted fee ${feeToRefund}₫ to pendingBalance for owner-reserved booking ${booking._id}`
                );

                // Update booking status
                booking.status = BookingStatus.CANCELLED;
                booking.cancellationReason = data.cancellationReason || 'Owner cancelled reserved slot';
                booking.paymentStatus = 'refunded'; // Mark as refunded (fee returned)

                await booking.save({ session });

                // Release slots
                await this.paymentHandlerService.releaseBookingSlots(booking);

                await session.commitTransaction();

                // Emit notification
                this.eventEmitter.emit('booking.cancelled.by.owner', {
                    bookingId: booking._id,
                    userId: booking.user,
                    ownerId: booking.user,
                    fieldId: booking.field,
                    penaltyAmount: 0,
                    refundAmount: feeToRefund,
                    reason: booking.cancellationReason,
                    isRevert: true
                });

                return booking;
            }

            // --- STANDARD USER CANCELLATION FLOW ---

            // Validate cancellation eligibility
            const eligibility = this.cancellationValidator.validateCancellationEligibility(
                booking,
                CancellationRole.USER
            );

            if (!eligibility.allowed) {
                throw new BadRequestException(eligibility.errorMessage || 'Cannot cancel this booking');
            }

            // Calculate refund amount
            const { refundAmount, refundPercentage } = this.cancellationValidator.calculateUserRefund(booking);

            // Process refund if applicable
            if (refundAmount > 0) {
                try {
                    await this.paymentHandlerService.handleRefund(
                        (booking as any)._id.toString(),
                        'credit', // Refund to user's refundBalance
                        refundAmount,
                        `User cancellation: ${refundPercentage}% refund (${data.cancellationReason || 'No reason provided'})`,
                        session // [NEW] Pass session
                    );
                    this.logger.log(
                        `[Cancel Booking] Processed refund of ${refundAmount}₫ (${refundPercentage}%) for booking ${data.bookingId}`
                    );
                } catch (error) {
                    this.logger.error(
                        `[Cancel Booking] Failed to process refund for booking ${data.bookingId}:`,
                        error
                    );
                    // Continue with cancellation even if refund fails (will be handled manually)
                    // Note: If refund fails inside transaction, it will throw and abort automatically if we propagate error.
                    // But here we are catching it. If handleRefund uses shared session, the transaction might already be aborted by MongoDB driver on error.
                    // Ideally we should throw here to rollback everything if refund fails.
                    throw error;
                }
            } else {
                this.logger.log(
                    `[Cancel Booking] No refund for booking ${data.bookingId} (${refundPercentage}% refund policy)`
                );
            }

            // Update booking status
            booking.status = BookingStatus.CANCELLED;
            booking.cancellationReason = data.cancellationReason || `User cancelled (${refundPercentage}% refund)`;
            if (refundAmount > 0) {
                (booking as any).paymentStatus = 'refunded';

                // [NEW] Log refund to note for admin (as requested)
                const logMessage = `[System Log] User cancelled. Refund required: ${refundAmount.toLocaleString('vi-VN')} VND (${refundPercentage}%). Reason: ${data.cancellationReason || 'No reason'}`;
                booking.note = booking.note ? `${booking.note}\n${logMessage}` : logMessage;
            }
            await booking.save({ session });

            // Release schedule slots
            await this.paymentHandlerService.releaseBookingSlots(booking, session); // [NEW] Pass session

            await session.commitTransaction();

            // Emit notification with court info and refund details
            this.eventEmitter.emit('booking.cancelled', {
                bookingId: booking._id,
                userId: booking.user,
                fieldId: booking.field,
                courtId: (booking as any).court,
                date: booking.date,
                startTime: booking.startTime,
                endTime: booking.endTime,
                reason: data.cancellationReason,
                refundAmount,
                refundPercentage,
            });

            return booking;

        } catch (error) {
            await session.abortTransaction();
            throw error;
        } finally {
            await session.endSession();
        }
    }

    /**
     * Cancel booking session (field + coach) (legacy)
     */
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
}
