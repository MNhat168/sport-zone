import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { Notification, NotificationSchema } from './entities/notification.entity';
import { NotificationListener } from './notifications.listener';
import { NotificationRepository } from './repositories/notification.repository';
import { NOTIFICATION_REPOSITORY } from './interfaces/notifications.interface';
import { Booking, BookingSchema } from '../bookings/entities/booking.entity';
import { Field, FieldSchema } from '../fields/entities/field.entity';
import { FieldOwnerProfile, FieldOwnerProfileSchema } from '../fields/entities/field-owner-profile.entity';
import { User, UserSchema } from '../users/entities/user.entity';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Notification.name, schema: NotificationSchema },
      { name: Booking.name, schema: BookingSchema },
      { name: Field.name, schema: FieldSchema },
      { name: FieldOwnerProfile.name, schema: FieldOwnerProfileSchema },
      { name: User.name, schema: UserSchema },
    ]),
    EmailModule,
  ],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationListener,
    NotificationRepository,
    {
      provide: NOTIFICATION_REPOSITORY,
      useClass: NotificationRepository,
    }
  ],
  exports: [NotificationsService]
})
export class NotificationsModule { }
