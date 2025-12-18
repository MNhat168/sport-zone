import { Controller, Post, Body, BadRequestException, UseGuards, Get, Query, Res } from '@nestjs/common';
import { AuthService } from './auth.service';
import { Inject } from '@nestjs/common';
import { SignInTokenDto } from './dto/sign-in-token.dto';
import { RegisterDto, LoginDto, VerifyAccountDto, ForgotPasswordDto, ResetPasswordDto, LoginWithRememberDto, ClaimGuestDto } from './dto/auth.dto';
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
   * @param clientType - Phân biệt client (ví dụ: 'admin' | 'web')
   *
   * Lưu ý:
   * - Mặc định (không truyền clientType hoặc clientType !== 'admin') sẽ dùng cookie:
   *   + access_token
   *   + refresh_token
   * - Với clientType = 'admin' sẽ dùng cookie:
   *   + access_token_admin
   *   + refresh_token_admin
   *
   * Điều này cho phép FE admin và FE user có session tách biệt,
   * dù cùng gọi tới 1 API domain.
   */
  private setAuthCookies(
    res: Response,
    accessToken: string,
    refreshToken: string,
    rememberMe: boolean,
    clientType: 'admin' | 'web' = 'web',
    req?: any,  // Thêm req để detect origin
  ): void {
    const isProduction = process.env.NODE_ENV === 'production';

    // Detect nếu đang chạy trên server (không phải localhost)
    // Kiểm tra origin từ request hoặc từ ENV
    const origin = req?.headers?.origin || req?.headers?.referer || '';
    const isLocalhost = origin.includes('localhost') || origin.includes('127.0.0.1') || !origin;
    const isCrossOrigin = !isLocalhost && origin && !origin.includes(req?.headers?.host || '');

    // Detect HTTPS: kiểm tra nhiều nguồn
    // 1. req.secure (sau khi trust proxy)
    // 2. x-forwarded-proto header (từ reverse proxy)
    // 3. x-forwarded-ssl header (một số proxy dùng)
    // 4. NODE_ENV production (thường có HTTPS)
    // 5. origin bắt đầu bằng https:// (trường hợp proxy không set X-Forwarded-Proto)
    const forwardedProto = req?.headers?.['x-forwarded-proto'];
    const forwardedSsl = req?.headers?.['x-forwarded-ssl'];
    const forceSecure = String(process.env.FORCE_SECURE_COOKIES || '').toLowerCase() === 'true';
    const hasHttps =
      req?.secure === true ||
      forwardedProto === 'https' ||
      forwardedSsl === 'on' ||
      origin.startsWith('https://') ||
      (isProduction && !isLocalhost) ||
      forceSecure; // Cho phép ép bật Secure qua ENV

    // Nếu cross-origin hoặc production, cần sameSite: 'none' + secure: true
    const needsCrossSiteCookie = isCrossOrigin || isProduction;

    // Đọc thời gian hết hạn từ ENV (cùng giá trị với JwtService)
    const accessExpCfg = this.configService.get<string>('JWT_ACCESS_TOKEN_EXPIRATION_TIME') ?? '1d';
    const refreshExpCfg = this.configService.get<string>('JWT_REFRESH_TOKEN_EXPIRATION_TIME') ?? '7d';
    const accessMs = this.parseExpirationToMs(accessExpCfg);
    const refreshMs = this.parseExpirationToMs(refreshExpCfg);

    /**
     * Cấu hình cookie chung
     *
     * Lưu ý về SameSite:
     * - DEV localhost: dùng 'lax' để đơn giản, không bắt buộc HTTPS
     * - Cross-origin hoặc PROD: bắt buộc dùng 'none' + secure: true
     *   nếu không browser sẽ KHÔNG lưu/gửi cookie cross-site → JwtAccessTokenGuard luôn nhận user = null
     * 
     * Lưu ý về Domain:
     * - Không set domain để cookie hoạt động với mọi subdomain
     * - Với localhost, không cần set domain (browser tự xử lý)
     * - Với production, có thể cần set domain nếu FE và BE ở khác domain
     */
    let sameSiteOption: 'lax' | 'none' | 'strict' = 'lax';
    let secureOption = false;

    if (needsCrossSiteCookie && hasHttps) {
      // Cross-origin với HTTPS: dùng 'none' + secure
      sameSiteOption = 'none';
      secureOption = true;
    } else if (needsCrossSiteCookie && !hasHttps) {
      // Cross-origin nhưng không có HTTPS: vẫn dùng 'none' nhưng secure: false
      // Browser có thể reject, nhưng thử xem
      sameSiteOption = 'none';
      secureOption = false;
      console.warn('⚠️ [setAuthCookies] Cross-origin cookie without HTTPS - browser may reject');
    } else {
      // Same-origin hoặc localhost: dùng 'lax'
      sameSiteOption = 'lax';
      secureOption = isProduction;
    }

    // Xác định domain dựa trên môi trường
    // Không set domain cho localhost (để hoạt động với mọi port)
    // Set domain cho production nếu cần (ví dụ: .yourdomain.com)
    const cookieDomain = isProduction
      ? process.env.COOKIE_DOMAIN || undefined  // Có thể set trong ENV nếu cần
      : undefined;  // Localhost: không set domain

    const cookieOptions: any = {
      httpOnly: true,          // Không thể truy cập từ JavaScript (bảo mật)
      secure: secureOption,     // Chỉ gửi qua HTTPS khi cần
      sameSite: sameSiteOption,
      path: '/',
    };

    // Chỉ thêm domain nếu được set (undefined = không set domain)
    if (cookieDomain) {
      cookieOptions.domain = cookieDomain;
    }

    const isAdminClient = clientType === 'admin';
    const accessCookieName = isAdminClient ? 'access_token_admin' : 'access_token';
    const refreshCookieName = isAdminClient ? 'refresh_token_admin' : 'refresh_token';

    // Access token
    res.cookie(accessCookieName, accessToken, {
      ...cookieOptions,
      expires: rememberMe ? new Date(Date.now() + accessMs) : undefined,
    });

    // Refresh token
    res.cookie(refreshCookieName, refreshToken, {
      ...cookieOptions,
      expires: rememberMe ? new Date(Date.now() + refreshMs) : undefined,
    });

    // Log cookie config để debug
    console.log('🍪 [setAuthCookies] Cookie config:', {
      origin: origin || 'no origin',
      isLocalhost,
      isCrossOrigin,
      hasHttps,
      sameSite: sameSiteOption,
      secure: secureOption,
      host: req?.headers?.host,
    });

    // Log warning nếu cross-origin không có HTTPS
    if (needsCrossSiteCookie && !hasHttps) {
      console.warn('⚠️ [setAuthCookies] Cross-origin cookie without HTTPS - browser may reject');
    }
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
   * Claim tài khoản guest (đặt mật khẩu cho email đã đặt sân ẩn danh)
   */
  @Post('claim-guest')
  @ApiOperation({ summary: 'Thiết lập mật khẩu cho tài khoản guest (email đã dùng khi đặt sân)' })
  @ApiResponse({
    status: 200,
    description: 'Thiết lập mật khẩu thành công',
  })
  @ApiResponse({
    status: 400,
    description: 'Email chưa tồn tại hoặc đã có tài khoản',
  })
  async claimGuest(@Body() dto: ClaimGuestDto) {
    return this.authService.claimGuestAccount(dto);
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
   * - Thành công: redirect về FRONTEND_URL/auth với trạng thái thành công
   * - Thất bại: redirect về FRONTEND_URL/auth với trạng thái lỗi
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
      return res.redirect(`${frontend}/auth?verified=success`);
    } catch (err) {
      return res.redirect(`${frontend}/auth?verified=failed`);
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
  async login(@Body() loginDto: LoginWithRememberDto, @Req() req: any, @Res() res: Response) {
    const result = await this.authService.login({
      ...loginDto,
      rememberMe: !!loginDto.rememberMe
    });

    // Xác định loại client từ header
    const clientHeader = (req.headers['x-client-type'] as string) || '';
    const clientType: 'admin' | 'web' = clientHeader === 'admin' ? 'admin' : 'web';

    // Set authentication cookies (theo từng loại client)
    this.setAuthCookies(
      res,
      result.accessToken,
      result.refreshToken,
      !!loginDto.rememberMe,
      clientType,
      req,
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
   * Endpoint GET để redirect legacy link hoặc link từ backend về frontend
   */
  @Get('reset-password')
  @ApiOperation({ summary: 'Redirect xác thực reset password (hỗ trợ legacy link)' })
  @ApiQuery({ name: 'token', required: true })
  @ApiQuery({ name: 'email', required: false })
  async resetPasswordRedirect(
    @Query('token') token: string,
    @Query('email') email: string,
    @Res() res: Response
  ) {
    const frontend = process.env.FRONTEND_URL || 'http://localhost:5173';
    const redirectUrl = email
      ? `${frontend}/reset-password?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`
      : `${frontend}/reset-password?token=${encodeURIComponent(token)}`;
    return res.redirect(redirectUrl);
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
    @Req() req: any,
    @Res() res: Response
  ) {
    const result = await this.authService.authenticateWithGoogle(sign_in_token);

    // Xác định loại client từ header
    const clientHeader = (req.headers['x-client-type'] as string) || '';
    const clientType: 'admin' | 'web' = clientHeader === 'admin' ? 'admin' : 'web';

    // Set authentication cookies
    this.setAuthCookies(
      res,
      result.accessToken,
      result.refreshToken,
      !!sign_in_token.rememberMe,
      clientType,
      req,  // Pass req để detect origin
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
    const hasRefreshToken =
      !!req.cookies['refresh_token'] || !!req.cookies['refresh_token_admin'];

    // Xác định loại client:
    // - Ưu tiên header X-Client-Type
    // - Nếu không có, fallback theo cookie đang tồn tại
    const headerClient = (req.headers['x-client-type'] as string) || '';
    let clientType: 'admin' | 'web';
    if (headerClient === 'admin') {
      clientType = 'admin';
    } else if (req.cookies['refresh_token_admin']) {
      clientType = 'admin';
    } else {
      clientType = 'web';
    }

    // Set lại cookies với cùng pattern & đúng loại client
    this.setAuthCookies(res, newAccessToken, newRefreshToken, hasRefreshToken, clientType, req);

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
  async logout(@Req() req: any, @Res() res: Response) {
    // Xác định loại client từ header hoặc cookie
    const headerClient = (req.headers['x-client-type'] as string) || '';
    const isAdminClient =
      headerClient === 'admin' || (!!req.cookies['access_token_admin'] && !req.cookies['access_token']);

    const accessCookieName = isAdminClient ? 'access_token_admin' : 'access_token';
    const refreshCookieName = isAdminClient ? 'refresh_token_admin' : 'refresh_token';

    // Xóa cookies tương ứng với client hiện tại
    res.clearCookie(accessCookieName, { path: '/' });
    res.clearCookie(refreshCookieName, { path: '/' });

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
