import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class JwtRefreshTokenGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const headerClient = (request.headers['x-client-type'] as string) || '';
    const isAdminClient = headerClient === 'admin';

    const cookieName = isAdminClient ? 'refresh_token_admin' : 'refresh_token';
    const refreshToken =
      request.cookies[cookieName] ||
      // Fallback: nếu header không chuẩn, thử cả hai cookie
      request.cookies['refresh_token_admin'] ||
      request.cookies['refresh_token'];

    if (!refreshToken) throw new UnauthorizedException('No refresh token');

    try {
      const payload = await this.jwtService.verifyAsync(refreshToken);
      request.user = payload;
      return true;
    } catch (err) {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }
}
