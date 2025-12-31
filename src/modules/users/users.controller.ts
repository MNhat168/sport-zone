import {
  Controller,
  Get,
  Param,
  Body,
  Delete,
  UseInterceptors,
  UploadedFiles,
  NotFoundException,
  BadRequestException,
  UseGuards,
  Req,
  Post,
  Request,
  Patch,
  Query,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { ApiTags, ApiConsumes, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import { UpdateUserDto } from './dto/update-user.dto';
import { GetAllUsersDto } from './dto/get-all-users.dto';
import { GetAllUsersResponseDto } from './dto/get-all-users-response.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
// import { UserProfileDto } from './dtos/user-profile.dto';
import { UserRepository } from '@modules/users/repositories/user.repository';
import { FileFieldsInterceptor } from '@nestjs/platform-express';

import { User } from './entities/user.entity';
import { JwtAccessTokenGuard } from '../auth/guards/jwt-access-token.guard';
import { USER_REPOSITORY } from './interface/users.interface';
import { Multer } from 'multer';
import { AuthGuard } from '@nestjs/passport';
import { UserRole } from '@common/enums/user.enum';
import { SetBookmarkCoachesDto } from './dto/set-bookmark-coaches.dto';
import { SetBookmarkFieldsDto } from './dto/set-bookmark-fields.dto';
import { BookmarkCoachDto } from './dto/bookmark-coach.dto';
import { Roles } from 'src/decorators/roles.decorator';
import { RolesGuard } from 'src/common/guards/roles.guard';
@ApiTags('Users')
@Controller('users')
@ApiBearerAuth('token')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    // userRepository no longer needed here
  ) { }
  @UseGuards(JwtAccessTokenGuard)
  @Get('get-profile')
  async getProfile(@Req() req: any): Promise<User> {
    //console.log('req.user',req.user);
    return await this.usersService.findById(req.user.userId);
  }




  @UseGuards(JwtAccessTokenGuard)
  @Patch('me')
  @UseInterceptors(FileFieldsInterceptor([{ name: 'avatar', maxCount: 1 }]))
  @ApiConsumes('multipart/form-data')
  async updateMe(
    @Req() req: any,
    @Body() user: UpdateUserDto,
    @UploadedFiles() files: { avatar?: Express.Multer.File[] },
  ): Promise<User> {
    const avatarFile = files?.avatar?.[0];
    return this.usersService.update(req.user.userId, user, avatarFile);
  }

  @UseGuards(JwtAccessTokenGuard)
  @Post('change-password')
  async changePassword(
    @Request() req,
    @Body() body: ChangePasswordDto,
  ) {
    return this.usersService.changePassword(req.user.userId, body);
  }

  @UseGuards(JwtAccessTokenGuard)
  @Post('bookmark-coaches')
  async setBookmarkCoaches(
    @Request() req,
    @Body() body: SetBookmarkCoachesDto,
  ) {
    const userEmail = req.user.email;
    const user = await this.usersService.findByEmail(userEmail);
    if (!user) {
      throw new BadRequestException('User not found');
    }

    // Only regular users can set bookmark coaches
    if (user.role !== UserRole.USER) {
      throw new BadRequestException('Only users with role USER can set bookmark coaches');
    }

    return this.usersService.setBookmarkCoaches(userEmail, body.bookmarkCoaches);
  }

  @UseGuards(JwtAccessTokenGuard)
  @Delete('bookmark-coaches')
  async removeBookmarkCoaches(
    @Request() req,
    @Body() body: SetBookmarkCoachesDto,
  ) {
    const userEmail = req.user.email;
    const user = await this.usersService.findByEmail(userEmail);
    if (!user) {
      throw new BadRequestException('User not found');
    }

    if (user.role !== UserRole.USER) {
      throw new BadRequestException('Only users with role USER can remove bookmark coaches');
    }

    return this.usersService.removeBookmarkCoaches(userEmail, body.bookmarkCoaches);
  }

  @UseGuards(JwtAccessTokenGuard)
  @Post('bookmark-fields')
  async setBookmarkFields(
    @Request() req,
    @Body() body: SetBookmarkFieldsDto,
  ) {
    const userEmail = req.user.email;
    const user = await this.usersService.findByEmail(userEmail);
    if (!user) {
      throw new BadRequestException('User not found');
    }

    // Only regular users can set bookmark fields
    if (user.role !== UserRole.USER) {
      throw new BadRequestException('Only users with role USER can set bookmark fields');
    }

    return this.usersService.setBookmarkFields(userEmail, body.bookmarkFields);
  }

  @UseGuards(JwtAccessTokenGuard)
  @Get('bookmark-fields')
  async getBookmarkFields(@Request() req) {
    const userEmail = req.user.email;
    const user = await this.usersService.findByEmail(userEmail);
    if (!user) {
      throw new BadRequestException('User not found');
    }
    return this.usersService.getBookmarkFields(userEmail);
  }

  @UseGuards(JwtAccessTokenGuard)
  @Get('bookmark-coaches')
  @ApiOperation({ summary: 'Get current user bookmark coaches' })
  @ApiResponse({ status: 200, description: 'List of bookmark coaches', type: [BookmarkCoachDto] })
  async getBookmarkCoaches(@Request() req): Promise<BookmarkCoachDto[]> {
    const userEmail = req.user.email;
    const user = await this.usersService.findByEmail(userEmail);
    if (!user) {
      throw new BadRequestException('User not found');
    }
    return this.usersService.getBookmarkCoaches(userEmail);
  }

  @UseGuards(JwtAccessTokenGuard)
  @Delete('bookmark-fields')
  async removeBookmarkFields(
    @Request() req,
    @Body() body: SetBookmarkFieldsDto,
  ) {
    const userEmail = req.user.email;
    const user = await this.usersService.findByEmail(userEmail);
    if (!user) {
      throw new BadRequestException('User not found');
    }

    if (user.role !== UserRole.USER) {
      throw new BadRequestException('Only users with role USER can remove bookmark fields');
    }

    return this.usersService.removeBookmarkFields(userEmail, body.bookmarkFields);
  }

  @UseGuards(JwtAccessTokenGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Get('list')
  @ApiQuery({ name: 'search', required: false, description: 'Search by fullName or email' })
  @ApiQuery({ name: 'role', required: false, enum: UserRole, description: 'Filter by role' })
  @ApiQuery({ name: 'status', required: false, enum: ['active', 'inactive'], description: 'Filter by status' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (default: 10, max: 100)' })
  @ApiQuery({ name: 'sortBy', required: false, enum: ['fullName', 'email', 'createdAt', 'updatedAt'], description: 'Sort field (default: createdAt)' })
  @ApiQuery({ name: 'sortOrder', required: false, enum: ['asc', 'desc'], description: 'Sort order (default: desc)' })
  async getAllUsers(
    @Query() query: GetAllUsersDto,
  ): Promise<GetAllUsersResponseDto> {
    return this.usersService.getAllUsers(query);
  }
  @UseGuards(JwtAccessTokenGuard)
  @Patch('deactivate')
  @ApiOperation({ summary: 'Deactivate current user account' })
  @ApiResponse({ status: 200, description: 'Account deactivated successfully' })
  async deactivateMe(@Req() req: any): Promise<{ message: string }> {
    return this.usersService.deactivate(req.user.userId);
  }
}
