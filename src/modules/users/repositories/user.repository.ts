import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, FilterQuery } from 'mongoose';
import { User, UserDocument } from '@modules/users/entities/user.entity';
import { UserRepositoryInterface } from '@modules/users/interface/users.interface';

@Injectable()
export class UserRepository implements UserRepositoryInterface {
  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
  ) { }

  findAll(): Promise<User[]> {
    return this.userModel.find().exec();
  }

  findById(id: string): Promise<User | null> {
    return this.userModel.findById(id).exec();
  }

  create(data: Partial<User>): Promise<User> {
    const created = new this.userModel(data);
    return created.save();
  }

  update(id: string, data: Partial<User>): Promise<User | null> {
    return this.userModel.findByIdAndUpdate(id, data, { new: true }).exec();
  }

  delete(id: string): Promise<User | null> {
    return this.userModel.findByIdAndDelete(id).exec();
  }

  findOne(condition: FilterQuery<User>): Promise<User | null> {
    return this.userModel.findOne(condition).exec();
  }

  findOneByCondition(condition: FilterQuery<User>): Promise<User | null> {
    return this.userModel.findOne(condition);
  }

  findByCondition(condition: FilterQuery<User>): Promise<User[]> {
    return this.userModel.find(condition).exec();
  }

}
