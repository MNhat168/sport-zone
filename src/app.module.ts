import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ProfilesModule } from './profiles/profiles.module';
import { FieldsModule } from './fields/fields.module';
import { BookingsModule } from './bookings/bookings.module';
import { PaymentsModule } from './payments/payments.module';
import { TournamentsModule } from './tournaments/tournaments.module';
import { ReviewsModule } from './reviews/reviews.module';
import { AiModule } from './ai/ai.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AdminModule } from './admin/admin.module';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
@Module({
  imports: [
    ConfigModule.forRoot(),
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
    MongooseModule.forRoot(process.env.MONGODB_URI || 'mongodb+srv://nhatnmde180:helloworld@cluster0.zufvinh.mongodb.net/SportZone?retryWrites=true&w=majority')
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
