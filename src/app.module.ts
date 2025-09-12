import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
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
import { SchedulesModule } from './modules/bookings/schedules.module';
import { CoachesModule } from './modules/coaches/coaches.module';
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true, // ← cho phép dùng ở mọi module
    }),
    MongooseModule.forRoot(
      process.env.MONGODB_URI!
    ),
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
    MongooseModule.forRoot(process.env.MONGODB_URI!)
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
