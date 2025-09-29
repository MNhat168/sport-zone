import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { JwtModule } from '@nestjs/jwt';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { User, UserSchema } from './entities/user.entity';
import { UserRepository } from './repositories/user.repository';
import { USER_REPOSITORY } from './interface/users.interface';
import { ServiceModule } from '../../service/service.module';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema }
    ]),
    ServiceModule,
    JwtModule.register({}),
    EmailModule
  ],
  controllers: [UsersController],
  providers: [
    UsersService,
    UserRepository,
    {
      provide: USER_REPOSITORY,
      useClass: UserRepository,
    }
  ],
  exports: [UsersService]
})
export class UsersModule {}
