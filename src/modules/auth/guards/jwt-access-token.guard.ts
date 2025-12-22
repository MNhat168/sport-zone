import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { Observable } from 'rxjs';
import { IS_PUBLIC_KEY } from 'src/decorators/auth.decorator';

@Injectable()
export class JwtAccessTokenGuard extends AuthGuard('jwt') {
	constructor(private reflector: Reflector) {
		super();
	}

	canActivate(
		context: ExecutionContext,
	): boolean | Promise<boolean> | Observable<boolean> {
		const req = context.switchToHttp().getRequest();
		const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
			context.getHandler(),
			context.getClass(),
		]);

		if (isPublic) {
			return true;
		}

		// Debug: Log request info để kiểm tra cookie
		console.log('🔍 [JwtAccessTokenGuard] Request:', {
			path: req.path,
			origin: req.headers?.origin || 'no origin',
			host: req.headers?.host,
			hasCookies: !!req.cookies && Object.keys(req.cookies).length > 0,
			cookieHeader: req.headers?.cookie ? 'exists' : 'missing',
		});

		return super.canActivate(context);
	}

	handleRequest(err: any, user: any, info: any, context: ExecutionContext) {
		if (err || !user) {
			// Check if token is expired
			if (info && info.name === 'TokenExpiredError') {
				throw new UnauthorizedException({
					message: 'Access token đã hết hạn. Vui lòng đăng nhập lại.',
					error: 'TOKEN_EXPIRED',
					expiredAt: info.expiredAt,
					statusCode: 401
				});
			}

			// Check if token is invalid
			if (info && info.name === 'JsonWebTokenError') {
				throw new UnauthorizedException({
					message: 'Token không hợp lệ. Vui lòng đăng nhập lại.',
					error: 'INVALID_TOKEN',
					statusCode: 401
				});
			}

			// Check if no token provided
			if (info && info.message === 'No auth token') {
				throw new UnauthorizedException({
					message: 'Token xác thực không được cung cấp.',
					error: 'NO_TOKEN_PROVIDED',
					statusCode: 401
				});
			}

			// Generic authentication error
			throw new UnauthorizedException({
				message: 'Xác thực thất bại. Vui lòng đăng nhập lại.',
				error: 'AUTHENTICATION_FAILED',
				statusCode: 401
			});
		}

		return user;
	}
}