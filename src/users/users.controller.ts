import { Post, Body, UseGuards, Request, BadRequestException } from '@nestjs/common';
import { UsersService } from './users.service';
import { AuthGuard } from '@nestjs/passport';
import { UserRole } from './entities/user.entity';
export class SetFavouriteFieldDto {
	favouriteField: string;
}
import { Controller } from '@nestjs/common';

@Controller('users')
export class UsersController {
	constructor(private readonly usersService: UsersService) {}

		@UseGuards(AuthGuard('jwt'))
		@Post('favourite-field')
		async setFavouriteField(
			@Request() req,
			@Body() body: SetFavouriteFieldDto
		) {
			const userEmail = req.user.email;
			const user = await this.usersService.findByEmail(userEmail);
			if (!user) {
				throw new BadRequestException('User not found');
			}
			if (user.role !== UserRole.USER) {
				throw new BadRequestException('Only users with role USER can set favourite field');
			}
			// Now allows adding multiple favourite fields, but blocks duplicates
			return this.usersService.setFavouriteField(userEmail, body.favouriteField);
		}
}
