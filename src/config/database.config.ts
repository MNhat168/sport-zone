import { registerAs } from '@nestjs/config';
import * as process from 'process';

export default registerAs('database', () => ({
  uri: process.env.MONGODB_URI!,
}));