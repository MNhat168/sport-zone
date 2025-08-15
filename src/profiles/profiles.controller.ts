import { Controller, Patch, Param, Body, Get } from '@nestjs/common';
import { ProfilesService } from './profiles.service';
import { Types } from 'mongoose';
import { BadRequestException } from '@nestjs/common';
import { SportType } from 'src/common/enums/sport-type.enum';

@Controller('profiles')
export class ProfilesController {
    constructor(private readonly profileService: ProfilesService) { }

    @Get('user/:userId')
    async getByUserId(@Param('userId') userId: string) {
        return this.profileService.findByUserId(userId);
    }

    @Patch(':userId/hourly-rate')
    async updateHourlyRate(
        @Param('userId') userId: string,
        @Body('hourlyRate') hourlyRate: number,
    ) {
        return this.profileService.setHourlyRate(userId, hourlyRate);
    }

    @Patch(':userId/certification')
    async updateCertification(
        @Param('userId') userId: string,
        @Body('certification') certification: string,
    ) {
        if (!certification || typeof certification !== 'string') {
            throw new BadRequestException('Certification is required and must be a string');
        }

        return this.profileService.updateCertification(
            new Types.ObjectId(userId),
            certification,
        );
    }

    @Patch(':userId/bio')
    async updateBio(
        @Param('userId') userId: string,
        @Body('bio') bio: string
    ) {
        return this.profileService.updateBio(userId, bio);
    }

    @Patch(':userId/sports')
    async updateSports(
        @Param('userId') userId: string,
        @Body('sports') sports: SportType[]
    ) {
        return this.profileService.updateSports(userId, sports);
    }
}
