import { IsNotEmpty, IsNumber, Min } from 'class-validator';

/**
 * DTO for withdrawal request
 * [V2] User withdraws refundBalance to bank
 */
export class WithdrawRequestDto {
  @IsNotEmpty()
  @IsNumber()
  @Min(1000) // Minimum withdrawal: 1,000₫
  amount: number;
}
