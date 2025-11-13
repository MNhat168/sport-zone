import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

/**
 * DTO for refund request
 * [V2] Supports bank and credit refund options
 */
export class RefundRequestDto {
  @IsNotEmpty()
  @IsString()
  bookingId: string;

  @IsNotEmpty()
  @IsEnum(['bank', 'credit'])
  refundTo: 'bank' | 'credit';

  @IsOptional()
  @IsNumber()
  @Min(0)
  refundAmount?: number;

  @IsOptional()
  @IsString()
  reason?: string;
}
