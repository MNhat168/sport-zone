import { Controller, Post, Body, BadRequestException, UseGuards, Get, Query, Res } from '@nestjs/common';
import { AuthService } from './auth.service';
import { Inject } from '@nestjs/common';
import { SignInTokenDto } from './dto/sign-in-token.dto';
import { RegisterDto, LoginDto, VerifyAccountDto, ForgotPasswordDto, ResetPasswordDto, LoginWithRememberDto } from './dto/auth.dto';
import { HttpStatus } from '@nestjs/common';
import { JwtRefreshTokenGuard } from './guards/jwt-refresh-token.guard';
import { JwtAccessTokenGuard } from './guards/jwt-access-token.guard';
import { Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody, ApiQuery } from '@nestjs/swagger';
import { Response } from 'express';
import { ConfigService } from '@nestjs/config';

@Controller('auth')
@ApiTags('Auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) { }

  /**
   * Helper method để set authentication cookies
   * @param res - Response object
   * @param accessToken - JWT access token
   * @param refreshToken - JWT refresh token  
   * @param rememberMe - Nếu true: persistent cookies (có expiration), nếu false: session cookies
   */
  private setAuthCookies(
    res: Response, 
    accessToken: string, 
    refreshToken: string, 
    rememberMe: boolean
  ): void {
    const isProduction = process.env.NODE_ENV === 'production';
    
    // Đọc thời gian hết hạn từ ENV (cùng giá trị với JwtService)
    const accessExpCfg = this.configService.get<string>('JWT_ACCESS_TOKEN_EXPIRATION_TIME') ?? '1d';
    const refreshExpCfg = this.configService.get<string>('JWT_REFRESH_TOKEN_EXPIRATION_TIME') ?? '7d';
    const accessMs = this.parseExpirationToMs(accessExpCfg);
    const refreshMs = this.parseExpirationToMs(refreshExpCfg);
    
    // Cấu hình cookie chung
    const cookieOptions = {
      httpOnly: true,      // Không thể truy cập từ JavaScript (bảo mật)
      secure: isProduction, // Chỉ gửi qua HTTPS ở production
      sameSite: 'strict' as const, // Chống CSRF attack
      path: '/',
    };

    // Access token
    res.cookie('access_token', accessToken, {
      ...cookieOptions,
      // Nếu rememberMe = true: cookie tồn tại 15 phút
      // Nếu rememberMe = false: session cookie (xóa khi đóng browser)
      expires: rememberMe 
        ? new Date(Date.now() + accessMs) 
        : undefined,
    });

    // Refresh token
    res.cookie('refresh_token', refreshToken, {
      ...cookieOptions,
      // Nếu rememberMe = true: cookie tồn tại 7 ngày
      // Nếu rememberMe = false: session cookie (xóa khi đóng browser)
      expires: rememberMe 
        ? new Date(Date.now() + refreshMs) 
        : undefined,
    });
  }

  /**
   * Parse giá trị thời gian hết hạn từ ENV sang milliseconds.
   * Hỗ trợ:
   * - Số thuần: tính là giây (ví dụ: 86400)
   * - Chuỗi có hậu tố: s, m, h, d (ví dụ: '15m', '7d')
   */
  private parseExpirationToMs(exp: string | number): number {
    if (typeof exp === 'number') return exp * 1000;
    const str = String(exp).trim();
    if (/^\d+$/.test(str)) {
      return Number(str) * 1000; // số giây
    }
    const match = str.match(/^(\d+)\s*([smhd])$/i);
    if (!match) return 15 * 60 * 1000; // fallback 15 phút
    const value = Number(match[1]);
    const unit = match[2].toLowerCase();
    switch (unit) {
      case 's': return value * 1000;
      case 'm': return value * 60 * 1000;
      case 'h': return value * 60 * 60 * 1000;
      case 'd': return value * 24 * 60 * 60 * 1000;
      default: return value * 1000;
    }
  }
  
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
  async login(@Body() loginDto: LoginWithRememberDto, @Res() res: Response) {
    console.log('🔐 Login attempt for:', loginDto.email);
    
    const result = await this.authService.login({ 
      ...loginDto, 
      rememberMe: !!loginDto.rememberMe 
    });
    
    console.log('✅ Login successful, setting cookies');
    
    // Set authentication cookies
    this.setAuthCookies(
      res, 
      result.accessToken, 
      result.refreshToken, 
      !!loginDto.rememberMe
    );
    
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

  // Đăng nhập bằng Google OAuth
  @Post('google')
  @ApiOperation({ summary: 'Đăng nhập bằng Google OAuth' })
  async authWithGoogle(
    @Body() sign_in_token: SignInTokenDto & { rememberMe: boolean }, 
    @Res() res: Response
  ) {
    const result = await this.authService.authenticateWithGoogle(sign_in_token);
    
    // Set authentication cookies
    this.setAuthCookies(
      res, 
      result.accessToken, 
      result.refreshToken, 
      !!sign_in_token.rememberMe
    );
    
    return res.status(HttpStatus.OK).json({ 
      user: result.user, 
      message: 'Đăng nhập Google thành công' 
    });
  }

  // Làm mới access token bằng refresh token
  @Post('refresh')
  @ApiOperation({ summary: 'Làm mới access token' })
  @UseGuards(JwtRefreshTokenGuard)
  async refreshToken(@Req() req: any, @Res() res: Response) {
    const { userId, email, role } = req.user;
    
    // Tạo token mới
    const newAccessToken = this.authService.generateAccessToken({ userId, email, role });
    const newRefreshToken = this.authService.generateRefreshToken({ userId, email, role });

    // Nếu refresh_token tồn tại, nghĩa là user đã đăng nhập (rememberMe hoặc session)
    // → Giữ nguyên pattern của cookie (persistent hoặc session)
    const hasRefreshToken = !!req.cookies['refresh_token'];
    
    // Set lại cookies với cùng pattern
    this.setAuthCookies(res, newAccessToken, newRefreshToken, hasRefreshToken);

    return res.status(HttpStatus.OK).json({ 
      message: 'Token refreshed successfully' 
    });
  }

  // Kiểm tra session hiện tại có hợp lệ không
  @Get('validate')
  @ApiOperation({ summary: 'Kiểm tra session có hợp lệ không' })
  @ApiResponse({ 
    status: 200, 
    description: 'Session hợp lệ, trả về thông tin user' 
  })
  @ApiResponse({ 
    status: 401, 
    description: 'Token không hợp lệ hoặc đã hết hạn' 
  })
  @UseGuards(JwtAccessTokenGuard)
  async validateSession(@Req() req: any) {
    console.log('🔐 Validating session for user:', req.user?.email);
    
    // Nếu đến đây, JWT guard đã verify token thành công
    // Lấy thông tin user đầy đủ từ database
    const user = await this.authService.getUserById(req.user.userId);
    
    if (!user) {
      throw new BadRequestException('User not found');
    }
    
    return {
      user: {
        _id: user._id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        avatarUrl: user.avatarUrl,
        isActive: user.isActive,
        isVerified: user.isVerified,
      },
    };
  }

  // Đăng xuất - xóa cookies
  @Post('logout')
  @ApiOperation({ summary: 'Đăng xuất' })
  async logout(@Res() res: Response) {
    // Xóa cả 2 cookies
    res.clearCookie('access_token', { path: '/' });
    res.clearCookie('refresh_token', { path: '/' });
    
    return res.status(HttpStatus.OK).json({ 
      message: 'Logged out successfully' 
    });
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
