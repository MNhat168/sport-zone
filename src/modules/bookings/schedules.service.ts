import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Schedule } from './entities/schedule.entity';
import { Booking } from './entities/booking.entity';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BookingsService } from './bookings.service';


@Injectable()
export class SchedulesService {
    constructor(
        @InjectModel(Schedule.name)
        private readonly scheduleModel: Model<Schedule>,
        @InjectModel(Booking.name)
        private readonly bookingModel: Model<Booking>,
        private eventEmitter: EventEmitter2,
        private bookingsService: BookingsService,
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

    async SetHoliday(
        coachId: string,
        startDate: Date,
        endDate: Date,
    ): Promise<{ modifiedCount: number }> {
        const start = new Date(startDate);
        start.setUTCHours(0, 0, 0, 0);

        const end = new Date(endDate);
        end.setUTCHours(23, 59, 59, 999);

        if (new Date(startDate) > new Date(endDate)) {
            throw new BadRequestException('Start date must be before end date');
        }

        const schedules = await this.scheduleModel.find({
            coach: new Types.ObjectId(coachId),
            date: { $gte: start, $lte: end },
            isHoliday: false,
        });


        const scheduleIds = schedules.map(s => s._id);

        const affectedBookings = await this.bookingModel.find({
            schedule: { $in: scheduleIds },
            requestedCoach: new Types.ObjectId(coachId),
            coachStatus: { $in: ['accepted', 'pending'] },
        });

        const result = await this.scheduleModel.updateMany(
            { _id: { $in: scheduleIds } },
            {
                $set: {
                    isHoliday: true,
                    availableSlots: [],
                    bookedSlots: [],
                },
            },
        );

        //create notification for affected users
        for (const booking of affectedBookings) {
            const b = booking as Booking & { _id: Types.ObjectId };
            if (booking.coachStatus === 'pending') {
                await this.bookingsService.updateCoachStatus(
                    b._id.toString(),
                    coachId,
                    'declined'
                );
            } else {
                if (!booking.holidayNotified) {
                    this.eventEmitter.emit('schedule.holiday.set', {
                        bookingId: booking._id,
                        userId: booking.user,
                        scheduleId: booking.schedule,
                        slot: booking.slot,
                        date: schedules.find(s => (s._id as Types.ObjectId).equals(booking.schedule))?.date,
                        coachStatus: booking.coachStatus,
                    });
                    booking.holidayNotified = true;
                    await booking.save();
                }
            }
        }
        return { modifiedCount: result.modifiedCount };
    }

    async UnsetHoliday(startDate: Date, endDate: Date): Promise<{ modifiedCount: number }> {
        const start = new Date(startDate);
        start.setUTCHours(0, 0, 0, 0);

        const end = new Date(endDate);
        end.setUTCHours(23, 59, 59, 999);

        const result = await this.scheduleModel.updateMany(
            { date: { $gte: start, $lte: end } },
            { $set: { isHoliday: false } },
        );

        return { modifiedCount: result.modifiedCount };
    }
}