import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
  port: process.env.PORT || 3000,
  jwtSecret: process.env.JWT_SECRET,
  googleClientId: process.env.GOOGLE_CLIENT_ID,
  googleSecret: process.env.GOOGLE_SECRET,
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3001',
  nodeEnv: process.env.NODE_ENV || 'development',
  didit: {
    apiKey: process.env.DIDIT_API_KEY,
    apiSecret: process.env.DIDIT_API_SECRET,
    baseUrl: process.env.DIDIT_BASE_URL || 'https://api.didit.com',
    mockMode: process.env.DIDIT_MOCK_MODE || 'false',
  },
}));