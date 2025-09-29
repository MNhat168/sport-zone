import { Controller, Get, Query, Param, Post, Body } from '@nestjs/common';
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

    @Post('set-holiday')
    async setHoliday(
        @Body() body: { coachId: string; startDate: string; endDate: string },
        ) {
        const { coachId, startDate, endDate } = body;
        return this.scheduleService.SetHoliday(
            coachId,
            new Date(startDate),
            new Date(endDate),
        );
    }
}