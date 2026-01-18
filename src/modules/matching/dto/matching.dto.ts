import { IsNotEmpty, IsString, IsEnum, IsArray, IsOptional, IsNumber, Min, Max, IsBoolean, IsDateString, MaxLength, MinLength } from 'class-validator';
import { SportType } from '@common/enums/sport-type.enum';
import { SkillLevel, Gender, GenderPreference } from '@common/enums/matching.enum';
import { Type } from 'class-transformer';

// Match Profile DTOs
export class LocationDto {
    @IsNotEmpty()
    @IsString()
    address: string;

    @IsNotEmpty()
    @IsArray()
    @IsNumber({}, { each: true })
    coordinates: [number, number]; // [longitude, latitude]

    @IsOptional()
    @IsNumber()
    @Min(1)
    @Max(100)
    searchRadius?: number; // in kilometers
}

export class TimeSlotDto {
    @IsNotEmpty()
    @IsEnum(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'])
    day: string;

    @IsNotEmpty()
    @IsString()
    startTime: string; // Format: "HH:mm"

    @IsNotEmpty()
    @IsString()
    endTime: string; // Format: "HH:mm"
}

export class CreateMatchProfileDto {
    @IsNotEmpty()
    @IsArray()
    @IsEnum(SportType, { each: true })
    sportPreferences: SportType[];

    @IsNotEmpty()
    @IsEnum(SkillLevel)
    skillLevel: SkillLevel;

    @IsNotEmpty()
    @Type(() => LocationDto)
    location: LocationDto;

    @IsNotEmpty()
    @IsEnum(Gender)
    gender: Gender;

    @IsOptional()
    @IsEnum(GenderPreference)
    preferredGender?: GenderPreference;

    @IsOptional()
    @IsString()
    @MaxLength(500)
    bio?: string;

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    photos?: string[];

    @IsOptional()
    @IsArray()
    @Type(() => TimeSlotDto)
    availability?: TimeSlotDto[];

    @IsOptional()
    @IsNumber()
    @Min(18)
    @Max(100)
    age?: number;

    @IsOptional()
    @IsNumber()
    @Min(0)
    @Max(10)
    skillLevelRange?: number;

    @IsOptional()
    @IsNumber()
    @Min(18)
    @Max(100)
    minAge?: number;

    @IsOptional()
    @IsNumber()
    @Min(18)
    @Max(100)
    maxAge?: number;
}

export class UpdateMatchProfileDto {
    @IsOptional()
    @IsArray()
    @IsEnum(SportType, { each: true })
    sportPreferences?: SportType[];

    @IsOptional()
    @IsEnum(SkillLevel)
    skillLevel?: SkillLevel;

    @IsOptional()
    @Type(() => LocationDto)
    location?: LocationDto;

    @IsOptional()
    @IsEnum(Gender)
    gender?: Gender;

    @IsOptional()
    @IsEnum(GenderPreference)
    preferredGender?: GenderPreference;

    @IsOptional()
    @IsString()
    @MaxLength(500)
    bio?: string;

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    photos?: string[];

    @IsOptional()
    @IsArray()
    @Type(() => TimeSlotDto)
    availability?: TimeSlotDto[];

    @IsOptional()
    @IsBoolean()
    isActive?: boolean;

    @IsOptional()
    @IsNumber()
    @Min(18)
    @Max(100)
    age?: number;

    @IsOptional()
    @IsNumber()
    @Min(0)
    @Max(10)
    skillLevelRange?: number;

    @IsOptional()
    @IsNumber()
    @Min(18)
    @Max(100)
    minAge?: number;

    @IsOptional()
    @IsNumber()
    @Min(18)
    @Max(100)
    maxAge?: number;
}

// Swipe DTOs
export class SwipeDto {
    @IsNotEmpty()
    @IsString()
    targetUserId: string;

    @IsNotEmpty()
    @IsEnum(['like', 'pass', 'super_like'])
    action: 'like' | 'pass' | 'super_like';

    @IsNotEmpty()
    @IsEnum(SportType)
    sportType: SportType;
}

// Match Candidate Query DTOs
export class GetMatchCandidatesDto {
    @IsOptional()
    @IsEnum(SportType)
    sportType?: SportType;

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(1)
    @Max(100)
    maxDistance?: number; // in kilometers

    @IsOptional()
    @IsEnum(SkillLevel)
    skillLevel?: SkillLevel;

    @IsOptional()
    @IsEnum(GenderPreference)
    genderPreference?: GenderPreference;

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(1)
    @Max(50)
    limit?: number;
}

// Schedule Match DTOs
export class ScheduleMatchDto {
    @IsNotEmpty()
    @IsDateString()
    scheduledDate: string;

    @IsNotEmpty()
    @IsString()
    startTime: string; // Format: "HH:mm"

    @IsNotEmpty()
    @IsString()
    endTime: string; // Format: "HH:mm"

    @IsOptional()
    @IsString()
    fieldId?: string;

    @IsOptional()
    @IsString()
    courtId?: string;
}
