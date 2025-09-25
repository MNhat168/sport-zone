import { Controller, Post, Body, BadRequestException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { Inject } from '@nestjs/common';
import { SignInTokenDto } from './dto/sign-in-token.dto';
import { HttpStatus } from '@nestjs/common';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) { }
  // Register a new user
  @Post('register')
  async register(
    @Body()
    body: {
      fullName: string;
      email: string;
      phone: string;
      password: string;
    },
  ) {
    return this.authService.register(body);
  }

  @Post('verify')
  async verify(@Body() body: { email: string; verificationToken: string }) {
    return this.authService.verify(body.email, body.verificationToken);
  }

  //Login with current user
  @Post('login')
  async login(@Body() body: { email: string; password: string }) {
    return this.authService.login(body);
  }

  //Forgot password
  @Post('forgot-password')
  async forgotPassword(@Body() body: { email: string }) {
    return this.authService.forgotPassword(body.email);
  }

  //Reset password
  @Post('reset-password')
  async resetPassword(
    @Body() body: { email: string; resetPasswordToken: string; password: string; confirmPassword: string }
  ) {
    return this.authService.resetPassword(body);
  }

  // //Login with Google OAuth

  @Post('google')
  async authWithGoogle(@Body() sign_in_token: SignInTokenDto) {
    const result = await this.authService.authenticateWithGoogle(sign_in_token);
    return { status: HttpStatus.OK, message: 'Đăng nhập Google thành công', data: result };
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
