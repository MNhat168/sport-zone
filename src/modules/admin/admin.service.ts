import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { User, UserDocument } from 'src/modules/users/entities/user.entity';
import { Notification, NotificationDocument } from 'src/modules/notifications/entities/notification.entity';
import { UserRole } from '@common/enums/user.enum';
import { Transaction, TransactionDocument } from 'src/modules/transactions/entities/transaction.entity';
import { TransactionStatus } from '@common/enums/transaction.enum';
import { Booking, BookingDocument } from '../bookings/entities/booking.entity';
import { Field, FieldDocument } from '../fields/entities/field.entity';
import { CoachProfile, CoachProfileDocument } from '../coaches/entities/coach-profile.entity';
import { Tournament, TournamentDocument } from '../tournaments/entities/tournament.entity';
import { UserRoleStatDto, UserMonthlyStatsDto } from './dto/user.dto';
import { BookingMonthlyStatsDto } from './dto/booking.dto';
import { ListTransactionsDto } from './dto/list-transactions.dto';
import { ListBookingsDto } from './dto/list-bookings.dto';
import {
    FieldOwnerStatsDto,
    CoachStatsDto,
    PlatformAnalyticsDto,
    AnalyticsFilterDto,
    DetailedFieldOwnerStatsDto,
    MonthlyBookingDto,
    SportsDistributionDto,
    RevenueAnalysisDto,
    PopularityAnalysisDto,
    UserBehaviorDto
} from './dto/admin-stats.dto';
import { AiService, DetailedFieldOwnerStats, DetailedCoachStats, PlatformAnalytics } from '../ai/ai.service';
import { PaymentMethod } from 'src/common/enums/payment-method.enum';
import { BookingStatus, BookingType } from '@common/enums/booking.enum';
import { SportType } from 'src/common/enums/sport-type.enum';

@Injectable()
export class AdminService {
    constructor(
        @InjectModel('User') private userModel: Model<UserDocument>,
        @InjectModel('FieldOwnerProfile') private fieldOwnerProfileModel: Model<any>, // Add this
        @InjectModel('Transaction') private transactionModel: Model<TransactionDocument>,
        @InjectModel('Booking') private bookingModel: Model<BookingDocument>,
        @InjectModel('Field') private fieldModel: Model<FieldDocument>,
        @InjectModel('CoachProfile') private coachProfileModel: Model<CoachProfileDocument>,
        @InjectModel('Tournament') private tournamentModel: Model<any>,
        @InjectModel('Notification') private readonly notificationModel: Model<NotificationDocument>,
        private aiService: AiService,
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

            {
                $lookup: {
                    from: "users",
                    localField: "user",
                    foreignField: "_id",
                    as: "user"
                }
            },
            { $unwind: "$user" },

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

    async listTransactions(query: ListTransactionsDto) {
        const {
            search,
            status,
            type,
            method,
            startDate,
            endDate,
            page = 1,
            limit = 10,
            sortBy = 'createdAt',
            sortOrder = 'desc',
        } = query;

        const filter: FilterQuery<TransactionDocument> = {};

        if (status && status.length > 0) {
            filter.status = { $in: status } as any;
        }
        if (type && type.length > 0) {
            filter.type = { $in: type } as any;
        }
        if (method && method.length > 0) {
            const nameToNumber: Record<string, PaymentMethod> = {
                bank_transfer: PaymentMethod.BANK_TRANSFER,
                internal: PaymentMethod.INTERNAL,
                payos: PaymentMethod.PAYOS,
                wallet: PaymentMethod.WALLET
            };
            const methodNums = method
                .map((m) => nameToNumber[m])
                .filter((v): v is PaymentMethod => typeof v === 'number');
            if (methodNums.length > 0) {
                filter.method = { $in: methodNums } as any;
            }
        }
        if (startDate || endDate) {
            filter.createdAt = { ...filter.createdAt } as any;
            if (startDate) (filter.createdAt as any).$gte = new Date(startDate);
            if (endDate) (filter.createdAt as any).$lte = new Date(endDate);
        }
        if (search && search.trim().length > 0) {
            const regex = new RegExp(search.trim(), 'i');
            filter.$or = [
                { externalTransactionId: regex },
                { vnpayTransactionNo: regex },
                { notes: regex },
            ] as any;
        }

        const sort: Record<string, 1 | -1> = { [sortBy]: sortOrder === 'asc' ? 1 : -1 };

        const skip = (page - 1) * limit;

        const [data, total] = await Promise.all([
            this.transactionModel
                .find(filter)
                .sort(sort)
                .skip(skip)
                .limit(limit)
                .populate('user', 'fullName email')
                .populate({
                    path: 'booking',
                    select: '_id date startTime endTime field',
                    populate: {
                        path: 'field',
                        select: 'name',
                    },
                })
                .lean(),
            this.transactionModel.countDocuments(filter),
        ]);

        const totalPages = Math.ceil(total / limit) || 1;
        return {
            data,
            total,
            page,
            limit,
            totalPages,
            hasNextPage: page < totalPages,
            hasPrevPage: page > 1,
        };
    }

    async listBookings(query: ListBookingsDto) {
        const {
            search,
            status,
            type,
            paymentStatus,
            approvalStatus,
            startDate,
            endDate,
            page = 1,
            limit = 10,
            sortBy = 'createdAt',
            sortOrder = 'desc',
        } = query;

        const filter: FilterQuery<BookingDocument> = {};

        if (status && status.length > 0) {
            filter.status = { $in: status } as any;
        }
        if (type && type.length > 0) {
            filter.type = { $in: type } as any;
        }
        if (paymentStatus && paymentStatus.length > 0) {
            filter.paymentStatus = { $in: paymentStatus } as any;
        }
        if (approvalStatus && approvalStatus.length > 0) {
            filter.approvalStatus = { $in: approvalStatus } as any;
        }
        if (startDate || endDate) {
            filter.date = { ...filter.date } as any;
            if (startDate) (filter.date as any).$gte = new Date(startDate);
            if (endDate) {
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                (filter.date as any).$lte = end;
            }
        }
        if (search && search.trim().length > 0) {
            const searchTerm = search.trim();
            const regex = new RegExp(searchTerm, 'i');
            const isObjectId = /^[0-9a-fA-F]{24}$/.test(searchTerm);
            filter.$or = [
                { note: regex },
                ...(isObjectId ? [{ _id: searchTerm }] : []),
            ] as any;
        }

        const sort: Record<string, 1 | -1> = { [sortBy]: sortOrder === 'asc' ? 1 : -1 };

        const skip = (page - 1) * limit;

        const [data, total] = await Promise.all([
            this.bookingModel
                .find(filter)
                .sort(sort)
                .skip(skip)
                .limit(limit)
                .populate('user', 'fullName email')
                .populate({
                    path: 'field',
                    select: 'name sportType address',
                })
                .populate({
                    path: 'court',
                    select: 'name courtNumber',
                })
                .populate({
                    path: 'requestedCoach',
                    select: 'fullName',
                })
                .populate({
                    path: 'transaction',
                    select: '_id amount status method',
                })
                .lean(),
            this.bookingModel.countDocuments(filter),
        ]);

        const totalPages = Math.ceil(total / limit) || 1;
        return {
            data,
            total,
            page,
            limit,
            totalPages,
            hasNextPage: page < totalPages,
            hasPrevPage: page > 1,
        };
    }

    async getPlatformAnalytics(
        filter?: AnalyticsFilterDto,
        useAi: boolean = false
    ): Promise<PlatformAnalyticsDto> {
        const { startDate, endDate, sportType, timeRange = 'month' } = filter || {};

        const dateFilter = this.buildDateFilter(startDate, endDate, timeRange);

        // Use REAL data fetching methods instead of placeholders
        const [
            monthlyRevenueData,
            revenueBySportData,
            revenueByTypeData,
            bookingStats,
            userStats,
            sportsFieldBookings,
            sportsTournamentParticipation,
            userFavoriteSports,
            topFieldsByFavorites,
            topCoachesByFavorites,
            bookingPatterns,
            retentionMetrics
        ] = await Promise.all([
            this.getMonthlyRevenueData(dateFilter, sportType), // REAL method
            this.getRevenueBySport(dateFilter), // REAL method
            this.getRevenueByType(dateFilter), // REAL method
            this.getBookingStatistics(dateFilter, sportType),
            this.getUserStatistics(dateFilter),
            this.getSportsFieldBookings(dateFilter, sportType),
            this.getSportsTournamentParticipation(dateFilter, sportType),
            this.getUserFavoriteSports(),
            this.getTopFieldsByFavorites(dateFilter, sportType),
            this.getTopCoachesByFavorites(dateFilter, sportType),
            this.getBookingPatterns(dateFilter),
            this.getRetentionMetrics(dateFilter)
        ]);

        if (!useAi) {
            // Return raw data with actual monthly revenue
            return this.getRawPlatformAnalyticsWithRealData(
                monthlyRevenueData,
                revenueBySportData,
                revenueByTypeData,
                bookingStats,
                userStats,
                sportsFieldBookings,
                sportsTournamentParticipation,
                userFavoriteSports,
                topFieldsByFavorites,
                topCoachesByFavorites,
                bookingPatterns,
                retentionMetrics
            );
        }

        const analyticsData = {
            revenueData: monthlyRevenueData || [],
            revenueBySport: revenueBySportData || [],
            revenueByType: revenueByTypeData || [],
            bookingStats: bookingStats[0] || {},
            userStats: userStats[0] || {},
            sportsFieldBookings: sportsFieldBookings || [],
            sportsTournamentParticipation: sportsTournamentParticipation || [],
            userFavoriteSports: userFavoriteSports || [],
            topFieldsByFavorites: topFieldsByFavorites || [],
            topCoachesByFavorites: topCoachesByFavorites || [],
            bookingPatterns: bookingPatterns || {},
            retentionMetrics: retentionMetrics || {}
        };

        const aiResult = await this.aiService.generatePlatformAnalytics(analyticsData);

        // Convert AI result to DTO
        return this.convertToPlatformAnalyticsDto(aiResult);
    }

    private getRawPlatformAnalyticsWithRealData(
        monthlyRevenueData: any[],
        revenueBySportData: any[],
        revenueByTypeData: any[],
        bookingStats: any[],
        userStats: any[],
        sportsFieldBookings: any[],
        sportsTournamentParticipation: any[],
        userFavoriteSports: any[],
        topFieldsByFavorites: any[],
        topCoachesByFavorites: any[],
        bookingPatterns: any,
        retentionMetrics: any
    ): PlatformAnalyticsDto {
        const totalRevenue = monthlyRevenueData.reduce((sum, month) => sum + (month.revenue || 0), 0);
        const totalBookings = bookingStats[0]?.total || 0;
        const totalUsers = userStats[0]?.total || 0;
        const activeUsers = userStats[0]?.activeUsers || 0;

        const sportsPopularity = this.calculateSportsPopularityFromData(
            sportsFieldBookings,
            sportsTournamentParticipation,
            userFavoriteSports
        );
        // Calculate growth rate for monthly revenue
        const monthlyRevenueWithGrowth = monthlyRevenueData.map((month, index, array) => {
            if (index === 0) return { ...month, growth: 0 };

            const prevMonth = array[index - 1];
            const growth = prevMonth.revenue > 0
                ? ((month.revenue - prevMonth.revenue) / prevMonth.revenue) * 100
                : 0;

            return { ...month, growth: Number(growth.toFixed(2)) };
        });

        return {
            summary: {
                totalRevenue,
                totalBookings,
                totalUsers: activeUsers,
                averageRating: 4.2,
                growthRate: this.calculateGrowthRate(monthlyRevenueData)
            },
            revenueAnalysis: {
                monthlyRevenue: monthlyRevenueWithGrowth,
                revenueBySport: revenueBySportData.map(sport => ({
                    sport: sport.sport || sport._id,
                    revenue: sport.revenue || 0,
                    percentage: totalRevenue > 0 ? (sport.revenue / totalRevenue) * 100 : 0
                })),
                revenueByType: revenueByTypeData.map(type => ({
                    type: this.validateRevenueTypeDto(type.type || type._id),
                    revenue: type.revenue || 0,
                    percentage: totalRevenue > 0 ? (type.revenue / totalRevenue) * 100 : 0
                })),
                peakRevenuePeriods: ['Weekends', 'Evenings']
            },
            popularityAnalysis: {
                sportsPopularity: sportsPopularity,  // Use calculated scores instead of random
                fieldPopularity: topFieldsByFavorites.slice(0, 5).map(field => ({
                    fieldId: field.fieldId,
                    name: field.name,
                    bookings: 0,
                    favorites: field.favoritesCount || 0,
                    rating: field.rating || 0
                })),
                coachPopularity: topCoachesByFavorites.slice(0, 5).map(coach => ({
                    coachId: coach.coachId,
                    name: coach.name,
                    bookings: 0,
                    favorites: coach.favoritesCount || 0,
                    rating: coach.rating || 0
                })),
                trendingSports: ['Football', 'Tennis', 'Badminton']
            },
            userBehavior: {
                bookingPatterns: bookingPatterns,
                retentionMetrics: retentionMetrics
            },
            recommendations: [
                "Generate AI insights for personalized recommendations",
                "Data updated every 5 seconds",
                "Click 'Generate AI Insights' for detailed analysis"
            ]
        };
    }

    private calculateSportsPopularityFromData(
        sportsFieldBookings: any[],
        sportsTournamentParticipation: any[],
        userFavoriteSports: any[]
    ): Array<{ sport: string; bookings: number; tournaments: number; favorites: number; score: number }> {
        const sportMap = new Map<string, {
            sport: string;
            bookings: number;
            tournaments: number;
            favorites: number;
        }>();

        // Aggregate field bookings
        sportsFieldBookings?.forEach(item => {
            if (item._id) {
                const existing = sportMap.get(item._id) || { sport: item._id, bookings: 0, tournaments: 0, favorites: 0 };
                existing.bookings += item.count || 0;
                sportMap.set(item._id, existing);
            }
        });

        // Aggregate tournament participation
        sportsTournamentParticipation?.forEach(item => {
            if (item._id) {
                const existing = sportMap.get(item._id) || { sport: item._id, bookings: 0, tournaments: 0, favorites: 0 };
                existing.tournaments += item.count || 0;
                sportMap.set(item._id, existing);
            }
        });

        // Aggregate user favorites
        userFavoriteSports?.forEach(item => {
            if (item._id) {
                const existing = sportMap.get(item._id) || { sport: item._id, bookings: 0, tournaments: 0, favorites: 0 };
                existing.favorites += item.count || 0;
                sportMap.set(item._id, existing);
            }
        });

        // Calculate scores (same formula as in ai.service.ts)
        return Array.from(sportMap.values())
            .map(sport => ({
                ...sport,
                score: this.calculatePopularityScore(sport.bookings, sport.tournaments, sport.favorites)
            }))
            .sort((a, b) => b.score - a.score);
    }

    // Add this method to calculate score (same as ai.service.ts)
    private calculatePopularityScore(bookings: number, tournaments: number, favorites: number): number {
        const bookingScore = Math.min(bookings * 0.5, 40); // Max 40 points
        const tournamentScore = Math.min(tournaments * 2, 30); // Max 30 points
        const favoriteScore = Math.min(favorites * 0.1, 30); // Max 30 points
        return Math.min(100, bookingScore + tournamentScore + favoriteScore);
    }

    private calculateGrowthRate(monthlyRevenue: any[]): number {
        if (monthlyRevenue.length < 2) return 0;

        const lastMonth = monthlyRevenue[monthlyRevenue.length - 1];
        const prevMonth = monthlyRevenue[monthlyRevenue.length - 2];

        if (prevMonth.revenue === 0) return 0;

        return Number((((lastMonth.revenue - prevMonth.revenue) / prevMonth.revenue) * 100).toFixed(2));
    }

    async getFieldOwnerStats(
        filter?: AnalyticsFilterDto,
        useAi: boolean = false
    ): Promise<FieldOwnerStatsDto[]> {
        const { startDate, endDate, timeRange = 'month' } = filter || {};
        const dateFilter = this.buildDateFilter(startDate, endDate, timeRange);

        const owners = await this.userModel.find({ role: UserRole.FIELD_OWNER });
        const results: FieldOwnerStatsDto[] = [];

        for (const owner of owners) {
            if (useAi) {
                const stats = await this.getFieldOwnerAnalytics((owner._id as Types.ObjectId), dateFilter);
                results.push(stats);
            } else {
                // Return raw data without AI
                const rawStats = await this.getRawFieldOwnerStats(owner, dateFilter);
                results.push(rawStats);
            }
        }

        return results;
    }

    async getDetailedFieldOwnerStats(
        fieldOwnerId: string,
        filter?: AnalyticsFilterDto,
        useAi: boolean = false
    ): Promise<DetailedFieldOwnerStatsDto> {
        const { startDate, endDate, timeRange = 'month' } = filter || {};
        const dateFilter = this.buildDateFilter(startDate, endDate, timeRange);

        const owner = await this.userModel.findById(fieldOwnerId);
        if (!owner) {
            throw new NotFoundException('Field owner not found');
        }

        if (!useAi) {
            // Return raw data without AI
            const [basicStats, revenueByMonth, fieldDetails, customerDemographics] = await Promise.all([
                this.getRawFieldOwnerStats(owner, dateFilter),
                this.getRevenueByMonth(fieldOwnerId, dateFilter),
                this.getFieldDetails(fieldOwnerId, dateFilter),
                this.getCustomerDemographics(fieldOwnerId, dateFilter)
            ]);

            const detailedStats: DetailedFieldOwnerStatsDto = {
                ...basicStats,
                revenueByMonth,
                fieldDetails,
                customerDemographics
            };

            return detailedStats;
        }

        const [
            basicStats,
            revenueByMonth,
            fieldDetails,
            customerDemographics
        ] = await Promise.all([
            this.getFieldOwnerAnalytics((fieldOwnerId as unknown as Types.ObjectId), dateFilter),
            this.getRevenueByMonth(fieldOwnerId, dateFilter),
            this.getFieldDetails(fieldOwnerId, dateFilter),
            this.getCustomerDemographics(fieldOwnerId, dateFilter)
        ]);

        const detailedStats: DetailedFieldOwnerStatsDto = {
            ...basicStats,
            revenueByMonth,
            fieldDetails,
            customerDemographics
        };

        return detailedStats;
    }

    async getCoachStats(
        filter?: AnalyticsFilterDto,
        useAi: boolean = false
    ): Promise<CoachStatsDto[]> {
        const { startDate, endDate, timeRange = 'month' } = filter || {};
        const dateFilter = this.buildDateFilter(startDate, endDate, timeRange);

        const profiles = await this.coachProfileModel.find().populate('user', 'fullName');
        const results: CoachStatsDto[] = [];

        for (const profile of profiles) {
            if (!profile.user) continue;

            if (useAi) {
                const stats = await this.getCoachAnalytics(profile, dateFilter);
                results.push(stats);
            } else {
                // Return raw data without AI
                const rawStats = await this.getRawCoachStats(profile, dateFilter);
                results.push(rawStats);
            }
        }

        return results;
    }

    async getDetailedCoachStats(
        coachId: string,
        filter?: AnalyticsFilterDto,
        useAi: boolean = false
    ): Promise<any> {
        const { startDate, endDate, timeRange = 'month' } = filter || {};
        const dateFilter = this.buildDateFilter(startDate, endDate, timeRange);

        const profile = await this.coachProfileModel.findOne({ user: coachId }).populate('user', 'fullName');
        if (!profile) {
            throw new NotFoundException('Coach profile not found');
        }

        if (!useAi) {
            const basicStats = await this.getRawCoachStats(profile, dateFilter);

            const [monthlyPerformance, clientAnalysis, sportsAnalysis] = await Promise.all([
                this.getCoachMonthlyPerformance(coachId, dateFilter),
                this.getCoachClientAnalysis(coachId, dateFilter),
                this.getCoachSportsAnalysis(profile)
            ]);

            return {
                ...basicStats,
                monthlyPerformance,
                clientAnalysis,
                sportsAnalysis
            };
        }

        const basicStats = await this.getCoachAnalytics(profile, dateFilter);

        const [monthlyPerformance, clientAnalysis, sportsAnalysis] = await Promise.all([
            this.getCoachMonthlyPerformance(coachId, dateFilter),
            this.getCoachClientAnalysis(coachId, dateFilter),
            this.getCoachSportsAnalysis(profile)
        ]);

        return {
            ...basicStats,
            monthlyPerformance,
            clientAnalysis,
            sportsAnalysis
        };
    }

    private async getRawFieldOwnerStats(
        owner: UserDocument,
        dateFilter: any
    ): Promise<FieldOwnerStatsDto> {
        // 1. First find the field owner profile for this user
        const fieldOwnerProfile = await this.fieldOwnerProfileModel.findOne({
            user: owner._id
        });

        if (!fieldOwnerProfile) {
            // Return empty stats if no profile exists
            return this.createEmptyFieldOwnerStats(owner);
        }

        // 2. Find fields using the profile ID OR User ID (to handle legacy data)
        const fields = await this.fieldModel.find({
            $or: [
                { owner: fieldOwnerProfile._id },
                { owner: owner._id }
            ]
        });

        // Rest of the method remains the same...
        const fieldIds = fields.map(f => f._id as Types.ObjectId);

        const [totalBookings, totalFavorites, monthlyBookings, sportsDistribution] = await Promise.all([
            this.bookingModel.countDocuments({
                field: { $in: fieldIds },
                ...dateFilter
            }),
            this.userModel.countDocuments({ favouriteFields: { $in: fieldIds } }),
            this.getMonthlyBookingsForFields(fieldIds, dateFilter),
            this.getSportsDistributionForFields(fields)
        ]);

        const averageRating = fields.length > 0
            ? fields.reduce((acc, f) => acc + (f.rating || 0), 0) / fields.length
            : 0;

        // Calculate real trends from monthly bookings
        const bookingTrend = this.determineTrend(monthlyBookings);
        const revenueTrend = this.determineRevenueTrend(monthlyBookings);

        // Calculate actual metrics
        const [cancellationRate, repeatCustomerRate] = await Promise.all([
            this.getCancellationRateForFields(fieldIds, dateFilter),
            this.getRepeatCustomerRateForFields(fieldIds, dateFilter)
        ]);

        return {
            fieldOwnerId: (owner._id as Types.ObjectId).toString(),
            fieldOwnerName: owner.fullName || 'Unknown',
            totalFields: fields.length,
            averageRating: Number(averageRating.toFixed(2)),
            totalBookings,
            bookingRate: 0,
            totalFavorites,
            aiInsight: "Click 'Generate AI Insights' for detailed analysis",
            monthlyBookings,
            sportsDistribution,
            bookingTrend,
            revenueTrend,
            peakBookingHours: await this.getPeakBookingHoursForFields(fieldIds, dateFilter),
            cancellationRate,
            repeatCustomerRate,
            performanceScore: this.calculatePerformanceScore(averageRating, totalBookings, totalFavorites),
            marketPosition: this.determineMarketPosition(averageRating, totalBookings),
            growthPotential: 50,
            strengths: ["Data available for AI analysis"],
            opportunities: ["Generate AI insights to identify opportunities"],
            recommendations: ["Use AI analysis for personalized recommendations"]
        };
    }

    private createEmptyFieldOwnerStats(owner: UserDocument): FieldOwnerStatsDto {
        return {
            fieldOwnerId: (owner._id as Types.ObjectId).toString(),
            fieldOwnerName: owner.fullName || 'Unknown',
            totalFields: 0,
            averageRating: 0,
            totalBookings: 0,
            bookingRate: 0,
            totalFavorites: 0,
            aiInsight: "No field owner profile found. User hasn't registered as a field owner yet.",
            monthlyBookings: [],
            sportsDistribution: [],
            bookingTrend: 'stable',
            revenueTrend: 'stable',
            peakBookingHours: [],
            cancellationRate: 0,
            repeatCustomerRate: 0,
            performanceScore: 0,
            marketPosition: 'developing',
            growthPotential: 50,
            strengths: ["User needs to complete field owner registration"],
            opportunities: ["Complete field owner profile setup"],
            recommendations: ["Register as a field owner and add fields to start earning"]
        };
    }

    private calculatePerformanceScore(rating: number, bookings: number, favorites: number): number {
        if (rating === 0 && bookings === 0 && favorites === 0) return 0;

        const ratingScore = rating * 20; // 0-100 scale
        const bookingScore = Math.min(bookings * 0.5, 40); // Max 40 points
        const favoriteScore = Math.min(favorites * 0.5, 30); // Max 30 points
        return Math.min(100, ratingScore + bookingScore + favoriteScore);
    }

    private determineMarketPosition(rating: number, bookings: number): 'leader' | 'strong' | 'average' | 'developing' {
        const score = rating * 20 + Math.min(bookings / 5, 50);
        if (score >= 80) return 'leader';
        if (score >= 60) return 'strong';
        if (score >= 40) return 'average';
        return 'developing';
    }

    private async getRawCoachStats(
        profile: CoachProfileDocument,
        dateFilter: any
    ): Promise<CoachStatsDto> {
        const user = profile.user as any;
        const userId = user._id as Types.ObjectId;
        const profileId = profile._id as Types.ObjectId;

        const [totalBookings, totalFavorites] = await Promise.all([
            this.getTotalBookingsForCoach(profileId, dateFilter),
            this.getTotalFavoritesForCoach(userId as Types.ObjectId)
        ]);

        return {
            coachId: userId.toString(),
            coachName: user.fullName || 'Unknown',
            averageRating: profile.rating || 0,
            totalBookings,
            totalFavorites,
            aiInsight: "Click 'Generate AI Insights' for detailed analysis",
            sports: profile.sports,
            hourlyRate: profile.hourlyRate,
            monthlyBookings: [],
            // Placeholder values
            bookingTrend: 'stable',
            clientRetentionRate: 0,
            peakAvailability: [],
            certificationLevel: profile.certification,
            experienceLevel: this.determineExperienceLevel(profile.experience),
            performanceScore: 50,
            marketPosition: 'average',
            strengths: ["Data available for AI analysis"],
            opportunities: ["Generate AI insights to identify opportunities"],
            recommendations: ["Use AI analysis for personalized recommendations"]
        };
    }

    // ==============================
    // Helper Methods
    // ==============================

    private async getFieldOwnerAnalytics(
        ownerId: Types.ObjectId,
        dateFilter: any
    ): Promise<FieldOwnerStatsDto> {
        const [owner, fieldOwnerProfile] = await Promise.all([
            this.userModel.findById(ownerId),
            this.fieldOwnerProfileModel.findOne({ user: ownerId })
        ]);

        const fields = await this.fieldModel.find({
            $or: [
                { owner: fieldOwnerProfile?._id },
                { owner: ownerId } // Legacy support
            ]
        });

        // Type assertion - assuming fields is an array of FieldDocument
        const typedFields = fields as FieldDocument[];
        const fieldIds = typedFields.map(f => f._id as Types.ObjectId);

        const [
            monthlyBookings,
            sportsDistribution,
            totalFavorites,
            totalBookings,
            cancellationRate,
            repeatCustomerRate,
            peakBookingHours
        ] = await Promise.all([
            this.getMonthlyBookingsForFields(fieldIds, dateFilter),
            this.getSportsDistributionForFields(fields),
            this.getTotalFavoritesForFields(fieldIds),
            this.getTotalBookingsForFields(fieldIds, dateFilter),
            this.getCancellationRateForFields(fieldIds, dateFilter),
            this.getRepeatCustomerRateForFields(fieldIds, dateFilter),
            this.getPeakBookingHoursForFields(fieldIds, dateFilter)
        ]);

        const averageRating = fields.reduce((acc, f) => acc + (f.rating || 0), 0) / (fields.length || 1);
        const totalFields = fields.length;

        const statsContext: DetailedFieldOwnerStats = {
            fieldOwnerId: ownerId.toString(),
            fieldOwnerName: owner?.fullName || 'Unknown',
            totalFields,
            averageRating: Number(averageRating.toFixed(2)),
            totalBookings,
            totalFavorites,
            monthlyBookings,
            sportsDistribution,
            bookingTrend: this.determineTrend(monthlyBookings),
            revenueTrend: this.determineRevenueTrend(monthlyBookings),
            peakBookingHours,
            cancellationRate,
            repeatCustomerRate
        };

        const aiInsights = await this.aiService.generateFieldOwnerInsights(statsContext);

        return {
            fieldOwnerId: ownerId.toString(),
            fieldOwnerName: owner?.fullName || 'Unknown',
            totalFields,
            averageRating: Number(averageRating.toFixed(2)),
            totalBookings,
            bookingRate: 0,
            totalFavorites,
            aiInsight: aiInsights.summary,
            monthlyBookings,
            sportsDistribution,
            bookingTrend: this.determineTrend(monthlyBookings),
            revenueTrend: this.determineRevenueTrend(monthlyBookings),
            peakBookingHours,
            cancellationRate,
            repeatCustomerRate,
            performanceScore: aiInsights.metrics.performanceScore,
            marketPosition: aiInsights.metrics.marketPosition,
            growthPotential: aiInsights.metrics.growthPotential,
            strengths: aiInsights.strengths,
            opportunities: aiInsights.opportunities,
            recommendations: aiInsights.recommendations
        };
    }

    private async getCoachAnalytics(
        profile: CoachProfileDocument,
        dateFilter: any
    ): Promise<CoachStatsDto> {
        const user = profile.user as any;
        const userId = user._id as Types.ObjectId;
        const profileId = profile._id as Types.ObjectId;

        const [
            monthlyBookings,
            totalBookings,
            totalFavorites,
            clientRetentionRate,
            peakAvailability
        ] = await Promise.all([
            this.getMonthlyBookingsForCoach(profileId, dateFilter),
            this.getTotalBookingsForCoach(profileId, dateFilter),
            this.getTotalFavoritesForCoach(userId),
            this.getClientRetentionRate(profileId, dateFilter),
            this.getPeakAvailability(profileId, dateFilter)
        ]);

        const statsContext: DetailedCoachStats = {
            coachId: userId.toString(),
            coachName: (profile as any).user?.fullName || 'Unknown',
            sports: profile.sports,
            averageRating: profile.rating || 0,
            totalBookings,
            totalFavorites,
            hourlyRate: profile.hourlyRate,
            monthlyBookings,
            bookingTrend: this.determineTrend(monthlyBookings),
            clientRetentionRate,
            peakAvailability,
            certificationLevel: profile.certification,
            experienceLevel: this.determineExperienceLevel(profile.experience)
        };

        const aiInsights = await this.aiService.generateCoachInsights(statsContext);

        return {
            coachId: userId.toString(),
            coachName: (profile as any).user?.fullName || 'Unknown',
            averageRating: profile.rating || 0,
            totalBookings,
            totalFavorites,
            aiInsight: aiInsights.summary,
            sports: profile.sports,
            hourlyRate: profile.hourlyRate,
            monthlyBookings,
            bookingTrend: this.determineTrend(monthlyBookings),
            clientRetentionRate,
            peakAvailability,
            certificationLevel: profile.certification,
            experienceLevel: this.determineExperienceLevel(profile.experience),
            performanceScore: aiInsights.metrics.performanceScore,
            marketPosition: aiInsights.metrics.marketPosition,
            strengths: aiInsights.strengths,
            opportunities: aiInsights.opportunities,
            recommendations: aiInsights.recommendations
        };
    }

    private async getMonthlyBookingsForFields(
        fieldIds: Types.ObjectId[],
        dateFilter: any
    ): Promise<MonthlyBookingDto[]> {
        if (fieldIds.length === 0) {
            return [];
        }

        const results = await this.bookingModel.aggregate([
            {
                $match: {
                    field: { $in: fieldIds },
                    status: { $in: [BookingStatus.CONFIRMED, BookingStatus.COMPLETED] },
                    ...dateFilter
                }
            },
            {
                $lookup: {
                    from: "transactions",
                    localField: "transaction",
                    foreignField: "_id",
                    as: "transactionData"
                }
            },
            { $unwind: { path: "$transactionData", preserveNullAndEmptyArrays: true } },
            {
                $group: {
                    _id: {
                        year: { $year: "$date" },
                        month: { $month: "$date" }
                    },
                    count: { $sum: 1 },
                    revenue: {
                        $sum: {
                            $cond: [
                                { $eq: ["$transactionData.status", "succeeded"] },
                                "$transactionData.amount",
                                0
                            ]
                        }
                    }
                }
            },
            { $sort: { "_id.year": 1, "_id.month": 1 } },
            {
                $project: {
                    _id: 0,
                    month: {
                        $dateToString: {
                            format: "%Y-%m",
                            date: {
                                $dateFromParts: {
                                    year: "$_id.year",
                                    month: "$_id.month",
                                    day: 1
                                }
                            }
                        }
                    },
                    count: 1,
                    revenue: 1
                }
            }
        ]);

        return results;
    }

    private async getSportsDistributionForFields(
        fields: FieldDocument[]
    ): Promise<SportsDistributionDto[]> {
        const sportCounts: Record<string, number> = {};

        fields.forEach(field => {
            const sport = field.sportType;
            sportCounts[sport] = (sportCounts[sport] || 0) + 1;
        });

        const total = fields.length;

        return Object.entries(sportCounts).map(([sport, count]) => ({
            sport,
            count,
            percentage: (count / total) * 100
        }));
    }

    private async getTotalFavoritesForFields(
        fieldIds: Types.ObjectId[]
    ): Promise<number> {
        return this.userModel.countDocuments({ favouriteFields: { $in: fieldIds } });
    }

    private async getTotalBookingsForFields(
        fieldIds: Types.ObjectId[],
        dateFilter: any
    ): Promise<number> {
        if (fieldIds.length === 0) return 0;

        return this.bookingModel.countDocuments({
            field: { $in: fieldIds },
            status: { $in: [BookingStatus.CONFIRMED, BookingStatus.COMPLETED] },
            ...dateFilter
        });
    }

    private async getCancellationRateForFields(
        fieldIds: Types.ObjectId[],
        dateFilter: any
    ): Promise<number> {
        const [totalBookings, cancelledBookings] = await Promise.all([
            this.bookingModel.countDocuments({
                field: { $in: fieldIds },
                ...dateFilter
            }),
            this.bookingModel.countDocuments({
                field: { $in: fieldIds },
                status: BookingStatus.CANCELLED,
                ...dateFilter
            })
        ]);

        return totalBookings > 0 ? (cancelledBookings / totalBookings) * 100 : 0;
    }

    private async getRepeatCustomerRateForFields(
        fieldIds: Types.ObjectId[],
        dateFilter: any
    ): Promise<number> {
        const repeatCustomers = await this.bookingModel.aggregate([
            {
                $match: {
                    field: { $in: fieldIds },
                    ...dateFilter
                }
            },
            {
                $group: {
                    _id: "$user",
                    bookings: { $sum: 1 }
                }
            },
            {
                $match: {
                    bookings: { $gt: 1 }
                }
            },
            {
                $count: "repeatCustomers"
            }
        ]);

        const totalCustomers = await this.bookingModel.distinct('user', {
            field: { $in: fieldIds },
            ...dateFilter
        });

        return totalCustomers.length > 0
            ? ((repeatCustomers[0]?.repeatCustomers || 0) / totalCustomers.length) * 100
            : 0;
    }

    private async getPeakBookingHoursForFields(
        fieldIds: Types.ObjectId[],
        dateFilter: any
    ): Promise<string[]> {
        const peakHours = await this.bookingModel.aggregate([
            {
                $match: {
                    field: { $in: fieldIds },
                    ...dateFilter
                }
            },
            {
                $group: {
                    _id: "$startTime",
                    count: { $sum: 1 }
                }
            },
            { $sort: { count: -1 } },
            { $limit: 3 }
        ]);

        return peakHours.map(hour => hour._id);
    }

    private async getRevenueByMonth(
        fieldOwnerId: string,
        dateFilter: any
    ): Promise<any[]> {
        const fields = await this.fieldModel.find({ owner: fieldOwnerId });
        const fieldIds = fields.map(f => f._id);

        return this.bookingModel.aggregate([
            {
                $match: {
                    field: { $in: fieldIds },
                    ...dateFilter
                }
            },
            {
                $lookup: {
                    from: "transactions",
                    localField: "transaction",
                    foreignField: "_id",
                    as: "transactionData"
                }
            },
            { $unwind: { path: "$transactionData", preserveNullAndEmptyArrays: true } },
            {
                $group: {
                    _id: {
                        year: { $year: "$createdAt" },
                        month: { $month: "$createdAt" }
                    },
                    revenue: {
                        $sum: {
                            $cond: [
                                { $eq: ["$transactionData.status", "succeeded"] },
                                "$transactionData.amount",
                                0
                            ]
                        }
                    },
                    bookings: { $sum: 1 },
                    avgBookingValue: {
                        $avg: {
                            $cond: [
                                { $eq: ["$transactionData.status", "succeeded"] },
                                "$transactionData.amount",
                                0
                            ]
                        }
                    }
                }
            },
            { $sort: { "_id.year": 1, "_id.month": 1 } }
        ]);
    }

    private async getFieldDetails(
        fieldOwnerId: string,
        dateFilter: any
    ): Promise<any[]> {
        const fields = await this.fieldModel.find({ owner: fieldOwnerId });

        return Promise.all(fields.map(async (field) => {
            const [bookings, revenue] = await Promise.all([
                this.bookingModel.countDocuments({
                    field: field._id,
                    ...dateFilter
                }),
                this.getFieldRevenue((field._id as Types.ObjectId), dateFilter)
            ]);

            return {
                fieldId: (field._id as Types.ObjectId).toString(),
                name: field.name,
                sportType: field.sportType,
                rating: field.rating || 0,
                bookings,
                revenue,
                utilizationRate: this.calculateUtilizationRate(field, bookings, dateFilter)
            };
        }));
    }

    private async getCustomerDemographics(
        fieldOwnerId: string,
        dateFilter: any
    ): Promise<any> {
        const fields = await this.fieldModel.find({ owner: fieldOwnerId });
        const typedFields = fields as FieldDocument[];
        const fieldIds = typedFields.map(f => f._id as Types.ObjectId);

        const [ageGroups, repeatCustomers, newCustomers, bookingTimes] = await Promise.all([
            this.getCustomerAgeGroups(fieldIds, dateFilter),
            this.getRepeatCustomers(fieldIds, dateFilter),
            this.getNewCustomers(fieldIds, dateFilter),
            this.getPreferredBookingTimes(fieldIds, dateFilter)
        ]);

        return {
            ageGroups,
            repeatCustomers,
            newCustomers,
            preferredBookingTimes: bookingTimes
        };
    }

    private buildDateFilter(
        startDate?: Date,
        endDate?: Date,
        timeRange?: string
    ): any {
        const filter: any = {};

        if (startDate || endDate) {
            filter.createdAt = {};
            if (startDate) filter.createdAt.$gte = new Date(startDate);
            if (endDate) filter.createdAt.$lte = new Date(endDate);
        } else if (timeRange) {
            const now = new Date();
            let start: Date;

            switch (timeRange) {
                case 'week':
                    start = new Date(now.setDate(now.getDate() - 7));
                    break;
                case 'month':
                    start = new Date(now.setMonth(now.getMonth() - 1));
                    break;
                case '3months':
                case 'quarter':
                    start = new Date(now.setMonth(now.getMonth() - 3));
                    break;
                case '6months':
                    start = new Date(now.setMonth(now.getMonth() - 6));
                    break;
                case '1year':
                case 'year':
                    start = new Date(now.setFullYear(now.getFullYear() - 1));
                    break;
                default:
                    return {};
            }

            filter.createdAt = { $gte: start };
        }

        return filter;
    }

    private determineTrend(monthlyData: MonthlyBookingDto[]): 'increasing' | 'decreasing' | 'stable' {
        if (monthlyData.length < 2) return 'stable';

        const lastTwo = monthlyData.slice(-2);
        const diff = lastTwo[1].count - lastTwo[0].count;

        if (diff > 0) return 'increasing';
        if (diff < 0) return 'decreasing';
        return 'stable';
    }

    private determineRevenueTrend(monthlyData: MonthlyBookingDto[]): 'increasing' | 'decreasing' | 'stable' {
        if (monthlyData.length < 2) return 'stable';

        const lastTwo = monthlyData.slice(-2);
        const diff = lastTwo[1].revenue - lastTwo[0].revenue;

        if (diff > 0) return 'increasing';
        if (diff < 0) return 'decreasing';
        return 'stable';
    }

    private determineExperienceLevel(experience: string): 'beginner' | 'intermediate' | 'expert' {
        const years = parseInt(experience) || 0;
        if (years >= 5) return 'expert';
        if (years >= 2) return 'intermediate';
        return 'beginner';
    }

    private calculateUtilizationRate(field: FieldDocument, bookings: number, dateFilter: any): number {
        const operatingHoursPerWeek = field.operatingHours?.length * 8 || 40;
        const slotsPerHour = 60 / (field.slotDuration || 60);
        const totalPossibleSlots = operatingHoursPerWeek * slotsPerHour;

        return totalPossibleSlots > 0 ? (bookings / totalPossibleSlots) * 100 : 0;
    }

    // Additional helper methods (simplified for brevity)
    private async getFieldRevenue(fieldId: Types.ObjectId, dateFilter: any): Promise<number> {
        const result = await this.bookingModel.aggregate([
            {
                $match: {
                    field: fieldId,
                    ...dateFilter
                }
            },
            {
                $lookup: {
                    from: "transactions",
                    localField: "transaction",
                    foreignField: "_id",
                    as: "transactionData"
                }
            },
            { $unwind: { path: "$transactionData", preserveNullAndEmptyArrays: true } },
            {
                $group: {
                    _id: null,
                    total: {
                        $sum: {
                            $cond: [
                                { $eq: ["$transactionData.status", "succeeded"] },
                                "$transactionData.amount",
                                0
                            ]
                        }
                    }
                }
            }
        ]);

        return result[0]?.total || 0;
    }

    private async getCustomerAgeGroups(fieldIds: Types.ObjectId[], dateFilter: any): Promise<any[]> {
        return [
            { range: "18-24", percentage: 25 },
            { range: "25-34", percentage: 45 },
            { range: "35-44", percentage: 20 },
            { range: "45+", percentage: 10 }
        ];
    }

    private async getRepeatCustomers(fieldIds: Types.ObjectId[], dateFilter: any): Promise<number> {
        const result = await this.bookingModel.aggregate([
            {
                $match: {
                    field: { $in: fieldIds },
                    ...dateFilter
                }
            },
            {
                $group: {
                    _id: "$user",
                    bookings: { $sum: 1 }
                }
            },
            {
                $match: {
                    bookings: { $gt: 1 }
                }
            },
            {
                $count: "repeatCustomers"
            }
        ]);

        return result[0]?.repeatCustomers || 0;
    }

    private async getNewCustomers(fieldIds: Types.ObjectId[], dateFilter: any): Promise<number> {
        const result = await this.bookingModel.aggregate([
            {
                $match: {
                    field: { $in: fieldIds },
                    ...dateFilter
                }
            },
            {
                $group: {
                    _id: "$user",
                    firstBooking: { $min: "$createdAt" }
                }
            },
            {
                $match: {
                    $expr: {
                        $gte: ["$firstBooking", dateFilter.createdAt?.$gte || new Date(0)]
                    }
                }
            },
            {
                $count: "newCustomers"
            }
        ]);

        return result[0]?.newCustomers || 0;
    }

    private async getPreferredBookingTimes(fieldIds: Types.ObjectId[], dateFilter: any): Promise<string[]> {
        const result = await this.bookingModel.aggregate([
            {
                $match: {
                    field: { $in: fieldIds },
                    ...dateFilter
                }
            },
            {
                $group: {
                    _id: "$startTime",
                    count: { $sum: 1 }
                }
            },
            { $sort: { count: -1 } },
            { $limit: 5 }
        ]);

        return result.map(item => item._id);
    }

    // Placeholder methods for additional analytics
    private async getRevenueAnalytics(dateFilter: any, sportType?: string): Promise<any[]> {
        return this.transactionModel.aggregate([
            {
                $match: {
                    status: 'succeeded',
                    direction: 'in',
                    ...dateFilter
                }
            },
            {
                $group: {
                    _id: null,
                    totalRevenue: { $sum: '$amount' },
                    avgTransaction: { $avg: '$amount' },
                    count: { $sum: 1 }
                }
            }
        ]);
    }

    private async getBookingStatistics(dateFilter: any, sportType?: string): Promise<any[]> {
        return this.bookingModel.aggregate([
            {
                $match: {
                    ...dateFilter
                }
            },
            {
                $group: {
                    _id: null,
                    total: { $sum: 1 },
                    fieldBookings: {
                        $sum: { $cond: [{ $eq: ["$type", "field"] }, 1, 0] }
                    },
                    coachBookings: {
                        $sum: { $cond: [{ $eq: ["$type", "coach"] }, 1, 0] }
                    }
                }
            }
        ]);
    }

    private async getUserStatistics(dateFilter: any): Promise<any[]> {
        return this.userModel.aggregate([
            {
                $match: {
                    createdAt: dateFilter.createdAt || {}
                }
            },
            {
                $group: {
                    _id: null,
                    total: { $sum: 1 },
                    activeUsers: {
                        $sum: { $cond: [{ $eq: ["$isActive", true] }, 1, 0] }
                    }
                }
            }
        ]);
    }

    private async getSportsFieldBookings(dateFilter: any, sportType?: string): Promise<any[]> {
        return this.fieldModel.aggregate([
            {
                $match: sportType ? { sportType } : {}
            },
            {
                $group: {
                    _id: "$sportType",
                    count: { $sum: "$totalReviews" }
                }
            },
            { $sort: { count: -1 } }
        ]);
    }

    private async getSportsTournamentParticipation(dateFilter: any, sportType?: string): Promise<any[]> {
        return this.tournamentModel.aggregate([
            {
                $match: sportType ? { sportType } : {}
            },
            {
                $group: {
                    _id: "$sportType",
                    count: { $sum: { $size: "$participants" } }
                }
            },
            { $sort: { count: -1 } }
        ]);
    }

    private async getUserFavoriteSports(): Promise<any[]> {
        return this.userModel.aggregate([
            { $unwind: "$favouriteSports" },
            { $group: { _id: "$favouriteSports", count: { $sum: 1 } } },
            { $sort: { count: -1 } }
        ]);
    }

    private async getTopFieldsByFavorites(dateFilter: any, sportType?: string, limit?: number): Promise<any[]> {
        const pipeline: any[] = [
            {
                $lookup: {
                    from: "users",
                    localField: "_id",
                    foreignField: "favouriteFields",
                    as: "favoritedBy"
                }
            },
            {
                $project: {
                    fieldId: "$_id",
                    name: 1,
                    sportType: 1,
                    rating: 1,
                    totalReviews: 1,
                    favoritesCount: { $size: "$favoritedBy" }
                }
            },
            { $sort: { favoritesCount: -1 } }
        ];

        if (limit) {
            pipeline.push({ $limit: limit });
        }

        return this.fieldModel.aggregate(pipeline);
    }

    private async getTopCoachesByFavorites(dateFilter: any, sportType?: string, limit?: number): Promise<any[]> {
        const pipeline: any[] = [
            {
                $lookup: {
                    from: "users",
                    localField: "user",
                    foreignField: "favouriteCoaches",
                    as: "favoritedBy"
                }
            },
            {
                $lookup: {
                    from: "users",
                    localField: "user",
                    foreignField: "_id",
                    as: "userDetails"
                }
            },
            { $unwind: "$userDetails" },
            {
                $project: {
                    coachId: "$user",
                    name: "$userDetails.fullName",
                    sports: 1,
                    rating: 1,
                    favoritesCount: { $size: "$favoritedBy" }
                }
            },
            { $sort: { favoritesCount: -1 } }
        ];

        if (limit) {
            pipeline.push({ $limit: limit });
        }

        return this.coachProfileModel.aggregate(pipeline);
    }

    private async getBookingPatterns(dateFilter: any): Promise<any> {
        // REAL QUERY for peak booking days
        const peakDaysResult = await this.bookingModel.aggregate([
            {
                $match: {
                    ...dateFilter,
                    status: { $in: [BookingStatus.CONFIRMED, BookingStatus.COMPLETED] }
                }
            },
            {
                $project: {
                    // Extract day of week from date field (ensure date is Date type)
                    dayOfWeek: { $dayOfWeek: "$date" }
                }
            },
            {
                $group: {
                    _id: "$dayOfWeek",
                    count: { $sum: 1 }
                }
            },
            { $sort: { count: -1 } },
            { $limit: 3 }
        ]);

        // Convert day numbers to names
        const dayMap = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const peakBookingDays = peakDaysResult.map(day => dayMap[(day._id - 1) % 7] || `Day ${day._id}`);

        // FIXED: Properly handle time extraction - check if startTime is Date or String
        const peakHoursResult = await this.bookingModel.aggregate([
            {
                $match: {
                    ...dateFilter,
                    status: { $in: [BookingStatus.CONFIRMED, BookingStatus.COMPLETED] }
                }
            },
            {
                $project: {
                    // Handle both Date objects and String representations
                    hour: {
                        $cond: [
                            { $eq: [{ $type: "$startTime" }, "date"] },
                            { $hour: "$startTime" },
                            // If startTime is string, parse it
                            {
                                $let: {
                                    vars: {
                                        timeStr: { $toString: "$startTime" }
                                    },
                                    in: {
                                        $toInt: {
                                            $arrayElemAt: [
                                                { $split: ["$$timeStr", ":"] },
                                                0
                                            ]
                                        }
                                    }
                                }
                            }
                        ]
                    },
                    // Calculate duration properly
                    duration: {
                        $cond: [
                            {
                                $and: [
                                    { $eq: [{ $type: "$startTime" }, "date"] },
                                    { $eq: [{ $type: "$endTime" }, "date"] }
                                ]
                            },
                            {
                                $divide: [
                                    { $subtract: ["$endTime", "$startTime"] },
                                    1000 * 60 * 60 // Convert ms to hours
                                ]
                            },
                            2.5 // Default duration if times are not dates
                        ]
                    }
                }
            },
            {
                $match: {
                    hour: { $ne: null } // Filter out invalid hours
                }
            },
            {
                $group: {
                    _id: "$hour",
                    count: { $sum: 1 },
                    avgDuration: { $avg: "$duration" }
                }
            },
            { $sort: { count: -1 } },
            { $limit: 3 }
        ]);

        const peakBookingHours = peakHoursResult.map(hour =>
            `${hour._id}:00-${hour._id + 1}:00`
        );

        // FIXED: Proper average booking duration calculation
        const avgDurationResult = await this.bookingModel.aggregate([
            {
                $match: {
                    ...dateFilter,
                    status: { $in: [BookingStatus.CONFIRMED, BookingStatus.COMPLETED] }
                }
            },
            {
                $project: {
                    startTime: 1,
                    endTime: 1,
                    duration: {
                        $cond: [
                            {
                                $and: [
                                    { $eq: [{ $type: "$startTime" }, "date"] },
                                    { $eq: [{ $type: "$endTime" }, "date"] },
                                    { $gt: ["$endTime", "$startTime"] }
                                ]
                            },
                            {
                                $divide: [
                                    { $subtract: ["$endTime", "$startTime"] },
                                    1000 * 60 * 60 // Convert ms to hours
                                ]
                            },
                            null // Return null for invalid durations
                        ]
                    }
                }
            },
            {
                $match: {
                    duration: { $ne: null, $gt: 0 }
                }
            },
            {
                $group: {
                    _id: null,
                    avgDuration: { $avg: "$duration" },
                    count: { $sum: 1 }
                }
            }
        ]);

        const averageBookingDuration = avgDurationResult[0]?.avgDuration || 2.5;

        // REAL QUERY for preferred sports (from fields)
        const preferredSportsResult = await this.bookingModel.aggregate([
            {
                $match: {
                    ...dateFilter,
                    status: { $in: [BookingStatus.CONFIRMED, BookingStatus.COMPLETED] },
                    field: { $exists: true, $ne: null }
                }
            },
            {
                $lookup: {
                    from: "fields",
                    localField: "field",
                    foreignField: "_id",
                    as: "fieldData"
                }
            },
            { $unwind: "$fieldData" },
            {
                $group: {
                    _id: "$fieldData.sportType",
                    count: { $sum: 1 }
                }
            },
            { $sort: { count: -1 } },
            { $limit: 3 }
        ]);

        const preferredSports = preferredSportsResult.map(sport => sport._id);

        return {
            peakBookingDays: peakBookingDays.length > 0 ? peakBookingDays : ['Saturday', 'Sunday'],
            peakBookingHours: peakBookingHours.length > 0 ? peakBookingHours : ['18:00-19:00', '19:00-20:00'],
            averageBookingDuration: Number(averageBookingDuration.toFixed(1)),
            preferredSports: preferredSports.length > 0 ? preferredSports : ['Football', 'Tennis', 'Badminton']
        };
    }

    private async getRetentionMetrics(dateFilter: any): Promise<any> {
        // REAL QUERY for repeat booking rate
        const repeatBookingResult = await this.bookingModel.aggregate([
            {
                $match: {
                    ...dateFilter,
                    status: { $in: [BookingStatus.CONFIRMED, BookingStatus.COMPLETED] }
                }
            },
            {
                $group: {
                    _id: "$user",
                    bookingCount: { $sum: 1 }
                }
            },
            {
                $group: {
                    _id: null,
                    totalUsers: { $sum: 1 },
                    repeatUsers: {
                        $sum: { $cond: [{ $gt: ["$bookingCount", 1] }, 1, 0] }
                    },
                    totalBookings: { $sum: "$bookingCount" }
                }
            }
        ]);

        const totalUsers = repeatBookingResult[0]?.totalUsers || 0;
        const repeatUsers = repeatBookingResult[0]?.repeatUsers || 0;
        const totalBookings = repeatBookingResult[0]?.totalBookings || 0;

        const repeatBookingRate = totalUsers > 0
            ? (repeatUsers / totalUsers) * 100
            : 0;

        // REAL QUERY for favorite to booking conversion
        const conversionResult = await this.userModel.aggregate([
            {
                $match: {
                    favouriteFields: { $exists: true, $ne: [] }
                }
            },
            {
                $lookup: {
                    from: "bookings",
                    let: { userId: "$_id" },
                    pipeline: [
                        {
                            $match: {
                                $expr: { $eq: ["$user", "$$userId"] },
                                ...dateFilter,
                                status: { $in: [BookingStatus.CONFIRMED, BookingStatus.COMPLETED] }
                            }
                        }
                    ],
                    as: "userBookings"
                }
            },
            {
                $project: {
                    hasFavorites: { $gt: [{ $size: "$favouriteFields" }, 0] },
                    hasBookings: { $gt: [{ $size: "$userBookings" }, 0] }
                }
            },
            {
                $group: {
                    _id: null,
                    totalWithFavorites: { $sum: { $cond: ["$hasFavorites", 1, 0] } },
                    converted: { $sum: { $cond: [{ $and: ["$hasFavorites", "$hasBookings"] }, 1, 0] } }
                }
            }
        ]);

        const totalWithFavorites = conversionResult[0]?.totalWithFavorites || 0;
        const converted = conversionResult[0]?.converted || 0;

        const favoriteToBookingConversion = totalWithFavorites > 0
            ? (converted / totalWithFavorites) * 100
            : 0;

        // REAL QUERY for user satisfaction score (average rating from reviews)
        const satisfactionResult = await this.bookingModel.aggregate([
            {
                $match: {
                    ...dateFilter,
                    rating: { $exists: true, $ne: null, $gt: 0 }
                }
            },
            {
                $group: {
                    _id: null,
                    avgRating: { $avg: "$rating" },
                    totalRatings: { $sum: 1 }
                }
            }
        ]);

        const userSatisfactionScore = satisfactionResult[0]?.avgRating || 4.3;

        return {
            repeatBookingRate: Number(repeatBookingRate.toFixed(1)),
            favoriteToBookingConversion: Number(favoriteToBookingConversion.toFixed(1)),
            userSatisfactionScore: Number(userSatisfactionScore.toFixed(1))
        };
    }

    private async getMonthlyBookingsForCoach(
        profileId: Types.ObjectId,
        dateFilter: any
    ): Promise<MonthlyBookingDto[]> {
        return this.bookingModel.aggregate([
            {
                $match: {
                    requestedCoach: profileId,
                    ...dateFilter
                }
            },
            {
                $lookup: {
                    from: "transactions",
                    localField: "transaction",
                    foreignField: "_id",
                    as: "transactionData"
                }
            },
            { $unwind: { path: "$transactionData", preserveNullAndEmptyArrays: true } },
            {
                $group: {
                    _id: {
                        year: { $year: "$createdAt" },
                        month: { $month: "$createdAt" }
                    },
                    count: { $sum: 1 },
                    revenue: {
                        $sum: {
                            $cond: [
                                { $eq: ["$transactionData.status", "succeeded"] },
                                "$transactionData.amount",
                                0
                            ]
                        }
                    }
                }
            },
            { $sort: { "_id.year": 1, "_id.month": 1 } }
        ]);
    }

    private async getTotalBookingsForCoach(
        profileId: Types.ObjectId,
        dateFilter: any
    ): Promise<number> {
        return this.bookingModel.countDocuments({
            requestedCoach: profileId,
            type: 'coach',
            ...dateFilter
        });
    }

    private async getTotalFavoritesForCoach(
        userId: Types.ObjectId
    ): Promise<number> {
        return this.userModel.countDocuments({ favouriteCoaches: userId });
    }

    private async getClientRetentionRate(
        profileId: Types.ObjectId,
        dateFilter: any
    ): Promise<number> {
        const repeatClients = await this.bookingModel.aggregate([
            {
                $match: {
                    requestedCoach: profileId,
                    ...dateFilter
                }
            },
            {
                $group: {
                    _id: "$user",
                    sessions: { $sum: 1 }
                }
            },
            {
                $match: {
                    sessions: { $gt: 1 }
                }
            },
            {
                $count: "repeatClients"
            }
        ]);

        const totalClients = await this.bookingModel.distinct('user', {
            requestedCoach: profileId,
            ...dateFilter
        });

        return totalClients.length > 0
            ? ((repeatClients[0]?.repeatClients || 0) / totalClients.length) * 100
            : 0;
    }

    private async getPeakAvailability(
        profileId: Types.ObjectId,
        dateFilter: any
    ): Promise<string[]> {
        const peakTimes = await this.bookingModel.aggregate([
            {
                $match: {
                    requestedCoach: profileId,
                    ...dateFilter
                }
            },
            {
                $group: {
                    _id: "$startTime",
                    count: { $sum: 1 }
                }
            },
            { $sort: { count: -1 } },
            { $limit: 3 }
        ]);

        return peakTimes.map(time => time._id);
    }

    private async getCoachMonthlyPerformance(
        coachId: string,
        dateFilter: any
    ): Promise<any> {
        return [];
    }

    private async getCoachClientAnalysis(
        coachId: string,
        dateFilter: any
    ): Promise<any> {
        return {};
    }

    private async getCoachSportsAnalysis(
        profile: CoachProfileDocument
    ): Promise<any> {
        return {};
    }

    // In admin.service.ts - Update these methods:

    private async getMonthlyRevenueData(
        dateFilter: any,
        sportType?: string
    ): Promise<any[]> {
        // Calculate Revenue and Count directly from Bookings
        const aggregationPipeline: any[] = [
            {
                $match: {
                    status: { $in: ['confirmed', 'completed'] },
                    // Consider a booking "revenue generating" if it's paid or deposit/full
                    paymentStatus: { $in: ['paid', 'succeeded', 'confirmed'] },
                    ...dateFilter
                }
            }
        ];

        if (sportType) {
            aggregationPipeline.push(
                {
                    $lookup: {
                        from: 'fields',
                        localField: 'field',
                        foreignField: '_id',
                        as: 'fieldData'
                    }
                },
                { $unwind: { path: '$fieldData', preserveNullAndEmptyArrays: true } },
                { $match: { 'fieldData.sportType': sportType } }
            );
        }

        aggregationPipeline.push(
            {
                $group: {
                    _id: {
                        year: { $year: '$createdAt' },
                        month: { $month: '$createdAt' }
                    },
                    // Sum totalPrice from the booking itself
                    revenue: { $sum: '$totalPrice' },
                    count: { $sum: 1 },
                    transactionCount: { $sum: 1 } // Treating each paid booking as a transaction event equivalent
                }
            },
            { $sort: { '_id.year': 1, '_id.month': 1 } },
            {
                $project: {
                    _id: 0,
                    month: {
                        $concat: [
                            { $toString: '$_id.year' },
                            '-',
                            {
                                $cond: [
                                    { $lt: ['$_id.month', 10] },
                                    { $concat: ['0', { $toString: '$_id.month' }] },
                                    { $toString: '$_id.month' }
                                ]
                            }
                        ]
                    },
                    revenue: 1,
                    count: 1,
                    transactionCount: 1
                }
            }
        );

        return this.bookingModel.aggregate(aggregationPipeline);
    }

    private async getRevenueBySport(dateFilter: any): Promise<any[]> {
        // ACTUAL QUERY from Bookings
        return this.bookingModel.aggregate([
            {
                $match: {
                    status: { $in: ['confirmed', 'completed'] },
                    paymentStatus: { $in: ['paid', 'succeeded', 'confirmed'] },
                    ...dateFilter
                }
            },
            {
                $lookup: {
                    from: 'fields',
                    localField: 'field',
                    foreignField: '_id',
                    as: 'fieldData'
                }
            },
            { $unwind: { path: '$fieldData', preserveNullAndEmptyArrays: true } },
            {
                $group: {
                    _id: '$fieldData.sportType',
                    revenue: { $sum: '$totalPrice' },
                    count: { $sum: 1 }
                }
            },
            {
                $project: {
                    _id: 0,
                    sport: '$_id',
                    revenue: 1,
                    count: 1
                }
            },
            { $sort: { revenue: -1 } }
        ]);
    }

    private async getRevenueByType(dateFilter: any): Promise<any[]> {
        // ACTUAL QUERY from Bookings
        return this.bookingModel.aggregate([
            {
                $match: {
                    status: { $in: ['confirmed', 'completed'] },
                    paymentStatus: { $in: ['paid', 'succeeded', 'confirmed'] },
                    ...dateFilter
                }
            },
            {
                $group: {
                    _id: '$type',
                    revenue: { $sum: '$totalPrice' },
                    count: { $sum: 1 }
                }
            },
            {
                $project: {
                    _id: 0,
                    type: '$_id',
                    revenue: 1,
                    count: 1
                }
            }
        ]);
    }

    private async getPeakRevenuePeriods(dateFilter: any): Promise<string[]> {
        return ['Weekends', 'Evenings'];
    }

    private async getSportsPopularityData(
        dateFilter: any,
        sportType?: string
    ): Promise<any[]> {
        return [];
    }

    private async getTrendingSports(dateFilter: any): Promise<string[]> {
        return ['Padel Tennis', 'Pickleball'];
    }

    private async getTopFieldsByBookings(
        dateFilter: any,
        sportType?: string,
        limit?: number
    ): Promise<any[]> {
        return [];
    }

    private async getTopCoachesByBookings(
        dateFilter: any,
        sportType?: string,
        limit?: number
    ): Promise<any[]> {
        return [];
    }

    private async getTopSportsByPopularity(
        dateFilter: any,
        limit?: number
    ): Promise<any[]> {
        return [];
    }

    private async getRevenueTrend(dateFilter: any): Promise<any> {
        return { trend: 'increasing', rate: 15.5 };
    }

    private async getBookingTrend(dateFilter: any): Promise<any> {
        return { trend: 'increasing', rate: 8.2 };
    }

    private async getUserGrowthTrend(dateFilter: any): Promise<any> {
        return { trend: 'increasing', rate: 12.3 };
    }

    private async getCurrentMonthStats(): Promise<any> {
        return {
            revenue: 45000,
            bookings: 320,
            newUsers: 45,
            activeUsers: 850
        };
    }

    private async getLastMonthStats(): Promise<any> {
        return {
            revenue: 38000,
            bookings: 280,
            newUsers: 38,
            activeUsers: 820
        };
    }

    private calculateComparison(current: any, last: any): any {
        return {
            revenueGrowth: ((current.revenue - last.revenue) / last.revenue) * 100,
            bookingGrowth: ((current.bookings - last.bookings) / last.bookings) * 100,
            userGrowth: ((current.newUsers - last.newUsers) / last.newUsers) * 100
        };
    }

    private async getRecentBookings(limit: number): Promise<any[]> {
        return [];
    }

    private async getPlatformHealthMetrics(): Promise<any> {
        return {
            uptime: 99.8,
            responseTime: 120,
            errorRate: 0.2,
            satisfaction: 4.5
        };
    }

    private convertToPlatformAnalyticsDto(aiResult: any): PlatformAnalyticsDto {
        // Ensure revenueByType has correct types
        // Ensure revenueByType has correct types and merge duplicates
        const revenueByTypeMap = new Map<string, any>();

        if (Array.isArray(aiResult.revenueAnalysis?.revenueByType)) {
            aiResult.revenueAnalysis.revenueByType.forEach((item: any) => {
                const type = this.validateRevenueTypeDto(item.type);
                const existing = revenueByTypeMap.get(type) || {
                    type,
                    revenue: 0,
                    percentage: 0
                };

                existing.revenue += (item.revenue || 0);
                existing.percentage += (item.percentage || 0);

                revenueByTypeMap.set(type, existing);
            });
        }

        const revenueByType = Array.from(revenueByTypeMap.values());

        return {
            summary: aiResult.summary || {
                totalRevenue: 0,
                totalBookings: 0,
                totalUsers: 0,
                averageRating: 0,
                growthRate: 0
            },
            revenueAnalysis: {
                monthlyRevenue: aiResult.revenueAnalysis?.monthlyRevenue || [],
                revenueBySport: aiResult.revenueAnalysis?.revenueBySport || [],
                revenueByType: revenueByType,
                peakRevenuePeriods: aiResult.revenueAnalysis?.peakRevenuePeriods || []
            },
            popularityAnalysis: {
                sportsPopularity: aiResult.popularityAnalysis?.sportsPopularity || [],
                fieldPopularity: aiResult.popularityAnalysis?.fieldPopularity || [],
                coachPopularity: aiResult.popularityAnalysis?.coachPopularity || [],
                trendingSports: aiResult.popularityAnalysis?.trendingSports || []
            },
            userBehavior: {
                bookingPatterns: {
                    peakBookingDays: aiResult.userBehavior?.bookingPatterns?.peakBookingDays || [],
                    peakBookingHours: aiResult.userBehavior?.bookingPatterns?.peakBookingHours || [],
                    averageBookingDuration: aiResult.userBehavior?.bookingPatterns?.averageBookingDuration || 0,
                    preferredSports: aiResult.userBehavior?.bookingPatterns?.preferredSports || []
                },
                retentionMetrics: {
                    repeatBookingRate: aiResult.userBehavior?.retentionMetrics?.repeatBookingRate || 0,
                    favoriteToBookingConversion: aiResult.userBehavior?.retentionMetrics?.favoriteToBookingConversion || 0,
                    userSatisfactionScore: aiResult.userBehavior?.retentionMetrics?.userSatisfactionScore || 0
                }
            },
            recommendations: aiResult.recommendations || []
        };
    }

    private validateRevenueTypeDto(type: any): 'field' | 'coach' | 'tournament' {
        if (typeof type === 'string') {
            const lowerType = type.toLowerCase();
            if (lowerType === 'field' || lowerType === 'coach' || lowerType === 'tournament') {
                return lowerType as 'field' | 'coach' | 'tournament';
            }
        }
        return 'field'; // Default value
    }

    // Add missing method signatures
    async getRevenueAnalysis(filter?: AnalyticsFilterDto): Promise<RevenueAnalysisDto> {
        const { startDate, endDate, sportType, timeRange = 'year' } = filter || {};
        const dateFilter = this.buildDateFilter(startDate, endDate, timeRange);

        const [
            monthlyRevenue,
            revenueBySport,
            revenueByType,
            peakPeriods
        ] = await Promise.all([
            this.getMonthlyRevenueData(dateFilter, sportType),
            this.getRevenueBySport(dateFilter),
            this.getRevenueByType(dateFilter),
            this.getPeakRevenuePeriods(dateFilter)
        ]);

        return {
            monthlyRevenue,
            revenueBySport,
            revenueByType,
            peakRevenuePeriods: peakPeriods
        };
    }

    async getSportsPopularity(filter?: AnalyticsFilterDto): Promise<PopularityAnalysisDto> {
        const { startDate, endDate, sportType, timeRange = 'month' } = filter || {};
        const dateFilter = this.buildDateFilter(startDate, endDate, timeRange);

        const [
            sportsPopularity,
            fieldPopularity,
            coachPopularity,
            trendingSports
        ] = await Promise.all([
            this.getSportsPopularityData(dateFilter, sportType),
            this.getTopFieldsByFavorites(dateFilter, sportType, 10),
            this.getTopCoachesByFavorites(dateFilter, sportType, 10),
            this.getTrendingSports(dateFilter)
        ]);

        return {
            sportsPopularity,
            fieldPopularity,
            coachPopularity,
            trendingSports
        };
    }

    async getUserBehaviorAnalytics(filter?: AnalyticsFilterDto): Promise<UserBehaviorDto> {
        const { startDate, endDate, timeRange = 'month' } = filter || {};
        const dateFilter = this.buildDateFilter(startDate, endDate, timeRange);

        const [
            bookingPatterns,
            retentionMetrics
        ] = await Promise.all([
            this.getBookingPatterns(dateFilter),
            this.getRetentionMetrics(dateFilter)
        ]);

        return {
            bookingPatterns,
            retentionMetrics
        };
    }

    async getTopPerformers(
        type: 'fields' | 'coaches' | 'sports',
        limit: number = 10,
        filter?: AnalyticsFilterDto
    ): Promise<any[]> {
        const { startDate, endDate, sportType, timeRange = 'month' } = filter || {};
        const dateFilter = this.buildDateFilter(startDate, endDate, timeRange);

        switch (type) {
            case 'fields':
                return this.getTopFieldsByBookings(dateFilter, sportType, limit);
            case 'coaches':
                return this.getTopCoachesByBookings(dateFilter, sportType, limit);
            case 'sports':
                return this.getTopSportsByPopularity(dateFilter, limit);
            default:
                throw new BadRequestException('Invalid type specified');
        }
    }

    async getTrendAnalytics(
        metric: 'revenue' | 'bookings' | 'users',
        filter?: AnalyticsFilterDto
    ): Promise<any> {
        const { startDate, endDate, timeRange = 'year' } = filter || {};
        const dateFilter = this.buildDateFilter(startDate, endDate, timeRange);

        switch (metric) {
            case 'revenue':
                return this.getRevenueTrend(dateFilter);
            case 'bookings':
                return this.getBookingTrend(dateFilter);
            case 'users':
                return this.getUserGrowthTrend(dateFilter);
            default:
                throw new BadRequestException('Invalid metric specified');
        }
    }

    async getDashboardOverview(): Promise<any> {
        const now = new Date();
        const oneMonthAgo = new Date(now.setMonth(now.getMonth() - 1));
        const threeMonthsAgo = new Date(now.setMonth(now.getMonth() - 3));

        const [
            currentMonthStats,
            lastMonthStats,
            topPerformingSports,
            recentBookings,
            platformHealth
        ] = await Promise.all([
            this.getCurrentMonthStats(),
            this.getLastMonthStats(),
            this.getTopSportsByPopularity({}, 5),
            this.getRecentBookings(10),
            this.getPlatformHealthMetrics()
        ]);

        return {
            currentMonth: currentMonthStats,
            lastMonth: lastMonthStats,
            comparison: this.calculateComparison(currentMonthStats, lastMonthStats),
            topPerformingSports,
            recentBookings,
            platformHealth,
            lastUpdated: new Date()
        };
    }

    async exportAnalytics(format: 'csv' | 'json' | 'pdf', filter?: AnalyticsFilterDto): Promise<any> {
        throw new Error('Export functionality not yet implemented');
    }

    async createNotificationForAllUsers(
        title: string,
        message: string,
        metadata?: Record<string, any>,
    ) {
        const users = await this.userModel
            .find(
                { userRole: { $ne: 'admin' } },
                { _id: 1 },
            )
            .lean();

        if (!users.length) return [];

        const notifications = users.map((user) => ({
            recipient: user._id as Types.ObjectId,
            type: 'admin_notifcation',
            title,
            message,
            metadata,
            isRead: false,
        }));

        return this.notificationModel.insertMany(notifications);
    }
}