import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, FilterQuery } from 'mongoose';
import { Amenity, AmenitySchema, AmenityDocument } from '../entities/amenities.entity';
import { AmenityRepositoryInterface } from '../interface/amenities.interface';

@Injectable()
export class AmenityRepository implements AmenityRepositoryInterface {
  constructor(
    @InjectModel(Amenity.name) private readonly amenityModel: Model<AmenityDocument>,
  ) {}

  async create(data: Partial<Amenity>): Promise<Amenity> {
    const amenity = new this.amenityModel(data);
    return await amenity.save();
  }

  async findById(id: string): Promise<Amenity | null> {
    return await this.amenityModel.findById(id).exec();
  }

  async findOneByCondition(condition: FilterQuery<Amenity>): Promise<Amenity | null> {
    return await this.amenityModel.findOne(condition).exec();
  }

  async findAll(condition?: FilterQuery<Amenity>): Promise<Amenity[]> {
    return await this.amenityModel.find(condition || {}).sort({ createdAt: -1 }).exec();
  }

  async update(id: string, data: Partial<Amenity>): Promise<Amenity | null> {
    return await this.amenityModel.findByIdAndUpdate(id, data, { new: true }).exec();
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.amenityModel.findByIdAndDelete(id).exec();
    return !!result;
  }

  async findWithPagination(
    condition: FilterQuery<Amenity>,
    page: number,
    limit: number,
  ): Promise<{ data: Amenity[]; total: number; page: number; limit: number }> {
    const skip = (page - 1) * limit;
    
    const [data, total] = await Promise.all([
      this.amenityModel.find(condition).sort({ createdAt: -1 }).skip(skip).limit(limit).exec(),
      this.amenityModel.countDocuments(condition).exec(),
    ]);

    return {
      data,
      total,
      page,
      limit,
    };
  }
}
