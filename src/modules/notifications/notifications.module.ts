import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { Notification, NotificationSchema } from './entities/notification.entity';
import { NotificationListener } from './notifications.listener';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Notification.name, schema: NotificationSchema }])
  ],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationListener
  ],
  exports: [NotificationsService]
})
export class NotificationsModule { }
