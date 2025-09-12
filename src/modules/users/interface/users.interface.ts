import { FilterQuery } from 'mongoose';
import { User } from '../entities/user.entity';

export const USER_REPOSITORY = 'USER_REPOSITORY';

export interface UserRepositoryInterface {
    findAll(): Promise<User[]>;

    findById(id: string): Promise<User | null>;

    findByCondition(condition: FilterQuery<User>): Promise<User[]>;

    create(data: Partial<User>): Promise<User>;

    update(id: string, data: Partial<User>): Promise<User | null>;

    delete(id: string): Promise<User | null>;

    findOne(condition: FilterQuery<User>): Promise<User | null>;

    findOneByCondition(condition: FilterQuery<User>): Promise<User | null>;

}
