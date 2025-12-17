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
import { Types } from 'mongoose';

// Define a type for the chat room with proper typing
interface ChatRoomWithId {
  _id: Types.ObjectId;
  [key: string]: any;
}

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
  ) {}

  async handleConnection(client: Socket) {
    try {
      const userId = client.handshake.auth.userId;
      
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
    fieldOwnerId: string;
    fieldId?: string;
    content: string;
    type?: string;
    attachments?: string[];
  },
) {
  const userId = this.socketUserMap.get(client.id);
  if (!userId) return;

  try {
    // Use the auto-create method
    const { message, chatRoom } = await this.chatService.sendMessageWithAutoCreate(
      userId,
      data.fieldOwnerId,
      data.content,
      data.type as any,
      data.fieldId,
      data.attachments,
    );
    
    // Emit message to chat room
    this.server.to(`chat:${chatRoom._id}`).emit('new_message', {
      chatRoomId: (chatRoom._id as Types.ObjectId).toString(),
      message,
      chatRoom,
    });

    // Notify field owner if they're online
    const fieldOwnerSocketId = this.userSocketMap.get(data.fieldOwnerId);
    if (fieldOwnerSocketId) {
      this.server.to(fieldOwnerSocketId).emit('message_notification', {
        chatRoomId: (chatRoom._id as Types.ObjectId).toString(),
        message,
        sender: userId,
      });
    }

  } catch (error) {
    console.error('Error sending message:', error);
    client.emit('message_error', {
      error: 'Failed to send message',
      ...data,
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