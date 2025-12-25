import { IsOptional, IsEnum } from 'class-validator';
import { BookingType } from '../enums/booking.enum';

export class GetCoachBookingsByTypeDto {
    @IsOptional()
    @IsEnum(BookingType)
    type?: BookingType;
}
