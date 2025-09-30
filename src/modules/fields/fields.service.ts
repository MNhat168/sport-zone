import { Injectable, NotFoundException, InternalServerErrorException, Logger, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Field } from './entities/field.entity';
import { Model } from 'mongoose';
import { FieldsDto } from './dtos/fields.dto';
import { FieldOwnerProfile } from './entities/field-owner-profile.entity';
import { PriceSchedulerService } from './services/price-scheduler.service';

@Injectable()
export class FieldsService {
    private readonly logger = new Logger(FieldsService.name);

    constructor(
        @InjectModel(Field.name) private fieldModel: Model<Field>,
        private priceSchedulerService: PriceSchedulerService,
    ) {}

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
            owner: field.owner?._id?.toString() || '',
            name: field.name,
            sportType: field.sportType,
            description: field.description,
            location: field.owner?.facilityLocation || 'Unknown',
            images: field.images,
            operatingHours: field.operatingHours,
            slotDuration: field.slotDuration,
            minSlots: field.minSlots,
            maxSlots: field.maxSlots,
            priceRanges: field.priceRanges,
            basePrice: field.basePrice,
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
            owner: field.owner?._id?.toString() || '',
            name: field.name,
            sportType: field.sportType,
            description: field.description,
            location: field.owner?.facilityLocation || 'Unknown',
            images: field.images,
            operatingHours: field.operatingHours,
            slotDuration: field.slotDuration,
            minSlots: field.minSlots,
            maxSlots: field.maxSlots,
            priceRanges: field.priceRanges,
            basePrice: field.basePrice,
            isActive: field.isActive,
            maintenanceNote: field.maintenanceNote,
            maintenanceUntil: field.maintenanceUntil,
            rating: field.rating,
            totalReviews: field.totalReviews,
        };
    }

    // Schedule price update cho field
    async schedulePriceUpdate(
        fieldId: string,
        newPriceRanges: { start: string; end: string; multiplier: number }[],
        newBasePrice: number,
        effectiveDate: Date,
        ownerId: string,
    ) {
        // Kiểm tra field tồn tại và thuộc về owner
        const field = await this.fieldModel.findById(fieldId);
        if (!field) {
            throw new NotFoundException(`Field with ID ${fieldId} not found`);
        }

        // TODO: Thêm kiểm tra quyền owner nếu cần
        if (field.owner.toString() !== ownerId) {
            throw new UnauthorizedException('You are not the owner of this field');
        }

        // Chuẩn hóa effectiveDate về 00:00:00
        const effectiveDateMidnight = new Date(effectiveDate);
        effectiveDateMidnight.setHours(0, 0, 0, 0);

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (effectiveDateMidnight <= today) {
            throw new NotFoundException('effectiveDate must be in the future (after today)');
        }

        // Xóa các pending cùng effectiveDate (chưa applied)
        field.pendingPriceUpdates = (field.pendingPriceUpdates || []).filter(u => !(u.effectiveDate && new Date(u.effectiveDate).getTime() === effectiveDateMidnight.getTime() && !u.applied));

        // Thêm pending mới
        field.pendingPriceUpdates.push({
            newPriceRanges,
            newBasePrice,
            effectiveDate: effectiveDateMidnight,
            applied: false,
            createdBy: field.owner,
        } as any);

        await field.save();
        return { success: true } as any;
    }

    // Cancel scheduled price update
    async cancelScheduledPriceUpdate(fieldId: string, effectiveDate: Date): Promise<boolean> {
        const field = await this.fieldModel.findById(fieldId);
        if (!field) return false;

        const effectiveDateMidnight = new Date(effectiveDate);
        effectiveDateMidnight.setHours(0, 0, 0, 0);

        const before = field.pendingPriceUpdates?.length || 0;
        field.pendingPriceUpdates = (field.pendingPriceUpdates || []).filter(u => new Date(u.effectiveDate).getTime() !== effectiveDateMidnight.getTime() || u.applied);
        await field.save();
        const after = field.pendingPriceUpdates.length;
        return after < before;
    }

    // Get scheduled price updates cho field
    async getScheduledPriceUpdates(fieldId: string) {
        const field = await this.fieldModel.findById(fieldId).lean();
        return field?.pendingPriceUpdates?.filter(u => !u.applied).sort((a, b) => new Date(a.effectiveDate).getTime() - new Date(b.effectiveDate).getTime()) || [];
    }
}
