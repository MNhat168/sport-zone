import { Controller, Patch, Param, Body } from '@nestjs/common';
import { ProfilesService } from './profiles.service';
import { UpdateCoachProfileDto } from './dtos/update-coach-profile.dto';
import { UpdateCertificationDto } from './dtos/update-certification.dto';
import { Types } from 'mongoose';

@Controller('profiles')
export class ProfilesController {
    constructor(private readonly profileService: ProfilesService) { }

    @Patch(':userId/hourly-rate')
    async updateHourlyRate(
        @Param('userId') userId: string,
        @Body('hourlyRate') hourlyRate: number,
    ) {
        return this.profileService.setHourlyRate(userId, hourlyRate);
    }

    @Patch(':userId')
    async updateProfile(
        @Param('userId') userId: string,
        @Body() updateDto: UpdateCoachProfileDto,
    ) {
        return this.profileService.updateProfile(userId, updateDto);
    }

    @Patch(':userId/certification')
    async updateCertification(
        @Param('userId') userId: string,
        @Body() dto: UpdateCertificationDto,
    ) {
        return this.profileService.updateCertification(
            new Types.ObjectId(userId),
            dto,
        );
    }
}
