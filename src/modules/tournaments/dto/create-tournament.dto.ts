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
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTournamentDto {
  @ApiProperty({ description: 'Tournament name' })
  @IsString()
  name: string;

  @ApiProperty({ enum: SportType, description: 'Sport type' })
  @IsEnum(SportType)
  sportType: SportType;

  @ApiProperty({ description: 'Category (e.g., singles, doubles, 5v5)' })
  @IsString()
  category: string;

  @ApiProperty({ enum: CompetitionFormat, description: 'Competition format' })
  @IsEnum(CompetitionFormat)
  competitionFormat: CompetitionFormat;

  @ApiProperty({ description: 'Location/city where tournament will be held' })
  @IsString()
  location: string;

  @ApiProperty({ description: 'Date when tournament will happen (YYYY-MM-DD)' })
  @IsDateString()
  tournamentDate: string;

  @ApiProperty({ description: 'Registration start date (YYYY-MM-DD)' })
  @IsDateString()
  registrationStart: string;

  @ApiProperty({ description: 'Registration end date (YYYY-MM-DD)' })
  @IsDateString()
  registrationEnd: string;

  @ApiProperty({ description: 'Start time (HH:mm)' })
  @IsString()
  @Matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, {
    message: 'Start time must be in HH:mm format'
  })
  startTime: string;

  @ApiProperty({ description: 'End time (HH:mm)' })
  @IsString()
  @Matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, {
    message: 'End time must be in HH:mm format'
  })
  endTime: string;

  @ApiProperty({ description: 'Number of teams in tournament' })
  @IsNumber()
  @IsInt()
  @Min(1)
  numberOfTeams: number;

  @ApiPropertyOptional({ description: 'Team size (for sports that allow override)' })
  @IsOptional()
  @IsNumber()
  @IsInt()
  @Min(1)
  teamSize?: number;

  @ApiProperty({ description: 'Maximum participants (calculated from teams)' })
  @IsNumber()
  @Min(1)
  maxParticipants: number;

  @ApiProperty({ description: 'Minimum participants (calculated from teams)' })
  @IsNumber()
  @Min(1)
  minParticipants: number;

  @ApiProperty({ description: 'Registration fee per participant' })
  @IsNumber()
  @Min(0)
  registrationFee: number;

  @ApiProperty({ description: 'Tournament description' })
  @IsString()
  description: string;

  @ApiPropertyOptional({ description: 'Number of courts needed (use courtsNeeded or fieldsNeeded)' })
  @IsOptional()
  @IsNumber()
  @Min(1)
  courtsNeeded?: number;

  @ApiPropertyOptional({
    description: 'Selected court IDs (use selectedCourtIds or selectedFieldIds)',
    type: [String],
    example: ['courtId1', 'courtId2']
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  selectedCourtIds?: string[];

  @ApiPropertyOptional({ description: 'Total cost for all courts (use totalCourtCost or totalFieldCost)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  totalCourtCost?: number;

  @ApiPropertyOptional({ description: 'Tournament rules and regulations' })
  @IsOptional()
  @IsString()
  rules?: string;

  @ApiPropertyOptional({
    description: 'Tournament images',
    type: [String],
    example: ['image1.jpg', 'image2.jpg']
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  images?: string[];

  // Backward compatibility fields (deprecated but kept for migration)
  @ApiPropertyOptional({
    description: 'Number of fields needed (deprecated, use courtsNeeded instead)',
    deprecated: true
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  fieldsNeeded?: number;

  @ApiPropertyOptional({
    description: 'Selected field IDs (deprecated, use selectedCourtIds instead)',
    type: [String],
    deprecated: true
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  selectedFieldIds?: string[];

  @ApiPropertyOptional({
    description: 'Total field cost (deprecated, use totalCourtCost instead)',
    deprecated: true
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  totalFieldCost?: number;
}

export class ConfirmTournamentDto {
  @ApiProperty({ description: 'Tournament ID' })
  @IsString()
  tournamentId: string;
}

// Additional DTO for court-based operations
export class CourtSelectionDto {
  @ApiProperty({ description: 'Court ID' })
  @IsString()
  courtId: string;

  @ApiProperty({ description: 'Court number' })
  @IsNumber()
  @IsInt()
  @Min(1)
  courtNumber: number;

  @ApiPropertyOptional({ description: 'Field ID (parent field of court)' })
  @IsOptional()
  @IsString()
  fieldId?: string;

  @ApiProperty({ description: 'Court pricing override (if any)' })
  @IsOptional()
  courtPricing?: {
    basePrice?: number;
    multiplier?: number;
  };
}

// DTO for court availability check
export class CourtAvailabilityDto {
  @ApiProperty({ enum: SportType, description: 'Sport type' })
  @IsEnum(SportType)
  sportType: SportType;

  @ApiProperty({ description: 'Location to search courts in' })
  @IsString()
  location: string;

  @ApiProperty({ description: 'Date to check availability (YYYY-MM-DD)' })
  @IsDateString()
  date: string;

  @ApiPropertyOptional({ description: 'Start time range (HH:mm)' })
  @IsOptional()
  @IsString()
  @Matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/)
  startTime?: string;

  @ApiPropertyOptional({ description: 'End time range (HH:mm)' })
  @IsOptional()
  @IsString()
  @Matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/)
  endTime?: string;

  @ApiPropertyOptional({ description: 'Minimum number of courts needed' })
  @IsOptional()
  @IsNumber()
  @Min(1)
  minCourts?: number;

  @ApiPropertyOptional({ description: 'Maximum number of courts needed' })
  @IsOptional()
  @IsNumber()
  @Min(1)
  maxCourts?: number;
}

// DTO for court reservation
export class CourtReservationDto {
  @ApiProperty({ description: 'Court ID' })
  @IsString()
  courtId: string;

  @ApiProperty({ description: 'Reservation date (YYYY-MM-DD)' })
  @IsDateString()
  date: string;

  @ApiProperty({ description: 'Start time (HH:mm)' })
  @IsString()
  @Matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/)
  startTime: string;

  @ApiProperty({ description: 'End time (HH:mm)' })
  @IsString()
  @Matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/)
  endTime: string;

  @ApiPropertyOptional({ description: 'Tournament ID (if reserving for tournament)' })
  @IsOptional()
  @IsString()
  tournamentId?: string;
}

// DTO for court cost calculation
export class CourtCostCalculationDto {
  @ApiProperty({ description: 'Court ID' })
  @IsString()
  courtId: string;

  @ApiProperty({ description: 'Date (YYYY-MM-DD)' })
  @IsDateString()
  date: string;

  @ApiProperty({ description: 'Start time (HH:mm)' })
  @IsString()
  @Matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/)
  startTime: string;

  @ApiProperty({ description: 'End time (HH:mm)' })
  @IsString()
  @Matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/)
  endTime: string;

  @ApiPropertyOptional({ description: 'Number of hours (auto-calculated if not provided)' })
  @IsOptional()
  @IsNumber()
  @Min(0.5)
  hours?: number;
}

export class UpdateTournamentDto {
  @ApiPropertyOptional({ description: 'Tournament name' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: 'Tournament description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Tournament rules and regulations' })
  @IsOptional()
  @IsString()
  rules?: string;

  @ApiPropertyOptional({
    description: 'Tournament images',
    type: [String]
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  images?: string[];

  @ApiPropertyOptional({ description: 'Registration fee per participant' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  registrationFee?: number;

  @ApiPropertyOptional({ description: 'Start time (HH:mm)' })
  @IsOptional()
  @IsString()
  @Matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/)
  startTime?: string;

  @ApiPropertyOptional({ description: 'End time (HH:mm)' })
  @IsOptional()
  @IsString()
  @Matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/)
  endTime?: string;

  @ApiPropertyOptional({
    description: 'Selected court IDs',
    type: [String]
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  selectedCourtIds?: string[];

  @ApiPropertyOptional({ description: 'Number of courts needed' })
  @IsOptional()
  @IsNumber()
  @Min(1)
  courtsNeeded?: number;

  @ApiPropertyOptional({ description: 'Number of teams' })
  @IsOptional()
  @IsNumber()
  @Min(1)
  numberOfTeams?: number;

  @ApiPropertyOptional({ description: 'Team size' })
  @IsOptional()
  @IsNumber()
  @Min(1)
  teamSize?: number;
}

// Helper methods for court operations
export class CourtDtoHelpers {
  /**
   * Calculates the number of hours between start and end time
   */
  static calculateHours(startTime: string, endTime: string): number {
    if (!startTime || !endTime) return 0;

    const [startHour, startMin] = startTime.split(':').map(Number);
    const [endHour, endMin] = endTime.split(':').map(Number);

    const startTotalMinutes = startHour * 60 + startMin;
    const endTotalMinutes = endHour * 60 + endMin;

    if (endTotalMinutes <= startTotalMinutes) {
      throw new Error('End time must be after start time');
    }

    return (endTotalMinutes - startTotalMinutes) / 60;
  }

  /**
   * Validates court selection against sport requirements
   */
  static validateCourtSelection(
    sportType: SportType,
    selectedCourtIds: string[],
    courtsNeeded: number
  ): { isValid: boolean; errors?: string[] } {
    const errors: string[] = [];

    if (!selectedCourtIds || selectedCourtIds.length === 0) {
      errors.push('At least one court must be selected');
    }

    if (selectedCourtIds.length !== courtsNeeded) {
      errors.push(`Number of selected courts (${selectedCourtIds.length}) must match courts needed (${courtsNeeded})`);
    }

    // Check for duplicate court selections
    const uniqueCourtIds = new Set(selectedCourtIds);
    if (uniqueCourtIds.size !== selectedCourtIds.length) {
      errors.push('Duplicate courts selected');
    }

    return {
      isValid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined
    };
  }

  /**
   * Calculates total cost for multiple courts
   */
  static calculateTotalCost(
    courts: Array<{
      pricingOverride?: { basePrice?: number };
      field?: { basePrice?: number };
    }>,
    date: string,
    startTime: string,
    endTime: string
  ): number {
    const hours = this.calculateHours(startTime, endTime);
    const tournamentDate = new Date(date);
    const dayOfWeek = tournamentDate.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const weekendMultiplier = isWeekend ? 1.2 : 1.0;

    return courts.reduce((total, court) => {
      const basePrice = court.pricingOverride?.basePrice || court.field?.basePrice || 100000;
      const courtCost = basePrice * hours * weekendMultiplier;
      return total + Math.round(courtCost);
    }, 0);
  }

  /**
   * Maps court data for frontend display
   */
  static mapCourtForDisplay(court: any) {
    return {
      id: court._id,
      courtNumber: court.courtNumber,
      name: `${court.field?.name || 'Unknown Field'} - Court ${court.courtNumber}`,
      sportType: court.sportType,
      field: {
        id: court.field?._id,
        name: court.field?.name,
        location: court.field?.location,
        description: court.field?.description,
        images: court.field?.images || [],
        basePrice: court.field?.basePrice || 0
      },
      pricing: {
        basePrice: court.pricingOverride?.basePrice || court.field?.basePrice || 0,
        hasOverride: !!court.pricingOverride?.basePrice
      },
      isActive: court.isActive,
      amenities: court.field?.amenities || []
    };
  }

  /**
   * Validates court availability for a time slot
   */
  static validateCourtAvailability(
    existingReservations: Array<{
      startTime: string;
      endTime: string;
      status: string;
    }>,
    requestedStartTime: string,
    requestedEndTime: string
  ): { isAvailable: boolean; conflicts?: Array<{ start: string; end: string }> } {
    const conflicts: Array<{ start: string; end: string }> = [];

    for (const reservation of existingReservations) {
      if (reservation.status !== 'cancelled' && reservation.status !== 'released') {
        const resStart = this.timeToMinutes(reservation.startTime);
        const resEnd = this.timeToMinutes(reservation.endTime);
        const reqStart = this.timeToMinutes(requestedStartTime);
        const reqEnd = this.timeToMinutes(requestedEndTime);

        // Check for overlap
        if (reqStart < resEnd && reqEnd > resStart) {
          conflicts.push({
            start: reservation.startTime,
            end: reservation.endTime
          });
        }
      }
    }

    return {
      isAvailable: conflicts.length === 0,
      conflicts: conflicts.length > 0 ? conflicts : undefined
    };
  }

  /**
   * Converts time string to minutes for easier comparison
   */
  private static timeToMinutes(time: string): number {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
  }
}