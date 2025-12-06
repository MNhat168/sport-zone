import { IsArray, IsDateString, IsEnum, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator'
import { Type } from 'class-transformer'
import { BookingStatus, BookingType } from '@common/enums/booking.enum'

export class ListBookingsDto {
  @IsOptional()
  @IsString()
  search?: string

  @IsOptional()
  @IsArray()
  @IsEnum(BookingStatus, { each: true })
  @Type(() => String)
  status?: BookingStatus[]

  @IsOptional()
  @IsArray()
  @IsEnum(BookingType, { each: true })
  @Type(() => String)
  type?: BookingType[]

  @IsOptional()
  @IsArray()
  @IsIn(['unpaid', 'paid', 'refunded'], { each: true })
  @Type(() => String)
  paymentStatus?: ('unpaid' | 'paid' | 'refunded')[]

  @IsOptional()
  @IsArray()
  @IsIn(['pending', 'approved', 'rejected'], { each: true })
  @Type(() => String)
  approvalStatus?: ('pending' | 'approved' | 'rejected')[]

  @IsOptional()
  @IsDateString()
  startDate?: string

  @IsOptional()
  @IsDateString()
  endDate?: string

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 10

  @IsOptional()
  @IsIn(['createdAt', 'date', 'bookingAmount', 'status', 'type'])
  sortBy?: 'createdAt' | 'date' | 'bookingAmount' | 'status' | 'type' = 'createdAt'

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc'
}

