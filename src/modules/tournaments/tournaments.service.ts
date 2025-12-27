import { Injectable, BadRequestException, NotFoundException, Logger, Inject, forwardRef } from '@nestjs/common';
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
import { BookingsService } from '../bookings/bookings.service';
import { FieldOwnerProfile } from '../field-owner/entities/field-owner-profile.entity';
import { BookingStatus } from '@common/enums';

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
        @InjectModel(FieldOwnerProfile.name)
        private fieldOwnerModel: Model<FieldOwnerProfile>,
        private readonly payosService: PayOSService,
        private readonly emailService: EmailService,
        private readonly eventEmitter: EventEmitter2,
        private readonly configService: ConfigService,
        private readonly transactionsService: TransactionsService,
        @Inject(forwardRef(() => BookingsService))
        private readonly bookingsService: BookingsService,
    ) {
        this.setupPaymentEventListeners();
    }

    /**
     * Get all tournament requests (reservations) for fields owned by this user
     */
    async getTournamentRequestsForFieldOwner(userId: string) {
        // 1. Find FieldOwnerProfile
        const profile = await this.fieldOwnerModel.findOne({ user: new Types.ObjectId(userId) });
        if (!profile) {
            throw new BadRequestException('Field owner profile not found');
        }

        // 2. Find all fields owned by this profile
        const fields = await this.fieldModel.find({ owner: profile._id as any }).select('_id');
        const fieldIds = fields.map(f => f._id);

        // 3. Find reservations for these fields
        return this.reservationModel.find({
            field: { $in: fieldIds },
        })
            .populate('tournament', 'name sportType category tournamentDate description organizer')
            .populate('court', 'name courtNumber')
            .populate('field', 'name location')
            .sort({ date: 1, startTime: 1 })
            .exec();
    }

    /**
     * Accept a tournament request and create a booking
     */
    async acceptTournamentRequest(userId: string, reservationId: string) {
        // 1. Find reservation and populate related data
        const reservation = await this.reservationModel.findById(reservationId)
            .populate('tournament')
            .populate('court');

        if (!reservation) {
            throw new NotFoundException('Reservation request not found');
        }

        if (reservation.status !== ReservationStatus.PENDING) {
            throw new BadRequestException(`Reservation is already ${reservation.status}`);
        }

        // 2. Verify ownership
        const profile = await this.fieldOwnerModel.findOne({ user: new Types.ObjectId(userId) });

        if (!reservation.field) {
            throw new BadRequestException('Reservation field is missing');
        }

        const field = await this.fieldModel.findById(reservation.field);

        if (!profile || !field || field.owner.toString() !== (profile._id as any).toString()) {
            throw new BadRequestException('You do not have permission to accept this request');
        }

        // 3. Update reservation status
        reservation.status = ReservationStatus.CONFIRMED;
        await reservation.save();

        // 4. Create actual booking in the system
        // We use a internal "tournament" user or the organizer?
        // Usually, the organizer is responsible, but the booking is "paid" or "held" by the tournament
        const tournament = reservation.tournament as any;

        const bookingData = {
            courtId: (reservation.court as any)._id?.toString() || reservation.court.toString(),
            fieldId: reservation.field.toString(),
            date: reservation.date.toISOString().split('T')[0],
            startTime: reservation.startTime,
            endTime: reservation.endTime,
            price: reservation.estimatedCost,
            paymentMethod: PaymentMethod.BANK_TRANSFER, // Tournament bookings are handled via escrow
            isInternal: true, // Mark as internal/tournament booking
            notes: `Tournament Booking: ${tournament.name}`,
        };

        // Call BookingsService to create the booking (offline mode usually)
        // We might need to bypass normal price checks or use a specific method
        const booking = await this.bookingsService.createFieldBookingWithoutPayment(
            tournament.organizer.toString(),
            bookingData as any
        );

        // Update booking status to CONFIRMED immediately
        booking.status = BookingStatus.CONFIRMED;
        booking.paymentStatus = 'paid';
        await booking.save();

        // 5. Link booking back to tournament
        const tournamentDoc = await this.tournamentModel.findById(tournament._id);
        if (tournamentDoc) {
            // Find the court entry in the tournament and update it
            const courtEntry = tournamentDoc.courts.find(c =>
                c.reservation && c.reservation.toString() === reservationId
            );

            if (courtEntry) {
                courtEntry.booking = booking._id as Types.ObjectId;
                tournamentDoc.markModified('courts');
                await tournamentDoc.save();
            }
        }

        // 6. Notify Organizer
        const organizer = await this.userModel.findById(tournament.organizer);
        if (organizer) {
            await this.emailService.sendTournamentAcceptedNotification({
                to: organizer.email,
                tournament: {
                    name: tournament.name,
                    date: reservation.date.toLocaleDateString(),
                    sportType: tournament.sportType,
                    location: field.name,
                },
                organizer: { fullName: organizer.fullName },
            });
        }

        return { success: true, bookingId: booking._id };
    }

    /**
     * Reject a tournament request
     */
    async rejectTournamentRequest(userId: string, reservationId: string) {
        // 1. Find reservation
        const reservation = await this.reservationModel.findById(reservationId)
            .populate('tournament')
            .populate('field');

        if (!reservation) {
            throw new NotFoundException('Reservation request not found');
        }

        if (reservation.status !== ReservationStatus.PENDING) {
            throw new BadRequestException(`Reservation is already ${reservation.status}`);
        }

        // 2. Verify ownership
        const profile = await this.fieldOwnerModel.findOne({ user: new Types.ObjectId(userId) });
        const field = reservation.field as any;

        if (!profile || !field || field.owner.toString() !== (profile._id as any).toString()) {
            throw new BadRequestException('You do not have permission to reject this request');
        }

        // 3. Update reservation status
        reservation.status = ReservationStatus.RELEASED;
        await reservation.save();

        // 4. Notify Organizer (Optional but recommended)
        const tournament = reservation.tournament as any;
        const organizer = await this.userModel.findById(tournament.organizer);
        if (organizer) {
            const tournamentDate = new Date(tournament.tournamentDate);
            const formattedDate = tournamentDate.toLocaleDateString('vi-VN');

            await this.emailService.sendTournamentRejectedNotification({
                to: organizer.email,
                tournament: {
                    name: tournament.name,
                    date: formattedDate,
                    location: tournament.location,
                },
                organizer: {
                    fullName: organizer.fullName,
                },
            });
        }

        return { success: true };
    }

    /**
     * Check if tournament should be confirmed (reached capacity)
     */
    async checkAndConfirmTournament(tournamentId: string) {
        const tournament = await this.tournamentModel.findById(tournamentId)
            .populate('participants.user');

        if (!tournament) return;

        // Count confirmed participants
        const confirmedCount = tournament.participants.filter(p =>
            p.paymentStatus === 'confirmed'
        ).length;

        this.logger.log(`Checking auto-confirmation for ${tournament.name}: ${confirmedCount}/${tournament.maxParticipants}`);

        if (confirmedCount >= tournament.maxParticipants && tournament.status === TournamentStatus.PENDING) {
            this.logger.log(`Tournament ${tournament.name} reached capacity! Confirming...`);

            tournament.status = TournamentStatus.CONFIRMED;
            await tournament.save();

            // Notify all participants
            for (const p of tournament.participants) {
                if (p.paymentStatus === 'confirmed' && p.user) {
                    const user = p.user as any;
                    await this.emailService.sendTournamentConfirmedNotification({
                        to: user.email,
                        tournament: {
                            name: tournament.name,
                            date: tournament.tournamentDate.toLocaleDateString(),
                            sportType: tournament.sportType,
                            location: tournament.location,
                        },
                        participant: { fullName: user.fullName },
                    });
                }
            }

            // Notify organizer too
            const organizer = await this.userModel.findById(tournament.organizer);
            if (organizer) {
                await this.emailService.sendMail({
                    to: organizer.email,
                    subject: `Thông báo: Giải đấu ${tournament.name} đã đủ người tham gia!`,
                    html: `<p>Chào ${organizer.fullName}, giải đấu của bạn đã đạt đủ ${tournament.maxParticipants} người đăng ký và đã được chuyển sang trạng thái XÁC NHẬN.</p>`
                });
            }
        }
    }

    async create(createTournamentDto: CreateTournamentDto, userId: string) {
        // Fetch user to check limits
        const user = await this.userModel.findById(userId);
        if (!user) {
            throw new NotFoundException('User not found');
        }

        // Limit Check 0: Demerit/Ban Check
        if (user.demeritUntil && new Date() < user.demeritUntil) {
            throw new BadRequestException(
                `Your account is currently restricted from creating tournaments until ${user.demeritUntil.toLocaleDateString('vi-VN')}. This is due to frequent cancellations.`
            );
        }

        // Limit Check 1: Max 3 active tournaments
        // We track this via user.activeTournamentsCount
        if (user.activeTournamentsCount >= 3) {
            // Re-verify actual count to be safe
            const actualActiveCount = await this.tournamentModel.countDocuments({
                organizer: userId,
                status: { $nin: [TournamentStatus.COMPLETED, TournamentStatus.CANCELLED] }
            });

            // Auto-correct if out of sync
            if (actualActiveCount < 3 && actualActiveCount !== user.activeTournamentsCount) {
                user.activeTournamentsCount = actualActiveCount;
                await user.save();
            } else if (actualActiveCount >= 3) {
                throw new BadRequestException('You have reached the limit of 3 active tournaments. Please complete or cancel existing ones.');
            }
        }

        // Limit Check 2: Weekly Creation Limit
        // FREE: 1, PREMIUM: 3
        const weeklyLimit = user.tournamentTier === 'PREMIUM' ? 3 : 1;
        if (user.weeklyTournamentCreationCount >= weeklyLimit) {
            throw new BadRequestException(
                `Weekly tournament creation limit reached (${user.weeklyTournamentCreationCount}/${weeklyLimit}). Upgrade to Premium for more.`
            );
        }

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

        // Get selected IDs (can be either court IDs or field IDs)
        const selectedIds = createTournamentDto.selectedCourtIds || createTournamentDto.selectedFieldIds || [];

        // Calculate total cost from frontend data (trust the frontend calculation)
        const totalCostFromDto = createTournamentDto.totalCourtCost || createTournamentDto.totalFieldCost || 0;

        // Calculate times
        const startTime = createTournamentDto.startTime;
        const endTime = createTournamentDto.endTime;

        let totalCourtCost = totalCostFromDto;
        const courtReservations: InstanceType<typeof this.reservationModel>[] = [];
        let courts: any[] = [];
        let fields: any[] = [];

        // Only validate and create reservations if IDs are provided
        if (selectedIds.length > 0) {
            // First, try to find as courts
            courts = await this.courtModel.find({
                _id: { $in: selectedIds.map(id => new Types.ObjectId(id)) },
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

            // If not found as courts, try as fields
            if (courts.length === 0) {
                this.logger.log('No courts found with provided IDs, trying as field IDs...');
                fields = await this.fieldModel.find({
                    _id: { $in: selectedIds.map(id => new Types.ObjectId(id)) },
                    sportType: createTournamentDto.sportType,
                    isActive: true,
                });

                if (fields.length > 0) {
                    this.logger.log(`Found ${fields.length} fields with provided IDs`);
                    // Calculate cost from fields if not provided
                    if (totalCourtCost === 0) {
                        for (const field of fields) {
                            const cost = this.calculateFieldCost(field, tournamentDate, startTime, endTime);
                            totalCourtCost += cost;
                        }
                    }
                } else {
                    this.logger.warn('No courts or fields found with provided IDs, creating tournament without reservations');
                }
            } else {
                this.logger.log(`Found ${courts.length} courts with provided IDs`);
                // Calculate cost from courts if not provided
                if (totalCourtCost === 0) {
                    for (const court of courts) {
                        const cost = this.calculateCourtCost(court, tournamentDate, startTime, endTime);
                        totalCourtCost += cost;
                    }
                }

                // Create court reservations
                for (const court of courts) {
                    const cost = this.calculateCourtCost(court, tournamentDate, startTime, endTime);

                    const reservation = new this.reservationModel({
                        tournament: null,
                        court: court._id,
                        field: court.field?._id,
                        date: tournamentDate,
                        startTime,
                        endTime,
                        estimatedCost: cost,
                        status: ReservationStatus.PENDING,
                        expiresAt: new Date(tournamentDate.getTime() - 48 * 60 * 60 * 1000),
                    });

                    courtReservations.push(reservation);
                }
            }
        }

        // Calculate confirmation deadline (48 hours before tournament)
        const confirmationDeadline = new Date(tournamentDate.getTime() - 48 * 60 * 60 * 1000);

        // Create tournament
        const tournament = new this.tournamentModel({
            ...createTournamentDto,
            organizer: new Types.ObjectId(userId),
            status: TournamentStatus.PENDING,
            totalCourtCost,
            totalFieldCost: totalCourtCost,
            confirmationDeadline,
            commissionRate: 0.1,
            participants: [],
            courts: [],
            fields: [],
            courtsNeeded: courtsNeeded,
            fieldsNeeded: courtsNeeded,
            numberOfTeams: createTournamentDto.numberOfTeams,
            teamSize: teamSize,

        });

        await tournament.save();

        // Save court reservations and link to tournament (if any)
        for (const reservation of courtReservations) {
            reservation.tournament = tournament._id as Types.ObjectId;
            await reservation.save();

            const court = courts.find(c => (c._id as Types.ObjectId).equals(reservation.court));

            tournament.courts.push({
                court: reservation.court as Types.ObjectId,
                field: court?.field?._id as Types.ObjectId,
                reservation: reservation._id as Types.ObjectId,
            });

            if (court?.field) {
                tournament.fields.push({
                    field: court.field._id as Types.ObjectId,
                    reservation: reservation._id as Types.ObjectId,
                });
            }
        }

        // If fields were found (not courts), add them to the tournament
        for (const field of fields) {
            tournament.fields.push({
                field: field._id as Types.ObjectId,
                reservation: null as any, // No reservation for field-only mode
            });
        }

        const savedTournament = await tournament.save();

        // Increment user counts
        user.activeTournamentsCount += 1;
        user.weeklyTournamentCreationCount += 1;
        await user.save();

        return savedTournament;
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
            // await this.sendTournamentRegistrationConfirmationEmail(userId, tournament, paymentLink.checkoutUrl);

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

    /**
     * ✅ ENHANCED: Handle tournament payment success with proper metadata handling
     * Uses TransactionsService.updateTransactionMetadata() to safely update transaction metadata
     * without overwriting PayOS webhook data (following bank verification pattern)
     */
    private async handleTournamentPaymentSuccess(event: {
        paymentId: string;
        bookingId?: string;
        tournamentId?: string;
        userId: string;
        amount: number;
        method?: string;
        transactionId?: string;
    }) {
        // ✅ CRITICAL FIX: This method now uses atomic updates to prevent race conditions
        // with PayOS webhooks that may be updating the same transaction simultaneously
        try {
            this.logger.log(`[Tournament Payment Success] Processing payment success event:`, {
                paymentId: event.paymentId,
                tournamentId: event.tournamentId,
                userId: event.userId,
                transactionId: event.transactionId
            });

            // First try to find by _id (paymentId)
            let transaction = await this.transactionModel.findById(event.paymentId);

            // If not found, try to find by externalTransactionId
            if (!transaction && event.transactionId) {
                this.logger.log(`[Tournament Payment Success] Transaction not found by ID, trying externalTransactionId: ${event.transactionId}`);
                transaction = await this.transactionModel.findOne({
                    externalTransactionId: event.transactionId
                });
            }

            // If still not found, try to find by metadata.payosReference
            if (!transaction && event.transactionId) {
                this.logger.log(`[Tournament Payment Success] Transaction not found by externalTransactionId, trying payosReference: ${event.transactionId}`);
                transaction = await this.transactionModel.findOne({
                    'metadata.payosReference': event.transactionId
                });
            }

            if (!transaction) {
                this.logger.error(`[Tournament Payment Success] ❌ Transaction not found for:`, {
                    paymentId: event.paymentId,
                    transactionId: event.transactionId
                });
                return;
            }

            this.logger.log(`[Tournament Payment Success] ✅ Transaction found: ${transaction._id}`);

            // ✅ Get userId from transaction if not provided in event
            const userId = event.userId ||
                (transaction.user
                    ? (typeof transaction.user === 'string'
                        ? transaction.user
                        : String(transaction.user))
                    : null);

            if (!userId) {
                this.logger.error(`[Tournament Payment Success] ❌ No userId found in event or transaction:`, {
                    eventUserId: event.userId,
                    transactionUser: transaction.user
                });
                return;
            }

            // ✅ Get tournament ID from event or transaction metadata (prioritize event)
            const tournamentId = event.tournamentId ||
                (transaction.metadata?.tournamentId ?
                    String(transaction.metadata.tournamentId) : null);

            (transaction.metadata?.tournamentId ?
                String(transaction.metadata.tournamentId) : null);

            if (!tournamentId) {
                // Not a tournament transaction - likely a field/coach booking
                this.logger.debug(`[Tournament Payment Success] ℹ️ Ignoring non-tournament transaction: ${transaction._id}`);
                return;
            }

            this.logger.log(`[Tournament Payment Success] ✅ Tournament ID found: ${tournamentId}`);

            // Find tournament
            const tournament = await this.tournamentModel.findById(tournamentId);

            if (!tournament) {
                this.logger.error(`[Tournament Payment Success] ❌ Tournament not found: ${tournamentId}`);
                return;
            }

            this.logger.log(`[Tournament Payment Success] ✅ Tournament found: ${tournament.name}`);

            // ✅ DEBUG: Log transaction metadata to verify type field
            this.logger.log(`[Tournament Payment Success] Transaction metadata:`, {
                type: transaction.metadata?.type,
                tournamentId: transaction.metadata?.tournamentId,
                metadataKeys: Object.keys(transaction.metadata || {})
            });

            // ✅ TOURNAMENT_CANCELLATION_FEE is deprecated in favor of demerit system
            // Keeping structure for other tournament-related payments
            if (transaction.metadata?.type === 'TOURNAMENT_REGISTRATION') {
                this.logger.log(`[Tournament Payment Success] Processing registration for tournament ${tournamentId}`);
                // Existing registration logic...
            }
            // Check if user is already registered
            const alreadyRegistered = tournament.participants.some(
                p => String(p.user) === userId
            );

            if (alreadyRegistered) {
                this.logger.warn(`[Tournament Payment Success] ⚠️ User ${userId} already registered for tournament ${tournamentId}`);
                // Still send confirmation email in case it wasn't sent before
                try {
                    await this.sendTournamentRegistrationConfirmation(userId, tournament);
                    this.logger.log(`[Tournament Payment Success] ✅ Confirmation email sent to already registered user ${userId}`);
                } catch (emailError) {
                    this.logger.error(`[Tournament Payment Success] ❌ Error sending email to already registered user:`, emailError);
                }
                return;
            }

            // ✅ Add participant to tournament
            tournament.participants.push({
                user: new Types.ObjectId(userId),
                registeredAt: new Date(),
                confirmedAt: new Date(),
                transaction: transaction._id as Types.ObjectId,
                paymentStatus: 'confirmed',
            });

            await tournament.save();
            this.logger.log(`[Tournament Payment Success] ✅ Participant ${userId} added to tournament ${tournament.name}`);

            // ✅ ENHANCED: Use TransactionsService to update metadata safely
            // This ensures PayOS metadata is preserved and atomic operation
            await this.transactionsService.updateTransactionMetadata(
                (transaction._id as Types.ObjectId).toString(),
                {
                    tournamentProcessed: true,
                    tournamentProcessedAt: new Date(),
                    tournamentParticipantConfirmed: true,
                    tournamentConfirmedAt: new Date(),
                }
            );
            this.logger.log(`[Tournament Payment Success] ✅ Transaction ${transaction._id} metadata updated via TransactionsService`);

            // ✅ Send confirmation email after participant is successfully added
            try {
                await this.sendTournamentRegistrationConfirmation(userId, tournament);
                this.logger.log(`[Tournament Payment Success] ✅ Confirmation email sent to ${userId} for tournament ${tournament.name}`);
            } catch (emailError) {
                this.logger.error(`[Tournament Payment Success] ❌ Error sending confirmation email:`, emailError);
                // Don't fail the whole process if email fails
            }

            this.logger.log(`[Tournament Payment Success] ✅ Successfully processed tournament payment for participant ${userId} in tournament ${tournament.name}`);

            // ✅ Auto-confirm tournament if capacity reached
            await this.checkAndConfirmTournament(tournamentId);
        } catch (error) {
            this.logger.error('[Tournament Payment Success] ❌ Error processing tournament payment:', error);
            this.logger.error('[Tournament Payment Success] Error stack:', error.stack);
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
            // Min participants check removed
            const minParticipantsNeeded = 0;

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

                // Decrement active count for organizer
                const organizer = await this.userModel.findById(tournament.organizer);
                if (organizer && organizer.activeTournamentsCount > 0) {
                    organizer.activeTournamentsCount -= 1;
                    await organizer.save();
                }
            }
        }
    }

    async findAvailableFields(sportType: string, location: string, date: string, startTime?: string, endTime?: string) {
        const query: any = {
            sportType,
            isActive: true,
            'location.address': { $regex: location, $options: 'i' },
        };

        const fields = await this.fieldModel.find(query).lean();

        if (!startTime || !endTime) {
            return fields;
        }

        const tournamentDate = new Date(date);
        const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const dayOfWeek = days[tournamentDate.getUTCDay()]; // Use UTC to be consistent with date storage

        return fields.filter(field => {
            const dayOperatingHours = field.operatingHours?.find(oh => oh.day.toLowerCase() === dayOfWeek);
            if (!dayOperatingHours) return false;

            // Check if operating hours cover the requested time slot
            return startTime >= dayOperatingHours.start && endTime <= dayOperatingHours.end;
        });
    }

    // In tournaments.service.ts
    async findAvailableCourts(sportType: string, location: string, date: string, startTime?: string, endTime?: string) {
        const tournamentDate = new Date(date);

        try {
            this.logger.log(`Finding available courts for: sportType = ${sportType}, location = ${location}, date = ${date}, time = ${startTime}-${endTime}`);

            // 1. Initial filter by field criteria (sportType, isActive, location)
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

            // 2. Filter out courts where field doesn't exist or doesn't match operating hours
            const dayOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][tournamentDate.getUTCDay()];

            const filteredCourts = courts.filter(court => {
                if (!court.field || typeof court.field !== 'object') return false;
                const field = court.field as any;
                if (field.sportType !== sportType) return false;

                // Check operating hours if time is provided
                if (startTime && endTime) {
                    const dayOperatingHours = field.operatingHours?.find(oh => oh.day.toLowerCase() === dayOfWeek);
                    if (!dayOperatingHours) return false;
                    if (startTime < dayOperatingHours.start || endTime > dayOperatingHours.end) return false;
                }

                return true;
            });

            this.logger.log(`After field/operating hours filter: ${filteredCourts.length} courts`);

            // 3. Check for existing reservations overlapping the requested time
            const startOfDayDate = new Date(tournamentDate);
            startOfDayDate.setUTCHours(0, 0, 0, 0);

            const endOfDayDate = new Date(tournamentDate);
            endOfDayDate.setUTCHours(23, 59, 59, 999);

            const existingReservations = await this.reservationModel.find({
                date: {
                    $gte: startOfDayDate,
                    $lte: endOfDayDate
                },
                status: { $in: [ReservationStatus.PENDING, ReservationStatus.CONFIRMED] }
            }).lean();

            this.logger.log(`Found ${existingReservations.length} existing reservations for the day`);

            // 4. Final availability check (reservation overlap)
            const availableCourts = filteredCourts.filter(court => {
                const courtId = court._id.toString();

                // Check for overlapping reservations for THIS court
                const courtReservations = existingReservations.filter(res => {
                    const resCourtId = res.court?.toString() || String(res.court);
                    return resCourtId === courtId;
                });

                if (startTime && endTime && courtReservations.length > 0) {
                    const hasOverlap = courtReservations.some(res => {
                        // Reseration overlaps if res.startTime < endTime AND res.endTime > startTime
                        return res.startTime < endTime && res.endTime > startTime;
                    });
                    if (hasOverlap) {
                        this.logger.log(`Court ${courtId} has overlapping reservation`);
                        return false;
                    }
                } else if (courtReservations.length > 0) {
                    // If no time range provided, ANY reservation on that day makes it unavailable (default behavior)
                    return false;
                }

                return true;
            });

            this.logger.log(`Available courts: ${availableCourts.length} `);

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
                    isActive: court.isActive,
                    basePrice: field.basePrice || 0
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
            isActive: true,
        })
            .populate({
                path: 'field',
                match: {
                    sportType: sportType,
                    'location.address': { $regex: new RegExp(location, 'i') },
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

        // Get base price from field's base price
        const basePrice = court.field?.basePrice || 100000;

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

    private calculateFieldCost(field: any, date: Date, startTime: string, endTime: string): number {
        // Calculate hours from start to end time
        const hours = this.calculateHours(startTime, endTime);

        // Get base price from field
        const basePrice = field.basePrice || 100000;

        // Apply any date-based pricing (weekend/holiday multipliers)
        const dayOfWeek = date.getDay();
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
        const multiplier = isWeekend ? 1.2 : 1.0;

        return Math.round(basePrice * hours * multiplier);
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
            .populate('teams.members', 'fullName email avatarUrl')
            .populate('teams.captain', 'fullName email avatarUrl')
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
                `Cannot transition from ${tournament.status} to ${status} `
            );
        }

        tournament.status = status;

        // Decrement active count if status is CANCELLED or COMPLETED
        if (status === TournamentStatus.CANCELLED || status === TournamentStatus.COMPLETED) {
            const organizer = await this.userModel.findById(tournament.organizer);
            if (organizer && organizer.activeTournamentsCount > 0) {
                organizer.activeTournamentsCount -= 1;
                await organizer.save();
            }
        }

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

    async findTournamentsByParticipant(userId: string) {
        return this.tournamentModel
            .find({
                'participants.user': new Types.ObjectId(userId),
                'participants.paymentStatus': 'confirmed',
                status: { $ne: TournamentStatus.CANCELLED }
            })
            .sort({ tournamentDate: -1 })
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

    /**
     * ✅ ENHANCED: Confirm tournament payment with proper metadata handling
     * Uses TransactionsService methods to safely handle PayOS gateway data
     * without overwriting existing tournament metadata
     */
    async confirmTournamentPaymentWithMetadata(
        transactionId: string,
        gatewayData: any
    ): Promise<Transaction> {
        const transaction = await this.transactionModel.findById(transactionId);

        if (!transaction) {
            throw new NotFoundException('Transaction not found');
        }

        // ✅ Use TransactionsService.updatePaymentStatus to handle gateway data properly
        // This ensures PayOS metadata is merged correctly and atomically
        const updatedTransaction = await this.transactionsService.updatePaymentStatusSafe(
            transactionId,
            TransactionStatus.SUCCEEDED,
            undefined, // receiptUrl
            {
                payosOrderCode: gatewayData.payosOrderCode,
                payosReference: gatewayData.payosReference,
                payosAccountNumber: gatewayData.payosAccountNumber,
                payosTransactionDateTime: gatewayData.payosTransactionDateTime,
            }
        );

        // ✅ Use updateTransactionMetadata to add tournament-specific fields
        await this.transactionsService.updateTransactionMetadata(
            transactionId,
            {
                paymentVerifiedAt: new Date().toISOString(),
                tournamentPaymentConfirmed: true,
            }
        );

        // ✅ Use updateTransactionMetadata to add tournament-specific fields
        await this.transactionsService.updateTransactionMetadata(
            transactionId,
            {
                paymentVerifiedAt: new Date().toISOString(),
                tournamentPaymentConfirmed: true,
            }
        );

        if (!updatedTransaction) {
            throw new NotFoundException('Transaction not found after update');
        }

        return updatedTransaction;
    }
    /**
     * Get cancellation fee details for a tournament
     */
    async getCancellationFee(tournamentId: string, userId: string) {
        const tournament = await this.tournamentModel.findById(tournamentId);
        if (!tournament) throw new NotFoundException('Tournament not found');

        // Allow admin or organizer
        if (tournament.organizer.toString() !== userId) {
            // You might want to check for admin role here if available
            throw new BadRequestException('Only organizer can check cancellation fee');
        }

        return this.calculateCancellationFee(tournament);
    }

    /**
     * Calculate cancellation fee based on rules
     */
    private calculateCancellationFee(tournament: Tournament) {
        const now = new Date();
        const createdDate = new Date(tournament.createdAt as any);
        const tournamentDate = new Date(tournament.tournamentDate);

        // Free Window: < 48 hours from creation
        const hoursSinceCreation = (now.getTime() - createdDate.getTime()) / (1000 * 60 * 60);

        // Debug logging
        this.logger.log(`Calculating cancellation fee for ${tournament._id}: Hours since creation: ${hoursSinceCreation}`);

        if (hoursSinceCreation <= 48) {
            return { fee: 0, percentage: 0, reason: 'Free cancellation window (< 48h)' };
        }

        // Tiered Fees
        const daysToTournament = (tournamentDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
        let feePercentage = 0;
        let reason = '';

        if (daysToTournament > 7) {
            feePercentage = 0.10; // 10%
            reason = 'Early cancellation (> 7 days before event)';
        } else {
            feePercentage = 0.50; // 50%
            reason = 'Late cancellation (< 7 days before event)';
        }

        const baseCost = tournament.totalCourtCost || tournament.totalFieldCost || 0;
        const fee = Math.ceil(baseCost * feePercentage);

        return { fee, percentage: feePercentage, reason, baseCost };
    }

    /**
     * Cancel a tournament
     * Simplified version - always free cancellation (no fee required)
     */
    async cancelTournament(tournamentId: string, userId: string, cancellationReason: string) {
        const tournament = await this.tournamentModel.findById(tournamentId);

        if (!tournament) {
            throw new NotFoundException('Tournament not found');
        }

        // Only organizer can cancel
        if (tournament.organizer.toString() !== userId) {
            throw new BadRequestException('Only the organizer can cancel the tournament');
        }

        if (tournament.status === TournamentStatus.CANCELLED) {
            throw new BadRequestException('Tournament already cancelled');
        }

        // Cannot cancel if already started
        const now = new Date();
        if (now >= new Date(tournament.tournamentDate)) {
            throw new BadRequestException('Cannot cancel a tournament that has already started');
        }

        this.logger.log(`Cancelling tournament ${tournamentId}. Reason: ${cancellationReason}`);

        // Apply Demerit System
        const user = await this.userModel.findById(userId);
        if (user) {
            const shortInterval = 30 * 24 * 60 * 60 * 1000; // 30 days
            const lastCancelTime = user.lastCancellationDate ? user.lastCancellationDate.getTime() : 0;
            const timeSinceLastCancel = now.getTime() - lastCancelTime;

            if (user.lastCancellationDate && timeSinceLastCancel < shortInterval) {
                // If cancelled twice within 30 days, ban for 1 year
                const oneYear = 365 * 24 * 60 * 60 * 1000;
                user.demeritUntil = new Date(now.getTime() + oneYear);
                this.logger.log(`User ${userId} penalized with 1-year ban due to frequent cancellations.`);
            }

            user.lastCancellationDate = now;
            await user.save();
        }

        // Perform cancellation (refunds participants, releases courts)
        await this.processCancellation(tournament, cancellationReason);

        return {
            success: true,
            message: 'Tournament cancelled successfully. Demerit applied if applicable.'
        };
    }

    /**
     * Process actual cancellation (refunds, release courts)
     */
    async processCancellation(tournament: Tournament, reason: string) {
        this.logger.log(`Processing cancellation for tournament ${tournament._id}`);

        tournament.status = TournamentStatus.CANCELLED;
        tournament.cancellationReason = reason;
        // tournament.cancelledAt = new Date(); // If field exists
        await tournament.save();

        // Release Reservations
        await this.reservationModel.updateMany(
            { tournament: tournament._id },
            { status: ReservationStatus.RELEASED }
        );

        // Refund Participants
        const participantsToRefund = tournament.participants.filter(p => p.paymentStatus === 'confirmed');

        for (const p of participantsToRefund) {
            // Create REFUND transaction record
            // Actual money refund logic depends on system (manual or auto via gateway)
            // For now, we assume manual/admin processing or separate refund service
            const refundTransaction = new this.transactionModel({
                user: p.user,
                amount: p.transaction ? tournament.registrationFee : 0, // Should look up original transaction amount
                direction: 'out',
                type: TransactionType.REFUND_FULL, // or REFUND_FULL
                status: TransactionStatus.PENDING,
                notes: `Auto-refund for cancelled tournament: ${tournament.name}`,
                relatedTransaction: p.transaction,
                metadata: {
                    tournamentId: tournament._id,
                    reason: 'Tournament Cancelled'
                }
            });
            await refundTransaction.save();

            p.paymentStatus = 'refunded'; // Mark as refunded (or pending_refund)
        }

        if (participantsToRefund.length > 0) {
            tournament.markModified('participants');
            await tournament.save();
        }

        // ✅ Send cancellation emails to all confirmed participants
        // Debug: Log all participants and their payment statuses
        this.logger.log(`Total participants in tournament: ${tournament.participants.length}`);
        tournament.participants.forEach((p, index) => {
            this.logger.log(`Participant ${index + 1}: paymentStatus = "${p.paymentStatus}"`);
        });

        const confirmedParticipants = tournament.participants.filter(
            p => p.paymentStatus === 'confirmed' || p.paymentStatus === 'refunded'
        );

        this.logger.log(`Sending cancellation emails to ${confirmedParticipants.length} participants`);

        for (const participant of confirmedParticipants) {
            try {
                const user = await this.userModel.findById(participant.user).select('email fullName').exec();
                if (user?.email) {
                    await this.emailService.sendTournamentCancellationNotification({
                        to: user.email,
                        participant: { fullName: user.fullName },
                        tournament: {
                            name: tournament.name,
                            sportType: tournament.sportType,
                            date: tournament.tournamentDate.toLocaleDateString('vi-VN'),
                            time: `${tournament.startTime} - ${tournament.endTime}`,
                            location: tournament.location
                        },
                        cancellationReason: reason,
                        refundAmount: tournament.registrationFee
                    });
                    this.logger.log(`✅ Cancellation email sent to ${user.email}`);
                } else {
                    this.logger.warn(`⚠️ User ${participant.user} has no email address`);
                }
            } catch (emailError) {
                this.logger.error(`❌ Failed to send cancellation email to participant ${participant.user}:`, emailError);
                // Don't fail the whole process if email fails
            }
        }

        this.logger.log(`✅ Tournament ${tournament.name} cancellation processed successfully`);
    }
}
