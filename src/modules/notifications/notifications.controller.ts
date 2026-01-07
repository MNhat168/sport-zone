import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards, Request, ForbiddenException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
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
    getUserNotifications(
        @Param('userId') userId: string,
        @Query('type') type?: 'all' | 'admin' | 'non-admin',
    ) {
        return this.notificationsService.getUserNotifications(
            userId,
            type ?? 'all',
        );
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
    @UseGuards(AuthGuard('jwt'))
    async markAsRead(
        @Param('id') id: string,
        @Request() req: any,
    ) {
        const userId = req.user?.userId || req.user?._id || req.user?.id;
        if (!userId) {
            throw new ForbiddenException('User ID not found in request');
        }
        return this.notificationsService.markAsRead(id, userId);
    }
}
