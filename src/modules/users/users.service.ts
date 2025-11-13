import {
  Injectable,
  NotFoundException,
  Inject,
  BadRequestException,
} from '@nestjs/common';
import { FilterQuery } from 'mongoose';
import { User } from './entities/user.entity';
import {
  UserRepositoryInterface,
  USER_REPOSITORY,
} from './interface/users.interface';
import { ConfigService } from '@nestjs/config';
import { AwsS3Service } from 'src/service/aws-s3.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { Model } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';

@Injectable()
export class UsersService {
  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepository: UserRepositoryInterface,
    private readonly awsS3Service: AwsS3Service,
    private readonly configService: ConfigService,
    @InjectModel(User.name) private readonly userModel: Model<User>,
  ) {}

  async findOneByCondition(condition: FilterQuery<User>): Promise<User | null> {
    const result = await this.userRepository.findOneByCondition(condition);
    if (!result) {
      throw new NotFoundException(
        `User with condition ${JSON.stringify(condition)} not found`,
      );
    }
    return result;
  }

    async findById(id: string): Promise<User> {
      const user = await this.userRepository.findById(id);
        if (!user) throw new NotFoundException('User not found');
        return user;
    }
    
    async update(
        id: string,
        data: UpdateUserDto,
        avatarFile?: any, // Avatar file từ multer
    ): Promise<User> {
        const user = await this.userRepository.findById(id);
        if (!user) {
            throw new NotFoundException('User not found');
        }

    let updateData = { ...data };

    // Handle avatar file upload if provided
    if (avatarFile) {
      // Delete old avatar if exists
      if (user.avatarUrl) {
        const oldKey = user.avatarUrl.split('.com/')[1];
        try {
          await this.awsS3Service.deleteObject(oldKey);
        } catch (error) {
          console.warn('Failed to delete old avatar:', error);
        }
      }

      // Upload new avatar to S3
      const avatarUrl = await this.awsS3Service.uploadACLImage({
        buffer: avatarFile.buffer,
        mimetype: avatarFile.mimetype,
        originalname: avatarFile.originalname,
        encoding: avatarFile.encoding,
        fieldname: avatarFile.fieldname,
        size: avatarFile.size,
      });

      updateData.avatarUrl = avatarUrl;
    }

    const updated = await this.userRepository.update(id, updateData);
    if (!updated) throw new NotFoundException('User not found');
    return updated;
  }

  async findByEmail(email: string) {
    return this.userModel.findOne({ email });
  }

  async setFavouriteSports(email: string, favouriteSports: string[]) {
    // Debug: log the value and type
    console.log(
      '[DEBUG] setFavouriteSports received:',
      favouriteSports,
      'Type:',
      typeof favouriteSports,
      'IsArray:',
      Array.isArray(favouriteSports),
    );

    const user = await this.userModel.findOne({ email });
    if (!user) {
      throw new BadRequestException('User not found');
    }

    // Ensure favouriteSports input is an array
    if (!Array.isArray(favouriteSports)) {
      throw new BadRequestException('favouriteSports must be an array');
    }

    // Ensure user's favouriteSports is an array on the document
    if (!Array.isArray(user.favouriteSports)) {
      user.favouriteSports = [];
    }

    const currentSports: string[] = user.favouriteSports as string[];

    // Filter incoming sports to only include strings not already present
    const newSports = favouriteSports.filter(
      (s) => typeof s === 'string' && !currentSports.includes(s),
    );

    if (newSports.length === 0) {
      throw new BadRequestException('All favourite sports already set');
    }

    user.favouriteSports.push(...newSports);
    await user.save();
    return user;
  }
}
