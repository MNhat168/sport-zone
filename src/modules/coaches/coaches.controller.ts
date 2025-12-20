import { Controller, Get, Param, Query,Post,Patch, BadRequestException, Put, Body, NotFoundException, Request, UseGuards, Logger} from '@nestjs/common';
import { UpdateCoachDto } from './dtos/update-coach.dto';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import {
  ApiTags,
  ApiBearerAuth,
  ApiQuery,
  ApiParam,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { CoachesService } from './coaches.service';
import { CoachesDto } from './dtos/coaches.dto';
import { SportType } from 'src/common/enums/sport-type.enum';
import {
  CreateCoachRegistrationDto,
  ApproveCoachRegistrationDto,
  CoachRegistrationResponseDto,
} from './dtos/coach-registration.dto';
import { JwtAccessTokenGuard } from '../auth/guards/jwt-access-token.guard';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { Roles } from 'src/decorators/roles.decorator';
import { UserRole } from '@common/enums/user.enum';

@ApiTags('Coaches')
@Controller('coaches')
export class CoachesController {
  private readonly logger = new Logger(CoachesController.name);

  constructor(private readonly coachesService: CoachesService) { }

  @Get('all')
  async getAllCoaches(): Promise<any[]> {
    return this.coachesService.getAllCoaches();
  }

  @Get()
  async findAll(
    @Query('name') name?: string,
    @Query('sportType') sportType?: SportType,
    @Query('minRate') minRate?: number,
    @Query('maxRate') maxRate?: number,
    @Query('district') district?: string,
  ): Promise<CoachesDto[]> {
    return this.coachesService.findAll({
      name,
      sportType,
      minRate: minRate ? Number(minRate) : undefined,
      maxRate: maxRate ? Number(maxRate) : undefined,
      district,
    });
  }

  // ==================== Coach Registration Endpoints ====================

  @Post('registration')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Submit coach registration request' })
  async createRegistrationRequest(
    @Request() req: any,
    @Body() dto: CreateCoachRegistrationDto,
  ): Promise<CoachRegistrationResponseDto> {
    const userId = req.user._id || req.user.id;
    this.logger.log(`Creating coach registration request for user ${userId}`);
    try {
      return await this.coachesService.createRegistrationRequest(userId, dto);
    } catch (error: any) {
      this.logger.error('Failed to create coach registration request:', error?.message || error);
      throw error;
    }
  }

  @Get('registration/my-request')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user coach registration request status' })
  async getMyRegistrationRequest(@Request() req: any): Promise<CoachRegistrationResponseDto> {
    const userId = req.user._id || req.user.id;
    return this.coachesService.getMyRegistrationRequest(userId);
  }

  @UseGuards(JwtAccessTokenGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Get('registration')
  @ApiOperation({ summary: 'Admin: list coach registration requests' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getRegistrationRequests(
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '10',
  ) {
    const parsedPage = Math.max(1, parseInt(page, 10) || 1);
    const parsedLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 10));
    return this.coachesService.getPendingRegistrationRequests(parsedPage, parsedLimit);
  }

  @UseGuards(JwtAccessTokenGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Get('registration/:id')
  @ApiOperation({ summary: 'Admin: get coach registration request by ID' })
  @ApiParam({ name: 'id', description: 'Registration request ID' })
  async getRegistrationRequest(
    @Param('id') requestId: string,
  ): Promise<CoachRegistrationResponseDto> {
    return this.coachesService.getRegistrationRequest(requestId);
  }

  @UseGuards(JwtAccessTokenGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Patch('registration/:id/approve')
  @ApiOperation({ summary: 'Admin: approve coach registration request' })
  @ApiParam({ name: 'id', description: 'Registration request ID' })
  async approveRegistrationRequest(
    @Request() req: any,
    @Param('id') requestId: string,
    @Body() dto: ApproveCoachRegistrationDto,
  ): Promise<any> {
    const adminId = req.user._id || req.user.id;
    return this.coachesService.approveRegistrationRequest(requestId, adminId, dto);
  }

  @UseGuards(JwtAccessTokenGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Patch('registration/:id/reject')
  @ApiOperation({ summary: 'Admin: reject coach registration request' })
  @ApiParam({ name: 'id', description: 'Registration request ID' })
  async rejectRegistrationRequest(
    @Request() req: any,
    @Param('id') requestId: string,
    @Body() dto: { reason: string },
  ): Promise<CoachRegistrationResponseDto> {
    const adminId = req.user._id || req.user.id;
    return this.coachesService.rejectRegistrationRequest(requestId, adminId, dto.reason);
  }

  // ==================== End Coach Registration Endpoints ====================

  // GET /coaches/:id
  @Get(':id')
  async getCoachById(@Param('id') coachId: string): Promise<CoachesDto> {
    return this.coachesService.getCoachById(coachId);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update coach information' })
  @ApiResponse({ status: 200, description: 'Coach updated successfully' })
  async updateCoach(@Param('id') coachId: string, @Body() body: UpdateCoachDto): Promise<any> {
    // Delegates to service
    const updated = await this.coachesService.updateCoach(coachId, body);
    if (!updated) throw new NotFoundException('Coach not found');
    return updated;
  }

  // GET /coaches/:id/bank-account
  @Get(':id/bank-account')
  async getCoachBankAccount(@Param('id') coachId: string): Promise<any> {
    return this.coachesService.getCoachBankAccount(coachId);
  }

  // GET /coaches/:id/slots
  @Get(':id/slots')
  async getCoachAvailableSlots(
    @Param('id') coachId: string,
    @Query('date') date: string,
  ): Promise<any> {
    if (!date) {
      throw new BadRequestException('Date parameter is required');
    }
    return this.coachesService.getCoachAvailableSlots(coachId, date);
  }
}
