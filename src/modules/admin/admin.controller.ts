import { Controller, Get, Param, Patch, Body, Query, UseGuards, Post, Request } from '@nestjs/common';
import { Types } from 'mongoose';
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
import { WalletService } from '../wallet/wallet.service';
import { WithdrawalRequestStatus, WithdrawalRequestDocument } from '../wallet/entities/withdrawal-request.entity';
import { ApproveWithdrawalRequestDto } from '../wallet/dto/approve-withdrawal-request.dto';
import { RejectWithdrawalRequestDto } from '../wallet/dto/reject-withdrawal-request.dto';
import { ApiOperation, ApiResponse, ApiQuery, ApiParam } from '@nestjs/swagger';

@Controller('admin')
@UseGuards(JwtAccessTokenGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminController {
    constructor(
        private readonly adminService: AdminService,
        private readonly walletService: WalletService,
    ) { }

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

    // ===================================================================
    // WITHDRAWAL REQUEST ENDPOINTS
    // ===================================================================

    /**
     * Get withdrawal requests list (admin only)
     * Returns paginated list sorted by createdAt DESC (newest first)
     */
    @Get('withdrawal-requests')
    @ApiOperation({ summary: 'Get withdrawal requests list (admin only)' })
    @ApiQuery({ name: 'status', required: false, enum: WithdrawalRequestStatus, description: 'Filter by status' })
    @ApiQuery({ name: 'userRole', required: false, enum: ['field_owner', 'coach'], description: 'Filter by user role' })
    @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number (default: 1)' })
    @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (default: 10)' })
    @ApiResponse({ status: 200, description: 'Paginated withdrawal requests list' })
    async getWithdrawalRequests(
        @Query('status') status?: WithdrawalRequestStatus,
        @Query('userRole') userRole?: 'field_owner' | 'coach',
        @Query('page') page?: string,
        @Query('limit') limit?: string,
    ) {
        const pageNum = page ? parseInt(page, 10) : 1;
        const limitNum = limit ? parseInt(limit, 10) : 10;

        return this.walletService.getWithdrawalRequests(
            { status, userRole },
            pageNum,
            limitNum,
        );
    }

    /**
     * Approve withdrawal request
     * Processes the withdrawal (trừ balance, tạo transaction, gọi PayOS)
     */
    @Post('withdrawal-requests/:id/approve')
    @ApiOperation({ summary: 'Approve withdrawal request (admin only)' })
    @ApiParam({ name: 'id', description: 'Withdrawal request ID' })
    @ApiResponse({ status: 200, description: 'Withdrawal request approved and processed' })
    async approveWithdrawalRequest(
        @Request() req: any,
        @Param('id') requestId: string,
        @Body() dto: ApproveWithdrawalRequestDto,
    ) {
        const adminId = req.user.userId;
        const request: WithdrawalRequestDocument = await this.walletService.approveWithdrawalRequest(
            requestId,
            adminId,
            dto.notes,
        );

        return {
            success: true,
            message: 'Yêu cầu rút tiền đã được duyệt và xử lý thành công',
            data: {
                requestId: (request._id as Types.ObjectId).toString(),
                status: request.status,
                amount: request.amount,
                approvedAt: request.approvedAt,
            },
        };
    }

    /**
     * Reject withdrawal request
     * Updates request status to rejected
     */
    @Post('withdrawal-requests/:id/reject')
    @ApiOperation({ summary: 'Reject withdrawal request (admin only)' })
    @ApiParam({ name: 'id', description: 'Withdrawal request ID' })
    @ApiResponse({ status: 200, description: 'Withdrawal request rejected' })
    async rejectWithdrawalRequest(
        @Request() req: any,
        @Param('id') requestId: string,
        @Body() dto: RejectWithdrawalRequestDto,
    ) {
        const adminId = req.user.userId;
        const request = await this.walletService.rejectWithdrawalRequest(
            requestId,
            adminId,
            dto.reason,
        ) as WithdrawalRequestDocument;

        return {
            success: true,
            message: 'Yêu cầu rút tiền đã bị từ chối',
            data: {
                requestId: (request._id as Types.ObjectId).toString(),
                status: request.status,
                rejectionReason: request.rejectionReason,
                rejectedAt: request.rejectedAt,
            },
        };
    }
}