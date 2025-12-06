import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum VerifyPaymentProofAction {
  APPROVE = 'approve',
  REJECT = 'reject',
}

export class VerifyPaymentProofDto {
  @ApiProperty({ 
    enum: VerifyPaymentProofAction,
    example: VerifyPaymentProofAction.APPROVE,
    description: 'Action to take: approve or reject the payment proof'
  })
  @IsEnum(VerifyPaymentProofAction)
  action: VerifyPaymentProofAction;

  @ApiPropertyOptional({ 
    example: 'Ảnh chứng minh không rõ ràng hoặc không khớp với số tiền',
    description: 'Lý do từ chối (bắt buộc nếu action = reject)',
    maxLength: 500
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  rejectionReason?: string;
}


