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
import { GetAllUsersDto } from './dto/get-all-users.dto';
import { GetAllUsersResponseDto, UserListDto } from './dto/get-all-users-response.dto';
import { Model, Types } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';
import { UserRole } from '@common/enums/user.enum';
import { Field } from '../fields/entities/field.entity';

@Injectable()
export class UsersService {
  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepository: UserRepositoryInterface,
    private readonly awsS3Service: AwsS3Service,
    private readonly configService: ConfigService,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(Field.name) private readonly fieldModel: Model<Field>,
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

  async setFavouriteCoaches(email: string, favouriteCoaches: string[]) {
    const user = await this.userModel.findOne({ email });
    if (!user) {
      throw new BadRequestException('User not found');
    }

    if (!Array.isArray(favouriteCoaches)) {
      throw new BadRequestException('favouriteCoaches must be an array');
    }

    // Validate and convert coach IDs to ObjectId
    const validIds: Types.ObjectId[] = [];
    for (const id of favouriteCoaches) {
      if (typeof id !== 'string') continue;
      if (!Types.ObjectId.isValid(id)) continue;
      validIds.push(new Types.ObjectId(id));
    }

    if (validIds.length === 0) {
      throw new BadRequestException('No valid coach IDs provided');
    }

    // Ensure the provided IDs belong to users with role COACH
    const coaches = (await this.userModel
      .find({ _id: { $in: validIds }, role: UserRole.COACH })
      .select('_id')
      .lean()
      .exec()) as unknown as { _id: Types.ObjectId }[];

    if (!coaches || coaches.length === 0) {
      throw new BadRequestException('No valid coaches found for provided IDs');
    }

    const coachIdStrings = coaches.map((c) => c._id.toString());

    // Ensure user's favouriteCoaches is an array
    if (!Array.isArray(user.favouriteCoaches)) user.favouriteCoaches = [];

    const currentCoachIds = user.favouriteCoaches.map((c: any) => c.toString());

    // Filter new coach IDs (remove duplicates)
    const newCoachIds = coachIdStrings.filter((id) => !currentCoachIds.includes(id));

    if (newCoachIds.length === 0) {
      throw new BadRequestException('All provided coaches are already in favourites');
    }

    user.favouriteCoaches.push(...newCoachIds.map((id) => new Types.ObjectId(id)));
    await user.save();
    return user;
  }

  async removeFavouriteCoaches(email: string, coachIds: string[]) {
    const user = await this.userModel.findOne({ email });
    if (!user) {
      throw new BadRequestException('User not found');
    }

    if (!Array.isArray(coachIds)) {
      throw new BadRequestException('coachIds must be an array');
    }

    const validIds = coachIds.filter(id => typeof id === 'string' && Types.ObjectId.isValid(id));
    if (validIds.length === 0) {
      throw new BadRequestException('No valid coach IDs provided');
    }

    // Remove any matching IDs from user's favouriteCoaches
    if (!Array.isArray(user.favouriteCoaches) || user.favouriteCoaches.length === 0) {
      throw new BadRequestException('No favourite coaches to remove');
    }

    const validIdStrings = validIds.map(id => new Types.ObjectId(id).toString());

    const beforeCount = (user.favouriteCoaches || []).length;
    user.favouriteCoaches = (user.favouriteCoaches || []).filter((c: any) => !validIdStrings.includes((c as any).toString()));
    const afterCount = (user.favouriteCoaches || []).length;

    if (beforeCount === afterCount) {
      throw new BadRequestException('None of the provided coach IDs were in favourites');
    }

    await user.save();
    return user;
  }

  async removeFavouriteFields(email: string, fieldIds: string[]) {
    const user = await this.userModel.findOne({ email });
    if (!user) {
      throw new BadRequestException('User not found');
    }

    if (!Array.isArray(fieldIds)) {
      throw new BadRequestException('fieldIds must be an array');
    }

    const validIds = fieldIds.filter(id => typeof id === 'string' && Types.ObjectId.isValid(id));
    if (validIds.length === 0) {
      throw new BadRequestException('No valid field IDs provided');
    }

    // If user has no favourites, nothing to remove
    if (!Array.isArray(user.favouriteFields) || user.favouriteFields.length === 0) {
      throw new BadRequestException('No favourite fields to remove');
    }

    const validIdStrings = validIds.map(id => new Types.ObjectId(id).toString());
    const beforeCount = (user.favouriteFields || []).length;

    user.favouriteFields = (user.favouriteFields || []).filter((f: any) => !validIdStrings.includes((f as any).toString()));

    const afterCount = (user.favouriteFields || []).length;
    if (beforeCount === afterCount) {
      throw new BadRequestException('None of the provided field IDs were in favourites');
    }

    await user.save();
    return user;
  }

  async setFavouriteFields(email: string, favouriteFields: string[]) {
    const user = await this.userModel.findOne({ email });
    if (!user) {
      throw new BadRequestException('User not found');
    }

    if (!Array.isArray(favouriteFields)) {
      throw new BadRequestException('favouriteFields must be an array');
    }

    // Validate and convert field IDs to ObjectId
    const validIds: Types.ObjectId[] = [];
    for (const id of favouriteFields) {
      if (typeof id !== 'string') continue;
      if (!Types.ObjectId.isValid(id)) continue;
      validIds.push(new Types.ObjectId(id));
    }

    if (validIds.length === 0) {
      throw new BadRequestException('No valid field IDs provided');
    }

    // Ensure the provided IDs correspond to existing active fields
    const fields = (await this.fieldModel
      .find({ _id: { $in: validIds }, isActive: true })
      .select('_id')
      .lean()
      .exec()) as unknown as { _id: Types.ObjectId }[];

    if (!fields || fields.length === 0) {
      throw new BadRequestException('No valid fields found for provided IDs');
    }

    const fieldIdStrings = fields.map((f) => f._id.toString());

    // Ensure user's favouriteFields is an array
    if (!Array.isArray(user.favouriteFields)) user.favouriteFields = [];

    const currentFieldIds = user.favouriteFields.map((c: any) => c.toString());

    // Filter new field IDs (remove duplicates)
    const newFieldIds = fieldIdStrings.filter((id) => !currentFieldIds.includes(id));

    if (newFieldIds.length === 0) {
      throw new BadRequestException('All provided fields are already in favourites');
    }

    user.favouriteFields.push(...newFieldIds.map((id) => new Types.ObjectId(id)));
    await user.save();
    return user;
  }

  async getAllUsers(query: GetAllUsersDto): Promise<GetAllUsersResponseDto> {
    const {
      search,
      role,
      status,
      page = 1,
      limit = 10,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = query;

    // Build filter object
    const filter: FilterQuery<User> = {};

    // Search by fullName or email
    if (search) {
      filter.$or = [
        { fullName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ];
    }

    // Filter by role
    if (role) {
      filter.role = role;
    }

    // Filter by status (active/inactive)
    if (status) {
      filter.isActive = status === 'active';
    }

    // Validate page and limit
    const validatedPage = Math.max(1, page);
    const validatedLimit = Math.min(Math.max(1, limit), 100);

    // Get data from repository
    const { data, total } = await this.userRepository.getAllUsers(
      filter,
      sortBy,
      sortOrder,
      validatedPage,
      validatedLimit,
    );

    // Map to response DTO
    const mappedData: UserListDto[] = data.map((user) => ({
      _id: user._id?.toString(),
      fullName: user.fullName,
      email: user.email,
      phone: user.phone,
      role: user.role,
      status: user.isActive ? 'active' : 'inactive',
      isVerified: user.isVerified,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    }));

    const totalPages = Math.ceil(total / validatedLimit);
    const hasNextPage = validatedPage < totalPages;
    const hasPrevPage = validatedPage > 1;

    return {
      data: mappedData,
      total,
      page: validatedPage,
      limit: validatedLimit,
      totalPages,
      hasNextPage,
      hasPrevPage,
    };
  }
}
