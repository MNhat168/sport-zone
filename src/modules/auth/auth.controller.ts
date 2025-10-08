import { Controller, Post, Body, BadRequestException, UseGuards, Get, Query, Res } from '@nestjs/common';
import { AuthService } from './auth.service';
import { Inject } from '@nestjs/common';
import { SignInTokenDto } from './dto/sign-in-token.dto';
import { RegisterDto, LoginDto, VerifyAccountDto, ForgotPasswordDto, ResetPasswordDto } from './dto/auth.dto';
import { HttpStatus } from '@nestjs/common';
import { JwtRefreshTokenGuard } from './guards/jwt-refresh-token.guard';
import { Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody, ApiQuery } from '@nestjs/swagger';
import { Response } from 'express';

@Controller('auth')
@ApiTags('Authentication')
export class AuthController {
  constructor(private readonly authService: AuthService) { }
  
  /**
   * Đăng ký tài khoản mới
   * @param registerDto - Thông tin đăng ký
   * @returns Thông báo kết quả đăng ký
   */
  @Post('register')
  @ApiOperation({ summary: 'Đăng ký tài khoản mới' })
  @ApiResponse({ 
    status: 201, 
    description: 'Đăng ký thành công. Mã xác thực đã được gửi qua email.' 
  })
  @ApiResponse({ 
    status: 400, 
    description: 'Dữ liệu không hợp lệ hoặc email đã tồn tại' 
  })
  async register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  /**
   * Xác thực tài khoản bằng mã được gửi qua email
   * @param verifyDto - Email và mã xác thực
   * @returns Thông báo kết quả xác thực
   */
  @Post('verify')
  @ApiOperation({ summary: 'Xác thực tài khoản' })
  @ApiResponse({ 
    status: 200, 
    description: 'Xác thực thành công' 
  })
  @ApiResponse({ 
    status: 400, 
    description: 'Mã xác thực không hợp lệ hoặc tài khoản không tìm thấy' 
  })
  async verify(@Body() verifyDto: VerifyAccountDto) {
    return this.authService.verify(verifyDto.email, verifyDto.verificationToken);
  }

  /**
   * Xác thực 1-click qua link trong email
   * GET /auth/verify-email?email=...&token=...
   * - Thành công: redirect về FRONTEND_URL với trạng thái thành công
   * - Thất bại: redirect về FRONTEND_URL với trạng thái lỗi
   */
  @Get('verify-email')
  @ApiOperation({ summary: 'Xác thực 1-click qua link email' })
  @ApiQuery({ name: 'email', required: false })
  @ApiQuery({ name: 'token', required: true })
  async verifyEmail(
    @Query('email') email: string,
    @Query('token') token: string,
    @Res() res: Response,
  ) {
    const frontend = process.env.FRONTEND_URL || 'http://localhost:5173';
    try {
      if (email) {
        await this.authService.verify(email, token);
      } else {
        await this.authService.verifyByToken(token);
      }
      return res.redirect(`${frontend}/verify-email/success`);
    } catch (err) {
      return res.redirect(`${frontend}/verify-email/failed`);
    }
  }

  // Cập nhật login
  @Post('login')
  @ApiOperation({ summary: 'Đăng nhập' })
  @ApiResponse({
    status: 200,
    description: 'Đăng nhập thành công',
    schema: {
      type: 'object',
      properties: {
        user: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            email: { type: 'string' },
            fullName: { type: 'string' },
            role: { type: 'string' },
            avatarUrl: { type: 'string' },
            isActive: { type: 'boolean' },
            isVerified: { type: 'boolean' },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Email hoặc mật khẩu không đúng',
  })
  async login(@Body() loginDto: LoginDto & { rememberMe: boolean }, @Res() res: Response) {
    const result = await this.authService.login({ ...loginDto, rememberMe: loginDto.rememberMe });
    res.cookie('access_token', result.accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      expires: loginDto.rememberMe ? new Date(Date.now() + 15 * 60 * 1000) : undefined, // 15m or session
      path: '/',
    });
    res.cookie('refresh_token', result.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      expires: loginDto.rememberMe ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) : undefined, // 7d or session
      path: '/',
    });
    return res.status(HttpStatus.OK).json({ user: result.user });
  }

  /**
   * Quên mật khẩu - gửi mã đặt lại qua email
   * @param forgotPasswordDto - Email cần đặt lại mật khẩu
   * @returns Thông báo kết quả gửi mã
   */
  @Post('forgot-password')
  @ApiOperation({ summary: 'Quên mật khẩu' })
  @ApiResponse({ 
    status: 200, 
    description: 'Mã đặt lại mật khẩu đã được gửi qua email' 
  })
  @ApiResponse({ 
    status: 400, 
    description: 'Email không tồn tại' 
  })
  async forgotPassword(@Body() forgotPasswordDto: ForgotPasswordDto) {
    return this.authService.forgotPassword(forgotPasswordDto.email);
  }

  /**
   * Đặt lại mật khẩu bằng mã xác thực
   * @param resetPasswordDto - Thông tin đặt lại mật khẩu
   * @returns Thông báo kết quả đặt lại
   */
  @Post('reset-password')
  @ApiOperation({ summary: 'Đặt lại mật khẩu' })
  @ApiResponse({ 
    status: 200, 
    description: 'Đặt lại mật khẩu thành công' 
  })
  @ApiResponse({ 
    status: 400, 
    description: 'Mã xác thực không hợp lệ hoặc đã hết hạn' 
  })
  async resetPassword(@Body() resetPasswordDto: ResetPasswordDto) {
    return this.authService.resetPassword(resetPasswordDto);
  }

  // Cập nhật authenticateWithGoogle
  @Post('google')
  async authWithGoogle(@Body() sign_in_token: SignInTokenDto & { rememberMe: boolean }, @Res() res: Response) {
    const result = await this.authService.authenticateWithGoogle(sign_in_token);
    res.cookie('access_token', result.accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      expires: sign_in_token.rememberMe ? new Date(Date.now() + 15 * 60 * 1000) : undefined,
      path: '/',
    });
    res.cookie('refresh_token', result.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      expires: sign_in_token.rememberMe ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) : undefined,
      path: '/',
    });
    return res.status(HttpStatus.OK).json({ user: result.user, message: 'Đăng nhập Google thành công' });
  }

  // Cập nhật refresh token
  @Post('refresh')
  @UseGuards(JwtRefreshTokenGuard)
  async refreshToken(@Req() req: any, @Res() res: Response) {
    const { userId, email, role } = req.user;
    const newAccessToken = this.authService.generateAccessToken({ userId, email, role });
    const newRefreshToken = this.authService.generateRefreshToken({ userId, email, role });

    // Giả sử rememberMe=true (hoặc lấy từ user nếu lưu)
    res.cookie('access_token', newAccessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      expires: new Date(Date.now() + 15 * 60 * 1000), // 15m
      path: '/',
    });
    res.cookie('refresh_token', newRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7d
      path: '/',
    });

    return res.status(HttpStatus.OK).json({ message: 'Token refreshed successfully' });
  }

  // Thêm logout endpoint
  @Post('logout')
  async logout(@Res() res: Response) {
    res.clearCookie('access_token', { path: '/' });
    res.clearCookie('refresh_token', { path: '/' });
    return res.status(HttpStatus.OK).json({ message: 'Logged out' });
  }

  // Google OAuth callback handler
  @Post('google/callback')
  async googleCallback(@Body() body: { code: string }) {
    const axios = require('axios');
    try {
      // Exchange code for access token
      const tokenRes = await axios.post('https://oauth2.googleapis.com/token', null, {
        params: {
          code: body.code,
          client_id: process.env.GOOGLE_CLIENT_ID,
          client_secret: process.env.GOOGLE_SECRET,
          redirect_uri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/auth/google/callback',
          grant_type: 'authorization_code',
        },
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      const accessToken = tokenRes.data.access_token;
      // Get user info from Google
      const userRes = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const { id: googleId, email, name: fullName } = userRes.data;
      // Login or create user
      return this.authService.loginWithGoogle({ googleId, email, fullName });
    } catch (err) {
      // Log error to backend console
      console.error('Google OAuth callback error:', err?.response?.data || err);
      // Return error details to frontend
      throw new BadRequestException({
        message: 'Google OAuth failed',
        error: err?.response?.data?.error_description || err?.message || 'Unknown error',
        details: err?.response?.data || err,
      });
    }
  }

}
