import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Booking } from './entities/booking.entity';

@Injectable()
export class BookingsService {
    constructor(
        @InjectModel(Booking.name)
        private readonly bookingModel: Model<Booking>,
    ) { }

    async updateCoachStatus(
        bookingId: string,
        coachId: string,
        newStatus: 'accepted' | 'declined',
    ) {
        if (!Types.ObjectId.isValid(bookingId) || !Types.ObjectId.isValid(coachId)) {
            throw new BadRequestException('Invalid ID format');
        }

        const booking = await this.bookingModel.findOne({
            _id: new Types.ObjectId(bookingId),
            requestedCoach: new Types.ObjectId(coachId),
        });

        if (!booking) {
            throw new NotFoundException('Booking not found for this coach');
        }

        if (booking.coachStatus !== 'pending') {
            throw new BadRequestException(
                `Coach status is already "${booking.coachStatus}"`,
            );
        }

        booking.coachStatus = newStatus;
        await booking.save();

        return booking;
    }

    async getByRequestedCoachId(coachId: string): Promise<Booking[]> {
    return this.bookingModel
        .find({ requestedCoach: new Types.ObjectId(coachId) })
            .populate('user')
            .populate('schedule')
            //.populate('payment')
            .populate('requestedCoach')
            .exec();
    }
}
