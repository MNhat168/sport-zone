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
import { ChatStatus } from '@common/enums/chat.enum';

@ApiTags('Chat')
@Controller('chat')
@ApiBearerAuth()
export class ChatController {
  constructor(private readonly chatService: ChatService) { }

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
  @Get('field-owner/rooms')
  @ApiOperation({ summary: 'Get chat rooms for field owner' })
  async getFieldOwnerChatRooms(@Request() req) {
    return this.chatService.getChatRoomsForFieldOwner(req.user.userId);
  }

  @UseGuards(JwtAccessTokenGuard)
  @Get('coach/rooms')
  @ApiOperation({ summary: 'Get chat rooms for coach' })
  async getCoachChatRooms(@Request() req) {
    return this.chatService.getChatRoomsForCoach(req.user.userId);
  }

  @UseGuards(JwtAccessTokenGuard)
  @Post('coach/start')
  @ApiOperation({ summary: 'Start or get existing chat room with coach' })
  async startCoachChat(
    @Request() req,
    @Body() body: { coachId: string; fieldId?: string },
  ) {
    return this.chatService.createOrGetCoachChatRoom(
      req.user.userId,
      body.coachId,
      body.fieldId,
    );
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

  @UseGuards(JwtAccessTokenGuard)
  @Get('matching/unread-count')
  @ApiOperation({ summary: 'Get unread message count for matching chats' })
  async getMatchingUnreadCount(@Request() req) {
    const count = await this.chatService.getMatchingUnreadCount(req.user.userId);
    return { count };
  }

  @UseGuards(JwtAccessTokenGuard)
  @Get('matching/unread-per-match')
  @ApiOperation({ summary: 'Get unread count per match' })
  async getUnreadPerMatch(@Request() req) {
    const unreadMap = await this.chatService.getUnreadCountPerMatch(req.user.userId);
    return { unreadCounts: Object.fromEntries(unreadMap) };
  }
}