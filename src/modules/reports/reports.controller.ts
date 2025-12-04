import { Body, Controller, Get, Param, Patch, Post, Query, Request, UseGuards, UseInterceptors, UploadedFiles } from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAccessTokenGuard } from '../auth/guards/jwt-access-token.guard';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { Roles } from 'src/decorators/roles.decorator';
import { UserRole } from 'src/common/enums/user-role.enum';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ReportsService } from './reports.service';
import { CreateReportDto } from './dtos/create-report.dto';
import { CreateReportMessageDto } from './dtos/create-report-message.dto';
import { GetReportsQueryDto } from './dtos/get-reports.dto';

@ApiTags('Reports')
@ApiBearerAuth()
@Controller()
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @UseGuards(JwtAccessTokenGuard)
  @Get('reports')
  @ApiOperation({ summary: 'List my reports (reporter only)' })
  async listMyReports(@Request() req, @Query() query: GetReportsQueryDto) {
    return this.reports.userList(req.user.userId, {
      status: query.status,
      category: query.category as any,
      search: query.search,
      page: query.page ? Number(query.page) : 1,
      limit: query.limit ? Number(query.limit) : 20,
      fieldId: query.fieldId,
    })
  }

  @UseGuards(JwtAccessTokenGuard)
  @Post('reports')
  @ApiOperation({ summary: 'Create a new report' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FilesInterceptor('files', 3))
  async createReport(
    @Request() req,
    @Body() body: CreateReportDto,
    @UploadedFiles() files?: Express.Multer.File[],
  ) {
    return this.reports.createReport(req.user.userId, body, files);
  }

  @UseGuards(JwtAccessTokenGuard)
  @Get('reports/:id')
  @ApiOperation({ summary: 'Get report details (reporter or admin)' })
  async getReport(@Request() req, @Param('id') id: string) {
    const role = (req.user.role === UserRole.ADMIN ? 'admin' : 'user') as 'user'|'admin';
    return this.reports.getReport(req.user.userId, role, id);
  }

  @UseGuards(JwtAccessTokenGuard)
  @Get('reports/:id/messages')
  @ApiOperation({ summary: 'Get report messages (reporter or admin)' })
  async getMessages(
    @Request() req,
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const role = (req.user.role === UserRole.ADMIN ? 'admin' : 'user') as 'user'|'admin';
    return this.reports.getMessages(req.user.userId, role, id, Number(page) || 1, Number(limit) || 20);
  }

  @UseGuards(JwtAccessTokenGuard)
  @Post('reports/:id/messages')
  @ApiOperation({ summary: 'Add message to report (reporter only)' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FilesInterceptor('files', 3))
  async addMessage(
    @Request() req,
    @Param('id') id: string,
    @Body() body: CreateReportMessageDto,
    @UploadedFiles() files?: Express.Multer.File[],
  ) {
    const role = (req.user.role === UserRole.ADMIN ? 'admin' : 'user') as 'user'|'admin';
    // reporter is allowed; admin reply should use admin endpoint below
    return this.reports.addMessage(req.user.userId, role, id, body, files);
  }

  // Admin endpoints
  @UseGuards(JwtAccessTokenGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Get('admin/reports')
  @ApiOperation({ summary: 'Admin list reports (newest first)' })
  @ApiQuery({ name: 'status', required: false, isArray: true })
  @ApiQuery({ name: 'category', required: false, isArray: true })
  async adminList(@Query() query: GetReportsQueryDto) {
    return this.reports.adminList({
      status: query.status,
      category: query.category,
      search: query.search,
      page: query.page ? Number(query.page) : 1,
      limit: query.limit ? Number(query.limit) : 20,
    });
  }

  @UseGuards(JwtAccessTokenGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Post('admin/reports/:id/messages')
  @ApiOperation({ summary: 'Admin reply to a report' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FilesInterceptor('files', 3))
  async adminReply(
    @Request() req,
    @Param('id') id: string,
    @Body() body: CreateReportMessageDto,
    @UploadedFiles() files?: Express.Multer.File[],
  ) {
    return this.reports.addMessage(req.user.userId, 'admin', id, body, files);
  }

  @UseGuards(JwtAccessTokenGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Patch('admin/reports/:id/status')
  @ApiOperation({ summary: 'Admin update report status' })
  async updateStatus(@Param('id') id: string, @Body() body: { status: 'open'|'in_review'|'resolved'|'closed' }) {
    return this.reports.updateStatus(id, body.status);
  }
}