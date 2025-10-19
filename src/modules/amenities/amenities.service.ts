import { Injectable, NotFoundException, BadRequestException, Inject } from '@nestjs/common';
import { FilterQuery } from 'mongoose';
import { Amenity } from './entities/amenities.entity';
import { AmenityRepositoryInterface, AMENITY_REPOSITORY } from './interface/amenities.interface';
import { CreateAmenityDto } from './dto/create-amenity.dto';
import { UpdateAmenityDto } from './dto/update-amenity.dto';
import { QueryAmenityDto } from './dto/query-amenity.dto';
import { AwsS3Service } from 'src/service/aws-s3.service';

@Injectable()
export class AmenitiesService {
  constructor(
    @Inject(AMENITY_REPOSITORY)
    private readonly amenityRepository: AmenityRepositoryInterface,
    private readonly awsS3Service: AwsS3Service,
  ) {}

  async create(createAmenityDto: CreateAmenityDto, imageFile?: any): Promise<Amenity> {
    let imageUrl: string | undefined;

    // Handle image upload if provided
    if (imageFile) {
      imageUrl = await this.awsS3Service.uploadACLImage({
        buffer: imageFile.buffer,
        mimetype: imageFile.mimetype,
        originalname: imageFile.originalname,
        encoding: imageFile.encoding,
        fieldname: imageFile.fieldname,
        size: imageFile.size,
      });
    }

    const amenityData = {
      ...createAmenityDto,
      imageUrl,
    };

    return await this.amenityRepository.create(amenityData);
  }

  async findAll(queryDto: QueryAmenityDto) {
    const {
      sportType,
      type,
      search,
      isActive,
      page = 1,
      limit = 10,
    } = queryDto;

    // Build filter condition
    const condition: FilterQuery<Amenity> = {};

    if (sportType) {
      condition.sportType = sportType;
    }

    if (type) {
      condition.type = type;
    }

    if (isActive !== undefined) {
      condition.isActive = isActive;
    }

    if (search) {
      condition.name = { $regex: search, $options: 'i' };
    }

    return await this.amenityRepository.findWithPagination(condition, page, limit);
  }

  async findOne(id: string): Promise<Amenity> {
    const amenity = await this.amenityRepository.findById(id);
    if (!amenity) {
      throw new NotFoundException(`Amenity with ID ${id} not found`);
    }
    return amenity;
  }

  async update(id: string, updateAmenityDto: UpdateAmenityDto, imageFile?: any): Promise<Amenity> {
    const existingAmenity = await this.amenityRepository.findById(id);
    if (!existingAmenity) {
      throw new NotFoundException(`Amenity with ID ${id} not found`);
    }

    let updateData = { ...updateAmenityDto };

    // Handle image upload if provided
    if (imageFile) {
      // Delete old image if exists
      if (existingAmenity.imageUrl) {
        const oldKey = existingAmenity.imageUrl.split('.com/')[1];
        try {
          await this.awsS3Service.deleteObject(oldKey);
        } catch (error) {
          console.warn('Failed to delete old image:', error);
        }
      }

      // Upload new image to S3
      const imageUrl = await this.awsS3Service.uploadACLImage({
        buffer: imageFile.buffer,
        mimetype: imageFile.mimetype,
        originalname: imageFile.originalname,
        encoding: imageFile.encoding,
        fieldname: imageFile.fieldname,
        size: imageFile.size,
      });

      updateData.imageUrl = imageUrl;
    }

    const updatedAmenity = await this.amenityRepository.update(id, updateData);
    if (!updatedAmenity) {
      throw new NotFoundException(`Amenity with ID ${id} not found`);
    }

    return updatedAmenity;
  }

  async remove(id: string): Promise<void> {
    const amenity = await this.amenityRepository.findById(id);
    if (!amenity) {
      throw new NotFoundException(`Amenity with ID ${id} not found`);
    }

    // Delete image from S3 if exists
    if (amenity.imageUrl) {
      const imageKey = amenity.imageUrl.split('.com/')[1];
      try {
        await this.awsS3Service.deleteObject(imageKey);
      } catch (error) {
        console.warn('Failed to delete image from S3:', error);
      }
    }

    const deleted = await this.amenityRepository.delete(id);
    if (!deleted) {
      throw new BadRequestException('Failed to delete amenity');
    }
  }

  async findBySportType(sportType: string): Promise<Amenity[]> {
    return await this.amenityRepository.findAll({ sportType, isActive: true });
  }

  async findByType(type: string): Promise<Amenity[]> {
    return await this.amenityRepository.findAll({ type, isActive: true });
  }

  async toggleActiveStatus(id: string): Promise<Amenity> {
    const amenity = await this.amenityRepository.findById(id);
    if (!amenity) {
      throw new NotFoundException(`Amenity with ID ${id} not found`);
    }

    const updatedAmenity = await this.amenityRepository.update(id, {
      isActive: !amenity.isActive,
    });

    if (!updatedAmenity) {
      throw new BadRequestException('Failed to update amenity status');
    }

    return updatedAmenity;
  }
}
