import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserRole } from '../users/entities/user.entity';
import * as bcrypt from 'bcrypt';
import * as nodemailer from 'nodemailer';

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
  ) {}

  // Register a new user
  async register(body: {
    fullName: string;
    email: string;
    phone: string;
    password: string;
  }) {
    const { fullName, email, phone, password } = body;
    const existing = await this.userModel.findOne({ email });
    if (existing) throw new BadRequestException('Email already registered');
    const hashed = await bcrypt.hash(password, 10);
    const verificationToken = Math.floor(
      100000 + Math.random() * 900000,
    ).toString();
    // Send email
    await this.sendVerificationEmail(email, verificationToken);
    // Save user with isVerified: false
    const user = new this.userModel({
      fullName,
      email,
      phone,
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

  async sendVerificationEmail(email: string, code: string) {
    const transporter = nodemailer.createTransport({
      host: process.env.MAIL_HOST,
      port: Number(process.env.MAIL_PORT),
      secure: Number(process.env.MAIL_PORT) === 465, // true for port 465, false for others
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
      from: process.env.DEFAULT_MAIL_FROM || 'SportZone@example.com',
      to: email,
      subject: 'SportZone Verification Code',
      text: `Your verification code is: ${code}`,
    });
  }

  // Login with current user
  async login(body: { email: string; password: string }) {
    const { email, password } = body;
    const user = await this.userModel.findOne({ email });
    if (!user) throw new BadRequestException('Invalid credentials');
    if (!user.isVerified) throw new BadRequestException('Account not verified');
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) throw new BadRequestException('Invalid credentials');
    // JWT
    const jwt = require('jsonwebtoken');
    const token = jwt.sign(
      { sub: user._id, email: user.email, role: user.role },
      process.env.JWT_SECRET || 'defaultsecret',
      { expiresIn: process.env.JWT_ACCESS_TOKEN_EXPIRATION_TIME || '1h' },
    );
    return { access_token: token };
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
      from: process.env.DEFAULT_MAIL_FROM || 'SportZone@example.com',
      to: email,
      subject: 'SportZone Reset Password Code',
      text: `Your reset password code is: ${code}`,
    });
  }

  async resetPassword(body: { email: string; resetPasswordToken: string; password: string; confirmPassword: string }) {
    const { email, resetPasswordToken, password, confirmPassword } = body;
    if (password !== confirmPassword) throw new BadRequestException('Passwords do not match');
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
    // JWT
    const jwt = require('jsonwebtoken');
    const token = jwt.sign(
      { sub: user._id, email: user.email, role: user.role },
      process.env.JWT_SECRET || 'defaultsecret',
      { expiresIn: process.env.JWT_ACCESS_TOKEN_EXPIRATION_TIME || '1h' },
    );
    return { access_token: token };
  }

}
