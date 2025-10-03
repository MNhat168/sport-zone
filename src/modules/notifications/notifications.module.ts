import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { Notification, NotificationSchema } from './entities/notification.entity';
import { NotificationListener } from './notifications.listener';
import { NotificationRepository } from './repositories/notification.repository';
import { NOTIFICATION_REPOSITORY } from './interfaces/notifications.interface';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Notification.name, schema: NotificationSchema }])
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
