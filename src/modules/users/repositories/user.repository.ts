import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, FilterQuery } from 'mongoose';
import { User, UserDocument } from '../entities/user.entity';
import { UserRepositoryInterface } from '../interface/users.interface';

@Injectable()
export class UserRepository implements UserRepositoryInterface {
  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
  ) { }

  async findAll(): Promise<User[]> {
    return this.userModel.find().exec();
  }

  async findById(id: string): Promise<User | null> {
    return this.userModel.findById(id).exec();
  }

  async findByCondition(condition: FilterQuery<User>): Promise<User[]> {
    return this.userModel.find(condition).exec();
  }

  async findOne(condition: FilterQuery<User>): Promise<User | null> {
    return this.userModel.findOne(condition).exec();
  }

  async create(data: Partial<User>): Promise<User> {
    const createdUser = new this.userModel(data);
    return createdUser.save();
  }

  async update(id: string, data: Partial<User>): Promise<User | null> {
    return this.userModel.findByIdAndUpdate(id, data, { new: true }).exec();
  }

  async delete(id: string): Promise<User | null> {
    return this.userModel.findByIdAndDelete(id).exec();
  }

  async findOneByCondition(condition: FilterQuery<User>): Promise<User | null> {
    return this.userModel.findOne(condition).exec();
  }
}
