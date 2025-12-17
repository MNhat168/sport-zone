import { Injectable, NotFoundException, BadRequestException, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel, InjectConnection } from '@nestjs/mongoose';
import { Model, Types, Connection, ClientSession } from 'mongoose';
import { Schedule } from './entities/schedule.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { Field } from '../fields/entities/field.entity';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BookingsService } from '../bookings/bookings.service';

@Injectable()
export class SchedulesService implements OnModuleInit {
    private readonly logger = new Logger(SchedulesService.name);

    constructor(
        @InjectModel(Schedule.name)
        private readonly scheduleModel: Model<Schedule>,
        @InjectModel(Booking.name)
        private readonly bookingModel: Model<Booking>,
        @InjectModel(Field.name)
        private readonly fieldModel: Model<Field>,
        @InjectConnection() private readonly connection: Connection,
        private eventEmitter: EventEmitter2,
        private bookingsService: BookingsService,
    ) { }

    async onModuleInit() {
        try {
            // Check for problematic indexes and fix them
            const indexes = await this.scheduleModel.collection.indexes();

            // Check field_1_date_1
            // The issue is that we need a partial index for field_1_date_1 (only when court doesn't exist)
            // But if a non-partial unique index exists, it blocks creating schedules for different courts on same field/date
            const fieldDateIndex = indexes.find(idx => idx.name === 'field_1_date_1');
            if (fieldDateIndex && !fieldDateIndex.partialFilterExpression) {
                this.logger.warn('Found problematic non-partial field_1_date_1 index. Dropping it...');
                await this.scheduleModel.collection.dropIndex('field_1_date_1');
                this.logger.log('Successfully dropped field_1_date_1 index. Recreating with correct partial filter...');

                // Trigger recreation of indexes to ensure the correct partial index is created immediately
                await this.scheduleModel.ensureIndexes();
                this.logger.log('Indexes recreated successfully.');
            }
        } catch (error) {
            // Log but don't crash app if index check fails
            this.logger.error('Error checking indexes during module init', error);
        }
    }

    // ============================================================================
    // PURE LAZY CREATION METHODS (NEW)
    // ============================================================================

    /**
     * Atomic upsert Schedule with optimistic locking
     * Core method for Pure Lazy Creation pattern
     */
    async upsertSchedule(
        fieldId: string,
        date: Date,
        initialData: Partial<Schedule> = {},
        session?: ClientSession
    ): Promise<Schedule> {
        try {
            const updateData = {
                $setOnInsert: {
                    field: new Types.ObjectId(fieldId),
                    date,
                    bookedSlots: [],
                    isHoliday: false,
                    version: 0,
                    ...initialData
                }
            };

            const schedule = await this.scheduleModel.findOneAndUpdate(
                {
                    field: new Types.ObjectId(fieldId),
                    date
                },
                updateData,
                {
                    upsert: true,
                    new: true,
                    session
                }
            ).exec();

            this.logger.log(`Upserted schedule for field ${fieldId} on ${date.toISOString().split('T')[0]}`);
            return schedule;

        } catch (error) {
            this.logger.error('Error upserting schedule', error);
            throw new BadRequestException('Failed to create or update schedule');
        }
    }

    /**
     * Add booked slot with optimistic locking
     * Prevents race conditions in concurrent bookings
     */
    async addBookedSlot(
        scheduleId: string,
        startTime: string,
        endTime: string,
        session?: ClientSession
    ): Promise<Schedule> {
        try {
            const schedule = await this.scheduleModel.findByIdAndUpdate(
                scheduleId,
                {
                    $push: {
                        bookedSlots: { startTime, endTime }
                    },
                    $inc: { version: 1 }
                },
                {
                    new: true,
                    session
                }
            ).exec();

            if (!schedule) {
                throw new NotFoundException('Schedule not found');
            }

            this.logger.log(`Added booked slot ${startTime}-${endTime} to schedule ${scheduleId}`);
            return schedule;

        } catch (error) {
            this.logger.error('Error adding booked slot', error);
            throw new BadRequestException('Failed to add booked slot');
        }
    }

    /**
     * Remove booked slot (for cancellations)
     */
    async removeBookedSlot(
        scheduleId: string,
        startTime: string,
        endTime: string,
        session?: ClientSession
    ): Promise<Schedule> {
        try {
            const schedule = await this.scheduleModel.findByIdAndUpdate(
                scheduleId,
                {
                    $pull: {
                        bookedSlots: { startTime, endTime }
                    },
                    $inc: { version: 1 }
                },
                {
                    new: true,
                    session
                }
            ).exec();

            if (!schedule) {
                throw new NotFoundException('Schedule not found');
            }

            this.logger.log(`Removed booked slot ${startTime}-${endTime} from schedule ${scheduleId}`);
            return schedule;

        } catch (error) {
            this.logger.error('Error removing booked slot', error);
            throw new BadRequestException('Failed to remove booked slot');
        }
    }

    /**
     * Mark schedule as holiday with optimistic locking
     * For Field owner
     */
    async markScheduleHoliday(
        fieldId: string,
        date: Date,
        reason: string,
        session?: ClientSession
    ): Promise<Schedule> {
        try {
            const schedule = await this.scheduleModel.findOneAndUpdate(
                {
                    field: new Types.ObjectId(fieldId),
                    date
                },
                {
                    $set: {
                        isHoliday: true,
                        holidayReason: reason,
                        bookedSlots: [] // Clear all slots when marking as holiday
                    },
                    $setOnInsert: {
                        field: new Types.ObjectId(fieldId),
                        date,
                        version: 0
                    },
                    $inc: { version: 1 }
                },
                {
                    upsert: true,
                    new: true,
                    session
                }
            ).exec();

            this.logger.log(`Marked schedule as holiday for field ${fieldId} on ${date.toISOString().split('T')[0]}: ${reason}`);
            return schedule;

        } catch (error) {
            this.logger.error('Error marking schedule as holiday', error);
            throw new BadRequestException('Failed to mark schedule as holiday');
        }
    }

    /**
     * Get schedule by field and date (may not exist - Pure Lazy)
     */
    async getScheduleByFieldAndDate(
        fieldId: string,
        date: Date
    ): Promise<Schedule | null> {
        try {
            const schedule = await this.scheduleModel.findOne({
                field: new Types.ObjectId(fieldId),
                date
            }).exec();

            return schedule;

        } catch (error) {
            this.logger.error('Error getting schedule', error);
            throw new BadRequestException('Failed to retrieve schedule');
        }
    }

    /**
     * Find schedule by ID (for legacy compatibility)
     */
    async findById(scheduleId: string): Promise<Schedule | null> {
        try {
            const schedule = await this.scheduleModel.findById(scheduleId).exec();
            return schedule;

        } catch (error) {
            this.logger.error('Error finding schedule by ID', error);
            throw new BadRequestException('Failed to find schedule');
        }
    }

    /**
     * Get schedules in date range (may be sparse - Pure Lazy)
     */
    async getSchedulesInRange(
        fieldId: string,
        startDate: Date,
        endDate: Date
    ): Promise<Schedule[]> {
        try {
            const schedules = await this.scheduleModel.find({
                field: new Types.ObjectId(fieldId),
                date: { $gte: startDate, $lte: endDate }
            })
                .sort({ date: 1 })
                .exec();

            this.logger.log(`Retrieved ${schedules.length} schedules for field ${fieldId} from ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);
            return schedules;

        } catch (error) {
            this.logger.error('Error getting schedules in range', error);
            throw new BadRequestException('Failed to retrieve schedules');
        }
    }

    /**
     * Check if slot conflicts with existing booked slots
     */
    checkSlotConflict(
        startTime: string,
        endTime: string,
        bookedSlots: { startTime: string; endTime: string }[]
    ): boolean {
        const newStart = this.timeStringToMinutes(startTime);
        const newEnd = this.timeStringToMinutes(endTime);

        return bookedSlots.some(slot => {
            const bookedStart = this.timeStringToMinutes(slot.startTime);
            const bookedEnd = this.timeStringToMinutes(slot.endTime);

            // Check for overlap: newStart < bookedEnd && newEnd > bookedStart
            return newStart < bookedEnd && newEnd > bookedStart;
        });
    }

    /**
     * Get schedule for coach
     */
    async getCoachSchedules(
        coachId: string,
        startDate: Date,
        endDate: Date,
    ): Promise<Schedule[]> {
        return this.scheduleModel
            .find({
                coach: new Types.ObjectId(coachId),
                date: { $gte: startDate, $lte: endDate },
            })
            .sort({ date: 1 })
            .exec();
    }

    /**
     * Cleanup empty schedules (maintenance operation)
     * Removes schedules with no booked slots and not marked as holiday
     */
    async cleanupEmptySchedules(
        fieldId?: string,
        beforeDate?: Date
    ): Promise<{ deletedCount: number }> {
        try {
            const filter: any = {
                bookedSlots: { $size: 0 },
                isHoliday: false
            };

            if (fieldId) {
                filter.field = new Types.ObjectId(fieldId);
            }

            if (beforeDate) {
                filter.date = { $lt: beforeDate };
            }

            const result = await this.scheduleModel.deleteMany(filter).exec();

            this.logger.log(`Cleaned up ${result.deletedCount} empty schedules`);
            return { deletedCount: result.deletedCount };

        } catch (error) {
            this.logger.error('Error cleaning up empty schedules', error);
            throw new BadRequestException('Failed to cleanup empty schedules');
        }
    }

    /**
     * Get schedule statistics for monitoring
     */
    async getScheduleStats(fieldId?: string): Promise<{
        totalSchedules: number;
        emptySchedules: number;
        holidaySchedules: number;
        utilizationRate: number;
    }> {
        try {
            const filter: any = {};
            if (fieldId) {
                filter.field = new Types.ObjectId(fieldId);
            }

            const [totalSchedules, emptySchedules, holidaySchedules] = await Promise.all([
                this.scheduleModel.countDocuments(filter),
                this.scheduleModel.countDocuments({
                    ...filter,
                    bookedSlots: { $size: 0 },
                    isHoliday: false
                }),
                this.scheduleModel.countDocuments({
                    ...filter,
                    isHoliday: true
                })
            ]);

            const utilizationRate = totalSchedules > 0
                ? ((totalSchedules - emptySchedules - holidaySchedules) / totalSchedules) * 100
                : 0;

            return {
                totalSchedules,
                emptySchedules,
                holidaySchedules,
                utilizationRate: parseFloat(utilizationRate.toFixed(2))
            };

        } catch (error) {
            this.logger.error('Error getting schedule statistics', error);
            throw new BadRequestException('Failed to retrieve schedule statistics');
        }
    }

    // ============================================================================
    // LEGACY/BACKWARD COMPATIBILITY METHODS
    // ============================================================================

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

    async SetHoliday(
        coachId: string,
        startDate: Date,
        endDate: Date,
    ): Promise<{ modifiedCount: number }> {
        // ✅ CRITICAL: Use UTC methods to normalize date
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

        // Find affected bookings by matching field and date from schedules (Pure Lazy Creation)
        const scheduleFieldDates = schedules.map(s => ({ field: s.field, date: s.date }));

        const affectedBookings = await this.bookingModel.find({
            $or: scheduleFieldDates.map(sfd => ({ field: sfd.field, date: sfd.date })),
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

        return { modifiedCount: result.modifiedCount };
    }

    async UnsetHoliday(startDate: Date, endDate: Date): Promise<{ modifiedCount: number }> {
        // ✅ CRITICAL: Use UTC methods to normalize date
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

    // ============================================================================
    // HELPER METHODS
    // ============================================================================

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

    /**
     * Convert time string (HH:MM) to minutes since midnight
     */
    private timeStringToMinutes(timeString: string): number {
        const [hours, minutes] = timeString.split(':').map(Number);
        return hours * 60 + minutes;
    }

    /**
     * Convert minutes since midnight to time string (HH:MM)
     */
    private minutesToTimeString(minutes: number): string {
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
    }

    /**
     * Validate time format (HH:MM)
     */
    private validateTimeFormat(timeString: string): boolean {
        const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
        return timeRegex.test(timeString);
    }
}
