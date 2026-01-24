import { IsNotEmpty, IsNumber, Min, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO for creating withdrawal request
 */
export class CreateWithdrawalRequestDto {
  @ApiProperty({ description: 'Amount to withdraw (minimum 1,000 VND)', example: 100000 })
  @IsNotEmpty()
  @IsNumber()
  @Min(1000)
  amount: number;

  @ApiProperty({ description: 'Bank account number', required: false })
  @IsOptional()
  @IsString()
  bankAccount?: string;

  @ApiProperty({ description: 'Bank name', required: false })
  @IsOptional()
  @IsString()
  bankName?: string;
}
