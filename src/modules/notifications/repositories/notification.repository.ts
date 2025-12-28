import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, FilterQuery } from 'mongoose';
import { Notification, NotificationDocument } from '../entities/notification.entity';
import { NotificationRepositoryInterface } from '../interfaces/notifications.interface';
import { CreateNotificationDto } from '../dtos/create-notification.dto';

@Injectable()
export class NotificationRepository implements NotificationRepositoryInterface {
    constructor(
        @InjectModel(Notification.name)
        private readonly notificationModel: Model<NotificationDocument>,
    ) { }

    async findAll(): Promise<Notification[]> {
        return this.notificationModel.find().sort({ createdAt: -1 }).exec();
    }

    async findById(id: string): Promise<Notification | null> {
        return this.notificationModel.findById(id).exec();
    }

    async findByCondition(condition: FilterQuery<Notification>): Promise<Notification[]> {
        return this.notificationModel.find(condition).sort({ createdAt: -1 }).exec();
    }

    async create(data: CreateNotificationDto): Promise<Notification> {
        const notification = new this.notificationModel(data);
        return notification.save();
    }

    async update(id: string, data: Partial<Notification>): Promise<Notification | null> {
        return this.notificationModel.findByIdAndUpdate(id, data, { new: true }).exec();
    }

    async updateMany(condition: FilterQuery<Notification>, data: Partial<Notification>): Promise<any> {
        return this.notificationModel.updateMany(condition, data).exec();
    }

    async delete(id: string): Promise<Notification | null> {
        return this.notificationModel.findByIdAndDelete(id).exec();
    }

    async findOneByCondition(condition: FilterQuery<Notification>): Promise<Notification | null> {
        return this.notificationModel.findOne(condition).exec();
    }
}
