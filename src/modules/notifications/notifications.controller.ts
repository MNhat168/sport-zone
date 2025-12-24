import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { CreateNotificationDto } from './dtos/create-notification.dto';

@Controller('notifications')
export class NotificationsController {
    constructor(private readonly notificationsService: NotificationsService) { }

    @Post()
    create(@Body() dto: CreateNotificationDto) {
        return this.notificationsService.create(dto);
    }

    @Get('user/:userId')
    getUserNotifications(@Param('userId') userId: string) {
        return this.notificationsService.getUserNotifications(userId);
    }

    @Get('user/:userId/unread-count')
    getUnreadCount(@Param('userId') userId: string) {
        return this.notificationsService.getUnreadCount(userId);
    }

    @Patch('user/:userId/read-all')
    markAllAsRead(@Param('userId') userId: string) {
        return this.notificationsService.markAllAsRead(userId);
    }

    @Patch(':id/read')
    markAsRead(@Param('id') id: string) {
        return this.notificationsService.markAsRead(id);
    }
}
