import { Injectable, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtRefreshTokenGuard extends AuthGuard('refresh_token') {
  handleRequest(err: any, user: any, info: any, context: ExecutionContext) {
    if (err || !user) {
      console.error('JWT Refresh Guard failed:', err || 'No user found');
      
      // Check if token is expired
      if (info && info.name === 'TokenExpiredError') {
        throw new UnauthorizedException({
          message: 'Refresh token đã hết hạn',
          error: 'REFRESH_TOKEN_EXPIRED',
          expiredAt: info.expiredAt
        });
      }
      
      // Check if token is invalid
      if (info && info.name === 'JsonWebTokenError') {
        throw new UnauthorizedException({
          message: 'Refresh token không hợp lệ',
          error: 'INVALID_REFRESH_TOKEN'
        });
      }
      
      // Generic authentication error
      throw new UnauthorizedException({
        message: 'Xác thực refresh token thất bại',
        error: 'REFRESH_AUTHENTICATION_FAILED'
      });
    }
    
    return user;
  }
}
