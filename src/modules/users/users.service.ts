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
import { Booking } from '../bookings/entities/booking.entity';
import { BookmarkCoachDto } from './dto/bookmark-coach.dto';
import { UserRole } from '@common/enums/user.enum';
import { Field } from '../fields/entities/field.entity';
import * as bcrypt from 'bcrypt';
import { Cron, CronExpression } from '@nestjs/schedule';

@Injectable()
export class UsersService {
  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepository: UserRepositoryInterface,
    private readonly awsS3Service: AwsS3Service,
    private readonly configService: ConfigService,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(Field.name) private readonly fieldModel: Model<Field>,
    @InjectModel(Booking.name) private readonly bookingModel: Model<Booking>,
  ) { }

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

  async remove(id: string): Promise<User | null> {
    return this.userModel.findByIdAndDelete(id);
  }

  @Cron(CronExpression.EVERY_WEEK)
  async resetWeeklyLimits() {
    // Reset weekly tournament creation count for all users on Monday at 00:00
    // Note: CronExpression.EVERY_WEEK defaults to 0 0 * * 0 (Sunday).
    // If we want Monday 00:00 specifically, we could use '0 0 * * 1'
    // But EVERY_WEEK (Sunday midnight) is usually fine unless Monday is strictly required.
    // I'll stick to '0 0 * * 1' to be safe for "start of week".
    await this.userModel.updateMany({}, { weeklyTournamentCreationCount: 0 });
    console.log('Weekly tournament creation limits have been reset.');
  }

  async findByEmail(email: string) {
    return this.userModel.findOne({ email });
  }

  async setBookmarkCoaches(email: string, bookmarkCoaches: string[]) {
    const user = await this.userModel.findOne({ email });
    if (!user) {
      throw new BadRequestException('User not found');
    }

    if (!Array.isArray(bookmarkCoaches)) {
      throw new BadRequestException('bookmarkCoaches must be an array');
    }

    // Validate and convert coach IDs to ObjectId
    const validIds: Types.ObjectId[] = [];
    for (const id of bookmarkCoaches) {
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

    // Ensure user's bookmarkCoaches is an array
    if (!Array.isArray(user.bookmarkCoaches)) user.bookmarkCoaches = [];

    const currentCoachIds = user.bookmarkCoaches.map((c: any) => c.toString());

    // Filter new coach IDs (remove duplicates)
    const newCoachIds = coachIdStrings.filter((id) => !currentCoachIds.includes(id));

    if (newCoachIds.length === 0) {
      throw new BadRequestException('All provided coaches are already in bookmarks');
    }

    user.bookmarkCoaches.push(...newCoachIds.map((id) => new Types.ObjectId(id)));
    await user.save();
    return user;
  }

  async removeBookmarkCoaches(email: string, coachIds: string[]) {
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

    // Remove any matching IDs from user's bookmarkCoaches
    if (!Array.isArray(user.bookmarkCoaches) || user.bookmarkCoaches.length === 0) {
      throw new BadRequestException('No bookmark coaches to remove');
    }

    const validIdStrings = validIds.map(id => new Types.ObjectId(id).toString());

    const beforeCount = (user.bookmarkCoaches || []).length;
    user.bookmarkCoaches = (user.bookmarkCoaches || []).filter((c: any) => !validIdStrings.includes((c as any).toString()));
    const afterCount = (user.bookmarkCoaches || []).length;

    if (beforeCount === afterCount) {
      throw new BadRequestException('None of the provided coach IDs were in bookmarks');
    }

    await user.save();
    return user;
  }

  async removeBookmarkFields(email: string, fieldIds: string[]) {
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

    // If user has no bookmarks, nothing to remove
    if (!Array.isArray(user.bookmarkFields) || user.bookmarkFields.length === 0) {
      throw new BadRequestException('No bookmark fields to remove');
    }

    const validIdStrings = validIds.map(id => new Types.ObjectId(id).toString());
    const beforeCount = (user.bookmarkFields || []).length;

    user.bookmarkFields = (user.bookmarkFields || []).filter((f: any) => !validIdStrings.includes((f as any).toString()));

    const afterCount = (user.bookmarkFields || []).length;
    if (beforeCount === afterCount) {
      throw new BadRequestException('None of the provided field IDs were in bookmarks');
    }

    await user.save();
    return user;
  }

  async setBookmarkFields(email: string, bookmarkFields: string[]) {
    const user = await this.userModel.findOne({ email });
    if (!user) {
      throw new BadRequestException('User not found');
    }

    if (!Array.isArray(bookmarkFields)) {
      throw new BadRequestException('bookmarkFields must be an array');
    }

    // Validate and convert field IDs to ObjectId
    const validIds: Types.ObjectId[] = [];
    for (const id of bookmarkFields) {
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

    // Ensure user's bookmarkFields is an array
    if (!Array.isArray(user.bookmarkFields)) user.bookmarkFields = [];

    const currentFieldIds = user.bookmarkFields.map((c: any) => c.toString());

    // Filter new field IDs (remove duplicates)
    const newFieldIds = fieldIdStrings.filter((id) => !currentFieldIds.includes(id));

    if (newFieldIds.length === 0) {
      throw new BadRequestException('All provided fields are already in bookmarks');
    }

    user.bookmarkFields.push(...newFieldIds.map((id) => new Types.ObjectId(id)));
    await user.save();
    return user;
  }

  /**
   * Return bookmark fields for a user with minimal data
   * @param email - user email
   * @returns array of { _id, name, avatar, totalBookings }
   */
  async getBookmarkFields(email: string) {
    const user = await this.userModel.findOne({ email }).lean();
    if (!user) {
      throw new BadRequestException('User not found');
    }

    const bookmarkFields = Array.isArray(user.bookmarkFields)
      ? user.bookmarkFields.map((f: any) => (typeof f === 'string' ? f : (f as any).toString()))
      : [];

    if (bookmarkFields.length === 0) return [];

    // Fetch basic field info
    const fields = await this.fieldModel
      .find({ _id: { $in: bookmarkFields.map((id) => new Types.ObjectId(id)) }, isActive: true })
      .select('name images')
      .lean()
      .exec();

    // Aggregate booking counts per field
    const agg = await this.bookingModel
      .aggregate([
        { $match: { field: { $in: fields.map((f) => new Types.ObjectId((f as any)._id)) } } },
        { $group: { _id: '$field', totalBookings: { $sum: 1 } } },
      ])
      .exec();

    const countsMap: Record<string, number> = {};
    for (const c of agg) countsMap[(c._id as any).toString()] = c.totalBookings || 0;

    return fields.map((f: any) => ({
      _id: (f._id as any).toString(),
      name: f.name,
      avatar: Array.isArray(f.images) && f.images.length > 0 ? f.images[0] : null,
      totalBookings: countsMap[(f._id as any).toString()] || 0,
    }));
  }

  /**
   * Return bookmark coaches for a user with minimal data
   * @param email - user email
   * @returns array of { _id, name, avatar, totalBookings }
   */
  async getBookmarkCoaches(email: string): Promise<BookmarkCoachDto[]> {
    const user = await this.userModel.findOne({ email }).lean();
    if (!user) {
      throw new BadRequestException('User not found');
    }

    const bookmarkCoaches = Array.isArray(user.bookmarkCoaches)
      ? user.bookmarkCoaches.map((c: any) => (typeof c === 'string' ? c : (c as any).toString()))
      : [];

    if (bookmarkCoaches.length === 0) return [];

    // Fetch basic coach info (users with role COACH)
    const coaches = await this.userModel
      .find({ _id: { $in: bookmarkCoaches.map((id) => new Types.ObjectId(id)) }, role: UserRole.COACH })
      .select('fullName avatarUrl')
      .lean()
      .exec();

    // Aggregate booking counts per requestedCoach
    const agg = await this.bookingModel
      .aggregate([
        { $match: { requestedCoach: { $in: coaches.map((c) => new Types.ObjectId((c as any)._id)) } } },
        { $group: { _id: '$requestedCoach', totalBookings: { $sum: 1 } } },
      ])
      .exec();

    const countsMap: Record<string, number> = {};
    for (const c of agg) countsMap[(c._id as any).toString()] = c.totalBookings || 0;

    return coaches.map((c: any) => ({
      _id: (c._id as any).toString(),
      name: c.fullName,
      avatar: c.avatarUrl || null,
      totalBookings: countsMap[(c._id as any).toString()] || 0,
    })) as BookmarkCoachDto[];
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

  async changePassword(userId: string, body: { oldPassword: string; newPassword: string; confirmPassword: string }) {
    const { oldPassword, newPassword, confirmPassword } = body;
    if (newPassword !== confirmPassword) {
      throw new BadRequestException('Mật khẩu xác nhận không khớp');
    }

    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.password) {
      const isMatch = await bcrypt.compare(oldPassword, user.password);
      if (!isMatch) {
        throw new BadRequestException('Mật khẩu cũ không đúng');
      }
    } else {
      throw new BadRequestException('Tài khoản này chưa thiết lập mật khẩu');
    }

    const hashed = await bcrypt.hash(newPassword, 10);
    user.password = hashed;
    await user.save();

    return { message: 'Đổi mật khẩu thành công' };
  }

  async deactivate(id: string): Promise<{ message: string }> {
    const user = await this.userRepository.findById(id);
    if (!user) throw new NotFoundException('User not found');

    const updated = await this.userRepository.update(id, { isActive: false });
    if (!updated) throw new BadRequestException('Failed to deactivate user');

    return { message: 'Tài khoản đã được vô hiệu hóa thành công' };
  }
}
