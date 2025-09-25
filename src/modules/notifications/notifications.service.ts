import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CreateNotificationDto } from './dtos/create-notification.dto';
import { Notification } from './entities/notification.entity';

@Injectable()
export class NotificationsService {
    constructor(
        @InjectModel(Notification.name) private notificationModel: Model<Notification>
    ) { }

    async create(dto: CreateNotificationDto): Promise<Notification> {
        const notification = new this.notificationModel(dto);
        return notification.save();
    }

    async getUserNotifications(userId: string): Promise<Notification[]> {
        return this.notificationModel
            .find({ recipient: new Types.ObjectId(userId) })
            .sort({ createdAt: -1 })
            .exec();
    }

    async markAsRead(notificationId: string): Promise<Notification | null> {
        return this.notificationModel.findByIdAndUpdate(
            notificationId,
            { isRead: true },
            { new: true }
        );
    }
}
