import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNumber, IsOptional, IsDateString, IsArray, IsEnum, IsEmail } from 'class-validator';
import { PaymentMethod } from 'src/common/enums/payment-method.enum';
import { Transform } from 'class-transformer';

export class RegisterTournamentDto {
    @ApiProperty({ description: 'Tournament ID' })
    @IsString()
    tournamentId: string;

    @ApiProperty({ 
        enum: PaymentMethod, 
        description: 'Payment method',
        example: PaymentMethod.PAYOS
    })
    @IsEnum(PaymentMethod, { 
        message: `paymentMethod must be one of: ${Object.values(PaymentMethod).join(', ')}` 
    })
    @Transform(({ value }) => {
        // Convert string to number if needed
        if (typeof value === 'string') {
            const numValue = parseInt(value, 10);
            return isNaN(numValue) ? value : numValue;
        }
        return value;
    })
    paymentMethod: PaymentMethod;

    @ApiPropertyOptional({ description: 'Buyer name for payment' })
    @IsOptional()
    @IsString()
    buyerName?: string;

    @ApiPropertyOptional({ description: 'Buyer email for payment' })
    @IsOptional()
    @IsEmail()
    buyerEmail?: string;

    @ApiPropertyOptional({ description: 'Buyer phone for payment' })
    @IsOptional()
    @IsString()
    buyerPhone?: string;

    @ApiPropertyOptional({ description: 'Payment note' })
    @IsOptional()
    @IsString()
    paymentNote?: string;
}