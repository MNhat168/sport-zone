import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User } from './entities/user.entity';

@Injectable()
export class UsersService {
	constructor(
		@InjectModel(User.name) private readonly userModel: Model<User>,
	) {}

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
