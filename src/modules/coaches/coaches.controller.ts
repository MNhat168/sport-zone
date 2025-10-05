import { Controller, Get, Param, Query } from '@nestjs/common';
import { CoachesService } from './coaches.service';
import { CoachesDto } from './dtos/coaches.dto';
import { SportType } from 'src/common/enums/sport-type.enum';

@Controller('coaches')
export class CoachesController {
    constructor(private readonly coachesService: CoachesService) { }

    @Get()
    async findAll(
        @Query('name') name?: string,
        @Query('sportType') sportType?: SportType,
        @Query('minRate') minRate?: number,
        @Query('maxRate') maxRate?: number,
    ): Promise<CoachesDto[]> {
        return this.coachesService.findAll({
            name,
            sportType,
            minRate: minRate ? Number(minRate) : undefined,
            maxRate: maxRate ? Number(maxRate) : undefined,
        });
    }

    // GET /coaches/:id
    @Get(':id')
    async getCoachById(@Param('id') coachId: string): Promise<CoachesDto> {
        return this.coachesService.getCoachById(coachId);
    }
}