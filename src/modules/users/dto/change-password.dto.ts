import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class ChangePasswordDto {
    @ApiProperty({
        example: 'OldPassword123!',
        description: 'Mật khẩu cũ',
        minLength: 6
    })
    @IsString()
    @Length(6, 50, { message: 'Mật khẩu phải có độ dài từ 6-50 ký tự' })
    oldPassword: string;

    @ApiProperty({
        example: 'NewPassword123!',
        description: 'Mật khẩu mới (ít nhất 6 ký tự)',
        minLength: 6
    })
    @IsString()
    @Length(6, 50, { message: 'Mật khẩu phải có độ dài từ 6-50 ký tự' })
    newPassword: string;

    @ApiProperty({
        example: 'NewPassword123!',
        description: 'Xác nhận mật khẩu mới',
        minLength: 6
    })
    @IsString()
    @Length(6, 50, { message: 'Mật khẩu phải có độ dài từ 6-50 ký tự' })
    confirmPassword: string;
}
