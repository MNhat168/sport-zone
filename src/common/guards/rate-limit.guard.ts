import { Injectable, CanActivate, ExecutionContext, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

/**
 * Rate limit configuration decorator
 * @example @RateLimit({ ttl: 60, limit: 10 }) // 10 requests per 60 seconds
 */
export const RateLimit = Reflector.createDecorator<{ ttl: number; limit: number }>();

/**
 * In-memory rate limiter (without Redis)
 * ⚠️ Note: This is per-instance only. For multi-instance deployments, use Redis-based solution.
 * ✅ Good for: Single instance deployments, development, small scale applications
 * ❌ Limitation: Doesn't work across multiple server instances
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);
  
  // In-memory storage: Map<key, { count: number, resetAt: number }>
  private readonly store = new Map<string, { count: number; resetAt: number }>();
  
  // Cleanup interval to prevent memory leaks
  private cleanupInterval: NodeJS.Timeout;

  constructor(private readonly reflector: Reflector) {
    // Cleanup expired entries every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 5 * 60 * 1000);
  }

  /**
   * Cleanup expired entries from memory
   */
  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [key, value] of this.store.entries()) {
      if (value.resetAt < now) {
        this.store.delete(key);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      this.logger.debug(`Cleaned up ${cleaned} expired rate limit entries`);
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const config = this.reflector.get(RateLimit, context.getHandler());
    
    // No rate limit configured for this route
    if (!config) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    
    // Generate unique key per user/IP per endpoint
    const userId = request.user?.userId || request.user?.id;
    const endpoint = request.route?.path || request.url;
    const identifier = userId || request.ip || 'anonymous';
    
    const key = `${endpoint}:${identifier}`;
    const now = Date.now();
    
    // Get or create entry
    let entry = this.store.get(key);
    
    // If no entry or expired, create new one
    if (!entry || entry.resetAt < now) {
      entry = {
        count: 0,
        resetAt: now + config.ttl * 1000
      };
      this.store.set(key, entry);
    }
    
    // Increment counter
    entry.count++;
    
    // Calculate remaining and reset time
    const remaining = Math.max(0, config.limit - entry.count);
    const resetIn = Math.ceil((entry.resetAt - now) / 1000);
    
    // Add rate limit headers
    response.header('X-RateLimit-Limit', config.limit.toString());
    response.header('X-RateLimit-Remaining', remaining.toString());
    response.header('X-RateLimit-Reset', resetIn.toString());
    
    // Check if limit exceeded
    if (entry.count > config.limit) {
      this.logger.warn(`Rate limit exceeded for ${identifier} on ${endpoint}`);
      
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: `Rate limit exceeded. Try again in ${resetIn} seconds.`,
          retryAfter: resetIn
        },
        HttpStatus.TOO_MANY_REQUESTS
      );
    }
    
    return true;
  }

  /**
   * Clear all rate limit data (useful for testing)
   */
  clear(): void {
    this.store.clear();
  }

  /**
   * Cleanup on module destroy
   */
  onModuleDestroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.store.clear();
  }
}
