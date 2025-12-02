import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
  port: process.env.PORT || 3000,
  jwtSecret: process.env.JWT_SECRET,
  googleClientId: process.env.GOOGLE_CLIENT_ID,
  googleSecret: process.env.GOOGLE_SECRET,
  frontendUrl: process.env.FRONTEND_URL,
  nodeEnv: process.env.NODE_ENV || 'development',
  didit: {
    apiKey: process.env.DIDIT_API_KEY,
    apiSecret: process.env.DIDIT_API_SECRET,
    baseUrl: process.env.DIDIT_BASE_URL,
    workflowId: process.env.DIDIT_WORKFLOW_ID,
    mockMode: process.env.DIDIT_MOCK_MODE,
  },
}));