import { IsEmail, IsString, Length, IsPhoneNumber, IsDateString, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO cho việc đăng ký người dùng mới
 */
export class RegisterDto {
    /**
     * Tên đầy đủ của người dùng
     * @example "Nguyễn Văn A"
     */
    @ApiProperty({ 
        example: 'Nguyễn Văn A',
        description: 'Tên đầy đủ của người dùng',
        minLength: 2,
        maxLength: 50
    })
    @IsString()
    @Length(2, 50, { message: 'Tên phải có độ dài từ 2-50 ký tự' })
    fullName: string;

    /**
     * Email của người dùng
     * @example "nguyenvana@example.com"
     */
    @ApiProperty({ 
        example: 'nguyenvana@example.com',
        description: 'Địa chỉ email của người dùng'
    })
    @IsEmail({}, { message: 'Email không hợp lệ' })
    email: string;

    /**
     * Số điện thoại của người dùng (định dạng Việt Nam)
     * @example "0123456789"
     */
    @ApiProperty({ 
        example: '0123456789',
        description: 'Số điện thoại của người dùng (10 chữ số)',
        pattern: '^[0-9]{10}$'
    })
    @IsString()
    @Length(10, 10, { message: 'Số điện thoại phải có 10 chữ số' })
    phone: string;

    /**
     * Ngày sinh của người dùng
     * @example "1990-01-01"
     */
    @ApiProperty({ 
        example: '1990-01-01',
        description: 'Ngày sinh của người dùng (YYYY-MM-DD)'
    })
    @IsDateString({}, { message: 'Ngày sinh không hợp lệ' })
    date_of_birth: string;

    /**
     * Mật khẩu của người dùng
     * @example "Password123!"
     */
    @ApiProperty({ 
        example: 'Password123!',
        description: 'Mật khẩu của người dùng (ít nhất 6 ký tự)',
        minLength: 6
    })
    @IsString()
    @Length(6, 50, { message: 'Mật khẩu phải có độ dài từ 6-50 ký tự' })
    password: string;
}

/**
 * DTO cho việc đăng nhập
 */
export class LoginDto {
    /**
     * Email của người dùng
     * @example "nguyenvana@example.com"
     */
    @ApiProperty({ 
        example: 'nguyenvana@example.com',
        description: 'Địa chỉ email của người dùng'
    })
    @IsEmail({}, { message: 'Email không hợp lệ' })
    email: string;

    /**
     * Mật khẩu của người dùng
     * @example "Password123!"
     */
    @ApiProperty({ 
        example: 'Password123!',
        description: 'Mật khẩu của người dùng'
    })
    @IsString()
    password: string;
}

/**
 * DTO cho đăng nhập kèm rememberMe
 */
export class LoginWithRememberDto extends LoginDto {
    /**
     * Ghi nhớ đăng nhập (tùy chọn)
     * @example true
     */
    @ApiPropertyOptional({ description: 'Ghi nhớ đăng nhập', default: false })
    @IsOptional()
    rememberMe?: boolean;
}

/**
 * DTO cho việc xác thực tài khoản
 */
export class VerifyAccountDto {
    /**
     * Email của người dùng
     * @example "nguyenvana@example.com"
     */
    @ApiProperty({ 
        example: 'nguyenvana@example.com',
        description: 'Địa chỉ email của người dùng'
    })
    @IsEmail({}, { message: 'Email không hợp lệ' })
    email: string;

    /**
     * Mã xác thực 6 chữ số
     * @example "123456"
     */
    @ApiProperty({ 
        example: '123456',
        description: 'Mã xác thực 6 chữ số được gửi qua email'
    })
    @IsString()
    @Length(6, 6, { message: 'Mã xác thực phải có 6 chữ số' })
    verificationToken: string;
}

/**
 * DTO cho việc quên mật khẩu
 */
export class ForgotPasswordDto {
    /**
     * Email của người dùng
     * @example "nguyenvana@example.com"
     */
    @ApiProperty({ 
        example: 'nguyenvana@example.com',
        description: 'Địa chỉ email của người dùng'
    })
    @IsEmail({}, { message: 'Email không hợp lệ' })
    email: string;
}

/**
 * DTO cho việc đặt lại mật khẩu
 */
export class ResetPasswordDto {
    /**
     * Email của người dùng
     * @example "nguyenvana@example.com"
     */
    @ApiProperty({ 
        example: 'nguyenvana@example.com',
        description: 'Địa chỉ email của người dùng'
    })
    @IsEmail({}, { message: 'Email không hợp lệ' })
    email: string;

    /**
     * Mã đặt lại mật khẩu
     * @example "123456"
     */
    @ApiProperty({ 
        example: '123456',
        description: 'Mã đặt lại mật khẩu 6 chữ số'
    })
    @IsString()
    @Length(6, 6, { message: 'Mã đặt lại mật khẩu phải có 6 chữ số' })
    resetPasswordToken: string;

    /**
     * Mật khẩu mới
     * @example "NewPassword123!"
     */
    @ApiProperty({ 
        example: 'NewPassword123!',
        description: 'Mật khẩu mới (ít nhất 6 ký tự)'
    })
    @IsString()
    @Length(6, 50, { message: 'Mật khẩu phải có độ dài từ 6-50 ký tự' })
    newPassword: string;

    /**
     * Xác nhận mật khẩu mới
     * @example "NewPassword123!"
     */
    @ApiProperty({ 
        example: 'NewPassword123!',
        description: 'Xác nhận mật khẩu mới (phải giống mật khẩu mới)'
    })
    @IsString()
    @Length(6, 50, { message: 'Xác nhận mật khẩu phải có độ dài từ 6-50 ký tự' })
    confirmPassword: string;
}