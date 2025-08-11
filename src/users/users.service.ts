import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserRole } from './entities/user.entity';
import { UserProfileDto } from './dtos/user-profile.dto';

@Injectable()
export class UsersService {
    constructor(@InjectModel(User.name) private userModel: Model<User>) { }

    async getProfile(id: string): Promise<UserProfileDto> {
        const user = await this.userModel.findById(id).lean() as (User & { _id: any });
        if (!user) throw new NotFoundException('User not found');
        if (user.role !== UserRole.USER) throw new BadRequestException('Not a normal user');
        return {
            id: user._id.toString(),
            fullName: user.fullName,
            email: user.email,
            phone: user.phone,
            avatarUrl: user.avatarUrl,
            role: user.role,
            isVerified: user.isVerified,
        };
    }

    async updateProfile(id: string, dto: Partial<UserProfileDto>): Promise<UserProfileDto> {
        const user = await this.userModel.findById(id) as (User & { _id: any });
        if (!user) throw new NotFoundException('User not found');
        if (user.role !== UserRole.USER) throw new BadRequestException('Not a normal user');
        Object.assign(user, dto);
        await user.save();
        return {
            id: user._id.toString(),
            fullName: user.fullName,
            email: user.email,
            phone: user.phone,
            avatarUrl: user.avatarUrl,
            role: user.role,
            isVerified: user.isVerified,
        };
    }
}
