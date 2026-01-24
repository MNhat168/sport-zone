import { ApiProperty } from '@nestjs/swagger';
import { WithdrawalRequestStatus } from '../entities/withdrawal-request.entity';

/**
 * DTO for withdrawal request response
 */
export class WithdrawalRequestResponseDto {
  @ApiProperty()
  _id: string;

  @ApiProperty()
  userId: string;

  @ApiProperty({ enum: ['field_owner', 'coach'] })
  userRole: 'field_owner' | 'coach';

  @ApiProperty()
  amount: number;

  @ApiProperty({ enum: WithdrawalRequestStatus })
  status: WithdrawalRequestStatus;

  @ApiProperty({ required: false })
  bankAccount?: string;

  @ApiProperty({ required: false })
  bankName?: string;

  @ApiProperty({ required: false })
  rejectionReason?: string;

  @ApiProperty({ required: false })
  approvedBy?: string;

  @ApiProperty({ required: false })
  approvedAt?: Date;

  @ApiProperty({ required: false })
  rejectedBy?: string;

  @ApiProperty({ required: false })
  rejectedAt?: Date;

  @ApiProperty({ required: false })
  adminNotes?: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  // Populated fields
  @ApiProperty({ required: false })
  user?: {
    _id: string;
    fullName: string;
    email: string;
    phone?: string;
  };
}
