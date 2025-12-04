import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document, Types } from 'mongoose';
import { SportType, CompetitionFormat } from 'src/common/enums/sport-type.enum';
import { BaseEntity, configureBaseEntitySchema } from 'src/common/entities/base.entity';

export enum TournamentStatus {
  DRAFT = 'draft', // Initial creation, fields not reserved
  PENDING = 'pending', // Fields reserved, waiting for minimum participants
  CONFIRMED = 'confirmed', // Minimum threshold met, fields booked
  ONGOING = 'ongoing',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

@Schema()
export class Tournament extends BaseEntity {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true, enum: SportType })
  sportType: SportType;

  @Prop({ required: true })
  category: string;

  @Prop({ required: true, enum: CompetitionFormat })
  competitionFormat: CompetitionFormat;

  @Prop({ required: true })
  location: string;

  // Tournament date (when it actually happens)
  @Prop({ required: true, type: Date })
  tournamentDate: Date;

  // Registration period
  @Prop({ required: true, type: Date })
  registrationStart: Date;

  @Prop({ required: true, type: Date })
  registrationEnd: Date;

  // Tournament time slot
  @Prop({ required: true })
  startTime: string;

  @Prop({ required: true })
  endTime: string;

  // Teams configuration
  @Prop({ required: true, min: 1 })
  numberOfTeams: number;

  @Prop({ required: true, min: 1, max: 20, default: 1 })
  teamSize: number;

  // Derived participants count (calculated from teams)
  @Prop({ required: true, min: 1 })
  maxParticipants: number;

  @Prop({ required: true, min: 1 })
  minParticipants: number;

  @Prop({ required: true, min: 0 })
  registrationFee: number;

  @Prop({ required: true })
  description: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  organizer: Types.ObjectId;

  @Prop({ 
    type: [{ 
      user: { type: Types.ObjectId, ref: 'User', required: true },
      registeredAt: { type: Date, default: Date.now },
      transaction: { type: Types.ObjectId, ref: 'Transaction' },
      teamNumber: { type: Number, min: 1 }, // Team assignment
      position: { type: String }, // Position in team (e.g., "Captain", "Player")
      paymentStatus: { 
        type: String, 
        enum: ['pending', 'confirmed', 'failed', 'refunded'],
        default: 'pending'
      },
      confirmedAt: { type: Date },
    }],
    default: []
  })
  participants: Array<{
    confirmedAt?: Date; 
    user: Types.ObjectId;
    registeredAt: Date;
    transaction?: Types.ObjectId;
    teamNumber?: number;
    position?: string;
    paymentStatus?: string;
  }>;

  @Prop({ 
    enum: TournamentStatus, 
    default: TournamentStatus.DRAFT 
  })
  status: TournamentStatus;

  // Field Reservation
  @Prop({ 
    type: [{ 
      field: { type: Types.ObjectId, ref: 'Field', required: true },
      reservation: { type: Types.ObjectId, ref: 'TournamentFieldReservation' },
      booking: { type: Types.ObjectId, ref: 'Booking' }
    }],
    default: []
  })
  fields: Array<{
    field: Types.ObjectId;
    reservation?: Types.ObjectId;
    booking?: Types.ObjectId;
  }>;

  @Prop({ required: true, min: 1 })
  fieldsNeeded: number;

  @Prop({ required: true, min: 0 })
  totalFieldCost: number;

  // Confirmation deadline (e.g., 48 hours before tournament)
  @Prop({ required: true, type: Date })
  confirmationDeadline: Date;

  // Escrow tracking
  @Prop({ type: Number, default: 0 })
  totalRegistrationFeesCollected: number;

  @Prop({ type: Types.ObjectId, ref: 'Transaction' })
  organizerPaymentTransaction?: Types.ObjectId;

  // Commission
  @Prop({ type: Number, default: 0.1 }) // 10% default
  commissionRate: number;

  @Prop({ type: Number, default: 0 })
  commissionAmount: number;

  // Prize money or expenses
  @Prop({ type: Number, default: 0 })
  prizePool: number;

  // Team management
  @Prop({ 
    type: [{
      teamNumber: { type: Number, required: true, min: 1 },
      name: { type: String },
      captain: { type: Types.ObjectId, ref: 'User' },
      members: [{ type: Types.ObjectId, ref: 'User' }],
      isFull: { type: Boolean, default: false },
      color: { type: String }, // Team color for UI
      score: { type: Number, default: 0 },
      matchesPlayed: { type: Number, default: 0 },
      matchesWon: { type: Number, default: 0 },
      matchesLost: { type: Number, default: 0 },
      matchesDrawn: { type: Number, default: 0 },
      points: { type: Number, default: 0 },
      ranking: { type: Number, default: 0 },
    }],
    default: []
  })
  teams: Array<{
    teamNumber: number;
    name?: string;
    captain?: Types.ObjectId;
    members: Types.ObjectId[];
    isFull: boolean;
    color?: string;
    score: number;
    matchesPlayed: number;
    matchesWon: number;
    matchesLost: number;
    matchesDrawn: number;
    points: number;
    ranking: number;
  }>;

  // Bracket/Standings data
  @Prop({ type: mongoose.Schema.Types.Mixed })
  bracketData?: any; // Tournament bracket structure

  @Prop({ type: mongoose.Schema.Types.Mixed })
  standings?: any; // Tournament standings

  // Tournament rules
  @Prop({ type: String })
  rules?: string;

  // Tournament schedule
  @Prop({ 
    type: [{
      matchNumber: { type: Number },
      round: { type: String },
      teamA: { type: Number }, // teamNumber
      teamB: { type: Number }, // teamNumber
      field: { type: Types.ObjectId, ref: 'Field' },
      startTime: { type: Date },
      endTime: { type: Date },
      scoreA: { type: Number },
      scoreB: { type: Number },
      winner: { type: Number }, // teamNumber
      status: { 
        type: String, 
        enum: ['scheduled', 'ongoing', 'completed', 'cancelled'],
        default: 'scheduled'
      },
      referee: { type: Types.ObjectId, ref: 'User' },
    }],
    default: []
  })
  schedule: Array<{
    matchNumber: number;
    round: string;
    teamA: number;
    teamB: number;
    field?: Types.ObjectId;
    startTime?: Date;
    endTime?: Date;
    scoreA?: number;
    scoreB?: number;
    winner?: number;
    status: string;
    referee?: Types.ObjectId;
  }>;

  // Images and media
  @Prop({ type: [String], default: [] })
  images: string[];

  // Additional metadata
  @Prop({ type: Boolean, default: false })
  hasReferee: boolean;

  @Prop({ type: Number, default: 0 })
  refereeFee: number;

  @Prop({ type: String })
  trophyImage?: string;

  @Prop({ type: String })
  sponsorLogo?: string;

  @Prop({ type: String })
  venueMap?: string;

  @Prop({ type: String })
  cancellationReason?: string;

  @Prop({ type: Date })
  completedAt?: Date;

  @Prop({ type: Number, default: 0 })
  averageRating: number;

  @Prop({ type: Number, default: 0 })
  totalReviews: number;
}

export const TournamentSchema = SchemaFactory.createForClass(Tournament);
configureBaseEntitySchema(TournamentSchema);

TournamentSchema.index({ sportType: 1, status: 1 });
TournamentSchema.index({ tournamentDate: 1 });
TournamentSchema.index({ registrationEnd: 1 });
TournamentSchema.index({ organizer: 1 });
TournamentSchema.index({ 'teams.captain': 1 });
TournamentSchema.index({ 'participants.user': 1 });
TournamentSchema.index({ numberOfTeams: 1, teamSize: 1 });
TournamentSchema.index({ location: 'text', name: 'text', description: 'text' });

// Virtual for calculating current teams formed
TournamentSchema.virtual('currentTeams').get(function() {
  if (!this.participants || this.participants.length === 0) return 0;
  return Math.ceil(this.participants.length / this.teamSize);
});

// Virtual for calculating remaining spots
TournamentSchema.virtual('remainingSpots').get(function() {
  const totalSpots = this.numberOfTeams * this.teamSize;
  return Math.max(0, totalSpots - this.participants.length);
});

// Virtual for checking if tournament is full
TournamentSchema.virtual('isFull').get(function() {
  if (!this.numberOfTeams || !this.teamSize) return false;
  const totalSpots = this.numberOfTeams * this.teamSize;
  return this.participants.length >= totalSpots;
});

// Add a virtual for calculating currentTeams properly:
TournamentSchema.virtual('currentTeams').get(function() {
  if (!this.teamSize || this.teamSize === 0) return 0;
  if (!this.participants || this.participants.length === 0) return 0;
  
  const calculatedTeams = Math.ceil(this.participants.length / this.teamSize);
  return Math.min(calculatedTeams, this.numberOfTeams || 0);
});

// Virtual for getting formatted team info
TournamentSchema.virtual('teamInfo').get(function() {
  return {
    totalTeams: this.numberOfTeams,
    teamSize: this.teamSize,
    currentTeams: Math.ceil(this.participants.length / this.teamSize),
    participants: this.participants.length,
    remainingSpots: Math.max(0, (this.numberOfTeams * this.teamSize) - this.participants.length),
    isFull: this.participants.length >= (this.numberOfTeams * this.teamSize)
  };
});

// Method to assign participant to team
TournamentSchema.methods.assignToTeam = function(userId: Types.ObjectId, teamNumber?: number) {
  const participant = this.participants.find(p => p.user.toString() === userId.toString());
  if (!participant) {
    throw new Error('Participant not found');
  }

  // If teamNumber is provided, assign to that team
  if (teamNumber) {
    // Check if team exists
    let team = this.teams.find(t => t.teamNumber === teamNumber);
    if (!team) {
      // Create new team
      team = {
        teamNumber,
        members: [userId],
        isFull: this.teamSize === 1,
        score: 0,
        matchesPlayed: 0,
        matchesWon: 0,
        matchesLost: 0,
        matchesDrawn: 0,
        points: 0,
        ranking: 0
      };
      this.teams.push(team);
    } else {
      // Check if team is full
      if (team.members.length >= this.teamSize) {
        throw new Error(`Team ${teamNumber} is full`);
      }
      team.members.push(userId);
      team.isFull = team.members.length === this.teamSize;
    }
    
    participant.teamNumber = teamNumber;
  } else {
    // Auto-assign to next available team
    const teams = this.teams.sort((a, b) => a.teamNumber - b.teamNumber);
    let assignedTeam = teams.find(t => t.members.length < this.teamSize);
    
    if (!assignedTeam) {
      // Create new team
      const newTeamNumber = this.teams.length > 0 ? Math.max(...this.teams.map(t => t.teamNumber)) + 1 : 1;
      assignedTeam = {
        teamNumber: newTeamNumber,
        members: [userId],
        isFull: this.teamSize === 1,
        score: 0,
        matchesPlayed: 0,
        matchesWon: 0,
        matchesLost: 0,
        matchesDrawn: 0,
        points: 0,
        ranking: 0
      };
      this.teams.push(assignedTeam);
    } else {
      assignedTeam.members.push(userId);
      assignedTeam.isFull = assignedTeam.members.length === this.teamSize;
    }
    
    participant.teamNumber = assignedTeam.teamNumber;
  }

  return participant.teamNumber;
};

// Method to get team by number
TournamentSchema.methods.getTeam = function(teamNumber: number) {
  return this.teams.find(t => t.teamNumber === teamNumber);
};

// Method to get participant's team
TournamentSchema.methods.getParticipantTeam = function(userId: Types.ObjectId) {
  const participant = this.participants.find(p => p.user.toString() === userId.toString());
  if (!participant || !participant.teamNumber) return null;
  
  return this.teams.find(t => t.teamNumber === participant.teamNumber);
};

export type TournamentDocument = Tournament & Document;