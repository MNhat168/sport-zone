import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import { FilterQuery } from 'mongoose';
import { User } from './entities/user.entity';
import { UserRepositoryInterface, USER_REPOSITORY } from './interface/users.interface';

@Injectable()
export class UsersService {

    constructor(@Inject(USER_REPOSITORY) private readonly userRepository: UserRepositoryInterface) {}

    async findOneByCondition(condition: FilterQuery<User>): Promise<User | null> {
        const result = await this.userRepository.findOneByCondition(condition);
        if (!result) {
            throw new NotFoundException(`Admin with ${condition} not found`);
        }
        return result;
    }
}
