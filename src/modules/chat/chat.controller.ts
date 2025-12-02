import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  Patch,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ChatService } from './chat.service';
import { JwtAccessTokenGuard } from '../auth/guards/jwt-access-token.guard';
import { ChatStatus } from './entities/chat.entity';

@ApiTags('Chat')
@Controller('chat')
@ApiBearerAuth()
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @UseGuards(JwtAccessTokenGuard)
  @Post('start')
  @ApiOperation({ summary: 'Start or get existing chat room' })
  async startChat(
    @Request() req,
    @Body() body: { fieldOwnerId: string; fieldId?: string; bookingId?: string },
  ) {
    return this.chatService.createOrGetChatRoom(
      req.user.userId,
      body.fieldOwnerId,
      body.fieldId,
      body.bookingId,
    );
  }

  @UseGuards(JwtAccessTokenGuard)
  @Get('rooms')
  @ApiOperation({ summary: 'Get all chat rooms for user' })
  async getChatRooms(@Request() req) {
    return this.chatService.getChatRoomsForUser(req.user.userId);
  }

  @UseGuards(JwtAccessTokenGuard)
  @Get('room/:id')
  @ApiOperation({ summary: 'Get chat room messages' })
  async getChatRoom(@Request() req, @Param('id') id: string) {
    return this.chatService.getChatRoomMessages(id, req.user.userId);
  }

  @UseGuards(JwtAccessTokenGuard)
  @Get('unread-count')
  @ApiOperation({ summary: 'Get unread message count' })
  async getUnreadCount(@Request() req) {
    const count = await this.chatService.getUnreadCount(req.user.userId);
    return { count };
  }

  @UseGuards(JwtAccessTokenGuard)
  @Patch('room/:id/read')
  @ApiOperation({ summary: 'Mark messages as read' })
  async markAsRead(@Request() req, @Param('id') id: string) {
    await this.chatService.markMessagesAsRead(id, req.user.userId);
    return { success: true };
  }

  @UseGuards(JwtAccessTokenGuard)
  @Patch('room/:id/status')
  @ApiOperation({ summary: 'Update chat status' })
  async updateStatus(
    @Request() req,
    @Param('id') id: string,
    @Body() body: { status: ChatStatus },
  ) {
    await this.chatService.updateChatStatus(id, req.user.userId, body.status);
    return { success: true };
  }
}