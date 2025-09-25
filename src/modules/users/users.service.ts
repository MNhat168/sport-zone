import {
  Injectable,
  NotFoundException,
  Inject,
  BadRequestException,
} from '@nestjs/common';
import { FilterQuery } from 'mongoose';
import { User } from './entities/user.entity';
import {
  UserRepositoryInterface,
  USER_REPOSITORY,
} from './interface/users.interface';
import { Model } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';

@Injectable()
export class UsersService {
  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepository: UserRepositoryInterface,
    @InjectModel(User.name) private readonly userModel: Model<User>,
  ) {}

  async findOneByCondition(condition: FilterQuery<User>): Promise<User | null> {
    const result = await this.userRepository.findOneByCondition(condition);
    if (!result) {
      throw new NotFoundException(`Admin with ${condition} not found`);
    }
    return result;
  }

  async findByEmail(email: string) {
    return this.userModel.findOne({ email });
  }

  async setFavouriteField(email: string, favouriteField: string) {
    const user = await this.userModel.findOne({ email });
    if (!user) {
      throw new BadRequestException('User not found');
    }
    if (!Array.isArray(user.favouriteField)) {
      user.favouriteField = [];
    }
    if (user.favouriteField.includes(favouriteField)) {
      throw new BadRequestException('Favourite field already set');
    }
    user.favouriteField.push(favouriteField);
    await user.save();
    return user;
  }
}
