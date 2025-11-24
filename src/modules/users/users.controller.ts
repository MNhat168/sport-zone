import {
  Controller,
  Get,
  Param,
  Body,
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
import { UpdateUserDto } from './dto/update-user.dto';
import { GetAllUsersDto } from './dto/get-all-users.dto';
import { GetAllUsersResponseDto } from './dto/get-all-users-response.dto';
// import { UserProfileDto } from './dtos/user-profile.dto';
import { UserRepository } from '@modules/users/repositories/user.repository';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
 
import { User } from './entities/user.entity';
import { JwtAccessTokenGuard } from '../auth/guards/jwt-access-token.guard';
import { USER_REPOSITORY } from './interface/users.interface';
import { Multer } from 'multer';
import { AuthGuard } from '@nestjs/passport';
import { UserRole } from './entities/user.entity';
import { SetFavouriteSportsDto } from './dto/set-favourite-sports.dto';
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
