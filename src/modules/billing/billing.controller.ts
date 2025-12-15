import { Controller, Get, Post, Body, Param, Req, Query, UseGuards, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { BillingService } from './billing.service';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../decorators/roles.decorator';
import { UserRole } from '../../common/enums/user.enum';

@ApiTags('Billing')
@Controller('billing')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class BillingController {
    constructor(private readonly billingService: BillingService) { }

    @Get('current')
    @ApiOperation({ summary: 'Get current billing status' })
    async getCurrentStatus(@Req() req: any) {
        const userId = req.user.userId || req.user._id;
        return this.billingService.getCurrentStatus(userId);
    }

    @Get('history')
    @ApiOperation({ summary: 'Get invoice history' })
    async getHistory(@Req() req: any) {
        const userId = req.user.userId || req.user._id;
        return this.billingService.getHistory(userId);
    }

    @Post('pay/:invoiceId')
    @ApiOperation({ summary: 'Create payment link for invoice' })
    async payInvoice(@Req() req: any, @Param('invoiceId') invoiceId: string) {
        const userId = req.user.userId || req.user._id;
        return this.billingService.createPaymentLink(userId, invoiceId);
    }

    // Admin endpoints
    @Get('admin/overdue')
    @UseGuards(RolesGuard)
    @Roles(UserRole.ADMIN)
    @ApiOperation({ summary: 'Get overdue accounts (Admin only)' })
    @ApiResponse({ status: 200, description: 'Overdue accounts retrieved successfully' })
    async getOverdueAccounts(
        @Query('page') page?: string,
        @Query('limit') limit?: string
    ) {
        const pageNum = page ? parseInt(page, 10) : 1;
        const limitNum = limit ? parseInt(limit, 10) : 10;
        return this.billingService.getOverdueAccounts(pageNum, limitNum);
    }

    @Post('admin/suspend/:userId')
    @UseGuards(RolesGuard)
    @Roles(UserRole.ADMIN)
    @ApiOperation({ summary: 'Manually suspend a user (Admin only)' })
    @ApiResponse({ status: 200, description: 'User suspended successfully' })
    async suspendUser(
        @Param('userId') userId: string,
        @Body('reason') reason?: string
    ) {
        return this.billingService.suspendUser(userId, reason);
    }

    @Post('admin/unsuspend/:userId')
    @UseGuards(RolesGuard)
    @Roles(UserRole.ADMIN)
    @ApiOperation({ summary: 'Manually unsuspend a user (Admin only)' })
    @ApiResponse({ status: 200, description: 'User unsuspended successfully' })
    async unsuspendUser(@Param('userId') userId: string) {
        return this.billingService.unsuspendUser(userId);
    }
}
