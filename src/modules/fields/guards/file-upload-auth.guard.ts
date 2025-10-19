import { Injectable, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Observable } from 'rxjs';

/**
 * Custom guard để xử lý authentication cho file upload
 * Đảm bảo cookie được parse trước khi xử lý files
 */
@Injectable()
export class FileUploadAuthGuard extends AuthGuard('jwt') {
  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    const request = context.switchToHttp().getRequest();
    
    // Đảm bảo cookies được parse
    if (request.cookies && request.cookies.access_token) {
      console.log('FileUploadAuthGuard - Access token found in cookies');
    }
    
    // Log để debug multipart requests
    console.log('FileUploadAuthGuard - Content-Type:', request.headers['content-type']);
    console.log('FileUploadAuthGuard - Cookies available:', Object.keys(request.cookies || {}));
    
    return super.canActivate(context);
  }

  handleRequest(err: any, user: any, info: any, context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    
    console.log('FileUploadAuthGuard handleRequest - Error:', err);
    console.log('FileUploadAuthGuard handleRequest - User:', user ? { userId: user.userId || user.id || user._id } : null);
    console.log('FileUploadAuthGuard handleRequest - Info:', info);
    
    if (err || !user) {
      console.error('FileUploadAuthGuard - Authentication failed:', err || 'No user found');
      
      // Kiểm tra nếu là lỗi do multipart parsing
      if (request.headers['content-type']?.includes('multipart/form-data')) {
        console.error('FileUploadAuthGuard - Multipart form detected, auth failed');
      }
      
      throw new UnauthorizedException({
        message: 'Authentication failed for file upload',
        error: 'FILE_UPLOAD_AUTH_FAILED',
        statusCode: 401
      });
    }
    
    return user;
  }
}