import { Controller, Get, Patch, Param, Body } from '@nestjs/common';
import { UsersService } from './users.service';
import { UserProfileDto } from './dtos/user-profile.dto';

@Controller('users')
export class UsersController {
    constructor(private readonly usersService: UsersService) { }

    @Get(':id/profile')
    async getProfile(@Param('id') id: string): Promise<UserProfileDto> {
        return this.usersService.getProfile(id);
    }

    @Patch(':id/profile')
    async updateProfile(
        @Param('id') id: string,
        @Body() dto: Partial<UserProfileDto>,
    ): Promise<UserProfileDto> {
        return this.usersService.updateProfile(id, dto);
    }
}
