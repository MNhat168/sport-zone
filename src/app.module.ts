import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CommonModule } from './common/common.module';
import { GlobalTimezoneInterceptor } from './common/interceptors/global-timezone.interceptor';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { ProfilesModule } from './modules/profiles/profiles.module';
import { FieldsModule } from './modules/fields/fields.module';
import { BookingsModule } from './modules/bookings/bookings.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { TournamentsModule } from './modules/tournaments/tournaments.module';
import { ReviewsModule } from './modules/reviews/reviews.module';
import { AiModule } from './modules/ai/ai.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AdminModule } from './modules/admin/admin.module';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { SchedulesModule } from './modules/schedules/schedules.module';
import { CoachesModule } from './modules/coaches/coaches.module';
import { EventEmitterModule } from '@nestjs/event-emitter';
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true, // ← cho phép dùng ở mọi module
      envFilePath: '.env',
    }),
    MongooseModule.forRoot(
      process.env.MONGODB_URI!
    ),
    EventEmitterModule.forRoot(),
    CommonModule,
    AuthModule,
    UsersModule,
    ProfilesModule,
    FieldsModule,
    BookingsModule,
    PaymentsModule,
    TournamentsModule,
    ReviewsModule,
    AiModule,
    NotificationsModule,
    AdminModule,
    SchedulesModule,
    CoachesModule,
    NotificationsModule,
    MongooseModule.forRoot(process.env.MONGODB_URI!)
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_INTERCEPTOR,
      useClass: GlobalTimezoneInterceptor,
    },
  ],
})
export class AppModule { }
