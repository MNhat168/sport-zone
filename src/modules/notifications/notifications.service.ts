import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { CreateNotificationDto } from './dtos/create-notification.dto';
import { Notification } from './entities/notification.entity';
import { NotificationRepositoryInterface, NOTIFICATION_REPOSITORY } from './interfaces/notifications.interface';
import { NotificationType } from 'src/common/enums/notification-type.enum';

@Injectable()
export class NotificationsService {
    constructor(
        @Inject(NOTIFICATION_REPOSITORY)
        private readonly notificationRepository: NotificationRepositoryInterface,
    ) {}

    async create(dto: CreateNotificationDto): Promise<Notification> {
        return this.notificationRepository.create(dto);
    }

    async getUserNotifications(userId: string): Promise<Notification[]> {
        const notifications = await this.notificationRepository.findByCondition({
            recipient: new Types.ObjectId(userId)
        });
        // Sort by createdAt descending, handle undefined
        return notifications.sort((a, b) => {
            const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            return bTime - aTime;
        });
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
}
