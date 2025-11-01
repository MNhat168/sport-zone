import { Controller, Patch, Param, Body, Get } from '@nestjs/common';
import { ProfilesService } from './profiles.service';
import { Types } from 'mongoose';
import { BadRequestException } from '@nestjs/common';
import { SportType } from 'src/common/enums/sport-type.enum';
import { CoachProfile } from 'src/modules/coaches/entities/coach-profile.entity';

@Controller('profiles')
export class ProfilesController {
    constructor(private readonly profileService: ProfilesService) { }

    @Get('user/:userId')
    async getByUserId(@Param('userId') userId: string) {
        return this.profileService.findByUserId(userId);
    }

    @Patch('coach/update/:userId')
    async updateCoachProfile(
        @Param('userId') userId: string,
        @Body()
        body: {
            certification?: string;
            bio?: string;
            sports?: SportType[];
            location?: string;
            experience?: string;
        },
    ): Promise<CoachProfile> {
        const { certification, bio, sports, location, experience } = body;

        if (!certification && !bio && !sports && !location && !experience) {
            throw new BadRequestException(
                'At least one field must be provided to update',
            );
        }

        return this.profileService.updateCoachProfile(userId, {
            certification,
            bio,
            sports,
            location,
            experience,
        });
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
            userId,
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

    @Get('coach-id/:userId')
    async getCoachId(@Param('userId') userId: string): Promise<any> {
        console.log('userId', userId);
        return await this.profileService.getCoachIdByUserId(userId);
    }
}
