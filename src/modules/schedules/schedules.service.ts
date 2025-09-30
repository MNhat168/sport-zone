import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Schedule } from './entities/schedule.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { Field } from '../fields/entities/field.entity';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BookingsService } from '../bookings/bookings.service';


@Injectable()
export class SchedulesService {
    constructor(
        @InjectModel(Schedule.name)
        private readonly scheduleModel: Model<Schedule>,
        @InjectModel(Booking.name)
        private readonly bookingModel: Model<Booking>,
        @InjectModel(Field.name)
        private readonly fieldModel: Model<Field>,
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
            .populate('field')
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

            const field = schedule.field as any;
            if (!field) {
                throw new BadRequestException('Field not found for schedule');
            }

            // Generate virtual slots from Field configuration
            const virtualSlots = this.generateVirtualSlots(field);

            // Check availability against bookedSlots
            const slots = virtualSlots.map(slot => {
                const overlaps = schedule.bookedSlots.some(bs => {
                    return !(bs.endTime <= slot.startTime || bs.startTime >= slot.endTime);
                });
                return {
                    startTime: slot.startTime,
                    endTime: slot.endTime,
                    available: !overlaps,
                };
            });

            return {
                date: schedule.date,
                isHoliday: false,
                slots,
            };
        });
    }

    private generateVirtualSlots(field: any): { startTime: string; endTime: string }[] {
        const slots: { startTime: string; endTime: string }[] = [];
        const startMin = this.timeToMinutes(field.operatingHours.start);
        const endMin = this.timeToMinutes(field.operatingHours.end);
        const slotDuration = field.slotDuration;

        for (let currentMin = startMin; currentMin < endMin; currentMin += slotDuration) {
            const nextMin = currentMin + slotDuration;
            if (nextMin <= endMin) {
                slots.push({
                    startTime: this.minutesToTime(currentMin),
                    endTime: this.minutesToTime(nextMin),
                });
            }
        }

        return slots;
    }

    private timeToMinutes(time: string): number {
        const [hours, minutes] = time.split(':').map(Number);
        return hours * 60 + minutes;
    }

    private minutesToTime(minutes: number): string {
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
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
                        startTime: booking.startTime,
                        endTime: booking.endTime,
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