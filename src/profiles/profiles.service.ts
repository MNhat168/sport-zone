import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CoachProfile } from './entities/coach-profile.entity';
import { UpdateCoachProfileDto } from './dtos/update-coach-profile.dto';
import { UpdateCertificationDto } from './dtos/update-certification.dto';

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
            .populate('user', 'name email')
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

        const updatedCoach = await this.coachProfileModel.findByIdAndUpdate(
            new Types.ObjectId(coachId),
            { $set: { hourlyRate: newRate } },
            { new: true }
        );

        if (!updatedCoach) {
            throw new NotFoundException(`Coach with ID ${coachId} not found`);
        }

        return updatedCoach;
    }

    async updateProfile(
        userId: string,
        updateDto: UpdateCoachProfileDto,
    ): Promise<CoachProfile> {
        const profile = await this.coachProfileModel.findOneAndUpdate(
            { user: new Types.ObjectId(userId) },
            { $set: updateDto },
            { new: true },
        );

        if (!profile) {
            throw new NotFoundException('Coach profile not found');
        }

        return profile;
    }

    async updateCertification(
        userId: Types.ObjectId,
        dto: UpdateCertificationDto,
    ) {
        const profile = await this.coachProfileModel.findOneAndUpdate(
            { user: userId },
            { certification: dto.certification },
            { new: true },
        );

        if (!profile) {
            throw new NotFoundException('Coach profile not found');
        }

        return profile;
    }
}
