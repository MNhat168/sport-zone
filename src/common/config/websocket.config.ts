/**
 * Shared WebSocket CORS configuration for all gateways
 * Used by: NotificationsGateway, ChatGateway
 */
export const WEBSOCKET_CORS_CONFIG = {
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
        // Allow requests with no origin (mobile apps, curl, etc.)
        if (!origin) return callback(null, true);

        const allowedPatterns = [
            /^https:\/\/sport-zone-fe-deploy\.vercel\.app$/,
            /^https:\/\/.*\.vercel\.app$/,
            /^https:\/\/www\.sportzone\.io\.vn$/,              // Custom Domain (www)
            /^https:\/\/sportzone\.io\.vn$/,                   // Custom Domain (root)
            /^http:\/\/localhost(:\d+)?$/,  // Allow localhost with optional port
            /^http:\/\/127\.0\.0\.1(:\d+)?$/, // Allow 127.0.0.1 with optional port
        ];

        const isAllowed = allowedPatterns.some(pattern => pattern.test(origin));
        if (isAllowed) {
            return callback(null, true);
        }

        // Log rejected origins for debugging
        console.warn(`[WebSocket CORS] Rejected origin: ${origin}`);
        return callback(new Error(`Not allowed by WebSocket CORS: ${origin}`));
    },
    credentials: true,
};
