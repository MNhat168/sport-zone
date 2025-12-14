import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Tournament } from './entities/tournament.entity';
import { TournamentStatus } from '@common/enums/tournament.enum';
import { TournamentFieldReservation } from './entities/tournament-field-reservation.entity';
import { ReservationStatus } from '@common/enums/tournament-field-reservation.enum';
import { Field } from '../fields/entities/field.entity';
import { Court } from '../courts/entities/court.entity'; // Add Court import
import { Transaction } from '../transactions/entities/transaction.entity';
import { TransactionStatus, TransactionType } from '@common/enums/transaction.enum';
import { User } from '../users/entities/user.entity';
import { CreateTournamentDto, UpdateTournamentDto } from './dto/create-tournament.dto';
import { RegisterTournamentDto } from './dto/RegisterTournamentDto';
import { SPORT_RULES_MAP, TeamSizeMap, calculateParticipants } from 'src/common/enums/sport-type.enum';
import { PaymentMethod } from 'src/common/enums/payment-method.enum';
import { PayOSService } from '@modules/transactions/payos.service';
import { EmailService } from '@modules/email/email.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { User as UserEntity } from '../users/entities/user.entity';
import { TransactionsService } from '@modules/transactions/transactions.service';

@Injectable()
export class TournamentService {
    private readonly logger = new Logger(TournamentService.name);

    constructor(
        @InjectModel(Tournament.name) private tournamentModel: Model<Tournament>,
        @InjectModel(TournamentFieldReservation.name)
        private reservationModel: Model<TournamentFieldReservation>,
        @InjectModel(Field.name) private fieldModel: Model<Field>,
        @InjectModel(Court.name) private courtModel: Model<Court>, // Add Court model
        @InjectModel(Transaction.name) private transactionModel: Model<Transaction>,
        @InjectModel(UserEntity.name) private userModel: Model<UserEntity>,
        private readonly payosService: PayOSService,
        private readonly emailService: EmailService,
        private readonly eventEmitter: EventEmitter2,
        private readonly configService: ConfigService,
        private readonly transactionsService: TransactionsService,
    ) {
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

        // Validate courts needed
        const courtsNeeded = createTournamentDto.courtsNeeded || createTournamentDto.fieldsNeeded || 1;
        if (courtsNeeded < sportRules.minCourtsRequired ||
            courtsNeeded > sportRules.maxCourtsRequired) {
            throw new BadRequestException(
                `Courts needed must be between ${sportRules.minCourtsRequired} and ${sportRules.maxCourtsRequired}`
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

        // Validate selected courts exist and are available
        const selectedCourtIds = createTournamentDto.selectedCourtIds || createTournamentDto.selectedFieldIds;
        const courts = await this.courtModel.find({
            _id: { $in: selectedCourtIds.map(id => new Types.ObjectId(id)) },
            isActive: true,
        })
            .populate({
                path: 'field',
                match: {
                    sportType: createTournamentDto.sportType,
                    isActive: true
                },
                select: 'name location basePrice sportType'
            });

        if (courts.length !== selectedCourtIds.length) {
            throw new BadRequestException('Some selected courts are not available');
        }

        // Calculate total court cost
        const startTime = createTournamentDto.startTime;
        const endTime = createTournamentDto.endTime;

        let totalCourtCost = 0;

        // Create court reservations
        const courtReservations: InstanceType<typeof this.reservationModel>[] = [];

        for (const court of courts) {
            const cost = this.calculateCourtCost(court, tournamentDate, startTime, endTime);
            totalCourtCost += cost;

            // Create temporary reservation for court
            const reservation = new this.reservationModel({
                tournament: null, // Will be set after tournament creation
                court: court._id,
                field: court.field?._id,
                date: tournamentDate,
                startTime,
                endTime,
                estimatedCost: cost,
                status: ReservationStatus.PENDING,
                expiresAt: new Date(tournamentDate.getTime() - 48 * 60 * 60 * 1000), // 48 hours before tournament
            });

            courtReservations.push(reservation);
        }

        const maxParticipants = createTournamentDto.numberOfTeams * teamSize;
        const minParticipants = Math.ceil(maxParticipants * 0.5);

        // Calculate confirmation deadline (48 hours before tournament)
        const confirmationDeadline = new Date(tournamentDate.getTime() - 48 * 60 * 60 * 1000);

        // Create tournament with court information
        const tournament = new this.tournamentModel({
            ...createTournamentDto,
            organizer: new Types.ObjectId(userId),
            status: TournamentStatus.PENDING,
            totalCourtCost,
            totalFieldCost: totalCourtCost, // Keep backward compatibility
            confirmationDeadline,
            commissionRate: 0.1,
            participants: [],
            courts: [], // Initialize courts array
            fields: [], // Keep for backward compatibility
            courtsNeeded: courtsNeeded,
            fieldsNeeded: courtsNeeded, // Keep backward compatibility
            numberOfTeams: createTournamentDto.numberOfTeams,
            teamSize: teamSize,
            maxParticipants: maxParticipants,
            minParticipants: minParticipants,
        });

        await tournament.save();

        // Save reservations and link to tournament
        for (const reservation of courtReservations) {
            reservation.tournament = tournament._id as Types.ObjectId;
            await reservation.save();

            // Find the court for this reservation
            const court = courts.find(c => (c._id as Types.ObjectId).equals(reservation.court));

            tournament.courts.push({
                court: reservation.court as Types.ObjectId,
                field: court?.field?._id as Types.ObjectId,
                reservation: reservation._id as Types.ObjectId,
            });

            // Also add to fields array for backward compatibility
            if (court?.field) {
                tournament.fields.push({
                    field: court.field._id as Types.ObjectId,
                    reservation: reservation._id as Types.ObjectId,
                });
            }
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

        const paymentMethodValue = dto.paymentMethod;

        // Create payment transaction
        const transaction = new this.transactionModel({
            user: new Types.ObjectId(userId),
            amount: tournament.registrationFee,
            direction: 'in',
            method: paymentMethodValue, // This should now be a number
            type: TransactionType.PAYMENT,
            status: TransactionStatus.PENDING,
            notes: `Tournament registration: ${tournament.name}`,
            metadata: {
                tournamentId: (tournament._id as Types.ObjectId).toString(),
                tournamentName: tournament.name,
                sportType: tournament.sportType,
                category: tournament.category,
                userId: userId,
                participantName: dto.buyerName,
            }
        });


        await transaction.save();

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

            // Use existing externalTransactionId or generate one
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
                orderCode = Number(timestamp.toString().slice(-9));

                // Update transaction with tournament ID in metadata BEFORE saving
                transaction.externalTransactionId = orderCode.toString();
                transaction.metadata = {
                    ...transaction.metadata,
                    tournamentId: (tournament._id as Types.ObjectId).toString(), // Add tournament ID here
                    tournamentName: tournament.name,
                    sportType: tournament.sportType,
                    category: tournament.category,
                    userId: userId,
                    participantName: dto.buyerName,
                };

                await transaction.save();
                externalIdToUse = orderCode.toString();

                this.logger.log(`Generated new PayOS orderCode: ${orderCode} for transaction ${transaction._id}`);
            }

            // Get frontend and backend URLs from config
            const frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:5173';
            const backendUrl = this.configService.get<string>('BACKEND_URL') || 'http://localhost:3000';

            // Use transaction ID as orderId
            const orderId = (transaction._id as Types.ObjectId).toString();

            this.logger.log(`Creating PayOS payment with orderId: ${orderId}, orderCode: ${orderCode}`);

            // Create PayOS payment link with immediate redirect URL
            const paymentLink = await this.payosService.createPaymentUrl({
                orderId: orderId,
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
                returnUrl: `${backendUrl}/transactions/payos/tournament-return/${tournament._id}`,
                cancelUrl: `${frontendUrl}/tournaments/${tournament._id}`,
                expiredAt: 15,
            });

            // Send registration confirmation email
            await this.sendTournamentRegistrationConfirmationEmail(userId, tournament, paymentLink.checkoutUrl);

            return {
                success: true,
                transaction: {
                    _id: transaction._id,
                    status: transaction.status,
                    externalTransactionId: externalIdToUse
                },
                tournament: tournament,
                paymentUrl: paymentLink.checkoutUrl,
                orderCode: orderCode,
                message: 'Payment URL generated successfully'
            };

        } catch (error) {
            this.logger.error('Error creating PayOS payment link:', error);
            throw new BadRequestException('Failed to create payment link');
        }
    }

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
                paymentUrl: paymentUrl,
                status: 'pending'
            });

            this.logger.log(`Registration confirmation email sent to ${user.email} for tournament ${tournament.name}`);

        } catch (error) {
            this.logger.error('Error sending registration confirmation email:', error);
        }
    }

    private async sendTournamentPaymentRequestEmail(
        userId: string,
        tournament: Tournament,
        paymentLink: string,
        amount: number
    ) {
        try {
            const user = await this.userModel.findById(userId).select('email fullName');

            if (!user || !user.email) {
                this.logger.warn(`User ${userId} has no email, cannot send payment request`);
                return;
            }

            const expiresInMinutes = 15;
            const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000);

            const tournamentDate = new Date(tournament.tournamentDate);
            const formattedDate = tournamentDate.toLocaleDateString('vi-VN');

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
        }
    }

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

    private async sendTournamentRegistrationConfirmation(userId: string, tournament: Tournament) {
        try {
            const user = await this.userModel.findById(userId).select('email fullName');

            if (!user || !user.email) {
                this.logger.warn(`User ${userId} has no email, cannot send confirmation`);
                return;
            }

            const tournamentDate = new Date(tournament.tournamentDate);
            const formattedDate = tournamentDate.toLocaleDateString('vi-VN');

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
            // First try to find by _id (paymentId)
            let transaction = await this.transactionModel.findById(event.paymentId);

            // If not found, try to find by externalTransactionId
            if (!transaction && event.transactionId) {
                transaction = await this.transactionModel.findOne({
                    externalTransactionId: event.transactionId
                });
            }

            // If still not found, try to find by metadata.payosReference
            if (!transaction && event.transactionId) {
                transaction = await this.transactionModel.findOne({
                    'metadata.payosReference': event.transactionId
                });
            }

            if (!transaction) {
                this.logger.error(`[Tournament Payment Success] Transaction not found for:`, {
                    paymentId: event.paymentId,
                    transactionId: event.transactionId
                });
                return;
            }

            // Get tournament ID from event or transaction metadata
            const tournamentId = event.tournamentId ||
                (transaction.metadata?.tournamentId ?
                    transaction.metadata.tournamentId.toString() : null);

            if (!tournamentId) {
                this.logger.error(`[Tournament Payment Success] No tournament ID found for transaction:`, {
                    transactionId: transaction._id,
                    metadata: transaction.metadata
                });
                return;
            }

            // Find tournament
            const tournament = await this.tournamentModel.findById(tournamentId);

            if (!tournament) {
                this.logger.error(`[Tournament Payment Success] Tournament not found: ${tournamentId}`);
                return;
            }

            // Check if user is already registered
            const alreadyRegistered = tournament.participants.some(
                p => p.user.toString() === event.userId
            );

            if (alreadyRegistered) {
                this.logger.warn(`[Tournament Payment Success] User ${event.userId} already registered for tournament ${tournamentId}`);
                return;
            }

            // Add participant to tournament
            tournament.participants.push({
                user: new Types.ObjectId(event.userId),
                registeredAt: new Date(),
                confirmedAt: new Date(),
                transaction: transaction._id as Types.ObjectId,
                paymentStatus: 'confirmed',
            });

            await tournament.save();

            // Update transaction status if needed
            if (transaction.status !== TransactionStatus.SUCCEEDED) {
                transaction.status = TransactionStatus.SUCCEEDED;
                await transaction.save();
            }

            // Send confirmation email
            await this.sendTournamentRegistrationConfirmation(event.userId, tournament);

            this.logger.log(`[Tournament Payment Success] ✅ Participant ${event.userId} confirmed for tournament ${tournament.name}`);

        } catch (error) {
            this.logger.error('[Tournament Payment Success] Error processing tournament payment:', error);
        }
    }

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

    private async sendTournamentPaymentFailedNotification(userId: string, tournament: Tournament, reason: string) {
        try {
            const user = await this.userModel.findById(userId).select('email fullName');

            if (!user || !user.email) {
                return;
            }

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

        // Convert court reservations to bookings
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
        tournament.prizePool = tournament.totalRegistrationFeesCollected - tournament.commissionAmount - tournament.totalCourtCost;

        // Charge organizer for court costs if registration fees don't cover
        const shortfall = tournament.totalCourtCost - tournament.totalRegistrationFeesCollected;
        if (shortfall > 0) {
            const organizerPayment = new this.transactionModel({
                user: tournament.organizer,
                amount: shortfall,
                direction: 'in',
                method: PaymentMethod.WALLET,
                type: TransactionType.PAYMENT,
                status: TransactionStatus.PENDING,
                notes: `Tournament court cost shortfall: ${tournament.name}`,
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

                // Release court reservations
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
        return this.fieldModel.find({
            sportType,
            isActive: true,
            'location.address': { $regex: location, $options: 'i' },
        }).lean();
    }

    // In tournaments.service.ts
    async findAvailableCourts(sportType: string, location: string, date: string) {
        const tournamentDate = new Date(date);

        try {
            this.logger.log(`Finding available courts for: sportType=${sportType}, location=${location}, date=${date}`);

            // Find courts and populate field with sportType information
            const courts = await this.courtModel.find({
                isActive: true,
            })
                .populate<{ field: any }>({
                    path: 'field',
                    match: {
                        sportType: sportType,
                        isActive: true,
                        'location.address': { $regex: new RegExp(location, 'i') },
                    },
                    select: 'name sportType location description images basePrice rating totalReviews amenities operatingHours'
                })
                .lean();

            this.logger.log(`Found ${courts.length} courts initially`);

            // Filter out courts where field doesn't exist or doesn't match criteria
            const locationFilteredCourts = courts.filter(court => {
                // Check if field exists and has sportType property
                const hasField = court.field && typeof court.field === 'object';
                if (!hasField) {
                    return false;
                }

                // Type assertion to access field properties
                const field = court.field as any;
                return field.sportType === sportType;
            });

            this.logger.log(`After location filter: ${locationFilteredCourts.length} courts`);

            // Check for existing reservations
            const startOfDay = new Date(tournamentDate);
            startOfDay.setHours(0, 0, 0, 0);

            const endOfDay = new Date(tournamentDate);
            endOfDay.setHours(23, 59, 59, 999);

            const existingReservations = await this.reservationModel.find({
                date: {
                    $gte: startOfDay,
                    $lte: endOfDay
                },
                status: { $in: [ReservationStatus.PENDING, ReservationStatus.CONFIRMED] }
            }).lean();

            this.logger.log(`Found ${existingReservations.length} existing reservations`);

            // Extract reserved court IDs safely
            const reservedCourtIds = existingReservations
                .filter(reservation => reservation.court)
                .map(reservation => {
                    // Handle both ObjectId and string formats
                    const courtId = reservation.court;
                    if (courtId && typeof courtId === 'object' && 'toString' in courtId) {
                        return courtId.toString();
                    }
                    return String(courtId);
                })
                .filter(id => id && id !== 'null' && id !== 'undefined');

            this.logger.log(`Reserved court IDs: ${reservedCourtIds.join(', ')}`);

            // Filter out reserved courts
            const availableCourts = locationFilteredCourts.filter(court => {
                const courtId = court._id.toString();
                const isReserved = reservedCourtIds.includes(courtId);

                if (isReserved) {
                    this.logger.log(`Court ${courtId} is reserved`);
                }

                return !isReserved;
            });

            this.logger.log(`Available courts: ${availableCourts.length}`);

            // Transform the data for frontend
            const transformedCourts = availableCourts.map(court => {
                const field = court.field as any;
                return {
                    _id: court._id.toString(),
                    name: court.name,
                    courtNumber: court.courtNumber,
                    sportType: field.sportType,
                    field: {
                        _id: field._id.toString(),
                        name: field.name,
                        sportType: field.sportType,
                        location: field.location,
                        description: field.description,
                        images: field.images || [],
                        basePrice: field.basePrice || 0,
                        rating: field.rating || 0,
                        totalReviews: field.totalReviews || 0,
                        amenities: field.amenities || [],
                        operatingHours: field.operatingHours || []
                    },
                    pricingOverride: court.pricingOverride,
                    isActive: court.isActive,
                    basePrice: court.pricingOverride?.basePrice || field.basePrice || 0
                };
            });

            return transformedCourts;
        } catch (error) {
            this.logger.error('Error finding available courts:', error);
            this.logger.error('Error details:', {
                sportType,
                location,
                date,
                errorMessage: error.message,
                errorStack: error.stack
            });
            throw new BadRequestException('Failed to find available courts');
        }
    }

    async findTournamentCourts(sportType: string, location: string, date: string) {
        const tournamentDate = new Date(date);

        // Find courts
        const courts = await this.courtModel.find({
            sportType,
            isActive: true,
        })
            .populate({
                path: 'field',
                match: {
                    'location.address': { $regex: location, $options: 'i' },
                    isActive: true,
                },
            })
            .lean();

        // Filter out courts where field doesn't exist or doesn't match location
        const locationFilteredCourts = courts.filter(court => court.field);

        // Check for existing tournament reservations on the same date
        const existingReservations = await this.reservationModel.find({
            date: {
                $gte: new Date(tournamentDate.setHours(0, 0, 0, 0)),
                $lt: new Date(tournamentDate.setHours(23, 59, 59, 999))
            },
            status: { $in: [ReservationStatus.PENDING, ReservationStatus.CONFIRMED] }
        });

        const reservedCourtIds = existingReservations.map(r => (r.court as Types.ObjectId).toString());

        // Filter out reserved courts
        const availableCourts = locationFilteredCourts.filter(court =>
            !reservedCourtIds.includes(court._id.toString())
        );

        return availableCourts;
    }

    private calculateCourtCost(court: any, date: Date, startTime: string, endTime: string): number {
        // Calculate hours from start to end time
        const hours = this.calculateHours(startTime, endTime);

        // Get base price from court's pricing override or field's base price
        const basePrice = court.pricingOverride?.basePrice ||
            (court.field?.basePrice || 100000);

        // Apply any date-based pricing (weekend/holiday multipliers)
        const dayOfWeek = date.getDay();
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
        const multiplier = isWeekend ? 1.2 : 1.0;

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

        // Populate courts and their fields
        query.populate({
            path: 'courts.court',
            populate: {
                path: 'field',
                select: 'name location address'
            }
        });

        // Sort by tournament date (upcoming first)
        query.sort({ tournamentDate: 1, createdAt: -1 });

        return query.exec();
    }

    async findOne(id: string) {
        const tournament = await this.tournamentModel
            .findById(id)
            .populate('organizer', 'fullName email avatarUrl')
            .populate('participants.user', 'fullName email avatarUrl')
            .populate({
                path: 'courts.court',
                populate: {
                    path: 'field',
                    select: 'name location description images basePrice'
                }
            })
            .populate('courts.reservation')
            .populate('courts.booking')
            // Keep backward compatibility
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
                    averageTeams: { $avg: '$numberOfTeams' },
                    totalCourtsReserved: { $sum: { $size: '$courts' } }
                }
            },
            {
                $project: {
                    _id: 0,
                    totalTournaments: 1,
                    activeTournaments: 1,
                    totalParticipants: 1,
                    totalRevenue: 1,
                    averageTeams: 1,
                    totalCourtsReserved: 1
                }
            }
        ]);

        return stats[0] || {
            totalTournaments: 0,
            activeTournaments: 0,
            totalParticipants: 0,
            totalRevenue: 0,
            averageTeams: 0,
            totalCourtsReserved: 0
        };
    }

    async getTournamentsBySport() {
        return this.tournamentModel.aggregate([
            {
                $group: {
                    _id: '$sportType',
                    count: { $sum: 1 },
                    totalParticipants: { $sum: { $size: '$participants' } },
                    averageTeams: { $avg: '$numberOfTeams' },
                    averageCourts: { $avg: { $size: '$courts' } }
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
                    averageCourts: 1,
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

    async findTournamentsByOrganizer(organizerId: string) {
        return this.tournamentModel
            .find({
                organizer: new Types.ObjectId(organizerId),
                status: { $ne: TournamentStatus.CANCELLED }
            })
            .sort({ createdAt: -1 })
            .populate('organizer', 'fullName email avatarUrl')
            .populate({
                path: 'courts.court',
                populate: {
                    path: 'field',
                    select: 'name location'
                }
            })
            .lean();
    }

    async updateTournament(id: string, updateDto: UpdateTournamentDto, userId: string) {
        const tournament = await this.tournamentModel.findById(id);

        if (!tournament) {
            throw new NotFoundException('Tournament not found');
        }

        // Check if user is the organizer
        if (tournament.organizer.toString() !== userId) {
            throw new BadRequestException('Only tournament organizer can update the tournament');
        }

        // Check if tournament can be updated (only PENDING or DRAFT status)
        if (![TournamentStatus.DRAFT, TournamentStatus.PENDING].includes(tournament.status)) {
            throw new BadRequestException('Cannot update tournament in current status');
        }

        // Update fields that can be modified
        const updatableFields = [
            'name',
            'description',
            'rules',
            'images',
            'registrationFee',
            'startTime',
            'endTime',
            'selectedCourtIds',
            'courtsNeeded',
            'numberOfTeams',
            'teamSize'
        ];

        // Only update allowed fields
        const updateData: any = {};
        updatableFields.forEach(field => {
            if (updateDto[field] !== undefined) {
                updateData[field] = updateDto[field];
            }
        });

        // If courts are being updated, recalculate cost
        if (updateDto.selectedCourtIds && updateDto.selectedCourtIds.length > 0) {
            // Validate new courts
            const selectedCourtIds = updateDto.selectedCourtIds || tournament.selectedCourtIds;
            const courts = await this.courtModel.find({
                _id: { $in: selectedCourtIds.map(id => new Types.ObjectId(id)) },
                isActive: true,
            }).populate('field');

            if (courts.length !== selectedCourtIds.length) {
                throw new BadRequestException('Some selected courts are not available');
            }

            // Calculate new court cost
            const tournamentDate = tournament.tournamentDate;
            const startTime = updateDto.startTime || tournament.startTime;
            const endTime = updateDto.endTime || tournament.endTime;

            let totalCourtCost = 0;
            for (const court of courts) {
                const cost = this.calculateCourtCost(court, tournamentDate, startTime, endTime);
                totalCourtCost += cost;
            }

            updateData.totalCourtCost = totalCourtCost;
            updateData.totalFieldCost = totalCourtCost; // Keep backward compatibility
        }

        const updatedTournament = await this.tournamentModel.findByIdAndUpdate(
            id,
            { $set: updateData },
            { new: true }
        )
            .populate('organizer')
            .populate({
                path: 'courts.court',
                populate: {
                    path: 'field',
                    select: 'name location description images basePrice'
                }
            });

        return updatedTournament;
    }

    async cancelTournament(id: string, userId: string) {
        const tournament = await this.tournamentModel.findById(id);

        if (!tournament) {
            throw new NotFoundException('Tournament not found');
        }

        // Check if user is the organizer
        if (tournament.organizer.toString() !== userId) {
            throw new BadRequestException('Only tournament organizer can cancel the tournament');
        }

        // Only allow cancellation if tournament is in draft or pending status
        if (![TournamentStatus.DRAFT, TournamentStatus.PENDING].includes(tournament.status)) {
            throw new BadRequestException('Cannot cancel tournament in current status');
        }

        // Release court reservations
        await this.reservationModel.updateMany(
            { tournament: tournament._id },
            { status: ReservationStatus.RELEASED }
        );

        // Refund participants if any
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

        tournament.status = TournamentStatus.CANCELLED;
        tournament.cancellationReason = 'Cancelled by organizer';
        await tournament.save();

        return tournament;
    }

    // In tournaments.service.ts - add this method
    // In tournaments.service.ts
    async confirmTournamentPaymentWithMetadata(
        transactionId: string,
        gatewayData: any
    ): Promise<Transaction> {
        const transaction = await this.transactionModel.findById(transactionId);

        if (!transaction) {
            throw new NotFoundException('Transaction not found');
        }

        // Always preserve existing metadata
        const existingMetadata = transaction.metadata || {};

        // Update with gateway data while preserving tournament info
        const updatedTransaction = await this.transactionModel.findByIdAndUpdate(
            transactionId,
            {
                status: TransactionStatus.SUCCEEDED,
                completedAt: new Date(),
                externalTransactionId: gatewayData.payosOrderCode?.toString(),
                metadata: {
                    ...existingMetadata,
                    payosReference: gatewayData.payosReference,
                    payosAccountNumber: gatewayData.payosAccountNumber,
                    payosTransactionDateTime: gatewayData.payosTransactionDateTime,
                    paymentVerifiedAt: new Date().toISOString(),
                },
                notes: `${transaction.notes || ''}\nPayment verified and completed via PayOS`
            },
            { new: true }
        );

        if (!updatedTransaction) {
            throw new NotFoundException('Transaction not found after update');
        }

        return updatedTransaction;
    }
}