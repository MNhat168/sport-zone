import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RolesGuard } from './guards/roles.guard';
import { RateLimitGuard } from './guards/rate-limit.guard';
import { SubscriptionStatusGuard } from './guards/subscription-status.guard';
import { TimezoneService } from './services/timezone.service';
import { GlobalTimezoneInterceptor } from './interceptors/global-timezone.interceptor';
import { User, UserSchema } from '../modules/users/entities/user.entity';

/**
 * Global Common Module
 * Cung cấp các services và interceptors chung cho toàn bộ ứng dụng
 */
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
  ],
  providers: [
    TimezoneService,
    GlobalTimezoneInterceptor,
    RolesGuard,
    RateLimitGuard,
    SubscriptionStatusGuard,
  ],
  exports: [
    TimezoneService,
    GlobalTimezoneInterceptor,
    RolesGuard,
    RateLimitGuard,
    SubscriptionStatusGuard,
  ],
})
export class CommonModule {}