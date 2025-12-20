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
                existingBooking.transaction = payment._id as Types.ObjectId;
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
}
