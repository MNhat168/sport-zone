import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        // Từ cookie
        (req) => {
          if (!req?.cookies) {
            return null;
          }

          // Ưu tiên chọn cookie theo loại client
          // - Admin FE gửi header: X-Client-Type: admin
          // - FE user gửi header: X-Client-Type: web (hoặc không gửi)
          const clientHeader = (req.headers['x-client-type'] as string) || '';
          const isAdminClient = clientHeader === 'admin';

          const token = isAdminClient
            ? req.cookies['access_token_admin'] || req.cookies['access_token']
            : req.cookies['access_token'] || req.cookies['access_token_admin'];

          return token || null;
        },
        // Từ Authorization header (fallback cho Postman)
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      secretOrKey: configService.get<string>('JWT_SECRET'),
      ignoreExpiration: false,
      passReqToCallback: false, // Ensure req is not passed to validate method
    });
  }

  async validate(payload: any) {
    return {
      userId: payload.userId,    // ✅ Strict standard
      email: payload.email,
      role: payload.role
    };
  }
}
