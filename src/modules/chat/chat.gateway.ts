import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { ChatService } from './chat.service';
import { JwtService } from '@nestjs/jwt';
import { UseGuards } from '@nestjs/common';
import { WsJwtGuard } from '@common/guards/ws-jwt.guard';

@WebSocketGateway({
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  },
  namespace: '/chat',
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private userSocketMap = new Map<string, string>(); // userId -> socketId
  private socketUserMap = new Map<string, string>(); // socketId -> userId

  constructor(
    private readonly chatService: ChatService,
    private readonly jwtService: JwtService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth.token || 
                   client.handshake.headers.authorization?.split(' ')[1];
      
      if (!token) {
        client.disconnect();
        return;
      }

      const payload = this.jwtService.verify(token);
      const userId = payload.userId || payload.sub;

      if (!userId) {
        client.disconnect();
        return;
      }

      // Store socket mappings
      this.userSocketMap.set(userId, client.id);
      this.socketUserMap.set(client.id, userId);

      // Join user to their personal room
      client.join(`user:${userId}`);

      console.log(`User ${userId} connected to chat`);
    } catch (error) {
      console.error('WebSocket connection error:', error);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    const userId = this.socketUserMap.get(client.id);
    if (userId) {
      this.userSocketMap.delete(userId);
      this.socketUserMap.delete(client.id);
      console.log(`User ${userId} disconnected from chat`);
    }
  }

  @SubscribeMessage('join_chat')
  async handleJoinChat(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { chatRoomId: string },
  ) {
    const userId = this.socketUserMap.get(client.id);
    if (!userId) return;

    client.join(`chat:${data.chatRoomId}`);
    console.log(`User ${userId} joined chat room ${data.chatRoomId}`);
  }

  @SubscribeMessage('send_message')
  async handleSendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: {
      chatRoomId: string;
      content: string;
      type?: string;
      attachments?: string[];
    },
  ) {
    const userId = this.socketUserMap.get(client.id);
    if (!userId) return;

    try {
      // Save message to database
      const message = await this.chatService.sendMessage(
        data.chatRoomId,
        userId,
        data.content,
        data.type as any,
        data.attachments,
      );

      // Get chat room info
      const chatRoom = await this.chatService.getChatRoomMessages(data.chatRoomId, userId);
      
      // Emit message to chat room
      this.server.to(`chat:${data.chatRoomId}`).emit('new_message', {
        chatRoomId: data.chatRoomId,
        message,
        chatRoom,
      });

      // Notify recipient if they're online
      const recipientId = 
        chatRoom.user._id.toString() === userId 
          ? chatRoom.fieldOwner._id.toString()
          : chatRoom.user._id.toString();

      const recipientSocketId = this.userSocketMap.get(recipientId);
      if (recipientSocketId) {
        this.server.to(recipientSocketId).emit('message_notification', {
          chatRoomId: data.chatRoomId,
          message,
          sender: message.sender.toString(),
        });
      }

    } catch (error) {
      console.error('Error sending message:', error);
      client.emit('message_error', {
        error: 'Failed to send message',
        chatRoomId: data.chatRoomId,
      });
    }
  }

  @SubscribeMessage('typing')
  async handleTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { chatRoomId: string; isTyping: boolean },
  ) {
    const userId = this.socketUserMap.get(client.id);
    if (!userId) return;

    // Notify other participants in the chat room
    client.to(`chat:${data.chatRoomId}`).emit('user_typing', {
      chatRoomId: data.chatRoomId,
      userId,
      isTyping: data.isTyping,
    });
  }

  @SubscribeMessage('read_messages')
  async handleReadMessages(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { chatRoomId: string },
  ) {
    const userId = this.socketUserMap.get(client.id);
    if (!userId) return;

    try {
      await this.chatService.markMessagesAsRead(data.chatRoomId, userId);
      
      // Notify other participant
      this.server.to(`chat:${data.chatRoomId}`).emit('messages_read', {
        chatRoomId: data.chatRoomId,
        userId,
      });
    } catch (error) {
      console.error('Error marking messages as read:', error);
    }
  }

  // Helper method to emit events to specific user
  emitToUser(userId: string, event: string, data: any) {
    const socketId = this.userSocketMap.get(userId);
    if (socketId) {
      this.server.to(socketId).emit(event, data);
    }
  }
}