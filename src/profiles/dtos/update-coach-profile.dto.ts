import { IsArray, IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { SportType } from 'src/common/enums/sport-type.enum';

export class UpdateCoachProfileDto {
    @IsString()
    @IsNotEmpty()
    bio: string;

    @IsArray()
    @IsEnum(SportType, { each: true })
    @IsNotEmpty()
    sports: SportType[];
}