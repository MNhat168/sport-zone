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
  Matches
} from 'class-validator';
import { Type } from 'class-transformer';
import { SportType } from 'src/common/enums/sport-type.enum';

export class CreateTournamentDto {
  @IsString()
  name: string;

  @IsEnum(SportType)
  sportType: SportType;

  @IsString()
  location: string;

  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;

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
}

export class ConfirmTournamentDto {
  @IsString()
  tournamentId: string;
}