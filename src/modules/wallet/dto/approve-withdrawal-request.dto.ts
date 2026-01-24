import { IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO for approving withdrawal request
 */
export class ApproveWithdrawalRequestDto {
  @ApiProperty({ description: 'Admin notes (optional)', required: false })
  @IsOptional()
  @IsString()
  notes?: string;
}
