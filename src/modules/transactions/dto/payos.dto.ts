/**
 * PayOS DTOs
 * Data Transfer Objects for PayOS payment operations
 */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNumber, IsOptional, Min, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * PayOS Item DTO
 */
export class PayOSItemDto {
  @ApiProperty({
    description: 'Item name',
    example: 'Đặt sân bóng đá'
  })
  @IsString()
  name: string;

  @ApiProperty({
    description: 'Item quantity',
    example: 1,
    minimum: 1
  })
  @IsNumber()
  @Min(1)
  quantity: number;

  @ApiProperty({
    description: 'Item price in VND',
    example: 200000,
    minimum: 1000
  })
  @IsNumber()
  @Min(1000)
  price: number;
}

/**
 * Create PayOS Payment URL DTO
 */
export class CreatePayOSUrlDto {
  @ApiProperty({
    description: 'Order ID (payment ID or booking ID)',
    example: '675abc123def456'
  })
  @IsString()
  orderId: string;

  @ApiProperty({
    description: 'Payment amount in VND',
    example: 200000,
    minimum: 1000
  })
  @IsNumber()
  @Min(1000)
  amount: number;

  @ApiProperty({
    description: 'Payment description',
    example: 'Thanh toan dat san'
  })
  @IsString()
  description: string;

  @ApiProperty({
    description: 'List of items',
    type: [PayOSItemDto]
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PayOSItemDto)
  items: PayOSItemDto[];

  @ApiPropertyOptional({
    description: 'Buyer name',
    example: 'Nguyen Van A'
  })
  @IsOptional()
  @IsString()
  buyerName?: string;

  @ApiPropertyOptional({
    description: 'Buyer email',
    example: 'buyer@example.com'
  })
  @IsOptional()
  @IsString()
  buyerEmail?: string;

  @ApiPropertyOptional({
    description: 'Buyer phone',
    example: '0123456789'
  })
  @IsOptional()
  @IsString()
  buyerPhone?: string;

  @ApiPropertyOptional({
    description: 'Return URL (overrides config)',
    example: 'http://localhost:5173/transactions/payos/return'
  })
  @IsOptional()
  @IsString()
  returnUrl?: string;

  @ApiPropertyOptional({
    description: 'Cancel URL (overrides config)',
    example: 'http://localhost:5173/transactions/payos/cancel'
  })
  @IsOptional()
  @IsString()
  cancelUrl?: string;

  @ApiPropertyOptional({
    description: 'Expiration time in minutes (5-60, default: 15)',
    example: 15,
    minimum: 5,
    maximum: 60
  })
  @IsOptional()
  @IsNumber()
  @Min(5)
  expiredAt?: number;

  @ApiPropertyOptional({
    description: 'PayOS order code (if already generated). If not provided, will generate new one.',
    example: 251116131019218
  })
  @IsOptional()
  @IsNumber()
  orderCode?: number;
}

/**
 * PayOS Callback DTO (for webhook and return URL)
 */
export class PayOSCallbackDto {
  @ApiProperty({
    description: 'PayOS order code',
    example: 123456789
  })
  @IsNumber()
  orderCode: number;

  @ApiProperty({
    description: 'Payment amount',
    example: 200000
  })
  @IsNumber()
  amount: number;

  @ApiProperty({
    description: 'Payment description',
    example: 'Thanh toan dat san'
  })
  @IsString()
  description: string;

  @ApiProperty({
    description: 'Account number',
    example: '12345678'
  })
  @IsString()
  accountNumber: string;

  @ApiProperty({
    description: 'Transaction reference',
    example: 'FT21348762543'
  })
  @IsString()
  reference: string;

  @ApiProperty({
    description: 'Transaction date time',
    example: '2024-11-02 14:30:00'
  })
  @IsString()
  transactionDateTime: string;

  @ApiPropertyOptional({
    description: 'Signature (for verification)',
    example: '901cfa7037c7d9b950697033ff9e030a86d679bd57993619213bef1caccf1752'
  })
  @IsOptional()
  @IsString()
  signature?: string;
}

/**
 * Query PayOS Transaction DTO
 */
export class QueryPayOSTransactionDto {
  @ApiProperty({
    description: 'PayOS order code',
    example: 123456789
  })
  @IsNumber()
  orderCode: number;
}

/**
 * Cancel PayOS Transaction DTO
 */
export class CancelPayOSTransactionDto {
  @ApiPropertyOptional({
    description: 'Cancellation reason',
    example: 'Customer requested cancellation'
  })
  @IsOptional()
  @IsString()
  cancellationReason?: string;
}

/**
 * PayOS Payment Link Response DTO
 */
export class PayOSPaymentLinkResponseDto {
  @ApiProperty({
    description: 'Payment link ID',
    example: 'abc123def456'
  })
  paymentLinkId: string;

  @ApiProperty({
    description: 'Checkout URL',
    example: 'https://pay.payos.vn/web/abc123def456'
  })
  checkoutUrl: string;

  @ApiProperty({
    description: 'QR Code URL',
    example: 'https://pay.payos.vn/qr/abc123def456'
  })
  qrCodeUrl: string;

  @ApiProperty({
    description: 'Order code',
    example: 123456789
  })
  orderCode: number;

  @ApiProperty({
    description: 'Payment amount',
    example: 200000
  })
  amount: number;

  @ApiProperty({
    description: 'Payment status',
    example: 'PENDING',
    enum: ['PENDING', 'PROCESSING', 'PAID', 'CANCELLED', 'EXPIRED']
  })
  status: string;
}

/**
 * PayOS Transaction Query Response DTO
 */
export class PayOSTransactionQueryResponseDto {
  @ApiProperty({
    description: 'Order code',
    example: 123456789
  })
  orderCode: number;

  @ApiProperty({
    description: 'Payment amount',
    example: 200000
  })
  amount: number;

  @ApiProperty({
    description: 'Payment description',
    example: 'Thanh toan dat san'
  })
  description: string;

  @ApiProperty({
    description: 'Payment status',
    example: 'PAID',
    enum: ['PENDING', 'PROCESSING', 'PAID', 'CANCELLED', 'EXPIRED']
  })
  status: string;

  @ApiPropertyOptional({
    description: 'Account number',
    example: '12345678'
  })
  accountNumber?: string;

  @ApiPropertyOptional({
    description: 'Transaction reference',
    example: 'FT21348762543'
  })
  reference?: string;

  @ApiPropertyOptional({
    description: 'Transaction date time',
    example: '2024-11-02 14:30:00'
  })
  transactionDateTime?: string;

  @ApiProperty({
    description: 'Created timestamp',
    example: 1699000000
  })
  createdAt: number;

  @ApiPropertyOptional({
    description: 'Cancelled timestamp',
    example: null
  })
  cancelledAt?: number;
}

/**
 * PayOS Cancel Response DTO
 */
export class PayOSCancelResponseDto {
  @ApiProperty({
    description: 'Order code',
    example: 123456789
  })
  orderCode: number;

  @ApiProperty({
    description: 'Status',
    example: 'CANCELLED'
  })
  status: string;

  @ApiProperty({
    description: 'Message',
    example: 'Transaction cancelled successfully'
  })
  message: string;
}

