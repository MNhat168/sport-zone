import { Injectable, NotFoundException, BadRequestException, Logger, InternalServerErrorException } from '@nestjs/common';
import { InjectModel, InjectConnection } from '@nestjs/mongoose';
import { Model, Types, Connection, ClientSession } from 'mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Booking } from '../entities/booking.entity';
import { BookingStatus } from '@common/enums/booking.enum';
import { PaymentMethod, PaymentMethodLabels } from 'src/common/enums/payment-method.enum';
import { TransactionStatus } from '@common/enums/transaction.enum';
import { TransactionsService } from '../../transactions/transactions.service';
import { BookingEmailService } from './booking-email.service';
import { AwsS3Service } from '../../../service/aws-s3.service';
import { AiService } from '../../ai/ai.service';

/**
 * Payment Proof Service
 * Handles payment proof submission for bookings
 * Extracted from BookingsService for better code organization
 */
@Injectable()
export class PaymentProofService {
    private readonly logger = new Logger(PaymentProofService.name);

    constructor(
        @InjectModel(Booking.name) private readonly bookingModel: Model<Booking>,
        @InjectConnection() private readonly connection: Connection,
        private readonly eventEmitter: EventEmitter2,
        private readonly transactionsService: TransactionsService,
        private readonly bookingEmailService: BookingEmailService,
        private readonly awsS3Service: AwsS3Service,
        private readonly aiService: AiService,
    ) { }

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

                // Calculate total amount
                const totalAmount = existingBooking.bookingAmount + existingBooking.platformFee;

                let payment: any;
                if (existingBooking.transaction) {
                    // Step: Allow replacement - Update existing transaction
                    payment = await this.transactionsService.getPaymentById(existingBooking.transaction.toString());
                    if (!payment) {
                        throw new BadRequestException('Linked transaction not found. Please contact support.');
                    }

                    this.logger.log(`Replacing payment proof for booking ${bookingId}, transaction ${payment._id}`);

                    // Update transaction with new payment proof information
                    payment.paymentProofImageUrl = paymentProofImageUrl;
                    payment.paymentProofStatus = 'pending';
                    payment.paymentProofRejectionReason = undefined; // Clear old reason
                    payment.notes = (payment.notes || '') + `\n[Payment proof replaced at ${new Date().toISOString()}]`;
                    await payment.save({ session });
                } else {
                    // Step: First time submission - Create new Payment transaction
                    payment = await this.transactionsService.createPayment({
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

                    // Update booking with transaction reference
                    existingBooking.transaction = payment._id as Types.ObjectId;
                }

                if (payment.status === TransactionStatus.SUCCEEDED) {
                    existingBooking.paymentStatus = 'paid';
                    // Keep status as PENDING until field owner verifies payment proof
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

            // Step 3: Run AI verification (outside of primary transaction session to avoid long-held locks)
            try {
                this.logger.log(`Starting AI verification for booking: ${bookingId}`);
                const ocrResult = await this.aiService.extractTransactionData(proofImageBuffer, mimetype);

                const totalAmount = booking.bookingAmount + booking.platformFee;

                let verificationAction: 'approve' | 'reject' | 'keep_pending' = 'keep_pending';
                let reason = '';

                if (!ocrResult.isReceipt) {
                    verificationAction = 'reject';
                    reason = 'Uploaded file does not appear to be a payment receipt.';
                } else if (Math.abs(ocrResult.amount - totalAmount) > 1) { // Allowance for minor rounding
                    verificationAction = 'reject';
                    reason = `Amount mismatch: Expected ${totalAmount}, but receipt shows ${ocrResult.amount}.`;
                } else if (ocrResult.confidence < 0.7) {
                    this.logger.warn(`AI verification confidence too low (${ocrResult.confidence}) for booking ${bookingId}`);
                    verificationAction = 'keep_pending';
                } else {
                    verificationAction = 'approve';
                }

                if (verificationAction !== 'keep_pending') {
                    this.logger.log(`AI Verification result for ${bookingId}: ${verificationAction}. Reason: ${reason}`);

                    // Use a new transaction to apply the result
                    const resultSession = await this.connection.startSession();
                    await resultSession.withTransaction(async () => {
                        const updatedBooking = await this.bookingModel.findById(bookingId).session(resultSession);
                        if (!updatedBooking || !updatedBooking.transaction) {
                            this.logger.warn(`Could not find booking or transaction for result update: ${bookingId}`);
                            return;
                        }

                        const transaction = await this.transactionsService.getPaymentById(updatedBooking.transaction.toString());
                        if (!transaction) {
                            this.logger.warn(`Could not find transaction for booking: ${bookingId}`);
                            return;
                        }

                        if (verificationAction === 'approve') {
                            updatedBooking.status = BookingStatus.CONFIRMED;
                            updatedBooking.paymentStatus = 'paid';
                            (transaction as any).paymentProofStatus = 'approved';
                            (transaction as any).status = TransactionStatus.SUCCEEDED;
                            (transaction as any).completedAt = new Date();
                            (transaction as any).notes = ((transaction as any).notes || '') + '\n[Auto-approved by AI OCR]';

                            this.eventEmitter.emit('payment.success', {
                                paymentId: (transaction as any)._id?.toString(),
                                bookingId: (updatedBooking as any)._id?.toString(),
                                userId: updatedBooking.user.toString(),
                                amount: (transaction as any).amount,
                                method: (transaction as any).method,
                            });
                        } else {
                            (transaction as any).paymentProofStatus = 'rejected';
                            (transaction as any).paymentProofRejectionReason = reason;

                            // ✅ Increment retry attempts
                            updatedBooking.retryAttempts = (updatedBooking.retryAttempts || 0) + 1;

                            if (updatedBooking.retryAttempts >= 4) {
                                updatedBooking.status = BookingStatus.CANCELLED;
                                updatedBooking.cancellationReason = 'Tự động hủy do gửi minh chứng sai 4 lần.';
                                (transaction as any).notes = ((transaction as any).notes || '') + '\n[Auto-cancelled: Limit of 4 payment proof rejections reached]';
                                this.logger.log(`Booking ${bookingId} auto-cancelled after 4th rejection.`);
                            } else {
                                updatedBooking.note = (updatedBooking.note || '') + `\n[Auto-rejected by AI OCR: ${reason}] (Lần ${updatedBooking.retryAttempts}/4)`;
                            }
                        }

                        await (transaction as any).save({ session: resultSession });
                        await updatedBooking.save({ session: resultSession });
                    });
                    await resultSession.endSession();
                }
            } catch (aiError) {
                this.logger.error(`AI verification failed for booking ${bookingId}`, aiError);
                // We don't throw here, as the proof is already submitted and can be verified manually
            }

            // Send confirmation email (outside transaction)
            try {
                await this.bookingEmailService.sendConfirmationEmails(bookingId, PaymentMethodLabels[PaymentMethod.BANK_TRANSFER]);
            } catch (emailError) {
                this.logger.warn('Failed to send booking confirmation email', emailError);
                // Don't fail the booking if email fails
            }

            // Return the latest version of the booking after all updates
            return (await this.bookingModel.findById(bookingId).populate('transaction')) as Booking;
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
}
