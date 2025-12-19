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
import { SetFavouriteSportsDto } from './dto/set-favourite-sports.dto';
import { SetFavouriteCoachesDto } from './dto/set-favourite-coaches.dto';
import { SetFavouriteFieldsDto } from './dto/set-favourite-fields.dto';
import { FavouriteCoachDto } from './dto/favourite-coach.dto';
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

  @UseGuards(AuthGuard('jwt'))
  @Post('favourite-sports')
  async setFavouriteSports(
    @Request() req,
    @Body() body: SetFavouriteSportsDto,
  ) {
    const userEmail = req.user.email;
    const user = await this.usersService.findByEmail(userEmail);
    if (!user) {
      throw new BadRequestException('User not found');
    }
    if (user.role !== UserRole.USER) {
      throw new BadRequestException(
        'Only users with role USER can set favourite fields',
      );
    }
    // Debug: log the received body
    console.log('[DEBUG] Controller received body:', body);
    // Add multiple favourite fields, block duplicates
    return this.usersService.setFavouriteSports(
      userEmail,
      body.favouriteSports,
    );
  }

  @UseGuards(JwtAccessTokenGuard)
  @Delete('favourite-sports')
  @ApiOperation({ summary: 'Remove all favourite sports for current user' })
  @ApiResponse({ status: 200, description: 'Favourite sports cleared' })
  async removeAllFavouriteSports(@Request() req) {
    const userEmail = req.user.email;
    if (!user) {
      throw new BadRequestException('User not found');
    }

    if (user.role !== UserRole.USER) {
      throw new BadRequestException('Only users with role USER can remove favourite sports');
    }

    return this.usersService.removeAllFavouriteSports(userEmail);
  }

  @UseGuards(JwtAccessTokenGuard)
  @Post('favourite-coaches')
  async setFavouriteCoaches(
    @Request() req,
    @Body() body: SetFavouriteCoachesDto,
  ) {
    const userEmail = req.user.email;
    const user = await this.usersService.findByEmail(userEmail);
    if (!user) {
      throw new BadRequestException('User not found');
    }

    // Only regular users can set favourite coaches
    if (user.role !== UserRole.USER) {
      throw new BadRequestException('Only users with role USER can set favourite coaches');
    }

    return this.usersService.setFavouriteCoaches(userEmail, body.favouriteCoaches);
  }

  @UseGuards(JwtAccessTokenGuard)
  @Delete('favourite-coaches')
  async removeFavouriteCoaches(
    @Request() req,
    @Body() body: SetFavouriteCoachesDto,
  ) {
    const userEmail = req.user.email;
    const user = await this.usersService.findByEmail(userEmail);
    if (!user) {
      throw new BadRequestException('User not found');
    }

    if (user.role !== UserRole.USER) {
      throw new BadRequestException('Only users with role USER can remove favourite coaches');
    }

    return this.usersService.removeFavouriteCoaches(userEmail, body.favouriteCoaches);
  }

  @UseGuards(JwtAccessTokenGuard)
  @Post('favourite-fields')
  async setFavouriteFields(
    @Request() req,
    @Body() body: SetFavouriteFieldsDto,
  ) {
    const userEmail = req.user.email;
    const user = await this.usersService.findByEmail(userEmail);
    if (!user) {
      throw new BadRequestException('User not found');
    }

    // Only regular users can set favourite fields
    if (user.role !== UserRole.USER) {
      throw new BadRequestException('Only users with role USER can set favourite fields');
    }

    return this.usersService.setFavouriteFields(userEmail, body.favouriteFields);
  }

  @UseGuards(JwtAccessTokenGuard)
  @Get('favourite-fields')
  async getFavouriteFields(@Request() req) {
    const userEmail = req.user.email;
    const user = await this.usersService.findByEmail(userEmail);
    if (!user) {
      throw new BadRequestException('User not found');
    }
    return this.usersService.getFavouriteFields(userEmail);
  }

  @UseGuards(JwtAccessTokenGuard)
  @Get('favourite-coaches')
  @ApiOperation({ summary: 'Get current user favourite coaches' })
  @ApiResponse({ status: 200, description: 'List of favourite coaches', type: [FavouriteCoachDto] })
  async getFavouriteCoaches(@Request() req): Promise<FavouriteCoachDto[]> {
    const userEmail = req.user.email;
    const user = await this.usersService.findByEmail(userEmail);
    if (!user) {
      throw new BadRequestException('User not found');
    }
    return this.usersService.getFavouriteCoaches(userEmail);
  }

  @UseGuards(JwtAccessTokenGuard)
  @Delete('favourite-fields')
  async removeFavouriteFields(
    @Request() req,
    @Body() body: SetFavouriteFieldsDto,
  ) {
    const userEmail = req.user.email;
    const user = await this.usersService.findByEmail(userEmail);
    if (!user) {
      throw new BadRequestException('User not found');
    }

    if (user.role !== UserRole.USER) {
      throw new BadRequestException('Only users with role USER can remove favourite fields');
    }

    return this.usersService.removeFavouriteFields(userEmail, body.favouriteFields);
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
  
}
