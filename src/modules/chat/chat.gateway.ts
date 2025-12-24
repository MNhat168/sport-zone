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
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      const allowedPatterns = [
        /^https:\/\/sport-zone-fe-deploy\.vercel\.app$/,
        /^https:\/\/.*\.vercel\.app$/,
        /^http:\/\/localhost:\d+$/,
      ];
      const isAllowed = allowedPatterns.some(pattern => pattern.test(origin));
      if (isAllowed) return callback(null, true);
      return callback(new Error('Not allowed by WebSocket CORS'));
    },
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
  ) { }

  private isSocketInRoom(socketId: string, roomName: string): boolean {
    try {
      const rooms: any = (this.server as any)?.sockets?.adapter?.rooms;
      const room = rooms?.get?.(roomName);
      return !!(room && socketId && room.has?.(socketId));
    } catch {
      // If adapter/rooms not ready, assume not in room to avoid errors
      return false;
    }
  }

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

      // Notify field owner via their user socket (map profile -> user)
      const fieldOwnerProfileId = (chatRoom.fieldOwner as Types.ObjectId).toString();
      const fieldOwnerUserId = await this.chatService.getFieldOwnerUserId(fieldOwnerProfileId);
      if (fieldOwnerUserId) {
        const socketId = this.userSocketMap.get(fieldOwnerUserId);
        if (socketId) {
          // lightweight notification (always ok)
          this.server.to(socketId).emit('message_notification', {
            chatRoomId: (chatRoom._id as Types.ObjectId).toString(),
            message,
            sender: userId,
          });
          // Avoid duplicate 'new_message' if owner socket already joined the room
          const roomName = `chat:${chatRoom._id}`;
          const alreadyInRoom = this.isSocketInRoom(socketId, roomName);
          if (!alreadyInRoom) {
            this.server.to(socketId).emit('new_message', {
              chatRoomId: (chatRoom._id as Types.ObjectId).toString(),
              message,
              chatRoom,
            });
          }
        }
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

  @SubscribeMessage('send_message_to_room')
  async handleSendMessageToRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { chatRoomId: string; content: string; type?: string; attachments?: string[] },
  ) {
    const userId = this.socketUserMap.get(client.id);
    if (!userId) return;

    try {
      const message = await this.chatService.sendMessage(
        data.chatRoomId,
        userId,
        data.content,
        (data.type as any) || 'text',
        data.attachments,
      );

      // Optionally fetch updated room snapshot for FE state consistency
      const chatRoom = await this.chatService.getChatRoomMessages(data.chatRoomId, userId);

      // Broadcast to room participants
      this.server.to(`chat:${data.chatRoomId}`).emit('new_message', {
        chatRoomId: data.chatRoomId,
        message,
        chatRoom,
      });

      // Also notify the other participant directly if we can (user socket mapping)
      // If sender is field owner user, notify customer by their user socket id
      const customerUserId = (chatRoom.user as any)?._id?.toString?.() || (chatRoom.user as any)?.toString?.();
      if (customerUserId) {
        const socketId = this.userSocketMap.get(customerUserId);
        if (socketId) {
          this.server.to(socketId).emit('message_notification', {
            chatRoomId: data.chatRoomId,
            message,
            sender: userId,
          });
          // Push full event only if customer's socket is not already in the chat room
          const roomName = `chat:${data.chatRoomId}`;
          const alreadyInRoom = this.isSocketInRoom(socketId, roomName);
          if (!alreadyInRoom) {
            this.server.to(socketId).emit('new_message', {
              chatRoomId: data.chatRoomId,
              message,
              chatRoom,
            });
          }
        }
      }
    } catch (error) {
      console.error('Error sending message to room:', error);
      client.emit('message_error', {
        error: 'Failed to send message to room',
        ...data,
      });
    }
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