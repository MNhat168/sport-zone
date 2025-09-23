import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Field } from './entities/field.entity';
import { Model } from 'mongoose';
import { FieldsDto } from './dtos/fields.dto';

@Injectable()
export class FieldsService {
    constructor(@InjectModel(Field.name) private fieldModel: Model<Field>) {

    }

    async findAll(query?: { name?: string; location?: string; sportType?: string }): Promise<FieldsDto[]> {
        //Lọc theo tên, vị trí và loại thể thao
        const filter: any = {};
        if (query?.name) filter.name = { $regex: query.name, $options: 'i' };
        if (query?.location) filter.location = { $regex: query.location, $options: 'i' };
        if (query?.sportType) filter.sportType = new RegExp(`^${query.sportType}$`, 'i');

        const fields = await this.fieldModel.find(filter).lean();
        return fields.map(field => ({
            id: field._id.toString(),
            owner: field.owner.toString(),
            name: field.name,
            sportType: field.sportType,
            description: field.description,
            location: field.location,
            images: field.images,
            pricePerHour: field.pricePerHour,
            isActive: field.isActive,
            maintenanceNote: field.maintenanceNote,
            maintenanceUntil: field.maintenanceUntil,
            rating: field.rating,
            totalReviews: field.totalReviews,
        }));
    }

    async findOne(id: string): Promise<FieldsDto> {
        const field = await this.fieldModel.findById(id).lean();
        if (!field) {
            throw new NotFoundException(`Field with ID ${id} not found`);
        }
        return {
            id: field._id.toString(),
            owner: field.owner.toString(),
            name: field.name,
            sportType: field.sportType,
            description: field.description,
            location: field.location,
            images: field.images,
            pricePerHour: field.pricePerHour,
            isActive: field.isActive,
            maintenanceNote: field.maintenanceNote,
            maintenanceUntil: field.maintenanceUntil,
            rating: field.rating,
            totalReviews: field.totalReviews,
        };
    }
}
