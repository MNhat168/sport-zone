import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET') || 'your-secret-key',
      algorithms: ['HS256'], // Use HS256 for symmetric key
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
