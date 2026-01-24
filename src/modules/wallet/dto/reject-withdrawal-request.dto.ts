import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO for rejecting withdrawal request
 */
export class RejectWithdrawalRequestDto {
  @ApiProperty({ description: 'Reason for rejection', example: 'Thông tin tài khoản không hợp lệ' })
  @IsNotEmpty()
  @IsString()
  reason: string;
}
