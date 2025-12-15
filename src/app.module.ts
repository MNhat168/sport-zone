import { LessonTypesModule } from './modules/lessontypes/lesson-types.module';
import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CommonModule } from './common/common.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { ProfilesModule } from './modules/profiles/profiles.module';
import { FieldsModule } from './modules/fields/fields.module';
import { FieldOwnerModule } from './modules/field-owner/field-owner.module';
import { BookingsModule } from './modules/bookings/bookings.module';
import { TransactionsModule } from './modules/transactions/transactions.module';
import { TournamentModule } from './modules/tournaments/tournaments.module';
import { ReviewsModule } from './modules/reviews/reviews.module';
import { AiModule } from './modules/ai/ai.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AdminModule } from './modules/admin/admin.module';
import { ReportsModule } from './modules/reports/reports.module';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { SchedulesModule } from './modules/schedules/schedules.module';
import { CoachesModule } from './modules/coaches/coaches.module';
import { AmenitiesModule } from './modules/amenities/amenities.module';
import { EventEmitterModule } from '@nestjs/event-emitter';
import envConfig from './config/env.config';

import { ChatModule } from '@modules/chat/chat.module';
import { CourtsModule } from './modules/courts/courts.module';
import { BillingModule } from './modules/billing/billing.module';
@Module({
  imports: [
    LessonTypesModule,
    ConfigModule.forRoot({
      isGlobal: true, // ← cho phép dùng ở mọi module
      // Dùng .env.prod khi NODE_ENV=production, fallback về .env
      envFilePath: process.env.NODE_ENV === 'production' ? '.env.prod' : '.env',
      load: [envConfig], // Load custom config
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
    FieldOwnerModule,
    BookingsModule,
    TransactionsModule,
    TournamentModule,
    ReviewsModule,
    AiModule,
    NotificationsModule,
    AdminModule,
    ReportsModule,
    SchedulesModule,
    CoachesModule,
    AmenitiesModule,
    NotificationsModule,
    ChatModule,
    CourtsModule,
    BillingModule
  ],
  controllers: [AppController],
  providers: [
    AppService,
  ],
})
export class AppModule { }
