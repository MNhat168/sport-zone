import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Tournament } from './entities/tournament.entity';
import { TournamentStatus } from '@common/enums/tournament.enum';
import { TournamentFieldReservation } from './entities/tournament-field-reservation.entity';
import { ReservationStatus } from '@common/enums/tournament-field-reservation.enum';
import { Field } from '../fields/entities/field.entity';
import { Transaction } from '../transactions/entities/transaction.entity';
import { TransactionStatus, TransactionType } from '@common/enums/transaction.enum';
import { User } from '../users/entities/user.entity'; // Add User import
import { CreateTournamentDto, RegisterTournamentDto } from './dto/create-tournament.dto';
import { SPORT_RULES_MAP, TeamSizeMap, calculateParticipants } from 'src/common/enums/sport-type.enum';
import { PaymentMethod } from 'src/common/enums/payment-method.enum';
import { PayOSService } from '@modules/transactions/payos.service';
import { EmailService } from '@modules/email/email.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config'; // Add ConfigService
import { User as UserEntity } from '../users/entities/user.entity'; // Add proper import
import { TransactionsService } from '@modules/transactions/transactions.service';

@Injectable()
export class TournamentService {
    private readonly logger = new Logger(TournamentService.name);

    constructor(
        @InjectModel(Tournament.name) private tournamentModel: Model<Tournament>,
        @InjectModel(TournamentFieldReservation.name)
        private reservationModel: Model<TournamentFieldReservation>,
        @InjectModel(Field.name) private fieldModel: Model<Field>,
        @InjectModel(Transaction.name) private transactionModel: Model<Transaction>,
        @InjectModel(UserEntity.name) private userModel: Model<UserEntity>, // Add User model
        private readonly payosService: PayOSService,
        private readonly emailService: EmailService,
        private readonly eventEmitter: EventEmitter2,
        private readonly configService: ConfigService, // Add ConfigService
        private readonly transactionsService: TransactionsService,
    ) {
        // Setup payment event listeners for tournament registration
        this.setupPaymentEventListeners();
    }

    async create(createTournamentDto: CreateTournamentDto, userId: string) {
        const sportRules = SPORT_RULES_MAP[createTournamentDto.sportType];

        // Validate teams against sport rules
        if (createTournamentDto.numberOfTeams < sportRules.minTeams) {
            throw new BadRequestException(
                `Minimum teams for ${createTournamentDto.sportType} is ${sportRules.minTeams}`
            );
        }

        if (createTournamentDto.numberOfTeams > sportRules.maxTeams) {
            throw new BadRequestException(
                `Maximum teams for ${createTournamentDto.sportType} is ${sportRules.maxTeams}`
            );
        }

        // Validate team size if provided
        const defaultTeamSize = TeamSizeMap[createTournamentDto.sportType]?.[createTournamentDto.category] || 1;
        const teamSize = createTournamentDto.teamSize || defaultTeamSize;

        // Validate team size is reasonable
        if (teamSize < 1 || teamSize > 20) {
            throw new BadRequestException('Team size must be between 1 and 20');
        }

        // Calculate expected participants
        const calculatedParticipants = calculateParticipants(
            createTournamentDto.numberOfTeams,
            createTournamentDto.sportType,
            createTournamentDto.category,
            teamSize
        );

        // Validate calculated participants match provided participants
        if (createTournamentDto.minParticipants !== calculatedParticipants ||
            createTournamentDto.maxParticipants !== calculatedParticipants) {
            throw new BadRequestException(
                `Participants count (${calculatedParticipants}) doesn't match teams configuration`
            );
        }

        // Validate participants against sport rules
        if (calculatedParticipants < sportRules.minParticipants) {
            throw new BadRequestException(
                `Minimum participants for ${createTournamentDto.sportType} is ${sportRules.minParticipants}`
            );
        }

        if (calculatedParticipants > sportRules.maxParticipants) {
            throw new BadRequestException(
                `Maximum participants for ${createTournamentDto.sportType} is ${sportRules.maxParticipants}`
            );
        }

        // Validate fields needed
        if (createTournamentDto.fieldsNeeded < sportRules.minFieldsRequired ||
            createTournamentDto.fieldsNeeded > sportRules.maxFieldsRequired) {
            throw new BadRequestException(
                `Fields needed must be between ${sportRules.minFieldsRequired} and ${sportRules.maxFieldsRequired}`
            );
        }

        // Validate registration period
        const registrationStart = new Date(createTournamentDto.registrationStart);
        const registrationEnd = new Date(createTournamentDto.registrationEnd);
        const tournamentDate = new Date(createTournamentDto.tournamentDate);

        if (registrationStart >= registrationEnd) {
            throw new BadRequestException('Registration end date must be after start date');
        }

        if (registrationEnd >= tournamentDate) {
            throw new BadRequestException('Registration must end before tournament date');
        }

        // Validate selected fields exist and are available
        const fields = await this.fieldModel.find({
            _id: { $in: createTournamentDto.selectedFieldIds.map(id => new Types.ObjectId(id)) },
            sportType: createTournamentDto.sportType,
            isActive: true,
        });

        if (fields.length !== createTournamentDto.selectedFieldIds.length) {
            throw new BadRequestException('Some selected fields are not available');
        }

        // Calculate total field cost
        const startTime = createTournamentDto.startTime;
        const endTime = createTournamentDto.endTime;

        let totalFieldCost = 0;

        // Create field reservations
        const fieldReservations: InstanceType<typeof this.reservationModel>[] = [];

        for (const field of fields) {
            const cost = this.calculateFieldCost(field, tournamentDate, startTime, endTime);
            totalFieldCost += cost;

            // Create temporary reservation
            const reservation = new this.reservationModel({
                tournament: null, // Will be set after tournament creation
                field: field._id,
                date: tournamentDate,
                startTime,
                endTime,
                estimatedCost: cost,
                status: ReservationStatus.PENDING,
                expiresAt: new Date(tournamentDate.getTime() - 48 * 60 * 60 * 1000), // 48 hours before tournament
            });

            fieldReservations.push(reservation);
        }
        const maxParticipants = createTournamentDto.numberOfTeams * teamSize;
        const minParticipants = Math.ceil(maxParticipants * 0.5);
        // Calculate confirmation deadline (48 hours before tournament)
        const confirmationDeadline = new Date(tournamentDate.getTime() - 48 * 60 * 60 * 1000);

        // Create tournament
        const tournament = new this.tournamentModel({
            ...createTournamentDto,
            organizer: new Types.ObjectId(userId),
            status: TournamentStatus.PENDING,
            totalFieldCost,
            confirmationDeadline,
            commissionRate: 0.1,
            participants: [],
            fields: [],
            numberOfTeams: createTournamentDto.numberOfTeams,
            teamSize: teamSize,
            maxParticipants: maxParticipants, // Make sure this is set
            minParticipants: minParticipants, // Make sure this is set
        });

        await tournament.save();

        // Save reservations and link to tournament
        for (const reservation of fieldReservations) {
            reservation.tournament = tournament._id as Types.ObjectId;
            await reservation.save();

            tournament.fields.push({
                field: reservation.field as Types.ObjectId,
                reservation: reservation._id as Types.ObjectId,
            });
        }

        await tournament.save();

        return tournament;
    }

    async registerParticipant(dto: RegisterTournamentDto, userId: string) {
        const tournament = await this.tournamentModel.findById(dto.tournamentId);

        if (!tournament) {
            throw new NotFoundException('Tournament not found');
        }

        // Check if registration period is active
        const now = new Date();
        if (now < tournament.registrationStart || now > tournament.registrationEnd) {
            throw new BadRequestException('Registration period has ended or not started yet');
        }

        if (tournament.status !== TournamentStatus.PENDING) {
            throw new BadRequestException('Tournament is not accepting registrations');
        }

        // Check if tournament is full
        if (tournament.participants.length >= tournament.maxParticipants) {
            throw new BadRequestException('Tournament is full');
        }

        // Check if user already registered (but pending)
        const alreadyRegistered = tournament.participants.some(
            p => p.user.toString() === userId
        );

        if (alreadyRegistered) {
            throw new BadRequestException('Already registered for this tournament');
        }

        let paymentMethodValue: number;
        const paymentMethodStr = dto.paymentMethod as unknown as string;

        switch (paymentMethodStr.toLowerCase()) {
            case 'payos':
                paymentMethodValue = PaymentMethod.PAYOS;
                break;
            case 'wallet':
                paymentMethodValue = PaymentMethod.WALLET;
                break;
            case 'momo':
                paymentMethodValue = PaymentMethod.MOMO;
                break;
            case 'banking':
                paymentMethodValue = PaymentMethod.BANK_TRANSFER;
                break;
            default:
                throw new BadRequestException('Invalid payment method');
        }

        // Create payment transaction
        const transaction = new this.transactionModel({
            user: new Types.ObjectId(userId),
            amount: tournament.registrationFee,
            direction: 'in',
            method: paymentMethodValue,
            type: TransactionType.PAYMENT,
            status: TransactionStatus.PENDING,
            notes: `Tournament registration: ${tournament.name}`,
            metadata: {
                tournamentId: tournament._id,
                tournamentName: tournament.name,
                sportType: tournament.sportType,
                category: tournament.category,
                userId: userId,
                participantName: dto.buyerName,
            }
        });

        await transaction.save();

        // ✅ REMOVED: Don't add participant immediately
        // Instead, participant will be added only when payment succeeds

        let response: any = {
            success: true,
            transaction: {
                _id: transaction._id,
                status: transaction.status
            },
            tournament: tournament,
            message: 'Registration initiated. Complete payment to confirm your spot.'
        };

        // Handle payment based on payment method
        if (paymentMethodValue === PaymentMethod.PAYOS) {
            const payosResponse = await this.handlePayOSPayment(tournament, transaction, userId, dto);
            response = { ...response, ...payosResponse };
        }

        return response;
    }
    /**
 * Handle PayOS payment for tournament registration
 * Modified to redirect immediately instead of emailing link
 */
    private async handlePayOSPayment(
        tournament: Tournament,
        transaction: Transaction,
        userId: string,
        dto: RegisterTournamentDto
    ) {
        try {
            // Get user details for payment
            const user = await this.userModel.findById(userId).select('email fullName phone').exec();

            if (!user) {
                throw new BadRequestException('User not found');
            }

            // ✅ Use existing externalTransactionId or generate one
            let orderCode: number;
            let externalIdToUse: string;

            if (transaction.externalTransactionId) {
                orderCode = Number(transaction.externalTransactionId);
                externalIdToUse = transaction.externalTransactionId;
                this.logger.log(`Using existing PayOS orderCode: ${orderCode} for transaction ${transaction._id}`);
            } else {
                // Generate order code from transaction ID
                const transactionIdStr = (transaction._id as Types.ObjectId).toString();
                const timestamp = Date.now();
                orderCode = Number(timestamp.toString().slice(-9)); // Use last 9 digits of timestamp

                // Update transaction with external ID
                transaction.externalTransactionId = orderCode.toString();
                externalIdToUse = orderCode.toString();
                await transaction.save();

                this.logger.log(`Generated new PayOS orderCode: ${orderCode} for transaction ${transaction._id}`);
            }

            // Get frontend and backend URLs from config
            const frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:5173';
            const backendUrl = this.configService.get<string>('BACKEND_URL') || 'http://localhost:3000';

            // ✅ Use transaction ID as orderId
            const orderId = (transaction._id as Types.ObjectId).toString();

            this.logger.log(`Creating PayOS payment with orderId: ${orderId}, orderCode: ${orderCode}`);

            // Create PayOS payment link with immediate redirect URL
            const paymentLink = await this.payosService.createPaymentUrl({
                orderId: orderId, // ✅ Use transaction ID
                orderCode: orderCode,
                amount: tournament.registrationFee,
                description: `Đăng ký tham gia giải đấu`,
                items: [{
                    name: `Đăng ký giải đấu: ${tournament.name}`,
                    quantity: 1,
                    price: tournament.registrationFee
                }],
                buyerName: dto.buyerName || user.fullName || 'Người tham gia',
                buyerEmail: dto.buyerEmail || user.email,
                buyerPhone: dto.buyerPhone || user.phone,
                // ✅ CRITICAL: Use direct backend return URL for immediate processing
                returnUrl: `${backendUrl}/transactions/payos/tournament-return/${tournament._id}`,
                cancelUrl: `${frontendUrl}/tournaments/${tournament._id}`,
                expiredAt: 15, // 15 minutes expiration
            });

            // ✅ Send registration confirmation email (not payment link email)
            await this.sendTournamentRegistrationConfirmationEmail(userId, tournament, paymentLink.checkoutUrl);

            // ✅ Return the payment URL for immediate redirect
            return {
                success: true,
                transaction: {
                    _id: transaction._id,
                    status: transaction.status,
                    externalTransactionId: externalIdToUse
                },
                tournament: tournament,
                paymentUrl: paymentLink.checkoutUrl, // Return URL for immediate redirect
                orderCode: orderCode,
                message: 'Payment URL generated successfully'
            };

        } catch (error) {
            this.logger.error('Error creating PayOS payment link:', error);
            throw new BadRequestException('Failed to create payment link');
        }
    }

    /**
     * Send registration confirmation email (notification only)
     */
    private async sendTournamentRegistrationConfirmationEmail(
        userId: string,
        tournament: Tournament,
        paymentUrl?: string
    ) {
        try {
            const user = await this.userModel.findById(userId).select('email fullName');

            if (!user || !user.email) {
                this.logger.warn(`User ${userId} has no email, cannot send confirmation`);
                return;
            }

            // Format tournament date
            const tournamentDate = new Date(tournament.tournamentDate);
            const formattedDate = tournamentDate.toLocaleDateString('vi-VN');

            // Create tournament time string
            let timeString = '';
            if (tournament.startTime && tournament.endTime) {
                timeString = ` (${tournament.startTime} - ${tournament.endTime})`;
            }

            await this.emailService.sendTournamentRegistrationConfirmation({
                to: user.email,
                tournament: {
                    name: tournament.name,
                    sportType: tournament.sportType,
                    date: formattedDate,
                    time: timeString,
                    location: tournament.location,
                    registrationFee: tournament.registrationFee,
                },
                customer: {
                    fullName: user.fullName || 'Người tham gia'
                },
                // Include payment URL if provided (for reference)
                paymentUrl: paymentUrl,
                status: 'pending' // Payment is pending
            });

            this.logger.log(`Registration confirmation email sent to ${user.email} for tournament ${tournament.name}`);

        } catch (error) {
            this.logger.error('Error sending registration confirmation email:', error);
            // Don't throw error - email failure shouldn't block registration
        }
    }

    /**
     * Send payment request email for tournament registration
     */
    private async sendTournamentPaymentRequestEmail(
        userId: string,
        tournament: Tournament,
        paymentLink: string,
        amount: number
    ) {
        try {
            // Get user email
            const user = await this.userModel.findById(userId).select('email fullName');

            if (!user || !user.email) {
                this.logger.warn(`User ${userId} has no email, cannot send payment request`);
                return;
            }

            const expiresInMinutes = 15; // Payment link expires in 15 minutes
            const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000);

            // Format tournament date and time
            const tournamentDate = new Date(tournament.tournamentDate);
            const formattedDate = tournamentDate.toLocaleDateString('vi-VN');

            // Create tournament time string if available
            let timeString = '';
            if (tournament.startTime && tournament.endTime) {
                timeString = ` (${tournament.startTime} - ${tournament.endTime})`;
            }

            await this.emailService.sendTournamentPaymentRequest({
                to: user.email,
                tournament: {
                    name: tournament.name,
                    sportType: tournament.sportType,
                    date: formattedDate,
                    time: timeString,
                    location: tournament.location,
                    registrationFee: amount,
                },
                customer: {
                    fullName: user.fullName || 'Người tham gia'
                },
                paymentLink,
                paymentMethod: PaymentMethod.PAYOS,
                expiresAt: expiresAt.toLocaleString('vi-VN'),
                expiresInMinutes
            });

            this.logger.log(`Payment request email sent to ${user.email} for tournament ${tournament.name}`);

        } catch (error) {
            this.logger.error('Error sending payment request email:', error);
            // Don't throw error - email failure shouldn't block registration
        }
    }

    /**
     * Confirm tournament payment when payment succeeds
     */
    private async confirmTournamentPayment(transactionId: string, userId: string) {
        try {
            const transaction = await this.transactionModel.findById(transactionId);

            if (!transaction) {
                throw new NotFoundException('Transaction not found');
            }

            // Update transaction status
            transaction.status = TransactionStatus.SUCCEEDED;
            await transaction.save();

            // Find tournament where this transaction is used
            const tournament = await this.tournamentModel.findOne({
                'participants.transaction': new Types.ObjectId(transactionId),
                'participants.user': new Types.ObjectId(userId)
            });

            if (!tournament) {
                throw new NotFoundException('Tournament not found for this transaction');
            }

            // Update participant payment status
            const participantIndex = tournament.participants.findIndex(
                p => p.user.toString() === userId &&
                    p.transaction?.toString() === transactionId
            );

            if (participantIndex >= 0) {
                tournament.participants[participantIndex].paymentStatus = 'confirmed';
                await tournament.save();
            }

            // Send confirmation email
            await this.sendTournamentRegistrationConfirmation(userId, tournament);

            return tournament;
        } catch (error) {
            this.logger.error('Error confirming tournament payment:', error);
            throw error;
        }
    }

    /**
     * Send tournament registration confirmation email
     */
    private async sendTournamentRegistrationConfirmation(userId: string, tournament: Tournament) {
        try {
            // Get user email
            const user = await this.userModel.findById(userId).select('email fullName');

            if (!user || !user.email) {
                this.logger.warn(`User ${userId} has no email, cannot send confirmation`);
                return;
            }

            // Format tournament date and time
            const tournamentDate = new Date(tournament.tournamentDate);
            const formattedDate = tournamentDate.toLocaleDateString('vi-VN');

            // Create tournament time string if available
            let timeString = '';
            if (tournament.startTime && tournament.endTime) {
                timeString = ` (${tournament.startTime} - ${tournament.endTime})`;
            }

            await this.emailService.sendTournamentRegistrationConfirmation({
                to: user.email,
                tournament: {
                    name: tournament.name,
                    sportType: tournament.sportType,
                    date: formattedDate,
                    time: timeString,
                    location: tournament.location,
                    registrationFee: tournament.registrationFee,
                    organizer: tournament.organizer,
                },
                customer: {
                    fullName: user.fullName || 'Người tham gia'
                }
            });

            this.logger.log(`Registration confirmation email sent to ${user.email} for tournament ${tournament.name}`);

        } catch (error) {
            this.logger.error('Error sending registration confirmation email:', error);
        }
    }

    /**
     * Setup payment event listeners for tournament registrations
     * Similar to booking system
     */
    private setupPaymentEventListeners() {
        this.eventEmitter.on('payment.success', this.handleTournamentPaymentSuccess.bind(this));
        this.eventEmitter.on('payment.failed', this.handleTournamentPaymentFailed.bind(this));

        this.logger.log('✅ Tournament payment event listeners registered');
    }

    private async handleTournamentPaymentSuccess(event: {
        paymentId: string;
        bookingId?: string;
        tournamentId?: string;
        userId: string;
        amount: number;
        method?: string;
        transactionId?: string;
    }) {
        try {
            const transaction = await this.transactionModel.findById(event.paymentId);

            if (!transaction) {
                this.logger.error(`[Tournament Payment Success] Transaction not found: ${event.paymentId}`);
                return;
            }

            // Check if this is a tournament payment
            const isTournamentPayment =
                event.tournamentId ||
                (transaction.metadata && transaction.metadata.tournamentId) ||
                transaction.notes?.includes('Tournament registration');

            if (!isTournamentPayment) {
                return;
            }

            this.logger.log(`[Tournament Payment Success] Processing tournament payment ${event.paymentId}`);

            // Get tournament ID from metadata or event
            const tournamentId = event.tournamentId ||
                (transaction.metadata?.tournamentId ? transaction.metadata.tournamentId.toString() : null);

            if (!tournamentId) {
                this.logger.error(`[Tournament Payment Success] No tournament ID found for payment ${event.paymentId}`);
                return;
            }

            // Find tournament
            const tournament = await this.tournamentModel.findById(tournamentId);

            if (!tournament) {
                this.logger.error(`[Tournament Payment Success] Tournament not found: ${tournamentId}`);
                return;
            }

            // ✅ CRITICAL: Check if tournament is still accepting registrations
            const now = new Date();
            if (now > tournament.registrationEnd) {
                this.logger.error(`[Tournament Payment Success] Registration period ended for tournament ${tournamentId}`);
                // Update transaction status to failed
                await this.transactionModel.findByIdAndUpdate(
                    event.paymentId,
                    {
                        status: TransactionStatus.FAILED,
                        notes: `Payment succeeded but registration period ended`,
                        errorMessage: 'Registration period ended'
                    }
                );
                return;
            }

            // ✅ CRITICAL: Check if tournament is full
            if (tournament.participants.length >= tournament.maxParticipants) {
                this.logger.error(`[Tournament Payment Success] Tournament ${tournamentId} is full`);
                // Update transaction status to failed
                await this.transactionModel.findByIdAndUpdate(
                    event.paymentId,
                    {
                        status: TransactionStatus.FAILED,
                        notes: `Payment succeeded but tournament is full`,
                        errorMessage: 'Tournament is full'
                    }
                );

                // Refund the payment since tournament is full
                await this.transactionsService.processRefund(
                    event.paymentId,
                    event.amount,
                    'Tournament is full',
                    'Automatic refund due to tournament being full'
                );
                return;
            }

            // ✅ CRITICAL: Check if user already registered
            const alreadyRegistered = tournament.participants.some(
                p => p.user.toString() === event.userId
            );

            if (alreadyRegistered) {
                this.logger.warn(`[Tournament Payment Success] User ${event.userId} already registered for tournament ${tournamentId}`);
                // Update transaction but don't add participant
                return;
            }

            tournament.participants.push({
                user: new Types.ObjectId(event.userId),
                registeredAt: now,
                confirmedAt: now, // ✅ ADD THIS
                transaction: new Types.ObjectId(event.paymentId),
                paymentStatus: 'confirmed',
            });

            await tournament.save();

            // Send confirmation email
            await this.sendTournamentRegistrationConfirmation(event.userId, tournament);

            this.logger.log(`[Tournament Payment Success] ✅ Participant ${event.userId} confirmed for tournament ${tournament.name}`);

        } catch (error) {
            this.logger.error('[Tournament Payment Success] Error processing tournament payment:', error);
        }
    }

    /**
     * Handle payment failed event for tournament registration
     */
    private async handleTournamentPaymentFailed(event: {
        paymentId: string;
        bookingId?: string;
        tournamentId?: string;
        userId: string;
        amount: number;
        method?: string;
        transactionId?: string;
        reason: string;
    }) {
        try {
            // Check if this is a tournament payment
            const transaction = await this.transactionModel.findById(event.paymentId);

            if (!transaction) {
                return;
            }

            // Check if this is a tournament payment
            const isTournamentPayment =
                event.tournamentId ||
                (transaction.metadata && transaction.metadata.tournamentId) ||
                transaction.notes?.includes('Tournament registration');

            if (!isTournamentPayment) {
                return;
            }

            this.logger.log(`[Tournament Payment Failed] Processing tournament payment failure ${event.paymentId}`);

            // Get tournament ID from metadata or event
            const tournamentId = event.tournamentId ||
                (transaction.metadata?.tournamentId ? transaction.metadata.tournamentId.toString() : null);

            if (!tournamentId) {
                return;
            }

            // Find tournament
            const tournament = await this.tournamentModel.findById(tournamentId);

            if (!tournament) {
                return;
            }

            // Remove participant from tournament (payment failed)
            tournament.participants = tournament.participants.filter(
                p => !(p.transaction && p.transaction.toString() === event.paymentId)
            );

            await tournament.save();

            // Send failure notification email
            await this.sendTournamentPaymentFailedNotification(event.userId, tournament, event.reason);

            this.logger.log(`[Tournament Payment Failed] ❌ Participant ${event.userId} removed from tournament ${tournament.name} due to payment failure`);

        } catch (error) {
            this.logger.error('[Tournament Payment Failed] Error handling tournament payment failure:', error);
        }
    }

    /**
     * Send tournament payment failed notification
     */
    private async sendTournamentPaymentFailedNotification(userId: string, tournament: Tournament, reason: string) {
        try {
            const user = await this.userModel.findById(userId).select('email fullName');

            if (!user || !user.email) {
                return;
            }

            // Format tournament date
            const tournamentDate = new Date(tournament.tournamentDate);
            const formattedDate = tournamentDate.toLocaleDateString('vi-VN');

            await this.emailService.sendTournamentPaymentFailed({
                to: user.email,
                tournament: {
                    name: tournament.name,
                    date: formattedDate,
                    sportType: tournament.sportType,
                    location: tournament.location,
                },
                customer: {
                    fullName: user.fullName || 'Người tham gia'
                },
                reason: reason
            });

        } catch (error) {
            this.logger.error('Error sending payment failed notification:', error);
        }
    }

    private async confirmTournament(tournament: Tournament) {
        // Update transaction statuses to SUCCEEDED
        for (const participant of tournament.participants) {
            if (participant.transaction) {
                await this.transactionModel.findByIdAndUpdate(
                    participant.transaction,
                    { status: TransactionStatus.SUCCEEDED }
                );
            }
        }

        // Convert reservations to bookings
        const reservations = await this.reservationModel.find({
            tournament: tournament._id,
            status: ReservationStatus.PENDING,
        });

        for (const reservation of reservations) {
            reservation.status = ReservationStatus.CONFIRMED;
            await reservation.save();
        }

        // Calculate commission based on teams and participants
        tournament.commissionAmount = tournament.totalRegistrationFeesCollected * tournament.commissionRate;
        tournament.prizePool = tournament.totalRegistrationFeesCollected - tournament.commissionAmount - tournament.totalFieldCost;

        // Charge organizer for field costs if registration fees don't cover
        const shortfall = tournament.totalFieldCost - tournament.totalRegistrationFeesCollected;
        if (shortfall > 0) {
            const organizerPayment = new this.transactionModel({
                user: tournament.organizer,
                amount: shortfall,
                direction: 'in',
                method: PaymentMethod.WALLET,
                type: TransactionType.PAYMENT,
                status: TransactionStatus.PENDING,
                notes: `Tournament field cost shortfall: ${tournament.name}`,
            });
            await organizerPayment.save();
            tournament.organizerPaymentTransaction = organizerPayment._id as Types.ObjectId;
        }

        tournament.status = TournamentStatus.CONFIRMED;
        await tournament.save();
    }

    async cancelLowTurnout() {
        const now = new Date();

        // Find tournaments past deadline with insufficient participants
        const tournaments = await this.tournamentModel.find({
            status: TournamentStatus.PENDING,
            confirmationDeadline: { $lt: now },
        });

        for (const tournament of tournaments) {
            // For team-based tournaments, check if we have enough participants to form minimum teams
            const minParticipantsNeeded = tournament.minParticipants;

            if (tournament.participants.length < minParticipantsNeeded) {
                // Refund all participants
                for (const participant of tournament.participants) {
                    if (participant.transaction) {
                        await this.transactionModel.findByIdAndUpdate(
                            participant.transaction,
                            {
                                status: TransactionStatus.REFUNDED,
                                type: TransactionType.REFUND_FULL,
                            }
                        );
                    }
                }

                // Release field reservations
                await this.reservationModel.updateMany(
                    { tournament: tournament._id },
                    { status: ReservationStatus.RELEASED }
                );

                tournament.status = TournamentStatus.CANCELLED;
                tournament.cancellationReason = 'Insufficient participants';
                await tournament.save();
            }
        }
    }

    async findAvailableFields(sportType: string, location: string, date: string) {
        const tournamentDate = new Date(date);

        // Find fields that are:
        // 1. Active and match sport type
        // 2. Match location (case-insensitive)
        // 3. Not already reserved for tournaments on that date
        return this.fieldModel.find({
            sportType,
            isActive: true,
            'location.address': { $regex: location, $options: 'i' },
        }).lean();
    }

    async findTournamentFields(sportType: string, location: string, date: string) {
        const tournamentDate = new Date(date);

        // Find fields that might be available for tournaments
        const fields = await this.fieldModel.find({
            sportType,
            isActive: true,
            'location.address': { $regex: location, $options: 'i' },
        }).lean();

        // Check for existing tournament reservations on the same date
        const existingReservations = await this.reservationModel.find({
            date: {
                $gte: new Date(tournamentDate.setHours(0, 0, 0, 0)),
                $lt: new Date(tournamentDate.setHours(23, 59, 59, 999))
            },
            status: { $in: [ReservationStatus.PENDING, ReservationStatus.CONFIRMED] }
        }).populate('field');

        const reservedFieldIds = existingReservations.map(r => r.field._id.toString());

        // Filter out reserved fields
        const availableFields = fields.filter(field =>
            !reservedFieldIds.includes(field._id.toString())
        );

        return availableFields;
    }

    private calculateFieldCost(field: any, date: Date, startTime: string, endTime: string): number {
        // Calculate hours from start to end time
        const hours = this.calculateHours(startTime, endTime);

        // Get base price or use default
        const basePrice = field.basePrice || 100000; // Default 100,000 VND/hour

        // Apply any date-based pricing (weekend/holiday multipliers)
        const dayOfWeek = date.getDay();
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
        const multiplier = isWeekend ? 1.2 : 1.0; // 20% weekend surcharge

        return Math.round(basePrice * hours * multiplier);
    }

    private calculateHours(startTime: string, endTime: string): number {
        if (!startTime || !endTime) return 0;

        const [startHour, startMin] = startTime.split(':').map(Number);
        const [endHour, endMin] = endTime.split(':').map(Number);

        const startTotalMinutes = startHour * 60 + startMin;
        const endTotalMinutes = endHour * 60 + endMin;

        if (endTotalMinutes <= startTotalMinutes) {
            throw new BadRequestException('End time must be after start time');
        }

        return (endTotalMinutes - startTotalMinutes) / 60;
    }

    async findAll(filters: any) {
        const query = this.tournamentModel.find(filters);

        // Always populate organizer
        query.populate('organizer', 'fullName email avatarUrl');

        // Sort by tournament date (upcoming first)
        query.sort({ tournamentDate: 1, createdAt: -1 });

        return query.exec();
    }

    async findOne(id: string) {
        const tournament = await this.tournamentModel
            .findById(id)
            .populate('organizer', 'fullName email avatarUrl')
            .populate('participants.user', 'fullName email avatarUrl')
            .populate('fields.field')
            .populate('fields.reservation')
            .populate('fields.booking');

        if (!tournament) {
            throw new NotFoundException('Tournament not found');
        }

        return tournament;
    }

    async getTournamentStatistics() {
        const now = new Date();
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

        const stats = await this.tournamentModel.aggregate([
            {
                $match: {
                    createdAt: { $gte: thirtyDaysAgo }
                }
            },
            {
                $group: {
                    _id: null,
                    totalTournaments: { $sum: 1 },
                    activeTournaments: {
                        $sum: {
                            $cond: [
                                { $in: ['$status', [TournamentStatus.PENDING, TournamentStatus.CONFIRMED, TournamentStatus.ONGOING]] },
                                1,
                                0
                            ]
                        }
                    },
                    totalParticipants: { $sum: { $size: '$participants' } },
                    totalRevenue: { $sum: '$totalRegistrationFeesCollected' },
                    averageTeams: { $avg: '$numberOfTeams' }
                }
            },
            {
                $project: {
                    _id: 0,
                    totalTournaments: 1,
                    activeTournaments: 1,
                    totalParticipants: 1,
                    totalRevenue: 1,
                    averageTeams: 1
                }
            }
        ]);

        return stats[0] || {
            totalTournaments: 0,
            activeTournaments: 0,
            totalParticipants: 0,
            totalRevenue: 0,
            averageTeams: 0
        };
    }

    async getTournamentsBySport() {
        return this.tournamentModel.aggregate([
            {
                $group: {
                    _id: '$sportType',
                    count: { $sum: 1 },
                    totalParticipants: { $sum: { $size: '$participants' } },
                    averageTeams: { $avg: '$numberOfTeams' }
                }
            },
            {
                $sort: { count: -1 }
            },
            {
                $project: {
                    sportType: '$_id',
                    count: 1,
                    totalParticipants: 1,
                    averageTeams: 1,
                    _id: 0
                }
            }
        ]);
    }

    async updateTournamentStatus(id: string, status: TournamentStatus, reason?: string) {
        const tournament = await this.tournamentModel.findById(id);

        if (!tournament) {
            throw new NotFoundException('Tournament not found');
        }

        // Validate status transition
        const allowedTransitions = {
            [TournamentStatus.PENDING]: [TournamentStatus.CONFIRMED, TournamentStatus.CANCELLED],
            [TournamentStatus.CONFIRMED]: [TournamentStatus.ONGOING, TournamentStatus.CANCELLED],
            [TournamentStatus.ONGOING]: [TournamentStatus.COMPLETED, TournamentStatus.CANCELLED],
            [TournamentStatus.COMPLETED]: [],
            [TournamentStatus.CANCELLED]: []
        };

        const allowedNextStatuses = allowedTransitions[tournament.status] || [];

        if (!allowedNextStatuses.includes(status)) {
            throw new BadRequestException(
                `Cannot transition from ${tournament.status} to ${status}`
            );
        }

        tournament.status = status;

        if (status === TournamentStatus.CANCELLED && reason) {
            tournament.cancellationReason = reason;

            // Refund participants if tournament is cancelled after confirmation
            if (tournament.status !== TournamentStatus.PENDING) {
                for (const participant of tournament.participants) {
                    if (participant.transaction) {
                        await this.transactionModel.findByIdAndUpdate(
                            participant.transaction,
                            {
                                status: TransactionStatus.REFUNDED,
                                type: TransactionType.REFUND_FULL,
                            }
                        );
                    }
                }
            }
        }

        await tournament.save();
        return tournament;
    }

    async getTournamentTeamInfo(id: string) {
        const tournament = await this.findOne(id);

        const teamSize = tournament.teamSize || 1;
        const participants = tournament.participants.length;
        const teams = Math.ceil(participants / teamSize);
        const fullTeams = Math.floor(participants / teamSize);
        const partialTeamSize = participants % teamSize;

        return {
            tournamentId: tournament._id,
            tournamentName: tournament.name,
            teamSize,
            totalTeams: tournament.numberOfTeams,
            currentTeams: teams,
            fullTeams,
            participants,
            partialTeamSize,
            remainingSpots: (tournament.numberOfTeams * teamSize) - participants,
            teamAssignments: this.generateTeamAssignments(tournament)
        };
    }

    private generateTeamAssignments(tournament: any) {
        // Simplified team assignment logic
        // In a real app, you'd have more sophisticated team assignment
        const teamSize = tournament.teamSize || 1;
        const participants = tournament.participants;

        const teams: any[] = [];
        for (let i = 0; i < Math.ceil(participants.length / teamSize); i++) {
            const startIdx = i * teamSize;
            const endIdx = startIdx + teamSize;
            const teamParticipants = participants.slice(startIdx, endIdx);

            teams.push({
                teamNumber: i + 1,
                participants: teamParticipants.map((p: any) => p.user),
                isFull: teamParticipants.length === teamSize
            });
        }

        return teams;
    }
}