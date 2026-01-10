import { Injectable, CanActivate, ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';

@Injectable()
export class CheckInRateLimitGuard implements CanActivate {
    private readonly cache = new Map<string, number>();
    private readonly RATE_LIMIT_SECONDS = 30;

    canActivate(context: ExecutionContext): boolean {
        const request = context.switchToHttp().getRequest();
        const userId = request.user?.userId || request.user?.id || request.user?._id;
        const bookingId = request.params?.id;

        if (!userId || !bookingId) {
            return true; // Skip rate limiting if we can't identify the user/booking
        }

        const key = `${userId}:${bookingId}`;
        const lastRequest = this.cache.get(key);
        const now = Date.now();

        // Check if user has requested within the rate limit window
        if (lastRequest && now - lastRequest < this.RATE_LIMIT_SECONDS * 1000) {
            const secondsRemaining = Math.ceil(
                (this.RATE_LIMIT_SECONDS * 1000 - (now - lastRequest)) / 1000,
            );
            throw new HttpException(
                {
                    message: `Vui lòng đợi ${secondsRemaining} giây trước khi tạo mã mới`,
                    retryAfter: secondsRemaining,
                },
                HttpStatus.TOO_MANY_REQUESTS,
            );
        }

        // Update the cache with current timestamp
        this.cache.set(key, now);

        // Clean up old entries (older than 5 minutes)
        this.cleanupCache();

        return true;
    }

    private cleanupCache(): void {
        const now = Date.now();
        const FIVE_MINUTES = 5 * 60 * 1000;

        for (const [key, timestamp] of this.cache.entries()) {
            if (now - timestamp > FIVE_MINUTES) {
                this.cache.delete(key);
            }
        }
    }
}
