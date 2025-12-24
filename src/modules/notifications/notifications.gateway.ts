import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Injectable, Logger } from '@nestjs/common';

@Injectable()
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
  namespace: '/notifications',
})
export class NotificationsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(NotificationsGateway.name);
  private userSocketMap = new Map<string, string>(); // userId -> socketId
  private socketUserMap = new Map<string, string>(); // socketId -> userId

  handleConnection(client: Socket) {
    try {
      const userId =
        (client.handshake.auth?.userId as string | undefined) ||
        (client.handshake.query?.userId as string | undefined);

      if (!userId) {
        this.logger.warn('NotificationsGateway: Missing userId, disconnecting client');
        client.disconnect();
        return;
      }

      this.userSocketMap.set(userId, client.id);
      this.socketUserMap.set(client.id, userId);
      client.join(`user:${userId}`);

      this.logger.log(`User ${userId} connected to notifications`);
    } catch (error) {
      this.logger.error('NotificationsGateway connection error', error as any);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    const userId = this.socketUserMap.get(client.id);
    if (userId) {
      this.userSocketMap.delete(userId);
      this.socketUserMap.delete(client.id);
      this.logger.log(`User ${userId} disconnected from notifications`);
    }
  }

  emitToUser(userId: string, payload: any) {
    this.server.to(`user:${userId}`).emit('notification', payload);
  }
}


