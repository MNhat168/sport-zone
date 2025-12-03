import { Injectable, BadRequestException, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserRole } from '../users/entities/user.entity';
import * as bcrypt from 'bcrypt';
import * as nodemailer from 'nodemailer';
import { EmailService } from '../email/email.service';
import { EmailQueueService } from '../email/email-queue.service';
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
    private readonly emailQueue: EmailQueueService,
  ) { }

  generateAccessToken(payload: TokenPayload) {
    return this.jwt_service.sign(payload, {
      expiresIn: Number(this.config_service.get('JWT_ACCESS_TOKEN_EXPIRATION_TIME')) || 3600,
    });
  }

  generateRefreshToken(payload: TokenPayload) {
    return this.jwt_service.sign(payload, {
      expiresIn: Number(this.config_service.get('JWT_REFRESH_TOKEN_EXPIRATION_TIME')) || 25200,
    });
  }

  /**
   * Generate JWT token for email verification
   * Token contains email and expires in 5 minutes
   */
  generateVerificationToken(email: string) {
    return this.jwt_service.sign(
      { email, type: 'email_verification' },
      {
        expiresIn: '5m', // Verification token expires in 5 minutes
      },
    );
  }

  /**
   * Generate JWT token for reset password
   * Token contains email and expires in 15 minutes
   */
  generateResetPasswordToken(email: string) {
    return this.jwt_service.sign(
      { email, type: 'reset_password' },
      {
        expiresIn: '15m', // Reset password token expires in 15 minutes
      },
    );
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

    // Generate JWT verification token (no need to store in database)
    const verificationToken = this.generateVerificationToken(email);

    // Enqueue email sending to background worker instead of awaiting SMTP directly
    this.emailQueue.enqueue({
      type: 'VERIFY_EMAIL',
      email,
      token: verificationToken,
    });
    // Save user with isVerified: false (no verificationToken field needed)
    const user = new this.userModel({
      fullName,
      email,
      phone,
      date_of_birth: new Date(date_of_birth),
      password: hashed,
      role: UserRole.USER,
      isVerified: false,
    });
    await user.save();
    return { message: 'Verification code sent to email' };
  }

  async verify(email: string, verificationToken: string) {
    const user = await this.userModel.findOne({ email });
    if (!user) throw new BadRequestException('User not found');
    if (user.isVerified) return { message: 'Already verified' };
    
    // Verify JWT token
    try {
      const payload = this.jwt_service.verify(verificationToken);
      // Check if token is for email verification and matches email
      if (payload.type !== 'email_verification' || payload.email !== email) {
        throw new BadRequestException('Invalid verification token');
      }
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        throw new BadRequestException('Verification token đã hết hạn. Vui lòng đăng ký lại.');
      }
      throw new BadRequestException('Invalid verification token');
    }
    
    user.isVerified = true;
    await user.save();
    return { message: 'Account verified and created' };
  }

  /**
   * Verify account using token only (no email). Intended for one-click flows.
   * Token is JWT containing email
   */
  async verifyByToken(verificationToken: string) {
    try {
      // Verify JWT token
      const payload = this.jwt_service.verify(verificationToken);
      
      // Check if token is for email verification
      if (payload.type !== 'email_verification' || !payload.email) {
        throw new BadRequestException('Invalid verification token');
      }
      
      // Find user by email from token
      const user = await this.userModel.findOne({ email: payload.email });
      if (!user) throw new BadRequestException('User not found');
      if (user.isVerified) return { message: 'Already verified' };
      
      user.isVerified = true;
      await user.save();
      return { message: 'Account verified and created' };
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        throw new BadRequestException('Verification token đã hết hạn. Vui lòng đăng ký lại.');
      }
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException('Invalid or expired token');
    }
  }

  // Deprecated: replaced by EmailService.sendEmailVerification
  // async sendVerificationEmail(email: string, code: string) {}

  // Login with current user
  async login(body: { email: string; password: string; rememberMe: boolean }) {
    const { email, password } = body;
    const user = await this.userModel.findOne({ email });
    if (!user) throw new BadRequestException('Email không tồn tại');
    if (!user.isVerified) throw new BadRequestException('Account not verified');
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) throw new BadRequestException('Mật khẩu không đúng');
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
    // Generate JWT token for reset password (no need to store in database)
    const resetPasswordToken = this.generateResetPasswordToken(email);

    // Enqueue reset password email to background worker
    this.emailQueue.enqueue({
      type: 'RESET_PASSWORD',
      email,
      token: resetPasswordToken,
    });
    return { message: 'Reset password link sent to email' };
  }

  async resetPassword(body: { email: string; resetPasswordToken: string; newPassword: string; confirmPassword: string }) {
    const { email, resetPasswordToken, newPassword, confirmPassword } = body;
    if (newPassword !== confirmPassword) throw new BadRequestException('Mật khẩu xác nhận không khớp');
    
    // Verify JWT token
    try {
      const payload = this.jwt_service.verify(resetPasswordToken);
      // Check if token is for reset password and matches email
      if (payload.type !== 'reset_password' || payload.email !== email) {
        throw new BadRequestException('Invalid reset password token');
      }
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        throw new BadRequestException('Reset password token đã hết hạn. Vui lòng yêu cầu lại.');
      }
      throw new BadRequestException('Invalid or expired reset password token');
    }
    
    const user = await this.userModel.findOne({ email });
    if (!user) throw new BadRequestException('User not found');
    
    user.password = await bcrypt.hash(newPassword, 10);
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

  // Get user by ID for session validation
  async getUserById(userId: string) {
    try {
      const user = await this.userModel.findById(userId);
      return user;
    } catch (error) {
      return null;
    }
  }
}
