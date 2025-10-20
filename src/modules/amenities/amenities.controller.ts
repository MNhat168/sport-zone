import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseInterceptors,
  UploadedFile,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiResponse, ApiConsumes, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { AmenitiesService } from './amenities.service';
import { CreateAmenityDto } from './dto/create-amenity.dto';
import { UpdateAmenityDto } from './dto/update-amenity.dto';
import { QueryAmenityDto } from './dto/query-amenity.dto';
import { Amenity } from './entities/amenities.entity';
import { JwtAccessTokenGuard } from '../auth/guards/jwt-access-token.guard';

@ApiTags('Amenities')
@Controller('amenities')
@ApiBearerAuth('token')
export class AmenitiesController {
  constructor(private readonly amenitiesService: AmenitiesService) {}

  @Post()
  @UseGuards(JwtAccessTokenGuard)
  @UseInterceptors(FileInterceptor('image'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ 
    summary: 'Tạo tiện ích mới',
    description: 'Tạo một tiện ích mới với thông tin chi tiết và hình ảnh (tùy chọn)'
  })
  @ApiResponse({ 
    status: 201, 
    description: 'Tạo tiện ích thành công',
    type: Amenity
  })
  @ApiResponse({ status: 400, description: 'Dữ liệu đầu vào không hợp lệ' })
  @ApiResponse({ status: 401, description: 'Không có quyền truy cập' })
  async create(
    @Body() createAmenityDto: CreateAmenityDto,
    @UploadedFile() imageFile?: Express.Multer.File,
  ): Promise<Amenity> {
    return this.amenitiesService.create(createAmenityDto, imageFile);
  }

  @Get()
  @ApiOperation({ 
    summary: 'Lấy danh sách tiện ích',
    description: 'Lấy danh sách tiện ích với khả năng lọc và phân trang'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Lấy danh sách tiện ích thành công',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          items: { $ref: '#/components/schemas/Amenity' }
        },
        total: { type: 'number', description: 'Tổng số tiện ích' },
        page: { type: 'number', description: 'Trang hiện tại' },
        limit: { type: 'number', description: 'Số lượng mỗi trang' }
      }
    }
  })
  async findAll(@Query() queryDto: QueryAmenityDto) {
    return this.amenitiesService.findAll(queryDto);
  }

  @Get('sport-type/:sportType')
  @ApiOperation({ 
    summary: 'Lấy tiện ích theo loại thể thao',
    description: 'Lấy danh sách tiện ích theo loại thể thao cụ thể'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Lấy danh sách tiện ích theo loại thể thao thành công',
    type: [Amenity]
  })
  @ApiResponse({ status: 404, description: 'Không tìm thấy tiện ích' })
  async findBySportType(@Param('sportType') sportType: string): Promise<Amenity[]> {
    return this.amenitiesService.findBySportType(sportType);
  }

  @Get('type/:type')
  @ApiOperation({ 
    summary: 'Lấy tiện ích theo loại tiện ích',
    description: 'Lấy danh sách tiện ích theo loại tiện ích cụ thể (coach, drink, facility, other)'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Lấy danh sách tiện ích theo loại thành công',
    type: [Amenity]
  })
  @ApiResponse({ status: 404, description: 'Không tìm thấy tiện ích' })
  async findByType(@Param('type') type: string): Promise<Amenity[]> {
    return this.amenitiesService.findByType(type);
  }

  @Get(':id')
  @ApiOperation({ 
    summary: 'Lấy thông tin tiện ích theo ID',
    description: 'Lấy thông tin chi tiết của một tiện ích theo ID'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Lấy thông tin tiện ích thành công',
    type: Amenity
  })
  @ApiResponse({ status: 404, description: 'Không tìm thấy tiện ích' })
  async findOne(@Param('id') id: string): Promise<Amenity> {
    return this.amenitiesService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(JwtAccessTokenGuard)
  @UseInterceptors(FileInterceptor('image'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ 
    summary: 'Cập nhật tiện ích',
    description: 'Cập nhật thông tin tiện ích và hình ảnh (tùy chọn)'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Cập nhật tiện ích thành công',
    type: Amenity
  })
  @ApiResponse({ status: 400, description: 'Dữ liệu đầu vào không hợp lệ' })
  @ApiResponse({ status: 401, description: 'Không có quyền truy cập' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy tiện ích' })
  async update(
    @Param('id') id: string,
    @Body() updateAmenityDto: UpdateAmenityDto,
    @UploadedFile() imageFile?: Express.Multer.File,
  ): Promise<Amenity> {
    return this.amenitiesService.update(id, updateAmenityDto, imageFile);
  }

  @Patch(':id/toggle-status')
  @UseGuards(JwtAccessTokenGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ 
    summary: 'Bật/tắt trạng thái tiện ích',
    description: 'Chuyển đổi trạng thái hoạt động của tiện ích (active/inactive)'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Cập nhật trạng thái tiện ích thành công',
    type: Amenity
  })
  @ApiResponse({ status: 401, description: 'Không có quyền truy cập' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy tiện ích' })
  async toggleStatus(@Param('id') id: string): Promise<Amenity> {
    return this.amenitiesService.toggleActiveStatus(id);
  }

  @Delete(':id')
  @UseGuards(JwtAccessTokenGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ 
    summary: 'Xóa tiện ích',
    description: 'Xóa tiện ích và hình ảnh liên quan khỏi hệ thống'
  })
  @ApiResponse({ 
    status: 204, 
    description: 'Xóa tiện ích thành công' 
  })
  @ApiResponse({ status: 401, description: 'Không có quyền truy cập' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy tiện ích' })
  async remove(@Param('id') id: string): Promise<void> {
    return this.amenitiesService.remove(id);
  }
}
