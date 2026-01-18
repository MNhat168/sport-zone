import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { OnEvent } from '@nestjs/event-emitter';
import { Server, Socket } from 'socket.io';
import { ChatService } from './chat.service';
import { Types } from 'mongoose';
import { WEBSOCKET_CORS_CONFIG } from '@common/config/websocket.config';

// Define a type for the chat room with proper typing
interface ChatRoomWithId {
  _id: Types.ObjectId;
  [key: string]: any;
}

@WebSocketGateway({
  cors: WEBSOCKET_CORS_CONFIG,
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

      // console.log(`User ${userId} connected to chat`);
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
      fieldOwnerId?: string;
      coachId?: string;
      fieldId?: string;
      content: string;
      type?: string;
      attachments?: string[];
    },
  ) {
    const userId = this.socketUserMap.get(client.id);
    if (!userId) return;

    try {
      let result;

      if (data.coachId) {
        // Use coach-specific auto-create method
        result = await this.chatService.sendMessageToCoachWithAutoCreate(
          userId,
          data.coachId,
          data.content,
          data.type as any,
          data.fieldId,
          data.attachments,
        );
      } else if (data.fieldOwnerId) {
        // Use field-specific auto-create method
        result = await this.chatService.sendMessageWithAutoCreate(
          userId,
          data.fieldOwnerId,
          data.content,
          data.type as any,
          data.fieldId,
          data.attachments,
        );
      } else {
        throw new Error('Neither fieldOwnerId nor coachId provided');
      }

      const { message, chatRoom } = result;

      // Emit message to chat room
      this.server.to(`chat:${chatRoom._id}`).emit('new_message', {
        chatRoomId: (chatRoom._id as Types.ObjectId).toString(),
        message,
        chatRoom,
      });

      // Join the sender to the room so they receive subsequent updates
      client.join(`chat:${chatRoom._id}`);

      // Notify recipient via their user socket
      let recipientProfileId: string | undefined;
      let recipientUserId: string | null = null;

      if (chatRoom.fieldOwner) {
        recipientProfileId = (chatRoom.fieldOwner as Types.ObjectId).toString();
        recipientUserId = await this.chatService.getFieldOwnerUserId(recipientProfileId);
      } else if (chatRoom.coach) {
        recipientProfileId = (chatRoom.coach as Types.ObjectId).toString();
        recipientUserId = await this.chatService.getCoachUserId(recipientProfileId);
      }

      if (recipientUserId) {
        const socketId = this.userSocketMap.get(recipientUserId);
        if (socketId) {
          this.server.to(socketId).emit('message_notification', {
            chatRoomId: (chatRoom._id as Types.ObjectId).toString(),
            message,
            sender: userId,
          });

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
        error: error.message || 'Failed to send message',
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

    console.log('📨 [send_message_to_room] Received:', {
      chatRoomId: data.chatRoomId,
      userId,
      content: data.content?.substring(0, 50),
    });

    try {
      const message = await this.chatService.sendMessage(
        data.chatRoomId,
        userId,
        data.content,
        (data.type as any) || 'text',
        data.attachments,
      );

      console.log('✅ [send_message_to_room] Message saved to DB:', message || 'no-id');

      // Optionally fetch updated room snapshot for FE state consistency
      const chatRoom = await this.chatService.getChatRoomMessages(data.chatRoomId, userId);

      // Broadcast to room participants
      this.server.to(`chat:${data.chatRoomId}`).emit('new_message', {
        chatRoomId: data.chatRoomId,
        message,
        chatRoom,
      });

      // Also notify other participants directly if we can (user socket mapping)
      const otherParticipants: string[] = [];

      // Traditional 1:1 chat (User <-> FieldOwner/Coach)
      const customerUserId = (chatRoom.user as any)?._id?.toString?.() || (chatRoom.user as any)?.toString?.();
      if (customerUserId && customerUserId !== userId) {
        otherParticipants.push(customerUserId);
      }

      // New style: Check participants array (Matches, Group Sessions)
      if (chatRoom.participants && chatRoom.participants.length > 0) {
        chatRoom.participants.forEach((p: any) => {
          const pId = p?._id?.toString?.() || p?.toString?.();
          if (pId && pId !== userId && !otherParticipants.includes(pId)) {
            otherParticipants.push(pId);
          }
        });
      }

      // If it's a field owner/coach chat and sender is a user, notify the business
      if (chatRoom.fieldOwner && userId === customerUserId) {
        const bizUserId = await this.chatService.getFieldOwnerUserId(chatRoom.fieldOwner.toString());
        if (bizUserId && !otherParticipants.includes(bizUserId)) {
          otherParticipants.push(bizUserId);
        }
      }

      if (chatRoom.coach && userId === customerUserId) {
        const bizUserId = await this.chatService.getCoachUserId(chatRoom.coach.toString());
        if (bizUserId && !otherParticipants.includes(bizUserId)) {
          otherParticipants.push(bizUserId);
        }
      }

      // Send notifications to all identified participants
      otherParticipants.forEach(targetUserId => {
        const socketId = this.userSocketMap.get(targetUserId);
        if (socketId) {
          this.server.to(socketId).emit('message_notification', {
            chatRoomId: data.chatRoomId,
            message,
            sender: userId,
          });

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
      });
    } catch (error) {
      console.error('❌ [send_message_to_room] Error:', error);
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

  @OnEvent('chat.system_message')
  async handleSystemMessage(payload: { chatRoomId: string, message: any, chatRoom: any }) {
    // Broadcast to room
    this.server.to(`chat:${payload.chatRoomId}`).emit('new_message', {
      chatRoomId: payload.chatRoomId,
      message: payload.message,
      chatRoom: payload.chatRoom, // Now available via event payload
    });
  }

  @OnEvent('chat.proposal_updated')
  handleProposalUpdated(payload: { chatRoomId: string, bookingId: string, status: string }) {
    this.server.to(`chat:${payload.chatRoomId}`).emit('proposal_updated', payload);
  }
}