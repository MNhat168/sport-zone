import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        // Từ cookie - improved for multipart requests
        (req) => {
          let token = null;
          if (req && req.cookies) {
            token = req.cookies['access_token'];
            console.log('JWT Strategy - Cookie token:', token ? 'Found' : 'Not found');
            console.log('JWT Strategy - Available cookies:', Object.keys(req.cookies || {}));
            console.log('JWT Strategy - Content-Type:', req.headers['content-type']);
            
            // Special handling for multipart requests
            if (req.headers['content-type']?.includes('multipart/form-data') && token) {
              console.log('JWT Strategy - Multipart request with cookie token detected');
            }
          }
          return token;
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
      _id: payload.userId,      // ✅ Thêm _id để tương thích
      id: payload.userId,        // ✅ Thêm id để tương thích
      userId: payload.userId,    // ✅ Giữ userId
      email: payload.email, 
      role: payload.role 
    };
  }
}
