import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class UpdateFieldVerificationDto {
    @ApiProperty({ example: true, description: 'Trạng thái xác minh bởi admin' })
    @IsBoolean()
    isAdminVerify: boolean;
}

