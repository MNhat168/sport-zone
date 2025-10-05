import { Controller, Get, Query, Param, Post, Body } from '@nestjs/common';
import { SchedulesService } from './schedules.service';
import { Schedule } from './entities/schedule.entity';
@Controller('schedules')
export class SchedulesController {
    constructor(private readonly scheduleService: SchedulesService) { }

    @Get()
    async getCoachSchedules(
        @Param('coachId') coachId: string,
        @Query('start') start: string,
        @Query('end') end: string,
    ): Promise<Schedule[]> {
        return this.scheduleService.getCoachSchedules(
            coachId,
            new Date(start),
            new Date(end),
        );
    }
}