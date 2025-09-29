import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class AuthLoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger(AuthLoggerMiddleware.name);

  use(req: Request, res: Response, next: NextFunction) {
    const { method, originalUrl, headers } = req;
    const userAgent = headers['user-agent'] || '';
    const authorization = headers.authorization ? 'Present' : 'Missing';
    
    // Only log for auth-related endpoints
    if (originalUrl.includes('/auth') || originalUrl.includes('/users/get-profile')) {
      this.logger.log(`${method} ${originalUrl} - Auth Header: ${authorization} - User-Agent: ${userAgent}`);
      
      if (headers.authorization) {
        const token = headers.authorization.replace('Bearer ', '');
        // Don't log the full token, just the first and last few characters for security
        const tokenPreview = `${token.substring(0, 10)}...${token.substring(token.length - 10)}`;
        this.logger.log(`Token Preview: ${tokenPreview}`);
      }
    }

    next();
  }
}