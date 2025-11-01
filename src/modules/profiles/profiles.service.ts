import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CoachProfile } from '../coaches/entities/coach-profile.entity';
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

    async updateCoachProfile(
        userId: string,
        updates: {
            certification?: string;
            bio?: string;
            sports?: SportType[];
            location?: string;
            experience?: string;
        },
    ): Promise<CoachProfile> {
        if (!Types.ObjectId.isValid(userId)) {
            throw new BadRequestException('Invalid user ID format');
        }

        const allowedFields = ['certification', 'bio', 'sports', 'location', 'experience'];
        const updateData: Record<string, any> = {};

        for (const field of allowedFields) {
            if (updates[field] !== undefined) {
                updateData[field] = updates[field];
            }
        }

        if (Object.keys(updateData).length === 0) {
            throw new BadRequestException('No valid fields provided for update');
        }

        const profile = await this.coachProfileModel.findOneAndUpdate(
            { user: new Types.ObjectId(userId) },
            { $set: updateData },
            { new: true },
        );

        if (!profile) {
            throw new NotFoundException('Coach profile not found');
        }

        return profile;
    }

    async setHourlyRate(coachId: string, newRate: number): Promise<CoachProfile> {
        if (!Types.ObjectId.isValid(coachId)) {
            throw new BadRequestException('Invalid coach ID format');
        }

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

    async updateCertification(userId: string, certification: string): Promise<CoachProfile> {
        if (!Types.ObjectId.isValid(userId)) {
            throw new BadRequestException('Invalid user ID format');
        }

        const profile = await this.coachProfileModel.findOneAndUpdate(
            { user: new Types.ObjectId(userId) },
            { certification },
            { new: true },
        );

        if (!profile) {
            throw new NotFoundException('Coach profile not found');
        }

        return profile;
    }

    async updateBio(userId: string, bio: string): Promise<CoachProfile> {
        if (!Types.ObjectId.isValid(userId)) {
            throw new BadRequestException('Invalid user ID format');
        }

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
        if (!Types.ObjectId.isValid(userId)) {
            throw new BadRequestException('Invalid user ID format');
        }

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

    async getCoachIdByUserId(userId: string): Promise<any> {
        const coach = await this.coachProfileModel.findOne({ user: new Types.ObjectId(userId) }).populate('user').exec();
        if (!coach) {
            throw new NotFoundException('Coach profile not found for this user');
        }
        return coach;
    }
}
