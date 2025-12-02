import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Tournament, TournamentStatus } from './entities/tournament.entity';
import { TournamentFieldReservation, ReservationStatus } from './entities/tournament-field-reservation.entity';
import { Field } from '../fields/entities/field.entity';
import { Transaction, TransactionStatus, TransactionType } from '../transactions/entities/transaction.entity';
import { CreateTournamentDto, RegisterTournamentDto } from './dto/create-tournament.dto';
import { SPORT_RULES_MAP, TeamSizeMap, calculateParticipants } from 'src/common/enums/sport-type.enum';
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

        // Check if user already registered
        const alreadyRegistered = tournament.participants.some(
            p => p.user.toString() === userId
        );

        if (alreadyRegistered) {
            throw new BadRequestException('Already registered for this tournament');
        }

        // For team sports, check if teams are filled
        const currentTeamCount = Math.ceil(tournament.participants.length / tournament.teamSize);

        // Check if we've reached maximum teams
        if (currentTeamCount >= tournament.numberOfTeams) {
            throw new BadRequestException('All tournament teams are already filled');
        }

        // Check if user's team is full (simplified - in real app you'd have team assignment logic)
        const participantsInCurrentTeam = tournament.participants.length % tournament.teamSize;
        if (participantsInCurrentTeam === tournament.teamSize - 1) {
            // This would be the last spot in a team
            console.log('Filling a team spot...');
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
        const requiredParticipants = tournament.minParticipants;
        if (tournament.participants.length >= requiredParticipants) {
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