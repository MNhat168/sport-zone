import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { 
  IsString, 
  IsNumber, 
  IsOptional, 
  IsEnum, 
  IsEmail, 
  ValidateIf 
} from 'class-validator';
import { PaymentMethod } from 'src/common/enums/payment-method.enum';
import { Transform } from 'class-transformer';

export class RegisterTournamentDto {
    @ApiProperty({ description: 'Tournament ID' })
    @IsString()
    tournamentId: string;

    @ApiProperty({ 
        enum: PaymentMethod, 
        description: 'Payment method',
        example: 'PAYOS' // Use string example instead of PaymentMethod.PAYOS
    })
    @IsEnum(PaymentMethod, { 
        message: `paymentMethod must be one of: ${Object.values(PaymentMethod).join(', ')}` 
    })
    @Transform(({ value }) => {
        console.log('Transform received value:', value, typeof value);
        
        // If value is a string that matches enum key, convert to number
        if (typeof value === 'string') {
            // Check if string matches an enum key
            const enumKey = Object.keys(PaymentMethod).find(key => key === value.toUpperCase());
            if (enumKey) {
                console.log('Found enum key:', enumKey, 'value:', PaymentMethod[enumKey]);
                return PaymentMethod[enumKey];
            }
            
            // Try to parse as number
            const numValue = parseInt(value, 10);
            if (!isNaN(numValue)) {
                // Check if number is a valid enum value
                const validValues = Object.values(PaymentMethod).filter(v => typeof v === 'number');
                if (validValues.includes(numValue)) {
                    console.log('Parsed as valid number:', numValue);
                    return numValue;
                }
            }
        }
        
        // If value is already a number, return it
        if (typeof value === 'number') {
            return value;
        }
        
        // Return the value as-is for validation to handle
        return value;
    })
    paymentMethod: PaymentMethod;

    @ApiPropertyOptional({ description: 'Buyer name for payment' })
    @IsOptional()
    @IsString()
    @ValidateIf(o => o.buyerName !== null && o.buyerName !== undefined)
    buyerName?: string;

    @ApiPropertyOptional({ description: 'Buyer email for payment' })
    @IsOptional()
    @IsEmail()
    @ValidateIf(o => o.buyerEmail !== null && o.buyerEmail !== undefined)
    buyerEmail?: string;

    @ApiPropertyOptional({ description: 'Buyer phone for payment' })
    @IsOptional()
    @IsString()
    @ValidateIf(o => o.buyerPhone !== null && o.buyerPhone !== undefined)
    buyerPhone?: string;

    @ApiPropertyOptional({ description: 'Payment note' })
    @IsOptional()
    @IsString()
    paymentNote?: string;
}