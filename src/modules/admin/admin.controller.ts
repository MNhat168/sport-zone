import { Controller, Get, Param, Patch, Body, Query } from '@nestjs/common';
import { User } from 'src/modules/users/entities/user.entity';
import { AdminService } from './admin.service';
import { UserRoleStatDto, UserMonthlyStatsDto } from './dto/user.dto';
import { BookingMonthlyStatsDto } from './dto/booking.dto';
@Controller('admin')
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

    //monthly sales
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
}
