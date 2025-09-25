import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  Post,
  Request,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import { UsersService } from './users.service';
// import { UserProfileDto } from './dtos/user-profile.dto';
import { AuthGuard } from '@nestjs/passport';
import { UserRole } from './entities/user.entity';

export class SetFavouriteFieldDto {
  favouriteField: string;
}

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // @Get(':id/profile')
  // async getProfile(@Param('id') id: string): Promise<UserProfileDto> {
  //     return this.usersService.getProfile(id);
  // }

  // @Patch(':id/profile')
  // async updateProfile(
  //     @Param('id') id: string,
  //     @Body() dto: Partial<UserProfileDto>,
  // ): Promise<UserProfileDto> {
  //     return this.usersService.updateProfile(id, dto);
  // }

  @UseGuards(AuthGuard('jwt'))
  @Post('favourite-field')
  async setFavouriteField(@Request() req, @Body() body: SetFavouriteFieldDto) {
    const userEmail = req.user.email;
    const user = await this.usersService.findByEmail(userEmail);
    if (!user) {
      throw new BadRequestException('User not found');
    }
    if (user.role !== UserRole.USER) {
      throw new BadRequestException(
        'Only users with role USER can set favourite field',
      );
    }
    // Now allows adding multiple favourite fields, but blocks duplicates
    return this.usersService.setFavouriteField(userEmail, body.favouriteField);
  }
}
