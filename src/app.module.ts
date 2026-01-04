
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
import { ScheduleModule } from '@nestjs/schedule';
import { Logger } from '@nestjs/common';

import { ChatModule } from '@modules/chat/chat.module';
import { CourtsModule } from './modules/courts/courts.module';
import { BillingModule } from './modules/billing/billing.module';
@Module({
  imports: [

    ConfigModule.forRoot({
      isGlobal: true, // ← cho phép dùng ở mọi module
      // Dùng .env.prod khi NODE_ENV=production, fallback về .env
      envFilePath: process.env.NODE_ENV === 'production' ? '.env.prod' : '.env',
      load: [envConfig], // Load custom config
    }),
    MongooseModule.forRoot(process.env.MONGODB_URI!, {
      // Connection pool settings - quan trọng cho production (AWS Lightsail)
      maxPoolSize: 10, // Số lượng connection tối đa trong pool
      minPoolSize: 2, // Số lượng connection tối thiểu để giữ sẵn
      socketTimeoutMS: 45000, // Timeout cho socket operations (45s)
      connectTimeoutMS: 30000, // Timeout khi kết nối ban đầu (30s)
      serverSelectionTimeoutMS: 30000, // Timeout khi chọn server (30s)
      heartbeatFrequencyMS: 10000, // Kiểm tra kết nối mỗi 10s
      maxIdleTimeMS: 30000, // Đóng connection idle sau 30s

      // Retry settings
      retryWrites: true,
      retryReads: true,



      connectionFactory: (connection) => {
        const logger = new Logger('MongoDB');

        // Event handlers để xử lý connection errors và reconnection
        connection.on('connected', () => {
          logger.log('✅ MongoDB connected successfully');
        });

        connection.on('error', (error) => {
          logger.error('❌ MongoDB connection error:', error);
        });

        connection.on('disconnected', () => {
          logger.warn('⚠️ MongoDB disconnected. Attempting to reconnect...');
        });

        connection.on('reconnected', () => {
          logger.log('✅ MongoDB reconnected successfully');
        });

        connection.on('close', () => {
          logger.warn('⚠️ MongoDB connection closed');
        });

        // Plugin để format JSON output
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
    EventEmitterModule.forRoot({ global: true }),
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
