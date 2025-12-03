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
          
          // Debug logging
          if (!req) {
            console.log('🔍 [JwtStrategy] Request object is null');
            return null;
          }
          
          if (!req.cookies) {
            console.log('🔍 [JwtStrategy] req.cookies is undefined/null. Available keys:', Object.keys(req));
            // Try to check if cookies might be in a different location
            if (req.headers && req.headers.cookie) {
              console.log('🔍 [JwtStrategy] Found cookies in headers.cookie:', req.headers.cookie.substring(0, 100));
            }
            return null;
          }
          
          // Ưu tiên chọn cookie theo loại client
          // - Admin FE gửi header: X-Client-Type: admin
          // - FE user gửi header: X-Client-Type: web (hoặc không gửi)
          const clientHeader = (req.headers['x-client-type'] as string) || '';
          const isAdminClient = clientHeader === 'admin';

          console.log('🔍 [JwtStrategy] Extracting token - Client type:', clientHeader || 'web', 'isAdmin:', isAdminClient);
          console.log('🔍 [JwtStrategy] Available cookies:', Object.keys(req.cookies));
          console.log('🔍 [JwtStrategy] Cookie values:', {
            access_token: req.cookies['access_token'] ? 'exists' : 'missing',
            access_token_admin: req.cookies['access_token_admin'] ? 'exists' : 'missing',
          });

          if (isAdminClient) {
            token = req.cookies['access_token_admin'] || req.cookies['access_token'];
          } else {
            token = req.cookies['access_token'] || req.cookies['access_token_admin'];
          }

          if (token) {
            const tokenStr = String(token);
            console.log('✅ [JwtStrategy] Token extracted successfully, length:', tokenStr.length);
          } else {
            console.log('❌ [JwtStrategy] No token found in cookies');
          }

          // Special handling for multipart requests (giữ nguyên behaviour cũ)
          if (req.headers['content-type']?.includes('multipart/form-data') && token) {
            // no-op
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
