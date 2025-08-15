import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CoachProfile } from './entities/coach-profile.entity';
import { SportType } from 'src/common/enums/sport-type.enum';

@Injectable()
export class ProfilesService {
    constructor(
        @InjectModel(CoachProfile.name)
        private readonly coachProfileModel: Model<CoachProfile>,
    ) { }

    async findByUserId(userId: string) {
        if (!Types.ObjectId.isValid(userId)) {
            throw new NotFoundException('Invalid userId');
        }

        const coachProfile = await this.coachProfileModel
            .findOne({ user: new Types.ObjectId(userId) })
            .populate('user')
            .exec();

        if (!coachProfile) {
            throw new NotFoundException('Coach profile not found');
        }

        return coachProfile;
    }

    async setHourlyRate(coachId: string, newRate: number): Promise<CoachProfile> {
        if (newRate < 0) {
            throw new BadRequestException('Hourly rate cannot be negative');
        }

        const updatedCoach = await this.coachProfileModel.findOneAndUpdate(
            { user: new Types.ObjectId(coachId) },
            { $set: { hourlyRate: newRate } },
            { new: true }
        );

        if (!updatedCoach) {
            throw new NotFoundException(`Coach with ID ${coachId} not found`);
        }

        return updatedCoach;
    }

    async updateCertification(userId: Types.ObjectId, certification: string) {
        const profile = await this.coachProfileModel.findOneAndUpdate(
            { user: userId },
            { certification },
            { new: true },
        );

        if (!profile) {
            throw new NotFoundException('Coach profile not found');
        }

        return profile;
    }

    async updateBio(userId: string, bio: string): Promise<CoachProfile> {
        const profile = await this.coachProfileModel.findOneAndUpdate(
            { user: new Types.ObjectId(userId) },
            { $set: { bio } },
            { new: true },
        );

        if (!profile) {
            throw new NotFoundException('Coach profile not found');
        }

        return profile;
    }

    async updateSports(userId: string, sports: SportType[]): Promise<CoachProfile> {
        const profile = await this.coachProfileModel.findOneAndUpdate(
            { user: new Types.ObjectId(userId) },
            { $set: { sports } },
            { new: true },
        );

        if (!profile) {
            throw new NotFoundException('Coach profile not found');
        }

        return profile;
    }
}
