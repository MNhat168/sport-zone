import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Field } from './entities/field.entity';
import { Model } from 'mongoose';
import { FieldsDto } from './dtos/fields.dto';
import { FieldOwnerProfile } from './entities/field-owner-profile.entity';

@Injectable()
export class FieldsService {
    constructor(@InjectModel(Field.name) private fieldModel: Model<Field>) {

    }

    async findAll(query?: { name?: string; location?: string; sportType?: string }): Promise<FieldsDto[]> {
        // Lọc theo tên và loại thể thao
        const filter: any = {};
        if (query?.name) filter.name = { $regex: query.name, $options: 'i' };
        if (query?.sportType) filter.sportType = new RegExp(`^${query.sportType}$`, 'i');

        const fields = await this.fieldModel
            .find(filter)
            .populate<{ owner: FieldOwnerProfile | null }>({ path: 'owner', select: 'facilityLocation', model: 'FieldOwnerProfile' })
            .lean();

        return fields.map(field => ({
            id: field._id.toString(),
            owner: field.owner?._id?.toString() || '', // Đảm bảo owner luôn là string
            name: field.name,
            sportType: field.sportType,
            description: field.description,
            location: field.owner?.facilityLocation || 'Unknown', // Kiểm tra null cho facilityLocation
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
        const field = await this.fieldModel
            .findById(id)
            .populate<{ owner: FieldOwnerProfile | null }>({ path: 'owner', select: 'facilityLocation', model: 'FieldOwnerProfile' })
            .lean();

        if (!field) {
            throw new NotFoundException(`Field with ID ${id} not found`);
        }

        return {
            id: field._id.toString(),
            owner: field.owner?._id?.toString() || '', // Đảm bảo owner luôn là string
            name: field.name,
            sportType: field.sportType,
            description: field.description,
            location: field.owner?.facilityLocation || 'Unknown', // Kiểm tra null cho facilityLocation
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
