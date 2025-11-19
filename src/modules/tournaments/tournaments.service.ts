import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Tournament, TournamentStatus } from './entities/tournament.entity';
import { TournamentFieldReservation, ReservationStatus } from './entities/tournament-field-reservation.entity';
import { Field } from '../fields/entities/field.entity';
import { Transaction, TransactionStatus, TransactionType } from '../transactions/entities/transaction.entity';
import { CreateTournamentDto, RegisterTournamentDto } from './dto/create-tournament.dto';
import { SPORT_RULES_MAP } from 'src/common/enums/sport-type.enum';
import { PaymentMethod } from 'src/common/enums/payment-method.enum';

@Injectable()
export class TournamentService {
    constructor(
        @InjectModel(Tournament.name) private tournamentModel: Model<Tournament>,
        @InjectModel(TournamentFieldReservation.name)
        private reservationModel: Model<TournamentFieldReservation>,
        @InjectModel(Field.name) private fieldModel: Model<Field>,
        @InjectModel(Transaction.name) private transactionModel: Model<Transaction>,
    ) { }

    async create(createTournamentDto: CreateTournamentDto, userId: string) {
        const sportRules = SPORT_RULES_MAP[createTournamentDto.sportType];

        // Validate participants against sport rules
        if (createTournamentDto.minParticipants < sportRules.minParticipants) {
            throw new BadRequestException(
                `Minimum participants for ${createTournamentDto.sportType} is ${sportRules.minParticipants}`
            );
        }

        if (createTournamentDto.maxParticipants > sportRules.maxParticipants) {
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

        // FIX: Explicitly type the reservations array
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
        });

        await tournament.save();
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

        if (tournament.participants.length >= tournament.maxParticipants) {
            throw new BadRequestException('Tournament is full');
        }

        // Check if user already registered
        const alreadyRegistered = tournament.participants.some(
            p => p.user.toString() === userId
        );

        if (alreadyRegistered) {
            throw new BadRequestException('Already registered for this tournament');
        }

        // Create payment transaction (held in escrow)
        const transaction = new this.transactionModel({
            user: new Types.ObjectId(userId),
            amount: tournament.registrationFee,
            direction: 'in',
            method: dto.paymentMethod as unknown as PaymentMethod,
            type: TransactionType.PAYMENT,
            status: TransactionStatus.PENDING,
            notes: `Tournament registration: ${tournament.name}`,
        });

        await transaction.save();

        // Add participant
        tournament.participants.push({
            user: new Types.ObjectId(userId),
            registeredAt: new Date(),
            transaction: transaction._id as Types.ObjectId,
        });

        tournament.totalRegistrationFeesCollected += tournament.registrationFee;

        // Check if minimum threshold is met
        if (tournament.participants.length >= tournament.minParticipants) {
            await this.confirmTournament(tournament);
        }

        await tournament.save();

        return tournament;
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
            // Create booking (simplified - would need full booking logic)
            reservation.status = ReservationStatus.CONFIRMED;
            await reservation.save();
        }

        // Calculate commission
        tournament.commissionAmount = tournament.totalRegistrationFeesCollected * tournament.commissionRate;
        tournament.prizePool = tournament.totalRegistrationFeesCollected - tournament.commissionAmount;

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
            // Ensure correct typing for the organizerPaymentTransaction field
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
            if (tournament.participants.length < tournament.minParticipants) {
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
        return this.fieldModel.find({
            sportType,
            isActive: true,
            'location.address': { $regex: location, $options: 'i' },
        });
    }

    private calculateFieldCost(field: any, date: Date, startTime: string, endTime: string): number {
        // Simplified calculation - would need full pricing logic
        const hours = this.calculateHours(startTime, endTime);
        return field.basePrice * hours;
    }

    private calculateHours(startTime: string, endTime: string): number {
        const [startHour, startMin] = startTime.split(':').map(Number);
        const [endHour, endMin] = endTime.split(':').map(Number);
        return (endHour * 60 + endMin - startHour * 60 - startMin) / 60;
    }

    async findAll(filters: any) {
        return this.tournamentModel
            .find(filters)
            .populate('organizer', 'fullName email avatarUrl')
            .sort({ tournamentDate: -1 });
    }

    async findOne(id: string) {
        return this.tournamentModel
            .findById(id)
            .populate('organizer', 'fullName email avatarUrl')
            .populate('participants.user', 'fullName email avatarUrl')
            .populate('fields.field');
    }
}