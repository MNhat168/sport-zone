import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel, InjectConnection } from '@nestjs/mongoose';
import { Model, Types, Connection, ClientSession } from 'mongoose';
import { Schedule } from '../../schedules/entities/schedule.entity';
import { CoachProfile } from '../entities/coach-profile.entity';

@Injectable()
export class CoachScheduleService {
  constructor(
    @InjectModel(Schedule.name) private readonly scheduleModel: Model<Schedule>,
    @InjectModel(CoachProfile.name) private readonly coachProfileModel: Model<CoachProfile>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  /**
   * Get available slots for a coach on a specific date
   * Returns slots from 8h-21h, excluding booked slots
   */
  async getAvailableSlots(coachId: string, date: Date): Promise<{
    startTime: string;
    endTime: string;
    available: boolean;
  }[]> {
    // Find coach profile
    const coachProfile = await this.coachProfileModel
      .findOne({ user: new Types.ObjectId(coachId) })
      .lean();

    if (!coachProfile) {
      throw new NotFoundException('Coach profile not found');
    }

    // Normalize date to start of day
    const bookingDate = new Date(date);
    bookingDate.setHours(0, 0, 0, 0);

    // Get schedule for this coach and date
    const schedule = await this.scheduleModel
      .findOne({
        coach: new Types.ObjectId(String(coachProfile._id)),
        date: bookingDate
      })
      .lean();

    // Generate all possible slots from 8h-21h (1 hour slots)
    const slots: { startTime: string; endTime: string; available: boolean }[] = [];
    for (let hour = 8; hour < 21; hour++) {
      const startTime = `${hour.toString().padStart(2, '0')}:00`;
      const endTime = `${(hour + 1).toString().padStart(2, '0')}:00`;
      
      // Check if this slot is booked
      const isBooked = schedule?.bookedSlots?.some(bookedSlot => {
        const bookedStart = this.timeStringToMinutes(bookedSlot.startTime);
        const bookedEnd = this.timeStringToMinutes(bookedSlot.endTime);
        const slotStart = this.timeStringToMinutes(startTime);
        const slotEnd = this.timeStringToMinutes(endTime);
        
        // Check for overlap
        return slotStart < bookedEnd && slotEnd > bookedStart;
      }) || false;

      slots.push({
        startTime,
        endTime,
        available: !isBooked && !schedule?.isHoliday,
      });
    }

    return slots;
  }

  /**
   * Lock slots for a coach booking (atomic operation with optimistic locking)
   * Used when creating a coach booking
   */
  async lockSlots(
    coachId: string,
    date: Date,
    startTime: string,
    endTime: string,
    session?: ClientSession
  ): Promise<Schedule> {
    // Find coach profile
    const coachProfile = await this.coachProfileModel
      .findOne({ user: new Types.ObjectId(coachId) })
      .session(session || null)
      .exec();

    if (!coachProfile) {
      throw new NotFoundException('Coach profile not found');
    }

    // ✅ CRITICAL: Use UTC methods to normalize date
    // setHours() uses LOCAL timezone → wrong on Singapore server (UTC+8)
    const bookingDate = new Date(date);
    bookingDate.setUTCHours(0, 0, 0, 0);

    // Atomic upsert with version initialization (Pure Lazy Creation)
    const scheduleUpdate = await this.scheduleModel.findOneAndUpdate(
      {
        coach: new Types.ObjectId(String(coachProfile._id)),
        date: bookingDate
      },
      {
        $setOnInsert: {
          coach: new Types.ObjectId(String(coachProfile._id)),
          date: bookingDate,
          bookedSlots: [],
          isHoliday: false
        },
        $inc: { version: 1 }
      },
      {
        upsert: true,
        new: true,
        session: session || undefined
      }
    ).exec();

    // Check for conflicts
    const hasConflict = this.checkSlotConflict(
      startTime,
      endTime,
      scheduleUpdate.bookedSlots
    );

    if (hasConflict) {
      throw new BadRequestException('Selected time slots are not available');
    }

    if (scheduleUpdate.isHoliday) {
      throw new BadRequestException(`Cannot book on holiday: ${scheduleUpdate.holidayReason}`);
    }

    // Atomic update with optimistic locking
    const scheduleUpdateResult = await this.scheduleModel.findOneAndUpdate(
      {
        _id: scheduleUpdate._id,
        version: scheduleUpdate.version
      },
      {
        $push: {
          bookedSlots: {
            startTime,
            endTime
          }
        },
        $inc: { version: 1 }
      },
      {
        new: true,
        session: session || undefined
      }
    ).exec();

    if (!scheduleUpdateResult) {
      throw new BadRequestException('Schedule was modified concurrently. Please try again.');
    }

    return scheduleUpdateResult;
  }

  /**
   * Release slots for a coach booking (when booking is cancelled)
   */
  async releaseSlots(
    coachId: string,
    date: Date,
    startTime: string,
    endTime: string,
    session?: ClientSession
  ): Promise<void> {
    // Find coach profile
    const coachProfile = await this.coachProfileModel
      .findOne({ user: new Types.ObjectId(coachId) })
      .session(session || null)
      .exec();

    if (!coachProfile) {
      throw new NotFoundException('Coach profile not found');
    }

    // ✅ CRITICAL: Use UTC methods to normalize date
    // setHours() uses LOCAL timezone → wrong on Singapore server (UTC+8)
    const bookingDate = new Date(date);
    bookingDate.setUTCHours(0, 0, 0, 0);

    // Remove the slot from bookedSlots
    await this.scheduleModel.findOneAndUpdate(
      {
        coach: new Types.ObjectId(String(coachProfile._id)),
        date: bookingDate
      },
      {
        $pull: {
          bookedSlots: {
            startTime,
            endTime
          }
        }
      },
      {
        session: session || undefined
      }
    ).exec();
  }

  /**
   * Check if time slot conflicts with booked slots
   */
  private checkSlotConflict(
    startTime: string,
    endTime: string,
    bookedSlots: { startTime: string; endTime: string }[]
  ): boolean {
    const newStart = this.timeStringToMinutes(startTime);
    const newEnd = this.timeStringToMinutes(endTime);

    return bookedSlots.some(slot => {
      const bookedStart = this.timeStringToMinutes(slot.startTime);
      const bookedEnd = this.timeStringToMinutes(slot.endTime);

      // Check for overlap
      return newStart < bookedEnd && newEnd > bookedStart;
    });
  }

  /**
   * Helper: Convert time string (HH:MM) to minutes
   */
  private timeStringToMinutes(time: string): number {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
  }
}

