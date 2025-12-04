import { 
  IsString, 
  IsEnum, 
  IsNumber, 
  IsDateString, 
  Min, 
  Max, 
  IsArray, 
  IsOptional,
  ValidateNested,
  Matches,
  IsInt
} from 'class-validator';
import { Type } from 'class-transformer';
import { CompetitionFormat, SportType } from 'src/common/enums/sport-type.enum';

export class CreateTournamentDto {
  @IsString()
  name: string;

  @IsEnum(SportType)
  sportType: SportType;

  @IsString()
  category: string;

  @IsEnum(CompetitionFormat)
  competitionFormat: CompetitionFormat;

  @IsString()
  location: string;

  @IsDateString()
  tournamentDate: string;

  // Registration period
  @IsDateString()
  registrationStart: string;

  @IsDateString()
  registrationEnd: string;

  // Tournament time slot
  @IsString()
  @Matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, {
    message: 'Start time must be in HH:mm format'
  })
  startTime: string;

  @IsString()
  @Matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, {
    message: 'End time must be in HH:mm format'
  })
  endTime: string;

  // Teams-based configuration
  @IsNumber()
  @IsInt()
  @Min(1)
  numberOfTeams: number;

  @IsOptional()
  @IsNumber()
  @IsInt()
  @Min(1)
  teamSize?: number; // For sports that allow team size override

  // Derived participants count (calculated on frontend, validated on backend)
  @IsNumber()
  @Min(1)
  maxParticipants: number;

  @IsNumber()
  @Min(1)
  minParticipants: number;

  @IsNumber()
  @Min(0)
  registrationFee: number;

  @IsString()
  description: string;

  @IsNumber()
  @Min(1)
  fieldsNeeded: number;

  @IsArray()
  @IsString({ each: true })
  selectedFieldIds: string[];

  @IsOptional()
  @IsString()
  rules?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  images?: string[];
}

export class RegisterTournamentDto {
  @IsString()
  tournamentId: string;

  @IsString()
  paymentMethod: string;
    buyerName: string;
    buyerEmail: string;
    buyerPhone: string;
}

export class ConfirmTournamentDto {
  @IsString()
  tournamentId: string;
}