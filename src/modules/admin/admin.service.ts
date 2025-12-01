import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument, UserRole } from 'src/modules/users/entities/user.entity';
import { Transaction, TransactionDocument, TransactionStatus } from 'src/modules/transactions/entities/transaction.entity';
import { Booking, BookingDocument } from '../bookings/entities/booking.entity';
import { UserRoleStatDto, UserMonthlyStatsDto } from './dto/user.dto';
import { BookingMonthlyStatsDto } from './dto/booking.dto';
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

    //#region overview
    async getMonthlyRevenue(): Promise<{
        currentMonth: number;
        lastMonth: number;
        percentageChange: number;
    }> {
        const now = new Date();

        const startOfCurrentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);

        const current = await this.transactionModel.aggregate([
            {
                $match: {
                    direction: 'in',
                    status: TransactionStatus.SUCCEEDED,
                    createdAt: { $gte: startOfCurrentMonth },
                },
            },
            { $group: { _id: null, total: { $sum: '$amount' } } },
        ]);

        const currentMonth = current[0]?.total || 0;

        const last = await this.transactionModel.aggregate([
            {
                $match: {
                    direction: 'in',
                    status: TransactionStatus.SUCCEEDED,
                    createdAt: { $gte: startOfLastMonth, $lte: endOfLastMonth },
                },
            },
            { $group: { _id: null, total: { $sum: '$amount' } } },
        ]);

        const lastMonth = last[0]?.total || 0;

        const percentageChange =
            lastMonth === 0
                ? currentMonth === 0
                    ? 0
                    : 100
                : ((currentMonth - lastMonth) / lastMonth) * 100;

        return {
            currentMonth,
            lastMonth,
            percentageChange: Number(percentageChange.toFixed(2)),
        };
    }

    async getMonthlySales(): Promise<{
        currentMonth: number;
        lastMonth: number;
        percentageChange: number;
    }> {
        const now = new Date();

        const startOfCurrentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);

        const current = await this.transactionModel.aggregate([
            {
                $match: {
                    direction: 'in',
                    status: TransactionStatus.SUCCEEDED,
                    createdAt: { $gte: startOfCurrentMonth },
                },
            },
            { $group: { _id: null, count: { $sum: 1 } } },
        ]);

        const currentMonth = current[0]?.count || 0;

        const last = await this.transactionModel.aggregate([
            {
                $match: {
                    direction: 'in',
                    status: TransactionStatus.SUCCEEDED,
                    createdAt: { $gte: startOfLastMonth, $lte: endOfLastMonth },
                },
            },
            { $group: { _id: null, count: { $sum: 1 } } },
        ]);

        const lastMonth = last[0]?.count || 0;

        const percentageChange =
            lastMonth === 0
                ? currentMonth === 0
                    ? 0
                    : 100
                : ((currentMonth - lastMonth) / lastMonth) * 100;

        return {
            currentMonth,
            lastMonth,
            percentageChange: Number(percentageChange.toFixed(2)),
        };
    }

    async getRevenueGraph(year?: number) {
        const selectedYear = year ?? new Date().getFullYear();

        const startOfYear = new Date(selectedYear, 0, 1);
        const endOfYear = new Date(selectedYear, 11, 31, 23, 59, 59, 999);

        const raw = await this.transactionModel.aggregate([
            {
                $match: {
                    status: 'succeeded',
                    direction: 'in',
                    createdAt: { $gte: startOfYear, $lte: endOfYear }
                },
            },
            {
                $group: {
                    _id: { month: { $month: "$createdAt" } },
                    revenue: { $sum: "$amount" }
                }
            },
            {
                $sort: { "_id.month": 1 }
            }
        ]);

        const revenueMap = new Map(
            raw.map(r => [r._id.month, r.revenue])
        );

        const monthlyRevenue: { month: number; revenue: number }[] = [];

        for (let m = 1; m <= 12; m++) {
            monthlyRevenue.push({
                month: m,
                revenue: revenueMap.get(m) || 0,
            });
        }

        return {
            year: selectedYear,
            months: monthlyRevenue
        };
    }

    async getRecentTransactions() {
        const transactions = await this.transactionModel.aggregate([
            {
                $match: {
                    status: "succeeded",
                    direction: "in"
                }
            },
            {
                $sort: { createdAt: -1 }
            },
            { $limit: 5 },

            // Join user info
            {
                $lookup: {
                    from: "users",
                    localField: "user",
                    foreignField: "_id",
                    as: "user"
                }
            },
            { $unwind: "$user" },

            // Only keep needed fields
            {
                $project: {
                    _id: 1,
                    amount: 1,
                    createdAt: 1,
                    "user.avatar": 1,
                    "user.fullName": 1,
                    "user.email": 1
                }
            }
        ]);

        return transactions;
    }
    //#endregion
}
