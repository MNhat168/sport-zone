import { Controller, Get, Query, Param } from '@nestjs/common';
import { SchedulesService } from './schedules.service';
@Controller('schedules')
export class SchedulesController {
    constructor(private readonly scheduleService: SchedulesService) { }

    @Get('coach/:coachId')
    async getCoachSchedule(
        @Param('coachId') coachId: string,
        @Query('startDate') startDateStr: string,
        @Query('endDate') endDateStr: string,
    ) {
        const startDate = new Date(startDateStr);
        const endDate = new Date(endDateStr);

        return this.scheduleService.getCoachSchedule(coachId, startDate, endDate);
    }
}