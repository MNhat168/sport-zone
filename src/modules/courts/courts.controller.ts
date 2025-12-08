import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { CourtsService } from './courts.service';
import { CreateCourtDto } from './dto/create-court.dto';
import { UpdateCourtDto } from './dto/update-court.dto';
import { Roles } from 'src/decorators/roles.decorator';
import { UserRole } from '@common/enums/user.enum';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { Court } from './entities/court.entity';

@ApiTags('Courts')
@Controller()
export class CourtsController {
  constructor(private readonly courtsService: CourtsService) {}

  @Post('fields/:fieldId/courts')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @ApiBearerAuth()
  @Roles(UserRole.FIELD_OWNER, UserRole.ADMIN)
  @ApiOperation({ summary: 'Owner/Admin: tạo court mới cho field' })
  @ApiParam({ name: 'fieldId', description: 'Field ID' })
  @ApiResponse({ status: 201, type: Court })
  async createCourt(
    @Request() req: any,
    @Param('fieldId') fieldId: string,
    @Body() dto: CreateCourtDto,
  ): Promise<Court> {
    return this.courtsService.create(fieldId, dto, req.user);
  }

  @Get('fields/:fieldId/courts')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @ApiBearerAuth()
  @Roles(UserRole.FIELD_OWNER, UserRole.ADMIN)
  @ApiOperation({ summary: 'Owner/Admin: xem danh sách courts của field' })
  @ApiParam({ name: 'fieldId', description: 'Field ID' })
  @ApiQuery({ name: 'includeInactive', required: false, type: Boolean, description: 'Bao gồm court inactive' })
  async getCourts(
    @Request() req: any,
    @Param('fieldId') fieldId: string,
    @Query('includeInactive') includeInactive?: string,
  ): Promise<Court[]> {
    return this.courtsService.findByField(fieldId, includeInactive === 'true', req.user);
  }

  @Get('public/fields/:fieldId/courts')
  @ApiOperation({ summary: 'Public: danh sách courts đang active của field' })
  @ApiParam({ name: 'fieldId', description: 'Field ID' })
  async getActiveCourts(@Param('fieldId') fieldId: string): Promise<Court[]> {
    return this.courtsService.findActiveByFieldPublic(fieldId);
  }

  @Patch('fields/:fieldId/courts/:courtId')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @ApiBearerAuth()
  @Roles(UserRole.FIELD_OWNER, UserRole.ADMIN)
  @ApiOperation({ summary: 'Owner/Admin: cập nhật court' })
  @ApiParam({ name: 'fieldId', description: 'Field ID' })
  @ApiParam({ name: 'courtId', description: 'Court ID' })
  async updateCourt(
    @Request() req: any,
    @Param('fieldId') fieldId: string,
    @Param('courtId') courtId: string,
    @Body() dto: UpdateCourtDto,
  ): Promise<Court> {
    return this.courtsService.update(fieldId, courtId, dto, req.user);
  }
}

