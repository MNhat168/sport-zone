import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User } from 'src/modules/users/entities/user.entity';
import { UserRole } from '@common/enums/user.enum';
import { CoachProfile } from 'src/modules/coaches/entities/coach-profile.entity';
import { BankAccount } from '../field-owner/entities/bank-account.entity';
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
    @InjectModel(BankAccount.name)
    private bankAccountModel: Model<BankAccount>,
    @InjectModel(LessonType.name)
    private lessonTypeModel: Model<LessonType>,
  ) {}

  async findAll(query?: {
    name?: string;
    sportType?: SportType;
    minRate?: number;
    maxRate?: number;
    district?: string; // Filter by district (quận)
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

    let result = users
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
          location: profile.location, // Add location for filtering
        } as CoachesDto & { location?: string };
      })
      .filter((coach): coach is CoachesDto & { location?: string } => !!coach);

    // Filter by district if provided
    if (query?.district) {
      const districtLower = query.district.toLowerCase();
      result = result.filter((coach) => {
        // Check coach.location first (priority)
        if (coach.location && coach.location.toLowerCase().includes(districtLower)) {
          return true;
        }
        // TODO: Fallback to check field.location.address if coach teaches at fields
        // For now, only filter by coach.location
        return false;
      });
    }

    return result.map(({ location, ...coach }) => coach); // Remove location from final result
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
        location: typeof profile?.location === 'string' 
          ? profile.location 
          : profile?.location?.address ?? '', // Support both old string format and new object format
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

    if (!profile) return null;

    // Fetch bank account (default)
    const bankAccount = await this.bankAccountModel
      .findOne({ 
        coach: new Types.ObjectId(String(profile._id)),
        isDefault: true 
      })
      .lean();

    // Fetch availableSlots from Schedule entity
    const schedule = await this.scheduleModel
      ?.findOne({ coach: profile._id })
      .lean();
    const availableSlots = schedule?.bookedSlots ?? [];

    // Fetch lesson types from LessonType entity (user as string)
    const lessonTypes = await this.lessonTypeModel
      .find({ user: user._id.toString() })
      .lean();
    // Logging for debugging lessonTypes fetch
    console.log('getCoachById - user._id:', user._id);
    console.log('getCoachById - lessonTypes:', lessonTypes);

    return {
      id: user._id.toString(),
      name: user.fullName,
      avatar: user.avatarUrl ?? '',
      description: profile?.bio ?? '',
      rating: profile?.rating ?? 0,
      numberOfReviews: profile?.totalReviews ?? 0,
      location: typeof profile?.location === 'string' 
        ? profile.location 
        : profile?.location?.address ?? '', // Support both old string format and new object format
      locationData: profile?.location && typeof profile.location === 'object' 
        ? profile.location 
        : null, // Return full location object with geo coordinates
      level: profile?.certification ?? '',
      completedSessions: profile?.completedSessions ?? 0,
      memberSince: (profile as any)?.createdAt ?? '',
      availableSlots,
      lessonTypes,
      price: profile?.hourlyRate ?? 0,
      rank: profile?.rank ?? 'novice',
      coachingDetails: {
        experience: profile?.experience ?? '',
        certification: profile?.certification ?? '',
      },
      bankAccount: bankAccount ? {
        accountName: bankAccount.accountName,
        accountNumber: bankAccount.accountNumber,
        bankName: bankAccount.bankName,
        qrCodeUrl: bankAccount.qrCodeUrl,
      } : null,
    };
  }

  /**
   * Get coach bank account (default account with STK + QR code)
   * Used for displaying payment information when booking coach
   */
  async getCoachBankAccount(coachId: string): Promise<any> {
    // Find coach profile by user ID
    const coachProfile = await this.coachProfileModel
      .findOne({ user: new Types.ObjectId(coachId) })
      .lean();

    if (!coachProfile) {
      throw new NotFoundException('Coach profile not found');
    }

    // Find default bank account for this coach
    const bankAccount = await this.bankAccountModel
      .findOne({ 
        coach: new Types.ObjectId(String(coachProfile._id)),
        isDefault: true 
      })
      .lean();

    if (!bankAccount) {
      throw new NotFoundException('Coach bank account not found. Please contact the coach.');
    }

    return {
      accountName: bankAccount.accountName,
      accountNumber: bankAccount.accountNumber,
      bankName: bankAccount.bankName,
      bankCode: bankAccount.bankCode,
      qrCodeUrl: bankAccount.qrCodeUrl,
      branch: bankAccount.branch,
    };
  }

  /**
   * Get available time slots for a coach on a specific date
   * Returns slots from 8h-21h, excluding booked slots
   */
  async getCoachAvailableSlots(coachId: string, date: string): Promise<{
    startTime: string;
    endTime: string;
    available: boolean;
  }[]> {
    // Find coach profile
    const coachProfile = await this.coachProfileModel
      .findOne({ user: new Types.ObjectId(coachId) })
      .lean();

    if (!coachProfile) {
      throw new NotFoundException('Coach profile not found');
    }

    // Parse date
    // ✅ CRITICAL: Use UTC methods to normalize date
    const bookingDate = new Date(date);
    bookingDate.setUTCHours(0, 0, 0, 0);

    // Get schedule for this coach and date
    const schedule = await this.scheduleModel
      .findOne({
        coach: new Types.ObjectId(String(coachProfile._id)),
        date: bookingDate
      })
      .lean();

    // Generate all possible slots from 8h-21h (1 hour slots)
    const slots: { startTime: string; endTime: string; available: boolean }[] = [];
    for (let hour = 8; hour < 21; hour++) {
      const startTime = `${hour.toString().padStart(2, '0')}:00`;
      const endTime = `${(hour + 1).toString().padStart(2, '0')}:00`;
      
      // Check if this slot is booked
      const isBooked = schedule?.bookedSlots?.some(bookedSlot => {
        const bookedStart = this.timeStringToMinutes(bookedSlot.startTime);
        const bookedEnd = this.timeStringToMinutes(bookedSlot.endTime);
        const slotStart = this.timeStringToMinutes(startTime);
        const slotEnd = this.timeStringToMinutes(endTime);
        
        // Check for overlap
        return slotStart < bookedEnd && slotEnd > bookedStart;
      }) || false;

      slots.push({
        startTime,
        endTime,
        available: !isBooked && !schedule?.isHoliday,
      });
    }

    return slots;
  }

  /**
   * Helper: Convert time string (HH:MM) to minutes
   */
  private timeStringToMinutes(time: string): number {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
  }
}
