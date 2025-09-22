import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
  port:3000,
  jwtSecret: process.env.JWT_SECRET,
  googleClientId: process.env.GOOGLE_CLIENT_ID,
  googleSecret: process.env.GOOGLE_SECRET,
}));