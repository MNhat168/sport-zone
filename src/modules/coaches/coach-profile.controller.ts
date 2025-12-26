import {
    BadRequestException,
    Body,
    Controller,
    Delete,
    ForbiddenException,
    Get,
    Logger,
    NotFoundException,
    Param,
    Patch,
    Post,
    Request,
    UseGuards,
} from '@nestjs/common';
import {
    ApiBearerAuth,
    ApiOperation,
    ApiParam,
    ApiResponse,
    ApiTags,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { CoachesService } from './coaches.service';
import {
    BankAccountResponseDto,
    CreateBankAccountDto,
    UpdateBankAccountDto,
} from '../field-owner/dtos/bank-account.dto';

@ApiTags('Coach Profile')
@Controller('coach')
export class CoachProfileController {
    private readonly logger = new Logger(CoachProfileController.name);

    constructor(private readonly coachesService: CoachesService) { }

    // ==================== Bank Account Endpoints ====================

    @Post('profile/bank-account')
    @UseGuards(AuthGuard('jwt'))
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Add bank account for coach' })
    @ApiResponse({ status: 201, description: 'Bank account added successfully', type: BankAccountResponseDto })
    async addBankAccount(
        @Request() req: any,
        @Body() dto: CreateBankAccountDto,
    ): Promise<BankAccountResponseDto> {
        const userRole = (req.user?.role || '').toLowerCase();
        if (userRole !== 'coach') {
            throw new ForbiddenException('Access denied. Coach only.');
        }
        const userId = req.user._id || req.user.id;
        return this.coachesService.addBankAccountForCoach(userId, dto);
    }

    @Get('profile/bank-accounts')
    @UseGuards(AuthGuard('jwt'))
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Get bank accounts for coach' })
    @ApiResponse({ status: 200, description: 'List of bank accounts', type: [BankAccountResponseDto] })
    async getMyBankAccounts(@Request() req: any): Promise<BankAccountResponseDto[]> {
        const userRole = (req.user?.role || '').toLowerCase();
        if (userRole !== 'coach') {
            throw new ForbiddenException('Access denied. Coach only.');
        }
        const userId = req.user._id || req.user.id;
        return this.coachesService.getBankAccountsForCoach(userId);
    }

    @Patch('profile/bank-account/:id')
    @UseGuards(AuthGuard('jwt'))
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Update bank account for coach' })
    @ApiParam({ name: 'id', description: 'Bank account ID' })
    @ApiResponse({ status: 200, description: 'Bank account updated successfully', type: BankAccountResponseDto })
    async updateBankAccount(
        @Request() req: any,
        @Param('id') accountId: string,
        @Body() dto: UpdateBankAccountDto,
    ): Promise<BankAccountResponseDto> {
        const userRole = (req.user?.role || '').toLowerCase();
        if (userRole !== 'coach') {
            throw new ForbiddenException('Access denied. Coach only.');
        }
        const userId = req.user._id || req.user.id;
        return this.coachesService.updateBankAccountForCoach(userId, accountId, dto);
    }

    @Get('profile/bank-account/:id/verification-status')
    @UseGuards(AuthGuard('jwt'))
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Get bank account verification status' })
    @ApiParam({ name: 'id', description: 'Bank account ID' })
    async getBankAccountVerificationStatus(
        @Request() req: any,
        @Param('id') accountId: string,
    ) {
        const userRole = (req.user?.role || '').toLowerCase();
        if (userRole !== 'coach') {
            throw new ForbiddenException('Access denied. Coach only.');
        }
        const userId = req.user._id || req.user.id;
        return this.coachesService.getVerificationStatusForCoach(userId, accountId);
    }

    @Delete('profile/bank-account/:id')
    @UseGuards(AuthGuard('jwt'))
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Delete bank account for coach' })
    @ApiParam({ name: 'id', description: 'Bank account ID' })
    @ApiResponse({ status: 200, description: 'Bank account deleted successfully' })
    async deleteBankAccount(
        @Request() req: any,
        @Param('id') accountId: string,
    ): Promise<{ success: boolean; message: string }> {
        const userRole = (req.user?.role || '').toLowerCase();
        if (userRole !== 'coach') {
            throw new ForbiddenException('Access denied. Coach only.');
        }
        const userId = req.user._id || req.user.id;
        return this.coachesService.deleteBankAccountForCoach(userId, accountId);
    }

    @Patch('profile/bank-account/:id/set-default')
    @UseGuards(AuthGuard('jwt'))
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Set bank account as default for coach' })
    @ApiParam({ name: 'id', description: 'Bank account ID' })
    @ApiResponse({ status: 200, description: 'Bank account set as default', type: BankAccountResponseDto })
    async setDefaultBankAccount(
        @Request() req: any,
        @Param('id') accountId: string,
    ): Promise<BankAccountResponseDto> {
        const userRole = (req.user?.role || '').toLowerCase();
        if (userRole !== 'coach') {
            throw new ForbiddenException('Access denied. Coach only.');
        }
        const userId = req.user._id || req.user.id;
        return this.coachesService.setDefaultBankAccountForCoach(userId, accountId);
    }
}
