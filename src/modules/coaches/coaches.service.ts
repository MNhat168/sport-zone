import { BadRequestException, ForbiddenException, Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
import { CoachRegistrationRequest } from './entities/coach-registration-request.entity';
import {
  CreateCoachRegistrationDto,
  UpdateCoachRegistrationDto,
  ApproveCoachRegistrationDto,
  CoachRegistrationResponseDto,
} from './dtos/coach-registration.dto';
import { RegistrationStatus } from '@common/enums/field-owner-registration.enum';
import { EmailService } from 'src/modules/email/email.service';
import { BankAccountStatus } from '@common/enums/bank-account.enum';
import {
  CreateBankAccountDto,
  UpdateBankAccountDto,
  BankAccountResponseDto,
} from '../field-owner/dtos/bank-account.dto';
import { PayOSService } from '../transactions/payos.service';
import { Transaction } from '../transactions/entities/transaction.entity';
import { TransactionStatus, TransactionType } from '@common/enums/transaction.enum';
import { PaymentMethod } from 'src/common/enums/payment-method.enum';
import { generatePayOSOrderCode } from '../transactions/utils/payos.utils';
@Injectable()
export class CoachesService {
  private readonly logger = new Logger(CoachesService.name);

  constructor(
    @InjectModel(User.name) private userModel: Model<User>,
    @InjectModel(Schedule.name) private scheduleModel: Model<Schedule>,
    @InjectModel(CoachProfile.name)
    private coachProfileModel: Model<CoachProfile>,
    @InjectModel(BankAccount.name)
    private bankAccountModel: Model<BankAccount>,
    @InjectModel(LessonType.name)
    private lessonTypeModel: Model<LessonType>,
    @InjectModel(CoachRegistrationRequest.name)
    private registrationRequestModel: Model<CoachRegistrationRequest>,
    @InjectModel(Transaction.name)
    private transactionModel: Model<Transaction>,
    private readonly emailService: EmailService,
    private readonly payosService: PayOSService,
    private readonly configService: ConfigService,
  ) { }

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
          rank: profile.rank ?? undefined,
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
        rank: profile?.rank ?? undefined,
        nextAvailability: null, // TODO: fetch next available slot
      };
    });
  }

  /**
   * Public listing of coaches optionally filtered by sports array
   * @param sports optional array of SportType to filter coaches
   */
  async getAllCoachesPublic(sports?: SportType[]): Promise<any[]> {
    const users = await this.userModel.find({ role: UserRole.COACH }).lean();

    const profileFilter: any = { user: { $in: users.map((u) => u._id) } };
    if (sports && sports.length > 0) {
      profileFilter.sports = { $in: sports };
    }

    const profiles = await this.coachProfileModel.find(profileFilter).lean();

    return profiles.map((profile) => {
      const user = users.find((u) => u._id.toString() === profile.user.toString());
      return {
        id: user?._id?.toString() ?? profile.user.toString(),
        name: user?.fullName ?? '',
        location: typeof profile?.location === 'string'
          ? profile.location
          : profile?.location?.address ?? '',
        description: profile?.bio ?? '',
        rating: profile?.rating ?? 0,
        totalReviews: profile?.totalReviews ?? 0,
        price: profile?.hourlyRate ?? 0,
        rank: profile?.rank ?? undefined,
        sports: profile?.sports ?? [],
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
      level: profile?.rank ?? profile?.certification ?? '',
      completedSessions: profile?.completedSessions ?? 0,
      memberSince: (profile as any)?.createdAt ?? '',
      availableSlots,
      lessonTypes,
      price: profile?.hourlyRate ?? 0,
      sports: profile?.sports ?? [],
      rank: profile?.rank ?? 'novice',
      coachingDetails: {
        experience: profile?.experience ?? '',
        certification: profile?.certification ?? '',
        sports: profile?.sports ?? [],
      },
      galleryImages: profile?.galleryImages ?? [],
      bankAccount: bankAccount ? {
        accountName: bankAccount.accountName,
        accountNumber: bankAccount.accountNumber,
        bankName: bankAccount.bankName,
        qrCodeUrl: bankAccount.qrCodeUrl,
      } : null,
    };
  }

  async updateCoach(id: string, payload: Partial<any>): Promise<any> {
    // Validate coach user exists
    const user = await this.userModel.findOne({ _id: id, role: UserRole.COACH });
    if (!user) throw new NotFoundException('Coach not found');

    // Update coach profile
    const profileUpdates: any = {};
    if (payload.bio !== undefined) profileUpdates.bio = payload.bio;
    if (payload.sports !== undefined) profileUpdates.sports = payload.sports;
    if (payload.certification !== undefined) profileUpdates.certification = payload.certification;
    if (payload.rank !== undefined) profileUpdates.rank = payload.rank;
    if (payload.experience !== undefined) profileUpdates.experience = payload.experience;
    if (payload.galleryImages !== undefined) profileUpdates.galleryImages = payload.galleryImages;

    if (Object.keys(profileUpdates).length > 0) {
      await this.coachProfileModel.updateOne({ user: user._id }, { $set: profileUpdates }).exec();
    }

    // Return updated record
    return this.getCoachById(id);
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

  /**
   * Get all coach profiles for admin with pagination and filtering
   */
  async getAllCoachProfiles(
    page: number = 1,
    limit: number = 10,
    search?: string,
    isVerified?: boolean,
    sortBy: string = 'createdAt',
    sortOrder: 'asc' | 'desc' = 'desc',
  ) {
    try {
      const filter: any = {};

      if (search) {
        // Search by user fullName or profile location
        const users = await this.userModel
          .find({
            role: UserRole.COACH,
            fullName: { $regex: search, $options: 'i' }
          })
          .select('_id')
          .lean();
        
        const userIds = users.map(u => u._id);
        
        filter.$or = [
          { user: { $in: userIds } },
          { 'location.address': { $regex: search, $options: 'i' } },
        ];
      }

      if (isVerified !== undefined) {
        filter.bankVerified = isVerified;
      }

      const sortValue = sortOrder === 'asc' ? 1 : -1;
      const sortField = ['rating', 'hourlyRate', 'createdAt'].includes(sortBy) ? sortBy : 'createdAt';

      const skip = (page - 1) * limit;

      const [profiles, total] = await Promise.all([
        this.coachProfileModel
          .find(filter)
          .populate('user', 'fullName email phone role avatarUrl')
          .sort({ [sortField]: sortValue })
          .skip(skip)
          .limit(limit)
          .exec(),
        this.coachProfileModel.countDocuments(filter),
      ]);

      const data = profiles
        .filter((profile) => profile.user !== null)
        .map((profile) => {
          const user = profile.user as any;
          return {
            id: (profile._id as Types.ObjectId).toString(),
            userId: user._id.toString(),
            fullName: user.fullName,
            email: user.email,
            phone: user.phone,
            avatarUrl: user.avatarUrl,
            sports: profile.sports,
            certification: profile.certification,
            hourlyRate: profile.hourlyRate,
            bio: profile.bio,
            experience: profile.experience,
            location: profile.location,
            rating: profile.rating,
            totalReviews: profile.totalReviews,
            completedSessions: profile.completedSessions,
            rank: profile.rank,
            bankVerified: profile.bankVerified,
            createdAt: (profile as any).createdAt,
          };
        });

      return {
        data,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      this.logger.error('Error getting all coach profiles', error);
      throw new InternalServerErrorException('Failed to get coach profiles');
    }
  }


  // ==================== Coach Registration Methods ====================

  /**
   * Create a new coach registration request
   */
  async createRegistrationRequest(
    userId: string,
    dto: CreateCoachRegistrationDto,
  ): Promise<CoachRegistrationResponseDto> {
    try {
      // Check for existing pending or approved registration
      const existingRequest = await this.registrationRequestModel.findOne({
        userId: new Types.ObjectId(userId),
        status: { $in: [RegistrationStatus.PENDING, RegistrationStatus.APPROVED] },
      });

      if (existingRequest) {
        throw new BadRequestException('You already have a pending or approved registration request');
      }

      // Check if user is already a coach
      const existingProfile = await this.coachProfileModel.findOne({
        user: new Types.ObjectId(userId),
      });

      if (existingProfile) {
        throw new BadRequestException('You are already a coach');
      }

      // Create registration request
      const registrationRequest = new this.registrationRequestModel({
        userId: new Types.ObjectId(userId),
        personalInfo: dto.personalInfo,
        // eKYC fields
        ekycSessionId: dto.ekycSessionId,
        ekycData: dto.ekycData,
        ekycStatus: dto.ekycData ? 'verified' : (dto.ekycSessionId ? 'pending' : undefined),
        ekycVerifiedAt: dto.ekycData ? new Date() : undefined,
        // Coach profile data
        sports: dto.sports,
        certification: dto.certification,
        hourlyRate: dto.hourlyRate,
        bio: dto.bio,
        experience: dto.experience,
        // Location data
        locationAddress: dto.locationAddress,
        locationCoordinates: dto.locationCoordinates
          ? {
            type: 'Point' as const,
            coordinates: [
              dto.locationCoordinates.lng,
              dto.locationCoordinates.lat,
            ],
          }
          : undefined,
        // Photos
        profilePhoto: dto.profilePhoto,
        certificationPhotos: dto.certificationPhotos || [],
        status: RegistrationStatus.PENDING,
        submittedAt: new Date(),
        isLatest: true,
      });

      const savedRequest = await registrationRequest.save();

      // Send notification email (non-blocking)
      try {
        const user = await this.userModel.findById(userId).exec();
        if (user) {
          await this.emailService.sendCoachRegistrationSubmitted(user.email, user.fullName);
        }
      } catch (emailError) {
        this.logger.warn('Failed to send registration email', emailError);
      }

      return this.mapToRegistrationDto(savedRequest);
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error('Error creating registration request', error);
      throw new InternalServerErrorException('Failed to create registration request');
    }
  }

  /**
   * Get current user's registration request
   */
  async getMyRegistrationRequest(userId: string) {
    const request = await this.registrationRequestModel
      .findOne({ userId: new Types.ObjectId(userId), isLatest: true })
      .sort({ submittedAt: -1 })
      .exec();

    if (!request) {
      throw new NotFoundException('No registration request found');
    }

    return this.mapToRegistrationDto(request);
  }

  /**
   * Get registration request by ID (admin)
   */
  async getRegistrationRequest(requestId: string): Promise<CoachRegistrationResponseDto> {
    const request = await this.registrationRequestModel.findById(requestId).exec();

    if (!request) {
      throw new NotFoundException('Registration request not found');
    }

    return this.mapToRegistrationDto(request);
  }

  /**
   * Get all pending registration requests (admin)
   */
  async getPendingRegistrationRequests(page: number = 1, limit: number = 10) {
    const skip = (page - 1) * limit;

    const [requests, total] = await Promise.all([
      this.registrationRequestModel
        .find({ status: RegistrationStatus.PENDING })
        .sort({ submittedAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.registrationRequestModel.countDocuments({ status: RegistrationStatus.PENDING }),
    ]);

    return {
      data: requests.map(req => this.mapToRegistrationDto(req)),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Approve registration request and create coach profile
   */
  async approveRegistrationRequest(
    requestId: string,
    adminId: string,
    dto: ApproveCoachRegistrationDto,
  ): Promise<any> {
    const session = await this.coachProfileModel.db.startSession();
    session.startTransaction();

    try {
      const request = await this.registrationRequestModel
        .findById(requestId)
        .session(session)
        .exec();

      if (!request) {
        throw new NotFoundException('Registration request not found');
      }

      if (request.status !== RegistrationStatus.PENDING) {
        throw new BadRequestException('Registration request is not pending');
      }

      // Check eKYC if present
      if (request.ekycSessionId) {
        if (request.ekycStatus !== 'verified') {
          throw new BadRequestException(
            `Cannot approve: eKYC not verified. Current status: ${request.ekycStatus || 'unknown'}`,
          );
        }

        const idNumber = request.ekycData?.identityCardNumber || request.ekycData?.idNumber;
        if (!request.ekycData || !request.ekycData.fullName || !idNumber) {
          throw new BadRequestException('Cannot approve: eKYC data missing or incomplete');
        }
      }

      // Admin can override request data with dto
      const sports = dto.sports ?? request.sports;
      const certification = dto.certification ?? request.certification;
      const hourlyRate = dto.hourlyRate ?? request.hourlyRate;
      const bio = dto.bio ?? request.bio;
      const experience = dto.experience ?? request.experience;
      const locationAddress = dto.locationAddress ?? request.locationAddress;
      const locationCoordinates = dto.locationCoordinates
        ? {
          type: 'Point' as const,
          coordinates: [dto.locationCoordinates.lng, dto.locationCoordinates.lat],
        }
        : request.locationCoordinates;

      // Create coach profile
      const profile = new this.coachProfileModel({
        user: request.userId,
        sports,
        certification,
        hourlyRate,
        bio,
        experience,
        location: {
          address: locationAddress,
          geo: locationCoordinates,
        },
        completedSessions: 0,
        rating: 0,
        totalReviews: 0,
        rank: 'novice',
        bankVerified: false,
      });

      const savedProfile = await profile.save({ session });

      // Update registration request status
      request.status = RegistrationStatus.APPROVED;
      request.processedAt = new Date();
      request.processedBy = new Types.ObjectId(adminId);
      await request.save({ session });

      // Update user role and sync eKYC data
      const userUpdateData: any = {
        role: UserRole.COACH,
      };

      if (request.ekycData) {
        const idNumber = request.ekycData.identityCardNumber || request.ekycData.idNumber;
        if (idNumber) {
          userUpdateData.idNumber = idNumber;
        }

        const address = request.ekycData.permanentAddress || request.ekycData.address;
        if (address) {
          userUpdateData.address = address;
        }

        if (request.ekycData.fullName) {
          userUpdateData.fullName = request.ekycData.fullName;
        }
      }

      await this.userModel
        .updateOne({ _id: request.userId }, { $set: userUpdateData })
        .session(session)
        .exec();

      await session.commitTransaction();

      // Send approval email (non-blocking)
      try {
        const user = await this.userModel.findById(request.userId).exec();
        if (user) {
          await this.emailService.sendCoachRegistrationApproved(user.email, user.fullName);
        }
      } catch (emailError) {
        this.logger.warn('Failed to send approval email', emailError);
      }

      return {
        id: (savedProfile._id as Types.ObjectId).toString(),
        user: savedProfile.user.toString(),
        sports: savedProfile.sports,
        certification: savedProfile.certification,
        hourlyRate: savedProfile.hourlyRate,
        bio: savedProfile.bio,
      };
    } catch (error) {
      await session.abortTransaction();
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Error approving registration request', error);
      throw new InternalServerErrorException('Failed to approve registration request');
    } finally {
      session.endSession();
    }
  }

  /**
   * Reject registration request
   */
  async rejectRegistrationRequest(
    requestId: string,
    adminId: string,
    reason: string,
  ): Promise<CoachRegistrationResponseDto> {
    const request = await this.registrationRequestModel.findById(requestId).exec();

    if (!request) {
      throw new NotFoundException('Registration request not found');
    }

    if (request.status !== RegistrationStatus.PENDING) {
      throw new BadRequestException('Registration request is not pending');
    }

    request.status = RegistrationStatus.REJECTED;
    request.rejectionReason = reason;
    request.processedAt = new Date();
    request.processedBy = new Types.ObjectId(adminId);

    await request.save();

    return this.mapToRegistrationDto(request);
  }

  /**
   * Update pending registration request
   */
  async updateRegistrationRequest(
    requestId: string,
    userId: string,
    dto: UpdateCoachRegistrationDto,
  ): Promise<CoachRegistrationResponseDto> {
    const request = await this.registrationRequestModel.findOne({
      _id: requestId,
      userId: new Types.ObjectId(userId),
    }).exec();

    if (!request) {
      throw new NotFoundException('Registration request not found');
    }

    if (request.status !== RegistrationStatus.PENDING) {
      throw new BadRequestException('Can only update pending registration requests');
    }

    // Update fields
    if (dto.personalInfo) request.personalInfo = dto.personalInfo;
    if (dto.sports) request.sports = dto.sports;
    if (dto.certification) request.certification = dto.certification;
    if (dto.hourlyRate !== undefined) request.hourlyRate = dto.hourlyRate;
    if (dto.bio) request.bio = dto.bio;
    if (dto.experience) request.experience = dto.experience;
    if (dto.locationAddress) request.locationAddress = dto.locationAddress;
    if (dto.locationCoordinates) {
      request.locationCoordinates = {
        type: 'Point',
        coordinates: [dto.locationCoordinates.lng, dto.locationCoordinates.lat],
      };
    }
    if (dto.profilePhoto) request.profilePhoto = dto.profilePhoto;
    if (dto.certificationPhotos) request.certificationPhotos = dto.certificationPhotos;

    await request.save();

    return this.mapToRegistrationDto(request);
  }

  /**
   * Helper: Map entity to DTO
   */
  private mapToRegistrationDto(request: any): CoachRegistrationResponseDto {
    return {
      id: request._id.toString(),
      userId: request.userId.toString(),
      personalInfo: request.personalInfo,
      ekycSessionId: request.ekycSessionId,
      ekycStatus: request.ekycStatus,
      ekycVerifiedAt: request.ekycVerifiedAt,
      ekycData: request.ekycData,
      status: request.status,
      sports: request.sports,
      certification: request.certification,
      hourlyRate: request.hourlyRate,
      bio: request.bio,
      experience: request.experience,
      locationAddress: request.locationAddress,
      locationCoordinates: request.locationCoordinates
        ? {
          lat: request.locationCoordinates.coordinates[1],
          lng: request.locationCoordinates.coordinates[0],
        }
        : undefined,
      profilePhoto: request.profilePhoto,
      certificationPhotos: request.certificationPhotos,
      rejectionReason: request.rejectionReason,
      submittedAt: request.submittedAt,
      processedAt: request.processedAt,
      processedBy: request.processedBy?.toString(),
      reviewedAt: request.reviewedAt,
      reviewedBy: request.reviewedBy?.toString(),
    };
  }

  // ==================== Bank Account Methods for Coach ====================

  /**
   * Add bank account for coach
   */
  async addBankAccountForCoach(
    userId: string,
    dto: CreateBankAccountDto,
  ): Promise<BankAccountResponseDto> {
    try {
      if (!dto.verificationDocument) {
        throw new BadRequestException('Vui lòng cung cấp ảnh/QR tài khoản ngân hàng để rút tiền');
      }

      // Find coach profile
      const coachProfile = await this.coachProfileModel
        .findOne({ user: new Types.ObjectId(userId) })
        .exec();

      if (!coachProfile) {
        throw new NotFoundException('Coach profile not found');
      }

      const coachId = (coachProfile._id as Types.ObjectId).toString();

      // Check for duplicate bank account
      const existingAccount = await this.bankAccountModel.findOne({
        coach: new Types.ObjectId(coachId),
        accountNumber: dto.accountNumber,
        bankCode: dto.bankCode,
      }).exec();

      if (existingAccount) {
        throw new BadRequestException(
          `Tài khoản ngân hàng ${dto.accountNumber} (${dto.bankCode}) đã được khai báo. Vui lòng kiểm tra lại.`
        );
      }

      const bankAccount = new this.bankAccountModel({
        coach: new Types.ObjectId(coachId),
        bankCode: dto.bankCode,
        bankName: dto.bankName,
        accountNumber: dto.accountNumber,
        accountName: dto.accountName,
        branch: dto.branch,
        verificationDocument: dto.verificationDocument,
        status: BankAccountStatus.PENDING,
        isDefault: dto.isDefault ?? false,
        verificationAmount: 10000,
        verificationPaymentStatus: 'pending',
      });

      const savedAccount = await bankAccount.save();

      // Create verification payment
      let verificationUrl: string | undefined;
      let verificationQrCode: string | undefined;

      if (!dto.skipVerification) {
        try {
          const verification = await this.createVerificationPaymentForCoach(
            (savedAccount._id as Types.ObjectId).toString(),
            userId,
          );
          verificationUrl = verification.verificationUrl;
          verificationQrCode = verification.verificationQrCode;
        } catch (verificationError) {
          this.logger.warn(
            `Failed to create verification payment for bank account ${savedAccount._id}:`,
            verificationError,
          );
        }
      }

      const response = this.mapToBankAccountDto(savedAccount);
      response.verificationUrl = verificationUrl;
      response.verificationQrCode = verificationQrCode;
      response.needsVerification = !dto.skipVerification;
      response.verificationPaymentStatus = savedAccount.verificationPaymentStatus || 'pending';
      response.verificationOrderCode = savedAccount.verificationOrderCode;

      return response;
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Error adding bank account for coach', error);
      throw new InternalServerErrorException('Failed to add bank account');
    }
  }


  /**
   * Auto-heal bank account: promote to VERIFIED if payment is paid but status is still pending
   * @private
   */
  private async autoHealBankAccount(account: any): Promise<void> {
    if (
      account.verificationPaymentStatus === 'paid' &&
      account.status === BankAccountStatus.PENDING
    ) {
      this.logger.warn(
        `[Auto-Heal] Coach bank account ${account._id} has paid verification but status is still pending. Promoting to VERIFIED...`,
      );
      account.status = BankAccountStatus.VERIFIED;
      account.isValidatedByPayOS = true;
      if (!account.verifiedAt) {
        account.verifiedAt = new Date();
      }
      await account.save();
      this.logger.log(`[Auto-Heal] ✅ Coach bank account ${account._id} promoted to VERIFIED`);
    }
  }

  /**
   * Get bank accounts for coach
   */
  async getBankAccountsForCoach(userId: string): Promise<BankAccountResponseDto[]> {
    try {
      // Find coach profile
      const coachProfile = await this.coachProfileModel
        .findOne({ user: new Types.ObjectId(userId) })
        .exec();

      if (!coachProfile) {
        throw new NotFoundException('Coach profile not found');
      }

      const coachId = (coachProfile._id as Types.ObjectId).toString();

      const accounts = await this.bankAccountModel
        .find({ coach: new Types.ObjectId(coachId) })
        .sort({ isDefault: -1, createdAt: -1 })
        .exec();

      // ✅ AUTO-HEAL: Promote to VERIFIED if payment is paid but status is still pending
      for (const account of accounts) {
        await this.autoHealBankAccount(account);
      }

      return accounts.map((account) => this.mapToBankAccountDto(account));
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Error getting bank accounts for coach', error);
      throw new InternalServerErrorException('Failed to get bank accounts');
    }
  }

  /**
   * Update bank account for coach
   */
  async updateBankAccountForCoach(
    userId: string,
    accountId: string,
    dto: UpdateBankAccountDto,
  ): Promise<BankAccountResponseDto> {
    try {
      // Find coach profile
      const coachProfile = await this.coachProfileModel
        .findOne({ user: new Types.ObjectId(userId) })
        .exec();

      if (!coachProfile) {
        throw new NotFoundException('Coach profile not found');
      }

      const coachId = (coachProfile._id as Types.ObjectId).toString();

      const bankAccount = await this.bankAccountModel.findById(accountId).exec();

      if (!bankAccount) {
        throw new NotFoundException('Bank account not found');
      }

      // Verify account belongs to the coach
      const accountOwnerId = (bankAccount.coach as Types.ObjectId)?.toString();
      if (accountOwnerId !== coachId) {
        throw new ForbiddenException('You do not have permission to update this bank account');
      }

      // Track if account details changed (to reset status)
      const detailsChanged =
        (dto.accountName && dto.accountName !== bankAccount.accountName) ||
        (dto.accountNumber && dto.accountNumber !== bankAccount.accountNumber) ||
        (dto.bankCode && dto.bankCode !== bankAccount.bankCode) ||
        (dto.bankName && dto.bankName !== bankAccount.bankName);

      // Update provided fields
      if (dto.accountName !== undefined) bankAccount.accountName = dto.accountName;
      if (dto.accountNumber !== undefined) bankAccount.accountNumber = dto.accountNumber;
      if (dto.bankCode !== undefined) bankAccount.bankCode = dto.bankCode;
      if (dto.bankName !== undefined) bankAccount.bankName = dto.bankName;
      if (dto.branch !== undefined) bankAccount.branch = dto.branch;
      if (dto.verificationDocument !== undefined) bankAccount.verificationDocument = dto.verificationDocument;

      // Reset status to PENDING if account details changed
      if (detailsChanged) {
        bankAccount.status = BankAccountStatus.PENDING;
        bankAccount.isValidatedByPayOS = false;
        bankAccount.accountNameFromPayOS = undefined;
        bankAccount.verifiedAt = undefined;
        bankAccount.verifiedBy = undefined;
        bankAccount.rejectionReason = undefined;
        bankAccount.notes = undefined;
      }

      // Handle isDefault update
      if (dto.isDefault !== undefined && dto.isDefault === true) {
        await this.bankAccountModel.updateMany(
          {
            coach: new Types.ObjectId(coachId),
            _id: { $ne: new Types.ObjectId(accountId) },
          },
          { isDefault: false },
        );
        bankAccount.isDefault = true;
      } else if (dto.isDefault !== undefined) {
        bankAccount.isDefault = dto.isDefault;
      }

      const updatedAccount = await bankAccount.save();

      return this.mapToBankAccountDto(updatedAccount);
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ForbiddenException) {
        throw error;
      }
      this.logger.error('Error updating bank account for coach', error);
      throw new InternalServerErrorException('Failed to update bank account');
    }
  }

  /**
   * Delete bank account for coach
   */
  async deleteBankAccountForCoach(
    userId: string,
    accountId: string,
  ): Promise<{ success: boolean; message: string }> {
    try {
      // Find coach profile
      const coachProfile = await this.coachProfileModel
        .findOne({ user: new Types.ObjectId(userId) })
        .exec();

      if (!coachProfile) {
        throw new NotFoundException('Coach profile not found');
      }

      const coachId = (coachProfile._id as Types.ObjectId).toString();

      const bankAccount = await this.bankAccountModel.findById(accountId).exec();

      if (!bankAccount) {
        throw new NotFoundException('Bank account not found');
      }

      // Verify account belongs to the coach
      const accountOwnerId = (bankAccount.coach as Types.ObjectId)?.toString();
      if (accountOwnerId !== coachId) {
        throw new ForbiddenException('You do not have permission to delete this bank account');
      }

      const wasDefault = bankAccount.isDefault;

      // Delete the bank account document
      await this.bankAccountModel.findByIdAndDelete(accountId);

      // If deleted account was default, set next verified account as default if available
      if (wasDefault) {
        const nextVerifiedAccount = await this.bankAccountModel
          .findOne({
            coach: new Types.ObjectId(coachId),
            status: BankAccountStatus.VERIFIED,
          })
          .sort({ createdAt: -1 })
          .exec();

        if (nextVerifiedAccount) {
          nextVerifiedAccount.isDefault = true;
          await nextVerifiedAccount.save();
        } else {
          const anyAccount = await this.bankAccountModel
            .findOne({ coach: new Types.ObjectId(coachId) })
            .sort({ createdAt: -1 })
            .exec();

          if (anyAccount) {
            anyAccount.isDefault = true;
            await anyAccount.save();
          }
        }
      }

      return { success: true, message: 'Bank account deleted successfully' };
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ForbiddenException) {
        throw error;
      }
      this.logger.error('Error deleting bank account for coach', error);
      throw new InternalServerErrorException('Failed to delete bank account');
    }
  }

  /**
   * Set default bank account for coach
   */
  async setDefaultBankAccountForCoach(
    userId: string,
    accountId: string,
  ): Promise<BankAccountResponseDto> {
    try {
      // Find coach profile
      const coachProfile = await this.coachProfileModel
        .findOne({ user: new Types.ObjectId(userId) })
        .exec();

      if (!coachProfile) {
        throw new NotFoundException('Coach profile not found');
      }

      const coachId = (coachProfile._id as Types.ObjectId).toString();

      const bankAccount = await this.bankAccountModel.findById(accountId).exec();

      if (!bankAccount) {
        throw new NotFoundException('Bank account not found');
      }

      // Verify account belongs to the coach
      const accountOwnerId = (bankAccount.coach as Types.ObjectId)?.toString();
      if (accountOwnerId !== coachId) {
        throw new ForbiddenException('You do not have permission to modify this bank account');
      }

      // Set all other accounts' isDefault to false
      await this.bankAccountModel.updateMany(
        {
          coach: new Types.ObjectId(coachId),
          _id: { $ne: new Types.ObjectId(accountId) },
        },
        { isDefault: false },
      );

      // Set target account's isDefault to true
      bankAccount.isDefault = true;
      const updatedAccount = await bankAccount.save();

      return this.mapToBankAccountDto(updatedAccount);
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ForbiddenException) {
        throw error;
      }
      this.logger.error('Error setting default bank account for coach', error);
      throw new InternalServerErrorException('Failed to set default bank account');
    }
  }

  /**
   * Get verification status for coach bank account
   */
  async getVerificationStatusForCoach(
    userId: string,
    accountId: string,
  ): Promise<{
    needsVerification: boolean;
    verificationPaymentStatus?: string;
    status: string;
    verificationOrderCode?: string;
    verificationUrl?: string;
    verificationQrCode?: string;
    qrCodeUrl?: string;
  }> {
    try {
      // Find coach profile
      const coachProfile = await this.coachProfileModel
        .findOne({ user: new Types.ObjectId(userId) })
        .exec();

      if (!coachProfile) {
        throw new NotFoundException('Coach profile not found');
      }

      const coachId = (coachProfile._id as Types.ObjectId).toString();

      const bankAccount = await this.bankAccountModel.findById(accountId).exec();
      if (!bankAccount) {
        throw new NotFoundException('Bank account not found');
      }

      // Verify ownership
      const accountOwnerId = (bankAccount.coach as Types.ObjectId)?.toString();
      if (accountOwnerId !== coachId) {
        throw new ForbiddenException('You do not have permission to view this bank account');
      }

      // Note: Auto-heal logic removed - now handled by getBankAccountsForCoach()
      // This method just returns current state

      const needsVerification =
        bankAccount.status === BankAccountStatus.PENDING &&
        bankAccount.verificationPaymentStatus !== 'paid';

      if (!needsVerification) {
        return {
          needsVerification: false,
          verificationPaymentStatus: bankAccount.verificationPaymentStatus,
          status: bankAccount.status,
          verificationOrderCode: bankAccount.verificationOrderCode,
          verificationUrl: bankAccount.verificationUrl,
          verificationQrCode: bankAccount.verificationQrCode,
          qrCodeUrl: bankAccount.verificationQrCode,
        };
      }

      // If verification payment exists, return status
      if (bankAccount.verificationOrderCode) {
        if (
          bankAccount.verificationPaymentStatus !== 'paid' &&
          (!bankAccount.verificationUrl || !bankAccount.verificationQrCode)
        ) {
          this.logger.warn(
            `Bank account ${accountId} has order code but missing URL/QR. Regenerating payment link...`,
          );
          const verification = await this.createVerificationPaymentForCoach(accountId, userId);
          return {
            needsVerification: true,
            verificationPaymentStatus: 'pending',
            status: 'pending',
            verificationOrderCode: String(verification.orderCode),
            verificationUrl: verification.verificationUrl,
            verificationQrCode: verification.verificationQrCode,
            qrCodeUrl: verification.verificationQrCode,
          };
        }

        const paymentStatus = bankAccount.verificationPaymentStatus || 'pending';
        const status = paymentStatus === 'paid' ? 'verified' : paymentStatus;

        return {
          needsVerification: true,
          verificationPaymentStatus: paymentStatus,
          status,
          verificationOrderCode: bankAccount.verificationOrderCode,
          verificationUrl: bankAccount.verificationUrl,
          verificationQrCode: bankAccount.verificationQrCode,
          qrCodeUrl: bankAccount.verificationQrCode,
        };
      }

      // No verification payment created yet - create one now
      this.logger.log(`Bank account ${accountId} needs verification but has no payment. Creating one...`);
      const verification = await this.createVerificationPaymentForCoach(accountId, userId);

      return {
        needsVerification: true,
        verificationPaymentStatus: 'pending',
        status: 'pending',
        verificationOrderCode: String(verification.orderCode),
        verificationUrl: verification.verificationUrl,
        verificationQrCode: verification.verificationQrCode,
        qrCodeUrl: verification.verificationQrCode,
      };
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ForbiddenException) {
        throw error;
      }
      this.logger.error('Error getting verification status for coach', error);
      throw new InternalServerErrorException('Failed to get verification status');
    }
  }

  /**
   * Create verification payment for coach bank account
   */
  private async createVerificationPaymentForCoach(
    bankAccountId: string,
    userId: string,
  ): Promise<{
    verificationUrl: string;
    verificationQrCode: string;
    orderCode: number;
  }> {
    try {
      const bankAccount = await this.bankAccountModel.findById(bankAccountId).exec();
      if (!bankAccount) {
        throw new NotFoundException('Bank account not found');
      }

      const orderCode = generatePayOSOrderCode();
      const verificationAmount = bankAccount.verificationAmount || 10000;

      const frontendUrl = this.configService.get<string>('app.frontendUrl');
      if (!frontendUrl) {
        this.logger.error('app.frontendUrl is not configured.');
        throw new InternalServerErrorException('Frontend URL is not configured');
      }

      // ✅ FIX: Update bank account with verification order code FIRST
      // This ensures the webhook can find the bank account by verificationOrderCode
      // even if it arrives very quickly after payment creation
      bankAccount.verificationOrderCode = String(orderCode);
      bankAccount.verificationPaymentStatus = 'pending';
      bankAccount.verificationAmount = verificationAmount;
      await bankAccount.save();

      this.logger.log(
        `Updated bank account ${bankAccountId} with verificationOrderCode=${orderCode} before creating PayOS link`,
      );

      // Create transaction record
      try {
        const verificationTransaction = new this.transactionModel({
          booking: undefined,
          user: new Types.ObjectId(userId),
          amount: verificationAmount,
          direction: 'in',
          method: PaymentMethod.PAYOS,
          type: TransactionType.FEE,
          status: TransactionStatus.PENDING,
          externalTransactionId: String(orderCode),
          notes: 'Coach bank account verification fee',
          metadata: {
            bankAccountId: (bankAccount._id as Types.ObjectId).toString(),
            verificationType: 'COACH_BANK_ACCOUNT_VERIFICATION',
            verificationAmount,
          },
        });

        await verificationTransaction.save();
        this.logger.log(
          `Created coach bank account verification fee transaction for bank account ${bankAccountId} (orderCode=${orderCode})`,
        );
      } catch (txError) {
        this.logger.error(
          `Failed to create verification fee transaction for coach bank account ${bankAccountId}:`,
          txError,
        );
        throw new InternalServerErrorException('Failed to initialize verification transaction');
      }

      // Create PayOS payment link
      const paymentLink = await this.payosService.createPaymentUrl({
        orderCode,
        orderId: `coach-bank-verify-${bankAccountId}`,
        amount: verificationAmount,
        description: 'BANKACCVERIFY',
        items: [
          {
            name: 'Coach bank account verification fee',
            quantity: 1,
            price: verificationAmount,
          },
        ],
        returnUrl: `${frontendUrl}/coach-wallet`,
        cancelUrl: `${frontendUrl}/coach-wallet`,
      });

      // Update bank account with PayOS payment link URLs
      bankAccount.verificationUrl = paymentLink.checkoutUrl;
      bankAccount.verificationQrCode = paymentLink.qrCodeUrl || '';
      await bankAccount.save();

      this.logger.log(
        `Created verification payment for coach bank account ${bankAccountId}: orderCode=${orderCode}`,
      );

      return {
        verificationUrl: paymentLink.checkoutUrl,
        verificationQrCode: paymentLink.qrCodeUrl || '',
        orderCode,
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Error creating verification payment for coach', error);
      throw new InternalServerErrorException('Failed to create verification payment');
    }
  }

  /**
   * Map bank account entity to DTO
   */
  private mapToBankAccountDto(account: BankAccount): BankAccountResponseDto {
    const needsVerification =
      account.status === BankAccountStatus.PENDING &&
      account.verificationPaymentStatus !== 'paid';

    return {
      id: (account._id as Types.ObjectId).toString(),
      fieldOwner: (account.coach as Types.ObjectId)?.toString() || '', // Using coach instead of fieldOwner
      bankCode: account.bankCode,
      bankName: account.bankName,
      accountNumber: account.accountNumber,
      accountName: account.accountName,
      branch: account.branch,
      verificationDocument: account.verificationDocument,
      status: account.status,
      isDefault: account.isDefault,
      accountNameFromPayOS: account.accountNameFromPayOS,
      isValidatedByPayOS: account.isValidatedByPayOS,
      verifiedBy: account.verifiedBy?._id?.toString() || account.verifiedBy?.toString(),
      notes: account.notes,
      rejectionReason: account.rejectionReason,
      verifiedAt: account.verifiedAt,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
      needsVerification,
      verificationPaymentStatus: account.verificationPaymentStatus,
      verificationOrderCode: account.verificationOrderCode,
      verificationUrl: account.verificationUrl,
      verificationQrCode: account.verificationQrCode,
    };
  }
}
