import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User, UserRole } from 'src/modules/users/entities/user.entity';
import { CoachProfile } from 'src/modules/coaches/entities/coach-profile.entity';
import { CoachesDto } from './dtos/coaches.dto';
import { SportType } from 'src/common/enums/sport-type.enum';
import { Schedule } from 'src/modules/schedules/entities/schedule.entity';
import { LessonType } from 'src/modules/lessontypes/entities/lesson-type.entity';
@Injectable()
export class CoachesService {
  constructor(
    @InjectModel(User.name) private userModel: Model<User>,
    @InjectModel(Schedule.name) private scheduleModel: Model<Schedule>,
    @InjectModel(CoachProfile.name)
    private coachProfileModel: Model<CoachProfile>,
    @InjectModel(LessonType.name)
    private lessonTypeModel: Model<LessonType>,
  ) {}

  async findAll(query?: {
    name?: string;
    sportType?: SportType;
    minRate?: number;
    maxRate?: number;
  }): Promise<CoachesDto[]> {
    const userFilter: any = { role: UserRole.COACH };
    if (query?.name)
      userFilter.fullName = { $regex: query.name, $options: 'i' };

    const users = await this.userModel.find(userFilter).lean();

    const profileFilter: any = { user: { $in: users.map((u) => u._id) } };
    if (query?.sportType) profileFilter.sports = query.sportType;
    if (query?.minRate)
      profileFilter.hourlyRate = {
        ...profileFilter.hourlyRate,
        $gte: query.minRate,
      };
    if (query?.maxRate)
      profileFilter.hourlyRate = {
        ...profileFilter.hourlyRate,
        $lte: query.maxRate,
      };

    const profiles = await this.coachProfileModel.find(profileFilter).lean();

    const result = users
      .map((user) => {
        const profile = profiles.find(
          (p) => p.user.toString() === user._id.toString(),
        );
        if (!profile) return undefined; // hoặc return null
        return {
          id: user._id.toString(),
          fullName: user.fullName,
          email: user.email,
          avatarUrl: user.avatarUrl ?? undefined,
          isVerified: user.isVerified,
          sports: profile.sports,
          certification: profile.certification,
          hourlyRate: profile.hourlyRate,
          bio: profile.bio,
          rating: profile.rating,
          totalReviews: profile.totalReviews,
        } as CoachesDto;
      })
      .filter((coach): coach is CoachesDto => !!coach);

    return result;
  }

  async getAllCoaches(): Promise<any[]> {
    const users = await this.userModel.find({ role: UserRole.COACH }).lean();
    const profiles = await this.coachProfileModel
      .find({ user: { $in: users.map((u) => u._id) } })
      .lean();

    return users.map((user) => {
      const profile = profiles.find(
        (p) => p.user.toString() === user._id.toString(),
      );
      return {
        id: user._id.toString(),
        name: user.fullName,
        location: (user as any).location ?? '', // fallback for missing location field
        description: profile?.bio ?? '',
        rating: profile?.rating ?? 0,
        totalReviews: profile?.totalReviews ?? 0, // TODO: fetch recent reviews
        price: profile?.hourlyRate ?? 0,
        nextAvailability: null, // TODO: fetch next available slot
      };
    });
  }

  async getCoachById(id: string): Promise<any> {
    // Find user by ID and role
    const user = await this.userModel
      .findOne({ _id: id, role: UserRole.COACH })
      .lean();
    if (!user) return null;
    // Find coach profile
    const profile = await this.coachProfileModel
      .findOne({ user: user._id })
      .lean();

    // Fetch availableSlots from Schedule entity
    const schedule = await this.scheduleModel
      ?.findOne({ coach: profile?._id })
      .lean();
    const availableSlots = schedule?.bookedSlots ?? [];

    // Fetch lesson types from LessonType entity
    const lessonTypes = await this.lessonTypeModel
      .find({ user: user._id })
      .lean();

    return {
      id: user._id.toString(),
      name: user.fullName,
      profileImage: user.avatarUrl ?? '',
      description: profile?.bio ?? '',
      rating: profile?.rating ?? 0,
      reviewCount: profile?.totalReviews ?? 0,
      location: (user as any).location ?? '',
      level: profile?.certification ?? '',
      completedSessions: profile?.completedSessions ?? 0,
      createdAt: (profile as any)?.createdAt ?? '',
      availableSlots,
      lessonTypes,
      price: profile?.hourlyRate ?? 0,

      coachingDetails: {
        experience: profile?.experience ?? '',
        certification: profile?.certification ?? '',
      },
    };
  }
}
