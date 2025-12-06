import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsEnum, IsOptional, IsInt } from 'class-validator';
import { PaymentMethod } from 'src/common/enums/payment-method.enum';

export class CreateCoachVerificationDto {
  @ApiProperty({ example: '9704xxxxxxxx1234', description: 'Số tài khoản/Thẻ của coach' })
  @IsString()
  bankAccountNumber: string;

  @ApiProperty({ example: 'Techcombank', description: 'Tên ngân hàng' })
  @IsString()
  bankName: string;

  @ApiProperty({ enum: PaymentMethod, example: PaymentMethod.VNPAY })
  @IsInt()
  @IsEnum(PaymentMethod)
  method: PaymentMethod;

  @ApiProperty({ required: false, example: 10000, description: 'Số tiền xác thực (mặc định 10k)' })
  @IsOptional()
  amount?: number;
}
