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
} from '@nestjs/common';
import { UsersService } from './users.service';
import { ApiTags, ApiConsumes, ApiBearerAuth } from '@nestjs/swagger';
import { UpdateUserDto } from './dto/update-user.dto';
// import { UserProfileDto } from './dtos/user-profile.dto';
import { UserRepository } from '@modules/users/repositories/user.repository';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
 
import { User } from './entities/user.entity';
import { JwtAccessTokenGuard } from '../auth/guards/jwt-access-token.guard';
import { USER_REPOSITORY } from './interface/users.interface';
import { Multer } from 'multer';
import { AuthGuard } from '@nestjs/passport';
import { UserRole } from './entities/user.entity';
import { SetFavouriteFieldsDto } from './dto/set-favourite-fields.dto';
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
    if (user.role !== UserRole.USER) {
      throw new BadRequestException(
        'Only users with role USER can set favourite fields',
      );
    }
    // Debug: log the received body
    console.log('[DEBUG] Controller received body:', body);
    // Add multiple favourite fields, block duplicates
    return this.usersService.setFavouriteFields(
      userEmail,
      body.favouriteFields,
    );
  }
}
