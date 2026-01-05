import { Injectable, Inject, NotFoundException, Logger } from '@nestjs/common';
import { Types } from 'mongoose';
import { CreateNotificationDto } from './dtos/create-notification.dto';
import { Notification } from './entities/notification.entity';
import { NotificationRepositoryInterface, NOTIFICATION_REPOSITORY } from './interfaces/notifications.interface';
import { NotificationType } from 'src/common/enums/notification-type.enum';
import { NotificationsGateway } from './notifications.gateway';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

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

  /**
   * Create multiple notifications in batch with bulk insert
   * @param dtos - Array of notification DTOs
   */
  async createBatch(dtos: CreateNotificationDto[]): Promise<void> {
    if (dtos.length === 0) return;

    try {
      const notifications = await this.notificationRepository.createMany(dtos);

      // Emit real-time notifications for each recipient
      for (const notification of notifications) {
        try {
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
        } catch (error) {
          // Silent fail for individual WebSocket emissions
          this.logger.warn(`Failed to emit notification to user: ${error?.message}`);
        }
      }
    } catch (error) {
      this.logger.error('Error creating batch notifications', error);
      // Don't throw - notifications are non-critical
    }
  }

  async getUserNotifications(
    userId: string,
    type: 'all' | 'admin' | 'non-admin' = 'all',
  ): Promise<Notification[]> {
    const condition: any = {
      recipient: new Types.ObjectId(userId),
    };

    switch (type) {
      case 'admin':
        condition.type = NotificationType.ADMIN_NOTIFICATION;
        break;

      case 'non-admin':
        condition.type = { $ne: NotificationType.ADMIN_NOTIFICATION };
        break;

      case 'all':
      default:
        // no extra condition
        break;
    }

    return this.notificationRepository.findByCondition(condition);
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
