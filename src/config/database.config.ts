import { registerAs } from '@nestjs/config';
import * as process from 'process';

export default registerAs('database', () => ({
  uri: process.env.MONGODB_URI || 'mongodb+srv://nhatnmde180:helloworld@cluster0.zufvinh.mongodb.net/SportZone?retryWrites=true&w=majority',
}));