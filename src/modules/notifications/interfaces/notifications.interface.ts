import { FilterQuery } from 'mongoose';
import { Notification } from '../entities/notification.entity';
import { CreateNotificationDto } from '../dtos/create-notification.dto';

export const NOTIFICATION_REPOSITORY = 'NOTIFICATION_REPOSITORY';

export interface NotificationRepositoryInterface {
    findAll(): Promise<Notification[]>;
    findById(id: string): Promise<Notification | null>;
    findByCondition(condition: FilterQuery<Notification>): Promise<Notification[]>;
    create(data: CreateNotificationDto): Promise<Notification>;
    createMany(dataArray: CreateNotificationDto[]): Promise<Notification[]>;
    update(id: string, data: Partial<Notification>): Promise<Notification | null>;
    updateMany(condition: FilterQuery<Notification>, data: Partial<Notification>): Promise<any>;
    delete(id: string): Promise<Notification | null>;
    findOneByCondition(condition: FilterQuery<Notification>): Promise<Notification | null>;
}
