import { Controller, Get, Param, Patch, Body, Query } from '@nestjs/common';
import { User } from 'src/modules/users/entities/user.entity';
import { AdminService } from './admin.service';
import { UserRoleStatDto } from './dto/user-role-stats.dto';

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

    @Get('role-stats')
    async getRoleStats(): Promise<UserRoleStatDto[]> {
        return this.adminService.getRoleDistribution();
    }

    @Get('statistic/payments')
    getPayments(
        @Query('year') year?: string,
        @Query('range') range: '1y' | '6m' | '3m' | '1m' = '1m',
    ) {
        const selectedYear = year ? parseInt(year, 10) : new Date().getFullYear();
        return this.adminService.getSuccessfulPayments(range, selectedYear);
    }
}
