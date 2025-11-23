import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument, UserRole } from 'src/modules/users/entities/user.entity';
import { Transaction, TransactionDocument } from 'src/modules/transactions/entities/transaction.entity';
import { Booking, BookingDocument } from '../bookings/entities/booking.entity';
import { UserRoleStatDto } from './dto/user-role-stats.dto';
import { UserMonthlyStatsDto } from './dto/user-monthly-stats.dto';
import { BookingMonthlyStatsDto } from './dto/booking-monthly-stats.dto';
@Injectable()
export class AdminService {
    constructor(
        @InjectModel(User.name) private userModel: Model<UserDocument>,
        @InjectModel(Transaction.name) private transactionModel: Model<TransactionDocument>,
        @InjectModel(Booking.name) private bookingModel: Model<BookingDocument>,
    ) { }

    async findAll(): Promise<User[]> {
        return this.userModel.find().exec();
    }

    async setIsActive(userId: string, isActive: boolean): Promise<User> {
        const user = await this.userModel.findById(userId);
        if (!user) {
            throw new NotFoundException('User not found');
        }

        user.isActive = isActive;
        await user.save();
        return user;
    }

    async getRoleDistribution(): Promise<UserRoleStatDto[]> {
        const result = await this.userModel.aggregate([
            {
                $match: { role: { $ne: UserRole.ADMIN } },
            },
            {
                $group: {
                    _id: '$role',
                    count: { $sum: 1 },
                },
            },
        ]);

        const validRoles = [UserRole.USER, UserRole.COACH, UserRole.FIELD_OWNER];

        return validRoles.map((role) => {
            const found = result.find((r) => r._id === role);
            return {
                role,
                count: found ? found.count : 0,
            };
        });
    }

    async getMonthlyNewUsersByYear(year: number): Promise<UserMonthlyStatsDto[]> {
        const targetYear = year ?? new Date().getFullYear();

        const users = await this.userModel.find({
            createdAt: {
                $gte: new Date(`${targetYear}-01-01T00:00:00Z`),
                $lte: new Date(`${targetYear}-12-31T23:59:59Z`)
            }
        });

        const stats: UserMonthlyStatsDto[] = Array.from({ length: 12 }, (_, i) => ({
            year: targetYear,
            month: i + 1,
            newUserCount: 0,
        }));

        users.forEach((user) => {
            const month = new Date(user.createdAt).getMonth();
            stats[month].newUserCount++;
        });

        return stats;
    }

    async getMonthlyBookingsByYear(year: number): Promise<BookingMonthlyStatsDto[]> {
        // If no year provided → use current year
        const targetYear = year ?? new Date().getFullYear();

        return this.bookingModel.aggregate([
            {
                $match: {
                    createdAt: {
                        $gte: new Date(targetYear, 0, 1),
                        $lte: new Date(targetYear, 11, 31, 23, 59, 59),
                    },
                },
            },
            {
                $group: {
                    _id: {
                        month: { $month: "$createdAt" },
                        year: { $year: "$createdAt" },
                        type: "$type",
                    },
                    count: { $sum: 1 },
                },
            },
            {
                $project: {
                    _id: 0,
                    month: "$_id.month",
                    year: "$_id.year",
                    type: "$_id.type",
                    count: 1,
                },
            },
            { $sort: { year: 1, month: 1, type: 1 } },
        ]);
    }

    async getMonthlyFieldBookingsByYear(year: number): Promise<BookingMonthlyStatsDto[]> {
        // Get field bookings only by year
        const targetYear = year ?? new Date().getFullYear();

        return this.bookingModel.aggregate([
            {
                $match: {
                    type: 'field',
                    createdAt: {
                        $gte: new Date(targetYear, 0, 1),
                        $lte: new Date(targetYear, 11, 31, 23, 59, 59),
                    },
                },
            },
            {
                $group: {
                    _id: {
                        month: { $month: "$createdAt" },
                        year: { $year: "$createdAt" },
                    },
                    count: { $sum: 1 },
                },
            },
            {
                $project: {
                    _id: 0,
                    month: "$_id.month",
                    year: "$_id.year",
                    type: { $literal: 'field' },
                    count: 1,
                },
            },
            { $sort: { year: 1, month: 1 } },
        ]);
    }

    async getMonthlyCoachBookingsByYear(year: number): Promise<BookingMonthlyStatsDto[]> {
        // Get coach bookings only by year
        const targetYear = year ?? new Date().getFullYear();

        return this.bookingModel.aggregate([
            {
                $match: {
                    type: 'coach',
                    createdAt: {
                        $gte: new Date(targetYear, 0, 1),
                        $lte: new Date(targetYear, 11, 31, 23, 59, 59),
                    },
                },
            },
            {
                $group: {
                    _id: {
                        month: { $month: "$createdAt" },
                        year: { $year: "$createdAt" },
                    },
                    count: { $sum: 1 },
                },
            },
            {
                $project: {
                    _id: 0,
                    month: "$_id.month",
                    year: "$_id.year",
                    type: { $literal: 'coach' },
                    count: 1,
                },
            },
            { $sort: { year: 1, month: 1 } },
        ]);
    }

    async getSuccessfulPayments(range: '1y' | '6m' | '3m' | '1m', year: number) {
        const now = new Date();
        const currentYear = now.getFullYear();

        const endDate = year === currentYear
            ? now
            : new Date(year, 11, 31, 23, 59, 59);

        const startOfYear = new Date(year, 0, 1);

        let startDate = new Date(endDate);
        switch (range) {
            case '1y':
                startDate.setFullYear(endDate.getFullYear() - 1);
                break;
            case '6m':
                startDate.setMonth(endDate.getMonth() - 6);
                break;
            case '3m':
                startDate.setMonth(endDate.getMonth() - 3);
                break;
            case '1m':
                startDate.setMonth(endDate.getMonth() - 1);
                break;
        }

        if (startDate < startOfYear) startDate = startOfYear;

        return this.transactionModel
            .find({
                type: 'payment',
                status: 'succeeded',
                createdAt: { $gte: startDate, $lte: endDate },
            })
            .exec();
    }
}
