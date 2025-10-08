import { Injectable, BadRequestException, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserRole } from '../users/entities/user.entity';
import * as bcrypt from 'bcrypt';
import * as nodemailer from 'nodemailer';
import { EmailService } from '../email/email.service';
import { ConfigService } from '@nestjs/config';
import { TokenPayload } from './interfaces/token.interface';
import { JwtService } from '@nestjs/jwt';
import { SignInTokenDto } from './dto/sign-in-token.dto';
import { HttpService } from '@nestjs/axios';
import { USER_REPOSITORY, UserRepositoryInterface } from '../users/interface/users.interface';
@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    private readonly jwt_service: JwtService,
    private readonly config_service: ConfigService,
    private readonly http_service: HttpService,
    @Inject(USER_REPOSITORY) private readonly user_repository: UserRepositoryInterface,
    private readonly emailService: EmailService,
  ) { }

  generateAccessToken(payload: TokenPayload) {
    return this.jwt_service.sign(payload, {
      expiresIn: this.config_service.get<string>('JWT_ACCESS_TOKEN_EXPIRATION_TIME') || '15m',
    });
  }

  generateRefreshToken(payload: TokenPayload) {
    return this.jwt_service.sign(payload, {
      expiresIn: this.config_service.get<string>('JWT_REFRESH_TOKEN_EXPIRATION_TIME') || '7d',
    });
  }
  // Register a new user
  async register(body: {
    fullName: string;
    email: string;
    phone: string;
    date_of_birth: string;
    password: string;
  }) {
    const { fullName, email, phone, date_of_birth, password } = body;
    
    // Validate phone number format (Vietnamese phone number)
    const phoneRegex = /^[0-9]{10}$/;
    if (!phoneRegex.test(phone)) {
      throw new BadRequestException('Số điện thoại không hợp lệ. Vui lòng nhập 10 chữ số.');
    }

    // Validate age (minimum 12 years old)
    const birthDate = new Date(date_of_birth);
    const today = new Date();
    const age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      // Chưa đến sinh nhật trong năm này
    }
    
    if (age < 12) {
      throw new BadRequestException('Tuổi phải lớn hơn hoặc bằng 12.');
    }
    const existing = await this.userModel.findOne({ email });
    if (existing) throw new BadRequestException('Email already registered');
    const hashed = await bcrypt.hash(password, 10);
    const verificationToken = Math.floor(
      100000 + Math.random() * 900000,
    ).toString();
    // Send email using template verify-email.hbs
    await this.emailService.sendEmailVerification(email, verificationToken);
    // Save user with isVerified: false
    const user = new this.userModel({
      fullName,
      email,
      phone,
      date_of_birth: new Date(date_of_birth),
      password: hashed,
      role: UserRole.USER,
      isVerified: false,
      verificationToken,
    });
    await user.save();
    return { message: 'Verification code sent to email' };
  }

  async verify(email: string, verificationToken: string) {
    const user = await this.userModel.findOne({ email });
    if (!user) throw new BadRequestException('User not found');
    if (user.isVerified) return { message: 'Already verified' };
    if (user.verificationToken !== verificationToken)
      throw new BadRequestException('Invalid code');
    user.isVerified = true;
    user.verificationToken = undefined;
    await user.save();
    return { message: 'Account verified and created' };
  }

  /**
   * Verify account using token only (no email). Intended for one-click flows.
   */
  async verifyByToken(verificationToken: string) {
    const user = await this.userModel.findOne({ verificationToken });
    if (!user) throw new BadRequestException('Invalid or expired token');
    if (user.isVerified) return { message: 'Already verified' };
    user.isVerified = true;
    user.verificationToken = undefined;
    await user.save();
    return { message: 'Account verified and created' };
  }

  // Deprecated: replaced by EmailService.sendEmailVerification
  // async sendVerificationEmail(email: string, code: string) {}

  // Login with current user
  async login(body: { email: string; password: string; rememberMe: boolean }) {
    const { email, password } = body;
    const user = await this.userModel.findOne({ email });
    if (!user) throw new BadRequestException('Invalid credentials');
    if (!user.isVerified) throw new BadRequestException('Account not verified');
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) throw new BadRequestException('Invalid credentials');
    const accessToken = this.generateAccessToken({
      userId: (user._id as any).toString(),
      email: user.email,
      role: user.role
    });
    const refreshToken = this.generateRefreshToken({
      userId: (user._id as any).toString(),
      email: user.email,
      role: user.role
    });
    return {
      user: {
        _id: user._id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        avatarUrl: user.avatarUrl,
        isActive: user.isActive,
        isVerified: user.isVerified
      },
      accessToken,
      refreshToken,
    };
  }

  // Forgot password
  async forgotPassword(email: string) {
    const user = await this.userModel.findOne({ email });
    if (!user) throw new BadRequestException('User not found');
    const resetPasswordToken = Math.floor(100000 + Math.random() * 900000).toString();
    const expires = new Date(Date.now() + 60 * 1000); // 1 minute from now
    user.resetPasswordToken = resetPasswordToken;
    user.resetPasswordExpires = expires;
    await user.save();
    // Send email
    await this.sendResetPasswordEmail(email, resetPasswordToken);
    return { message: 'Reset password code sent to email' };
  }

  async sendResetPasswordEmail(email: string, code: string) {
    const transporter = nodemailer.createTransport({
      host: process.env.MAIL_HOST,
      port: Number(process.env.MAIL_PORT),
      secure: Number(process.env.MAIL_PORT) === 465,
      auth: {
        user: process.env.MAIL_USER,
        pass: process.env.MAIL_PASS,
      },
      tls: {
        rejectUnauthorized: false,
      },
      family: 4,
    } as any);
    await transporter.sendMail({
      from: process.env.DEFAULT_MAIL_FROM!,
      to: email,
      subject: 'SportZone Reset Password Code',
      text: `Your reset password code is: ${code}`,
    });
  }

  async resetPassword(body: { email: string; resetPasswordToken: string; password: string; confirmPassword: string }) {
    const { email, resetPasswordToken, password, confirmPassword } = body;
    if (password !== confirmPassword) throw new BadRequestException('Mật khẩu xác nhận không khớp');
    const user = await this.userModel.findOne({ email });
    if (!user) throw new BadRequestException('User not found');
    if (!user.resetPasswordToken || !user.resetPasswordExpires) throw new BadRequestException('No reset token');
    if (user.resetPasswordToken !== resetPasswordToken) throw new BadRequestException('Invalid code');
    if (user.resetPasswordExpires < new Date()) throw new BadRequestException('Reset token expired');
    user.password = await bcrypt.hash(password, 10);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();
    return { message: 'Password reset successful' };
  }

  // Login with Google OAuth
  async loginWithGoogle(body: { googleId: string; email: string; fullName: string }) {
    const { googleId, email, fullName } = body;
    let user = await this.userModel.findOne({ email });
    if (user) {
      // Link googleId if not already linked
      if (!user.googleId) {
        user.googleId = googleId;
        await user.save();
      }
    } else {
      // Create new user with Google info only
      user = new this.userModel({
        fullName,
        email,
        googleId,
        role: UserRole.USER,
        isVerified: true,
        password: '',
        phone: '',
      });
      await user.save();
    }
    const accessToken = this.generateAccessToken({ 
      userId: (user._id as any).toString(), 
      email: user.email, 
      role: user.role 
    });
    const refreshToken = this.generateRefreshToken({ 
      userId: (user._id as any).toString(), 
      email: user.email, 
      role: user.role 
    });
    return { 
      access_token: accessToken,
      refresh_token: refreshToken 
    };
  }
  async authenticateWithGoogle(sign_in_token: SignInTokenDto & { rememberMe: boolean }) {
    const { token, avatar } = sign_in_token;
    const userInfo = await this.http_service.axiosRef.get(
      'https://www.googleapis.com/oauth2/v3/userinfo',
      { headers: { Authorization: `Bearer ${token}` } },
    );

    const { email, name, picture } = userInfo.data;
    if (!email) throw new HttpException({ message: 'Token không hợp lệ' }, HttpStatus.BAD_REQUEST);

    let user = await this.user_repository.findOneByCondition({ email });

    if (!user) {
      const defaultPassword = '123456';
      const passwordHash = await bcrypt.hash(defaultPassword, 10);
      user = await this.user_repository.create({
        email,
        googleId: userInfo.data.sub,
        fullName: userInfo.data.given_name,
        role: UserRole.USER,
        isActive: true,
        password: passwordHash,
        isVerified: userInfo.data.email_verified,
        avatarUrl: picture || avatar,
      });
    }

    if (!user.isActive) throw new HttpException({ message: 'Tài khoản đã bị khóa' }, HttpStatus.UNAUTHORIZED);
    if (avatar && user.avatarUrl !== avatar) await this.user_repository.update(user.id, { avatarUrl: avatar });

    const accessToken = this.generateAccessToken({ 
      userId: (user._id as any).toString(), 
      email: user.email, 
      role: user.role 
    });
    const refreshToken = this.generateRefreshToken({ 
      userId: (user._id as any).toString(), 
      email: user.email, 
      role: user.role 
    });

    return {
      user: {
        _id: user._id,
        email: user.email,
        fullName: user.fullName,
        avatarUrl: user.avatarUrl,
        role: user.role,
      },
      accessToken,
      refreshToken,
    };
  }

  // Logout
  async logout() {
    return { message: 'Logged out' };
  }
}
