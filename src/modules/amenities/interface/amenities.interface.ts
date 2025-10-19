import { FilterQuery } from 'mongoose';
import { Amenity, AmenityDocument } from '../entities/amenities.entity';

export interface AmenityRepositoryInterface {
  create(data: Partial<Amenity>): Promise<Amenity>;
  findById(id: string): Promise<Amenity | null>;
  findOneByCondition(condition: FilterQuery<Amenity>): Promise<Amenity | null>;
  findAll(condition?: FilterQuery<Amenity>): Promise<Amenity[]>;
  update(id: string, data: Partial<Amenity>): Promise<Amenity | null>;
  delete(id: string): Promise<boolean>;
  findWithPagination(
    condition: FilterQuery<Amenity>,
    page: number,
    limit: number,
  ): Promise<{ data: Amenity[]; total: number; page: number; limit: number }>;
}

export const AMENITY_REPOSITORY = 'AMENITY_REPOSITORY';
