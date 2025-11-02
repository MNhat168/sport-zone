/**
 * VNPay DTOs
 * Data Transfer Objects for VNPay payment operations
 */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNumber, IsOptional, Min, IsEnum } from 'class-validator';

/**
 * Create VNPay Payment URL DTO
 */
export class CreateVNPayUrlDto {
  @ApiProperty({
    description: 'Payment amount in VND',
    example: 200000,
    minimum: 1000
  })
  @IsNumber()
  @Min(1000)
  amount: number;

  @ApiProperty({
    description: 'Order ID (payment ID or booking ID)',
    example: '675abc123def456'
  })
  @IsString()
  orderId: string;

  @ApiPropertyOptional({
    description: 'Bank code for direct payment',
    example: 'NCB'
  })
  @IsOptional()
  @IsString()
  bankCode?: string;

  @ApiPropertyOptional({
    description: 'Language (vn or en)',
    example: 'vn'
  })
  @IsOptional()
  @IsString()
  locale?: string;

  @ApiPropertyOptional({
    description: 'Custom return URL (overrides config)',
    example: 'http://localhost:5173/transactions/vnpay/return'
  })
  @IsOptional()
  @IsString()
  returnUrl?: string;
}

/**
 * Query Transaction DTO (Query DR)
 */
export class QueryTransactionDto {
  @ApiProperty({
    description: 'Original order ID (vnp_TxnRef)',
    example: '675abc123def456'
  })
  @IsString()
  orderId: string;

  @ApiProperty({
    description: 'Transaction date in YYYYMMDDHHmmss format',
    example: '20251102143000'
  })
  @IsString()
  transactionDate: string;
}

/**
 * Refund Transaction DTO
 */
export class RefundTransactionDto {
  @ApiProperty({
    description: 'Original order ID (vnp_TxnRef)',
    example: '675abc123def456'
  })
  @IsString()
  orderId: string;

  @ApiProperty({
    description: 'Original transaction date in YYYYMMDDHHmmss format',
    example: '20251102143000'
  })
  @IsString()
  transactionDate: string;

  @ApiProperty({
    description: 'Refund amount in VND',
    example: 200000,
    minimum: 1000
  })
  @IsNumber()
  @Min(1000)
  amount: number;

  @ApiProperty({
    description: 'Transaction type (02: Full refund, 03: Partial refund)',
    example: '02',
    enum: ['02', '03']
  })
  @IsEnum(['02', '03'])
  transactionType: string;

  @ApiProperty({
    description: 'User who initiated refund',
    example: 'admin@example.com'
  })
  @IsString()
  createdBy: string;

  @ApiPropertyOptional({
    description: 'Refund reason',
    example: 'Customer requested cancellation'
  })
  @IsOptional()
  @IsString()
  reason?: string;
}

/**
 * VNPay IPN Response DTO
 */
export class VNPayIPNResponseDto {
  @ApiProperty({ description: 'Response code', example: '00' })
  RspCode: string;

  @ApiProperty({ description: 'Response message', example: 'Success' })
  Message: string;
}

/**
 * VNPay Return Verification Result DTO
 */
export class VNPayVerificationResultDto {
  @ApiProperty({ description: 'Whether payment was successful' })
  success: boolean;

  @ApiProperty({ 
    description: 'Payment status', 
    enum: ['succeeded', 'failed', 'pending']
  })
  paymentStatus: 'succeeded' | 'failed' | 'pending';

  @ApiProperty({ description: 'Booking ID' })
  bookingId: string;

  @ApiProperty({ description: 'Result message' })
  message: string;

  @ApiPropertyOptional({ description: 'Failure reason if payment failed' })
  reason?: string;

  @ApiPropertyOptional({ description: 'VNPay response code' })
  responseCode?: string;

  @ApiPropertyOptional({ description: 'VNPay transaction number' })
  transactionNo?: string;

  @ApiPropertyOptional({ description: 'Bank transaction number' })
  bankTranNo?: string;

  @ApiPropertyOptional({ description: 'Bank code' })
  bankCode?: string;

  @ApiPropertyOptional({ description: 'Card type' })
  cardType?: string;
}

/**
 * VNPay Query DR Response DTO
 */
export class VNPayQueryDRResponseDto {
  @ApiProperty({ description: 'Response code from VNPay' })
  vnp_ResponseCode: string;

  @ApiProperty({ description: 'Response message' })
  vnp_Message: string;

  @ApiPropertyOptional({ description: 'Transaction reference' })
  vnp_TxnRef?: string;

  @ApiPropertyOptional({ description: 'Amount' })
  vnp_Amount?: string;

  @ApiPropertyOptional({ description: 'Bank code' })
  vnp_BankCode?: string;

  @ApiPropertyOptional({ description: 'Transaction number' })
  vnp_TransactionNo?: string;

  @ApiPropertyOptional({ description: 'Transaction status' })
  vnp_TransactionStatus?: string;
}

/**
 * VNPay Refund Response DTO
 */
export class VNPayRefundResponseDto {
  @ApiProperty({ description: 'Response code from VNPay' })
  vnp_ResponseCode: string;

  @ApiProperty({ description: 'Response message' })
  vnp_Message: string;

  @ApiPropertyOptional({ description: 'Transaction reference' })
  vnp_TxnRef?: string;

  @ApiPropertyOptional({ description: 'Refund amount' })
  vnp_Amount?: string;

  @ApiPropertyOptional({ description: 'Transaction number' })
  vnp_TransactionNo?: string;
}

