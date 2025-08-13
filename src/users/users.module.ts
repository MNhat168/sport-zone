import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { User, UserSchema } from './entities/user.entity';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    // Đăng ký UserModel
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),

    // Import module chứa NotificationsService
    NotificationsModule
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService] // nếu cần dùng ở module khác
})
export class UsersModule { }
