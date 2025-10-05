import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User, UserRole } from 'src/modules/users/entities/user.entity';
import { CoachProfile } from 'src/modules/profiles/entities/coach-profile.entity';
import { CoachesDto } from './dtos/coaches.dto';
import { SportType } from 'src/common/enums/sport-type.enum';

@Injectable()
export class CoachesService {
    constructor(
        @InjectModel(User.name) private userModel: Model<User>,
        @InjectModel(CoachProfile.name) private coachProfileModel: Model<CoachProfile>,
    ) { }

    async findAll(query?: { name?: string; sportType?: SportType; minRate?: number; maxRate?: number }): Promise<CoachesDto[]> {
        const userFilter: any = { role: UserRole.COACH };
        if (query?.name) userFilter.fullName = { $regex: query.name, $options: 'i' };

        const users = await this.userModel.find(userFilter).lean();

        const profileFilter: any = { user: { $in: users.map(u => u._id) } };
        if (query?.sportType) profileFilter.sports = query.sportType;
        if (query?.minRate) profileFilter.hourlyRate = { ...profileFilter.hourlyRate, $gte: query.minRate };
        if (query?.maxRate) profileFilter.hourlyRate = { ...profileFilter.hourlyRate, $lte: query.maxRate };

        const profiles = await this.coachProfileModel.find(profileFilter).lean();

        const result = users
            .map(user => {
                const profile = profiles.find(p => p.user.toString() === user._id.toString());
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

    async getCoachById(coachId: string): Promise<CoachesDto> {
        if (!Types.ObjectId.isValid(coachId)) {
            throw new BadRequestException('Invalid coach ID');
        }

        const coach = await this.coachProfileModel
            .findById(new Types.ObjectId(coachId))
            .populate<{ user: User }>('user', 'fullName email avatarUrl isVerified')
            .exec();

        if (!coach) {
            throw new NotFoundException('Coach not found');
        }
        const user: any = coach.user;

        const dto: CoachesDto = {
            id: user._id.toString(),
            fullName: user.fullName,
            email: user.email,
            avatarUrl: user.avatarUrl,
            isVerified: user.isVerified,
            sports: coach.sports,
            certification: coach.certification,
            hourlyRate: coach.hourlyRate,
            bio: coach.bio,
            rating: coach.rating,
            totalReviews: coach.totalReviews,
        };

        return dto;
    }
}