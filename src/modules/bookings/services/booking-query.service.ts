import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Booking } from '../entities/booking.entity';

/**
 * Booking Query Service
 * Handles all booking query and listing operations
 * Extracted from BookingsService for better code organization
 */
@Injectable()
export class BookingQueryService {
    private readonly logger = new Logger(BookingQueryService.name);

    constructor(
        @InjectModel(Booking.name) private readonly bookingModel: Model<Booking>,
    ) { }

    /**
     * Get user bookings with pagination and filters
     */
    async getUserBookings(userId: string, options: {
        status?: string;
        paymentStatus?: 'unpaid' | 'paid' | 'refunded';
        approvalStatus?: 'pending' | 'approved' | 'rejected';
        coachStatus?: 'pending' | 'accepted' | 'declined';
        type?: string;
        limit: number;
        page: number;
    }): Promise<{ bookings: any[]; pagination: any }> {
        try {
            // Build filter query
            const filter: any = { user: new Types.ObjectId(userId) };

            if (options.status) {
                filter.status = options.status.toLowerCase();
            }

            if (options.paymentStatus) {
                filter.paymentStatus = options.paymentStatus;
            }

            if (options.approvalStatus) {
                filter.approvalStatus = options.approvalStatus;
            }

            if (options.coachStatus) {
                filter.coachStatus = options.coachStatus;
            }

            if (options.type) {
                filter.type = options.type.toLowerCase();
            }

            // Calculate skip for pagination
            const skip = (options.page - 1) * options.limit;

            // Get total count for pagination
            const total = await this.bookingModel.countDocuments(filter);

            // Get bookings with population
            const rawBookings = await this.bookingModel
                .find(filter)
                .populate({
                    path: 'field',
                    select: 'name location images sportType owner',
                    populate: {
                        path: 'owner',
                        select: 'fullName phoneNumber email'
                    }
                })
                .populate({
                    path: 'requestedCoach',
                    select: 'user hourlyRate sports',
                    populate: {
                        path: 'user',
                        select: 'fullName phoneNumber email'
                    }
                })
                .populate('selectedAmenities', 'name price')
                .populate('user', 'fullName email phoneNumber')
                .populate('transaction', 'amount method status notes createdAt paidAt updatedAt')
                .sort({ createdAt: -1 }) // Newest first
                .skip(skip)
                .limit(options.limit)
                .exec();

            // Convert to JSON
            const bookings = rawBookings.map(booking => booking.toJSON());

            const totalPages = Math.ceil(total / options.limit);

            return {
                bookings,
                pagination: {
                    total,
                    page: options.page,
                    limit: options.limit,
                    totalPages,
                    hasNextPage: options.page < totalPages,
                    hasPrevPage: options.page > 1
                }
            };

        } catch (error) {
            this.logger.error(`Error getting user bookings for ${userId}:`, error);
            throw new InternalServerErrorException('Failed to get user bookings');
        }
    }

    /**
     * Get simplified booking invoice list for a user
     */
    async getUserBookingSummaries(userId: string, options: {
        status?: string;
        paymentStatus?: 'unpaid' | 'paid' | 'refunded';
        approvalStatus?: 'pending' | 'approved' | 'rejected';
        coachStatus?: 'pending' | 'accepted' | 'declined';
        type?: string;
        limit: number;
        page: number;
    }): Promise<{ invoices: any[]; pagination: any }> {
        const { bookings, pagination } = await this.getUserBookings(userId, options);

        const invoices = bookings.map(b => {
            const bookingId = b._id || b.id || b.bookingId;
            const fieldName = (b.field && (b.field.name || b.field.title)) || b.fieldName || 'Unknown Field';
            const fieldImage = (b.field && (b.field.images?.[0] || b.field.image)) || b.fieldImage || '-';
            const dateIso = b.date ? new Date(b.date).toISOString().split('T')[0] : null;
            const timeRange = `${b.startTime || ''}${b.startTime && b.endTime ? ' - ' : ''}${b.endTime || ''}`;

            const payment = (b.transaction && (b.transaction.amount ?? b.transaction.total)) ?? (b.totalPrice ?? 0);
            const paidOn = (b.transaction && (b.transaction.createdAt || b.transaction.paidAt || b.transaction.updatedAt)) || null;

            return {
                bookingId,
                name: fieldName,
                fieldImage,
                date: dateIso,
                time: timeRange,
                payment,
                paidOn,
                status: b.status || 'unknown',
                paymentStatus: b.paymentStatus || 'unpaid',
                approvalStatus: b.approvalStatus || (b.noteStatus === 'accepted' ? 'approved' : b.noteStatus === 'denied' ? 'rejected' : b.note ? 'pending' : undefined),
                coachStatus: b.coachStatus || 'pending',
            };
        });

        return { invoices, pagination };
    }

    /**
     * Get the next upcoming booking for the user
     */
    async getUpcomingBooking(userId: string): Promise<any | null> {
        try {
            const today = new Date();
            today.setUTCHours(0, 0, 0, 0);

            const booking = await this.bookingModel
                .findOne({
                    user: new Types.ObjectId(userId),
                    status: 'confirmed',
                    date: { $gte: today },
                })
                .populate({
                    path: 'field',
                    select: 'name owner',
                    populate: {
                        path: 'owner',
                        select: 'fullName',
                    },
                })
                .sort({ date: 1, startTime: 1 })
                .exec();

            if (!booking) return null;

            const b = booking.toJSON ? booking.toJSON() : booking;

            const bookingId = b._id || b.id;
            const fieldObj = (b.field as any) || {};
            const ownerObj = (fieldObj.owner as any) || {};
            const fieldName = fieldObj.name || fieldObj.title || 'Sân';
            const academyName = ownerObj.fullName || ownerObj.name || 'Unknown Academy';
            const dateIso = b.date ? new Date(b.date).toISOString().split('T')[0] : null;
            const timeRange = `${b.startTime || ''}${b.startTime && b.endTime ? ' đến ' : ''}${b.endTime || ''}`;

            return {
                bookingId,
                academyName,
                fieldName,
                date: dateIso,
                time: timeRange,
            };
        } catch (error) {
            this.logger.error('Error getting upcoming booking', error);
            throw new InternalServerErrorException('Failed to get upcoming booking');
        }
    }
}
