import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsEnum,
  IsOptional,
  IsUrl,
  IsBoolean,
} from 'class-validator';
import { BankAccountStatus } from '@common/enums/bank-account.enum';

export class CreateBankAccountDto {
  @ApiProperty({ example: 'NGUYEN VAN A', description: 'Tên chủ tài khoản (phải trùng với CCCD)' })
  @IsString()
  accountName: string;

  @ApiProperty({ example: '1234567890', description: 'Số tài khoản' })
  @IsString()
  accountNumber: string;

  @ApiProperty({ example: 'VCB', description: 'Mã ngân hàng (PayOS bank code)' })
  @IsString()
  bankCode: string;

  @ApiProperty({ example: 'Vietcombank', description: 'Tên ngân hàng' })
  @IsString()
  bankName: string;

  @ApiPropertyOptional({ example: 'Chi nhánh Hà Nội', description: 'Chi nhánh' })
  @IsOptional()
  @IsString()
  branch?: string;

  @ApiPropertyOptional({ example: 'https://s3.../bank-screenshot.jpg', description: 'URL ảnh chụp màn hình Internet Banking' })
  @IsOptional()
  @IsUrl()
  verificationDocument?: string;

  @ApiPropertyOptional({ example: true, description: 'Đặt làm tài khoản rút tiền mặc định' })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({ example: false, description: 'Skip automatic verification payment creation (for admin/testing)' })
  @IsOptional()
  @IsBoolean()
  skipVerification?: boolean;
}


export class UpdateBankAccountStatusDto {
  @ApiProperty({ enum: BankAccountStatus, description: 'Trạng thái mới' })
  @IsEnum(BankAccountStatus)
  status: BankAccountStatus;

  @ApiPropertyOptional({ example: 'Tài khoản đã được xác minh', description: 'Ghi chú' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ example: 'Tên tài khoản không khớp', description: 'Lý do từ chối (nếu status = rejected)' })
  @IsOptional()
  @IsString()
  rejectionReason?: string;
}

export class UpdateBankAccountDto {
  @ApiPropertyOptional({ example: 'NGUYEN VAN A', description: 'Tên chủ tài khoản (phải trùng với CCCD)' })
  @IsOptional()
  @IsString()
  accountName?: string;

  @ApiPropertyOptional({ example: '1234567890', description: 'Số tài khoản' })
  @IsOptional()
  @IsString()
  accountNumber?: string;

  @ApiPropertyOptional({ example: 'VCB', description: 'Mã ngân hàng (PayOS bank code)' })
  @IsOptional()
  @IsString()
  bankCode?: string;

  @ApiPropertyOptional({ example: 'Vietcombank', description: 'Tên ngân hàng' })
  @IsOptional()
  @IsString()
  bankName?: string;

  @ApiPropertyOptional({ example: 'Chi nhánh Hà Nội', description: 'Chi nhánh' })
  @IsOptional()
  @IsString()
  branch?: string;

  @ApiPropertyOptional({ example: 'https://s3.../bank-screenshot.jpg', description: 'URL ảnh chụp màn hình Internet Banking' })
  @IsOptional()
  @IsUrl()
  verificationDocument?: string;

  @ApiPropertyOptional({ example: true, description: 'Đặt làm tài khoản rút tiền mặc định' })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class SetDefaultBankAccountDto {
  @ApiProperty({ example: true, description: 'Đặt làm tài khoản rút tiền mặc định' })
  @IsBoolean()
  isDefault: boolean;
}

export class BankAccountResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  fieldOwner: string;

  @ApiProperty()
  accountName: string;

  @ApiProperty()
  accountNumber: string;

  @ApiProperty()
  bankCode: string;

  @ApiProperty()
  bankName: string;

  @ApiPropertyOptional()
  branch?: string;

  @ApiPropertyOptional()
  verificationDocument?: string;

  @ApiProperty({ enum: BankAccountStatus })
  status: BankAccountStatus;

  @ApiProperty()
  isDefault: boolean;

  @ApiPropertyOptional()
  accountNameFromPayOS?: string;

  @ApiProperty()
  isValidatedByPayOS: boolean;

  @ApiPropertyOptional()
  verifiedAt?: Date;

  @ApiPropertyOptional()
  verifiedBy?: string;

  @ApiPropertyOptional()
  rejectionReason?: string;

  @ApiPropertyOptional()
  notes?: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  // Verification payment fields
  @ApiPropertyOptional({ example: 'https://pay.payos.vn/web/...', description: 'PayOS payment URL for verification' })
  verificationUrl?: string;

  @ApiPropertyOptional({ example: 'https://img.vietqr.io/...', description: 'QR code URL for verification payment' })
  verificationQrCode?: string;

  @ApiPropertyOptional({ enum: ['pending', 'paid', 'failed'], description: 'Current verification payment status' })
  verificationPaymentStatus?: 'pending' | 'paid' | 'failed';

  @ApiPropertyOptional({ example: true, description: 'Whether verification payment is required' })
  needsVerification?: boolean;

  @ApiPropertyOptional({ example: '123456789', description: 'PayOS order code for verification payment' })
  verificationOrderCode?: string;
}


