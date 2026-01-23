import {
    WebSocketGateway,
    WebSocketServer,
    SubscribeMessage,
    MessageBody,
    ConnectedSocket,
    OnGatewayConnection,
    OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, UseGuards } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@WebSocketGateway({
    cors: {
        origin: (origin, callback) => {
            // Allow requests with no origin (mobile apps, curl, etc.)
            if (!origin) return callback(null, true);

            const allowedPatterns = [
                /^https:\/\/sport-zone-fe-deploy\.vercel\.app$/,
                /^https:\/\/.*\.vercel\.app$/,
                /^https:\/\/www\.sportzone\.io\.vn$/,              // Custom Domain (www)
                /^https:\/\/sportzone\.io\.vn$/,                   // Custom Domain (root)
                /^http:\/\/localhost(:\d+)?$/,                     // Allow localhost with optional port
                /^http:\/\/127\.0\.0\.1(:\d+)?$/,                  // Allow 127.0.0.1 with optional port
            ];

            const isAllowed = allowedPatterns.some(pattern => pattern.test(origin));
            if (isAllowed) {
                return callback(null, true);
            }

            // Log rejected origins for debugging
            console.warn(`[Matching Gateway CORS] Rejected origin: ${origin}`);
            return callback(new Error(`Not allowed by Matching Gateway CORS: ${origin}`));
        },
        credentials: true,
    },
    namespace: '/matching',
})
export class MatchingGateway implements OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer()
    server: Server;

    private readonly logger = new Logger(MatchingGateway.name);
    private userSockets: Map<string, string> = new Map(); // userId -> socketId

    constructor(private jwtService: JwtService) { }

    async handleConnection(client: Socket) {
        try {
            const token = client.handshake.auth.token || client.handshake.headers.authorization?.split(' ')[1];

            if (!token) {
                this.logger.warn(`Client ${client.id} attempted to connect without token`);
                client.disconnect();
                return;
            }

            const payload = await this.jwtService.verifyAsync(token);
            const userId = payload.userId;

            // Store user socket mapping
            this.userSockets.set(userId, client.id);
            client.data.userId = userId;

            // Join user to their personal room
            client.join(`user:${userId}`);

            this.logger.log(`User ${userId} connected to matching gateway with socket ${client.id}`);

            // Notify user they're connected
            client.emit('connected', { userId, timestamp: new Date() });
        } catch (error) {
            this.logger.error(`Connection error: ${error.message}`);
            client.disconnect();
        }
    }

    handleDisconnect(client: Socket) {
        const userId = client.data.userId;
        if (userId) {
            this.userSockets.delete(userId);
            this.logger.log(`User ${userId} disconnected from matching gateway`);
        }
    }

    // ==================== MATCHING EVENTS ====================

    /**
     * Notify user of a new match
     */
    notifyMatch(userId: string, matchData: any) {
        const socketId = this.userSockets.get(userId);
        if (socketId) {
            this.server.to(`user:${userId}`).emit('match:created', matchData);
            this.logger.log(`Notified user ${userId} of new match`);
        }
    }

    /**
     * Notify both users when they match
     */
    notifyBothUsersOfMatch(user1Id: string, user2Id: string, matchData: any) {
        this.notifyMatch(user1Id, matchData);
        this.notifyMatch(user2Id, matchData);
    }

    /**
     * Notify user when someone super-liked them
     */
    notifySuperLike(userId: string, superLikeData: any) {
        this.server.to(`user:${userId}`).emit('match:super_like', superLikeData);
    }

    /**
     * Notify user when match is scheduled
     */
    notifyMatchScheduled(userId: string, scheduleData: any) {
        this.server.to(`user:${userId}`).emit('match:scheduled', scheduleData);
    }

    /**
     * Notify user when match is cancelled
     */
    notifyMatchCancelled(userId: string, matchId: string) {
        this.server.to(`user:${userId}`).emit('match:cancelled', { matchId });
    }

    /**
     * Notify user when they've been unmatched
     */
    notifyUnmatch(userId: string, matchId: string) {
        this.server.to(`user:${userId}`).emit('match:unmatched', { matchId });
    }

    /**
     * Notify user when match is confirmed (all parties paid)
     */
    notifyMatchConfirmed(userId: string, data: any) {
        this.server.to(`user:${userId}`).emit('match:confirmed', data);
    }



    // ==================== CHAT EVENTS ====================

    /**
     * Send message in match chat
     */
    @SubscribeMessage('match:message')
    handleMatchMessage(@MessageBody() data: { matchId: string; message: any }, @ConnectedSocket() client: Socket) {
        const { matchId, message } = data;
        const userId = client.data.userId;

        // Broadcast to match room (both users)
        this.server.to(`match:${matchId}`).emit('match:new_message', {
            matchId,
            message: {
                ...message,
                senderId: userId,
                timestamp: new Date(),
            },
        });

        return { success: true };
    }



    /**
     * Typing indicator for match chat
     */
    @SubscribeMessage('match:typing')
    handleMatchTyping(@MessageBody() data: { matchId: string; isTyping: boolean }, @ConnectedSocket() client: Socket) {
        const { matchId, isTyping } = data;
        const userId = client.data.userId;

        // Broadcast to other user in match
        client.to(`match:${matchId}`).emit('match:typing_status', {
            matchId,
            userId,
            isTyping,
        });
    }



    /**
     * Join match chat room
     */
    joinMatchRoom(matchId: string, userId: string) {
        const socketId = this.userSockets.get(userId);
        if (socketId) {
            const socket = this.server.sockets.sockets.get(socketId);
            if (socket) {
                socket.join(`match:${matchId}`);
                this.logger.log(`User ${userId} joined match ${matchId} room`);
            }
        }
    }

    /**
     * Notify match room of new message
     */
    notifyMatchMessage(matchId: string, messageData: any) {
        this.server.to(`match:${matchId}`).emit('match:new_message', messageData);
    }



    // ==================== UTILITY METHODS ====================

    /**
     * Check if user is online
     */
    isUserOnline(userId: string): boolean {
        return this.userSockets.has(userId);
    }

    /**
     * Get online users count
     */
    getOnlineUsersCount(): number {
        return this.userSockets.size;
    }

    /**
     * Broadcast to all connected users
     */
    broadcastToAll(event: string, data: any) {
        this.server.emit(event, data);
    }
}
