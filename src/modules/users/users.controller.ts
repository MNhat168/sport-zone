import {
  Controller,
  Get,
  Param,
  Body,
  UseInterceptors,
  UploadedFiles,
  Inject,
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
// DTO
import { ForgotPasswordDto } from './dto/forgot-password.dto.ts';
import { ResetPasswordDto } from './dto/reset-password.dto';

import { EmailService } from '../email/email.service';
import { v4 as uuidv4 } from 'uuid';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import * as bcrypt from 'bcrypt';
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
        @Inject(USER_REPOSITORY)
        private readonly userRepository: UserRepository,
        private readonly emailService: EmailService,
    ) { }
    @UseGuards(JwtAccessTokenGuard)
    @Get('get-profile')
    async getProfile(@Req() req: any): Promise<User> {
        //console.log('req.user',req.user);
    return await this.usersService.findById(req.user.userId);
    }

  @Post('forgot-password')
  async forgotPassword(@Body() body: ForgotPasswordDto) {
    const { email } = body;
    const user = await this.userRepository.findOne({ email });

    if (!user) throw new NotFoundException('Email không tồn tại');

    const token = uuidv4();
    console.log('token', token);
    user.resetPasswordToken = token;
    user.resetPasswordExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 giờ

    await this.userRepository.update(user.id, user);
    await this.emailService.sendResetPassword(user.email, token);

    return { message: 'Đã gửi mail đặt lại mật khẩu' };
  }

  @Post('reset-password')
  async resetPassword(@Body() body: ResetPasswordDto) {
    const { token, newPassword } = body;
    console.log('body', body);
    const user = await this.userRepository.findOne({
      resetPasswordToken: token,
    });
    if (
      !user ||
      !user.resetPasswordExpires ||
      new Date() > user.resetPasswordExpires
    ) {
      throw new BadRequestException('Token hết hạn hoặc không hợp lệ');
    }
    user.password = await bcrypt.hash(newPassword, 10);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await this.userRepository.update(user.id, user);
    return { message: 'Đặt lại mật khẩu thành công' };
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
