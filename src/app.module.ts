import { LessonTypesModule } from './modules/lessontypes/lesson-types.module';
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
import { TransactionsModule } from './modules/transactions/transactions.module';
import { TournamentModule } from './modules/tournaments/tournaments.module';
import { ReviewsModule } from './modules/reviews/reviews.module';
import { AiModule } from './modules/ai/ai.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AdminModule } from './modules/admin/admin.module';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { SchedulesModule } from './modules/schedules/schedules.module';
import { CoachesModule } from './modules/coaches/coaches.module';
import { AmenitiesModule } from './modules/amenities/amenities.module';
import { EventEmitterModule } from '@nestjs/event-emitter';
@Module({
  imports: [
        LessonTypesModule, 
    ConfigModule.forRoot({
      isGlobal: true, // ← cho phép dùng ở mọi module
      envFilePath: '.env',
    }),
    MongooseModule.forRoot(process.env.MONGODB_URI!, {
      connectionFactory: (connection) => {
        connection.plugin((schema: any) => {
          schema.set('toJSON', {
            virtuals: true,
            versionKey: false,
            transform: (_doc: any, ret: any) => {
              if (ret && ret._id && typeof ret._id !== 'string') ret._id = ret._id.toString();
              return ret;
            },
          });
        });
        return connection;
      },
    }),
    EventEmitterModule.forRoot(),
    CommonModule,
    AuthModule,
    UsersModule,
    ProfilesModule,
    FieldsModule,
    BookingsModule,
    TransactionsModule,
    TournamentModule,
    ReviewsModule,
    AiModule,
    NotificationsModule,
    AdminModule,
    SchedulesModule,
    CoachesModule,
    AmenitiesModule,
    NotificationsModule,
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
