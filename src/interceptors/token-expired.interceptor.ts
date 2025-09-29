import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  UnauthorizedException,
} from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';

@Injectable()
export class TokenExpiredInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      catchError((error) => {
        if (error instanceof UnauthorizedException && error.getResponse) {
          const response = error.getResponse() as any;
          
          // Check if it's a token expired error
          if (response.error === 'TOKEN_EXPIRED') {
            return throwError(() => new UnauthorizedException({
              message: 'Access token đã hết hạn. Vui lòng sử dụng refresh token để gia hạn.',
              error: 'TOKEN_EXPIRED',
              statusCode: 401,
              expiredAt: response.expiredAt,
              suggestion: 'Use /auth/refresh endpoint with refresh_token to get new access_token'
            }));
          }
        }
        
        return throwError(() => error);
      }),
    );
  }
}