import { Controller, Get, Param, Query, Post, Patch, BadRequestException, Put, Body, NotFoundException, Request, UseGuards, Logger, Delete, ForbiddenException, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { UpdateCoachDto } from './dtos/update-coach.dto';
import { ApiOperation, ApiResponse, ApiConsumes } from '@nestjs/swagger';
import {
  ApiTags,
  ApiBearerAuth,
  ApiQuery,
  ApiParam,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { FilesInterceptor } from '@nestjs/platform-express';
import { CoachesService } from './coaches.service';
import { CoachesDto } from './dtos/coaches.dto';
import {
  CreateCoachRegistrationDto,
  ApproveCoachRegistrationDto,
  CoachRegistrationResponseDto,
} from './dtos/coach-registration.dto';
import { JwtAccessTokenGuard } from '../auth/guards/jwt-access-token.guard';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { Roles } from 'src/decorators/roles.decorator';
import { UserRole } from '@common/enums/user.enum';
import { AwsS3Service } from '../../service/aws-s3.service';

@ApiTags('Coaches')
@Controller('coaches')
export class CoachesController {
  private readonly logger = new Logger(CoachesController.name);

  constructor(
    private readonly coachesService: CoachesService,
    private readonly awsS3Service: AwsS3Service,
  ) { }

  @Get('all')
  async getAllCoaches(): Promise<any[]> {
    return this.coachesService.getAllCoaches();
  }

  @Get()
  async findAll(
    @Query('name') name?: string,
    @Query('sportType') sportType?: string,
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
    const userId = req.user.userId;
    this.logger.log(`Creating coach registration request for user ${userId}`);
    try {
      return await this.coachesService.createRegistrationRequest(userId, dto);
    } catch (error: any) {
      this.logger.error('Failed to create coach registration request:', error?.message || error);
      throw error;
    }
  }

  @Post('confirm-policy')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Confirm coach has read platform policy' })
  async confirmPolicy(@Request() req: any): Promise<{ success: boolean }> {
    const userId = req.user.userId;
    await this.coachesService.confirmPolicy(userId);
    return { success: true };
  }

  @Get('registration/my-request')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user coach registration request status' })
  async getMyRegistrationRequest(@Request() req: any): Promise<CoachRegistrationResponseDto> {
    const userId = req.user.userId;
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
    const adminId = req.user.userId;
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
    const adminId = req.user.userId;
    return this.coachesService.rejectRegistrationRequest(requestId, adminId, dto.reason);
  }

  @UseGuards(JwtAccessTokenGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Get('admin/profiles')
  @ApiOperation({ summary: 'Admin: list all coach profiles' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getAllCoachProfiles(
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '10',
    @Query('search') search?: string,
    @Query('isVerified') isVerified?: string,
    @Query('sortBy') sortBy: string = 'createdAt',
    @Query('sortOrder') sortOrder: 'asc' | 'desc' = 'desc',
  ) {
    const parsedPage = Math.max(1, parseInt(page, 10) || 1);
    const parsedLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 10));
    const parsedIsVerified = isVerified === 'true' ? true : isVerified === 'false' ? false : undefined;
    return this.coachesService.getAllCoachProfiles(
      parsedPage,
      parsedLimit,
      search,
      parsedIsVerified,
      sortBy,
      sortOrder,
    );
  }


  /**
   * Public endpoint: GET /coaches/public?sports=football
   * Accepts a single sport value and returns matching coaches.
   */
  @Get('public')
  async getAllCoachesPublic(@Query('sports') sports?: string): Promise<any[]> {
    return this.coachesService.getAllCoachesPublic(sports);
  }

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

  // POST /coaches/:id/upload-gallery
  @Post(':id/upload-gallery')
  @UseGuards(AuthGuard('jwt'))
  @UseInterceptors(FilesInterceptor('images', 10))
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload gallery images for coach profile' })
  async uploadGalleryImages(
    @Param('id') id: string,
    @Request() req: any,
    @UploadedFiles() files: Express.Multer.File[],
  ): Promise<{ success: boolean; urls: string[] }> {
    if (!files || files.length === 0) {
      throw new BadRequestException('No files provided');
    }

    // Verify current user owns this coach profile
    const userId = req.user.userId;
    const coach = await this.coachesService.getCoachById(id);
    if (!coach) {
      throw new NotFoundException('Coach profile not found');
    }
    if (coach.id !== userId.toString()) {
      throw new ForbiddenException('Not authorized to upload images for this coach profile');
    }

    // Upload files to S3
    const urls = await Promise.all(
      files.map(file =>
        this.awsS3Service.uploadRegistrationDocumentFromBuffer(
          file.buffer,
          file.mimetype
        )
      )
    );

    // Return URLs only (Frontend will handle saving to profile)
    return { success: true, urls };
  }

  // DELETE /coaches/:id/gallery/:index
  @Delete(':id/gallery/:index')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete gallery image by index' })
  async deleteGalleryImage(
    @Param('id') id: string,
    @Param('index') index: string,
    @Request() req: any,
  ): Promise<{ success: boolean }> {
    const userId = req.user.userId;
    const coach = await this.coachesService.getCoachById(id);

    if (!coach) {
      throw new NotFoundException('Coach profile not found');
    }
    if (coach.id !== userId.toString()) {
      throw new ForbiddenException('Not authorized to modify images for this coach profile');
    }

    const imageIndex = parseInt(index, 10);
    if (isNaN(imageIndex) || !coach.galleryImages || imageIndex >= coach.galleryImages.length || imageIndex < 0) {
      throw new BadRequestException('Invalid index');
    }

    const newGallery = [...coach.galleryImages];
    newGallery.splice(imageIndex, 1);

    await this.coachesService.updateCoach(id, {
      galleryImages: newGallery
    });

    return { success: true };
  }
}
