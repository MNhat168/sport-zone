import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { CreateNotificationDto } from './dtos/create-notification.dto';
import { Notification } from './entities/notification.entity';
import { NotificationRepositoryInterface, NOTIFICATION_REPOSITORY } from './interfaces/notifications.interface';
import { NotificationType } from 'src/common/enums/notification-type.enum';
import { NotificationsGateway } from './notifications.gateway';

@Injectable()
export class NotificationsService {
  constructor(
    @Inject(NOTIFICATION_REPOSITORY)
    private readonly notificationRepository: NotificationRepositoryInterface,
    private readonly notificationsGateway: NotificationsGateway,
  ) { }

  async create(dto: CreateNotificationDto): Promise<Notification> {
    const notification = await this.notificationRepository.create(dto);

    try {
      // Emit realtime notification to user if connected
      const recipientId =
        typeof notification.recipient === 'string'
          ? notification.recipient
          : (notification.recipient as any)?.toString?.() ?? '';

      if (recipientId) {
        this.notificationsGateway.emitToUser(recipientId, {
          id: (notification as any)._id?.toString?.() ?? undefined,
          title: notification.title,
          message: notification.message,
          type: notification.type,
          isRead: notification.isRead,
          createdAt: notification['createdAt'],
          metadata: notification['metadata'] ?? undefined,
        });
      }
    } catch {
      // Avoid breaking main flow if websocket fails
    }

    return notification;
  }

  async getUserNotifications(userId: string): Promise<Notification[]> {
    const notifications = await this.notificationRepository.findByCondition({
      recipient: new Types.ObjectId(userId)
    });
    // Sorted by createdAt descending in repository
    return notifications;
  }

  async getUnreadCount(userId: string): Promise<number> {
    const notifications = await this.notificationRepository.findByCondition({
      recipient: new Types.ObjectId(userId),
      isRead: false
    });
    return notifications.length;
  }

  async markAllAsRead(userId: string): Promise<void> {
    await this.notificationRepository.updateMany(
      { recipient: new Types.ObjectId(userId), isRead: false },
      { isRead: true }
    );
  }

  async markAsRead(notificationId: string): Promise<Notification> {
    const notification = await this.notificationRepository.update(
      notificationId,
      { isRead: true }
    );

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    return notification;
  }

  async findById(id: string): Promise<Notification> {
    const notification = await this.notificationRepository.findById(id);
    if (!notification) {
      throw new NotFoundException('Notification not found');
    }
    return notification;
  }

  async findOne(condition: any): Promise<Notification | null> {
    return this.notificationRepository.findOneByCondition(condition);
  }
}
