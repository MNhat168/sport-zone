import { Controller, Get, Param, Patch, Body, Query, UseGuards, Post } from '@nestjs/common';
import { User } from 'src/modules/users/entities/user.entity';
import { AdminService } from './admin.service';
import { UserRoleStatDto, UserMonthlyStatsDto } from './dto/user.dto';
import { BookingMonthlyStatsDto } from './dto/booking.dto';
import { ListTransactionsDto } from './dto/list-transactions.dto';
import { ListBookingsDto } from './dto/list-bookings.dto';
import {
    JwtAccessTokenGuard
} from '../auth/guards/jwt-access-token.guard';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { Roles } from 'src/decorators/roles.decorator';
import { UserRole } from 'src/common/enums/user-role.enum';
import {
    PlatformAnalyticsDto,
    AnalyticsFilterDto,
    DetailedFieldOwnerStatsDto,
    FieldOwnerStatsDto,
    CoachStatsDto
} from './dto/admin-stats.dto';

@Controller('admin')
@UseGuards(JwtAccessTokenGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminController {
    constructor(private readonly adminService: AdminService) { }

    @Get('manage/users')
    async getAllUsers(): Promise<User[]> {
        return this.adminService.findAll();
    }

    @Patch('manage/user/:id/is-active')
    async updateIsActive(
        @Param('id') id: string,
        @Body('isActive') isActive: boolean,
    ): Promise<User> {
        return this.adminService.setIsActive(id, isActive);
    }

    @Get('statistic/user-role-stats')
    async getRoleStats(): Promise<UserRoleStatDto[]> {
        return this.adminService.getRoleDistribution();
    }

    @Get('statistic/user-monthly-stats')
    async getMonthlyStats(
        @Query('year') year?: string
    ): Promise<UserMonthlyStatsDto[]> {

        const parsedYear = year ? parseInt(year, 10) : new Date().getFullYear();

        return this.adminService.getMonthlyNewUsersByYear(parsedYear);
    }

    @Get('booking-monthly-stats')
    async getBookingMonthlyStats(
        @Query('year') year?: string
    ): Promise<BookingMonthlyStatsDto[]> {
        const parsedYear = year ? parseInt(year, 10) : new Date().getFullYear();
        return this.adminService.getMonthlyBookingsByYear(parsedYear);
    }

    @Get('booking-monthly-stats/field')
    async getFieldBookingMonthlyStats(
        @Query('year') year?: string
    ): Promise<BookingMonthlyStatsDto[]> {
        const parsedYear = year ? parseInt(year, 10) : new Date().getFullYear();
        return this.adminService.getMonthlyFieldBookingsByYear(parsedYear);
    }

    @Get('booking-monthly-stats/coach')
    async getCoachBookingMonthlyStats(
        @Query('year') year?: string
    ): Promise<BookingMonthlyStatsDto[]> {
        const parsedYear = year ? parseInt(year, 10) : new Date().getFullYear();
        return this.adminService.getMonthlyCoachBookingsByYear(parsedYear);
    }

    @Get('monthly-revenue')
    getMonthlyRevenue() {
        return this.adminService.getMonthlyRevenue();
    }

    @Get('monthly-requests-count')
    getMonthlySales() {
        return this.adminService.getMonthlySales();
    }

    @Get("revenue-graph")
    getRevenueByMonth(
        @Query("year") year?: number
    ) {
        return this.adminService.getRevenueGraph(year ? Number(year) : undefined);
    }

    @Get("transactions/most-recent")
    getRecentTransactions() {
        return this.adminService.getRecentTransactions();
    }

    @Get('transactions')
    listTransactions(@Query() query: ListTransactionsDto) {
        return this.adminService.listTransactions(query);
    }

    @Get('bookings')
    listBookings(@Query() query: ListBookingsDto) {
        return this.adminService.listBookings(query);
    }

    @Get('statistics/field-owners')
    async getFieldOwnerStats(
        @Query() filter?: AnalyticsFilterDto,
        @Query('ai') ai?: string
    ): Promise<FieldOwnerStatsDto[]> {
        return this.adminService.getFieldOwnerStats(filter, ai === 'true');
    }

    @Get('statistics/field-owners/:id/detailed')
    async getDetailedFieldOwnerStats(
        @Param('id') id: string,
        @Query() filter?: AnalyticsFilterDto,
        @Query('ai') ai?: string
    ): Promise<DetailedFieldOwnerStatsDto> {
        return this.adminService.getDetailedFieldOwnerStats(id, filter, ai === 'true');
    }

    @Get('statistics/coaches')
    async getCoachStats(
        @Query() filter?: AnalyticsFilterDto,
        @Query('ai') ai?: string
    ): Promise<CoachStatsDto[]> {
        return this.adminService.getCoachStats(filter, ai === 'true');
    }

    @Get('statistics/coaches/:id/detailed')
    async getDetailedCoachStats(
        @Param('id') id: string,
        @Query() filter?: AnalyticsFilterDto,
        @Query('ai') ai?: string
    ) {
        return this.adminService.getDetailedCoachStats(id, filter, ai === 'true');
    }

    @Get('statistics/platform-analytics')
    async getPlatformAnalytics(
        @Query() filter?: AnalyticsFilterDto,
        @Query('ai') ai?: string
    ): Promise<PlatformAnalyticsDto> {
        return this.adminService.getPlatformAnalytics(filter, ai === 'true');
    }

    @Get('statistics/revenue-analysis')
    async getRevenueAnalysis(
        @Query() filter?: AnalyticsFilterDto
    ) {
        return this.adminService.getRevenueAnalysis(filter);
    }

    @Get('statistics/sports-popularity')
    async getSportsPopularity(
        @Query() filter?: AnalyticsFilterDto
    ) {
        return this.adminService.getSportsPopularity(filter);
    }

    @Get('statistics/user-behavior')
    async getUserBehaviorAnalytics(
        @Query() filter?: AnalyticsFilterDto
    ) {
        return this.adminService.getUserBehaviorAnalytics(filter);
    }

    @Get('statistics/top-performers')
    async getTopPerformers(
        @Query('type') type: 'fields' | 'coaches' | 'sports' = 'fields',
        @Query('limit') limit: number = 10,
        @Query() filter?: AnalyticsFilterDto
    ) {
        return this.adminService.getTopPerformers(type, limit, filter);
    }

    @Get('statistics/trends')
    async getTrendAnalytics(
        @Query('metric') metric: 'revenue' | 'bookings' | 'users',
        @Query() filter?: AnalyticsFilterDto
    ) {
        return this.adminService.getTrendAnalytics(metric, filter);
    }

    @Get('statistics/dashboard-overview')
    async getDashboardOverview() {
        return this.adminService.getDashboardOverview();
    }

    @Get('statistics/export/:format')
    async exportAnalytics(
        @Param('format') format: 'csv' | 'json' | 'pdf',
        @Query() filter?: AnalyticsFilterDto
    ) {
        return this.adminService.exportAnalytics(format, filter);
    }

    @Post('notification')
    async adminNotification(
        @Body()
        body: {
            title: string;
            message: string;
            metadata?: Record<string, any>;
        },
    ) {
        return this.adminService.createNotificationForAllUsers(
            body.title,
            body.message,
            body.metadata,
        );
    }
}