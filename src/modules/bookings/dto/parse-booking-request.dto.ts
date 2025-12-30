import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO for parsing natural language booking requests
 */
export class ParseBookingRequestDto {
    /**
     * Natural language query from user
     */
    @ApiProperty({
        example: 'Đặt sân từ thứ 2 đến thứ 6 tuần này, 9h-11h sáng',
        description: 'Natural language booking request in Vietnamese or English'
    })
    @IsString()
    @IsNotEmpty()
    query: string;

    /**
     * Field ID to book
     */
    @ApiProperty({
        example: '507f1f77bcf86cd799439011',
        description: 'ID of the field to book'
    })
    @IsString()
    @IsNotEmpty()
    fieldId: string;
}

/**
 * Parsed booking data from AI
 */
export interface ParsedBookingData {
    /**
     * Type of booking pattern
     */
    type: 'consecutive' | 'weekly' | 'single';

    /**
     * For consecutive bookings: start date
     */
    startDate?: string; // YYYY-MM-DD

    /**
     * For consecutive bookings: end date
     */
    endDate?: string; // YYYY-MM-DD

    /**
     * For weekly bookings: weekdays to book
     */
    weekdays?: string[]; // ['monday', 'wednesday', 'friday']

    /**
     * For weekly bookings: number of weeks
     */
    numberOfWeeks?: number; // 1-12

    /**
     * Start time
     */
    startTime?: string; // HH:mm

    /**
     * End time
     */
    endTime?: string; // HH:mm

    /**
     * AI confidence score (0-1)
     */
    confidence: number;

    /**
     * Fields that need clarification
     */
    clarificationNeeded?: string[];

    /**
     * Explanation of what AI understood
     */
    explanation?: string;
}
