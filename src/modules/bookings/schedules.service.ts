import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Schedule } from './entities/schedule.entity';

@Injectable()
export class SchedulesService {
    constructor(
        @InjectModel(Schedule.name)
        private readonly scheduleModel: Model<Schedule>,
    ) { }

    async getCoachSchedule(
        coachId: string,
        startDate: Date,
        endDate: Date,
    ) {
        const schedules = await this.scheduleModel
            .find({
                coach: new Types.ObjectId(coachId),
                date: { $gte: startDate, $lte: endDate },
            })
            .sort({ date: 1 })
            .exec();

        if (!schedules || schedules.length === 0) {
            throw new NotFoundException('No schedules found for this coach');
        }

        return schedules.map(schedule => {
            if (schedule.isHoliday) {
                return {
                    date: schedule.date,
                    isHoliday: true,
                    holidayReason: schedule.holidayReason,
                };
            }

            const slots = schedule.availableSlots.map(slot => ({
                time: slot,
                available: !schedule.bookedSlots.includes(slot),
            }));

            return {
                date: schedule.date,
                isHoliday: false,
                slots,
            };
        });
    }

    async SetHoliday(startDate: Date, endDate: Date): Promise<{ modifiedCount: number }> {
        const start = new Date(startDate);
        start.setUTCHours(0, 0, 0, 0);

        const end = new Date(endDate);
        end.setUTCHours(23, 59, 59, 999);
        const result = await this.scheduleModel.updateMany(
            {
                date: { $gte: start, $lte: end },
            },
            {
                $set: {
                    isHoliday: true,
                    availableSlots: [],
                },
            },
        );

        return { modifiedCount: result.modifiedCount };
    }
}