import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { Notification, NotificationSchema } from './entities/notification.entity';
import { NotificationListener } from './notifications.listener';
import { NotificationRepository } from './repositories/notification.repository';
import { NOTIFICATION_REPOSITORY } from './interfaces/notifications.interface';
import { NotificationsGateway } from './notifications.gateway';
import { Booking, BookingSchema } from '../bookings/entities/booking.entity';
import { Field, FieldSchema } from '../fields/entities/field.entity';
import { FieldOwnerProfile, FieldOwnerProfileSchema } from '../field-owner/entities/field-owner-profile.entity';
import { User, UserSchema } from '../users/entities/user.entity';
import { EmailModule } from '../email/email.module';
import { BookmarkNotificationService } from './services/bookmark-notification.service';
import { UserRepository } from '../users/repositories/user.repository';
import { USER_REPOSITORY } from '../users/interface/users.interface';

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
    NotificationsGateway,
    BookmarkNotificationService,
    UserRepository,
    {
      provide: NOTIFICATION_REPOSITORY,
      useClass: NotificationRepository,
    },
    {
      provide: USER_REPOSITORY,
      useClass: UserRepository,
    }
  ],
  exports: [NotificationsService, NotificationsGateway]
})
export class NotificationsModule { }
