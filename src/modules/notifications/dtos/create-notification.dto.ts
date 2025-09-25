import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { Types } from 'mongoose';
import { NotificationType } from '../entities/notification.entity';

export class CreateNotificationDto {
    @IsNotEmpty()
    recipient: Types.ObjectId;

    @IsEnum(NotificationType)
    type: NotificationType;

    @IsString()
    @IsNotEmpty()
    title: string;

    @IsString()
    @IsNotEmpty()
    message: string;

    @IsOptional()
    metadata?: Record<string, any>;
}
