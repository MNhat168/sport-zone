import { Injectable, NotFoundException, InternalServerErrorException, Logger, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Field } from './entities/field.entity';
import { Model, Types } from 'mongoose';
import { FieldsDto, CreateFieldDto, UpdateFieldDto } from './dtos/fields.dto';
import { FieldOwnerProfile } from './entities/field-owner-profile.entity';
import { PriceSchedulerService } from './services/price-scheduler.service';


@Injectable()
export class FieldsService {
    private readonly logger = new Logger(FieldsService.name);
    
    // Cache field configs for short periods to improve performance
    private fieldConfigCache = new Map<string, { field: Field; timestamp: number }>();
    private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

    constructor(
        @InjectModel(Field.name) private fieldModel: Model<Field>,
        private priceSchedulerService: PriceSchedulerService,
        
    ) {}



    // ============================================================================
    // CRUD OPERATIONS
    // ============================================================================

    async findAll(query?: { name?: string; location?: string; sportType?: string }): Promise<FieldsDto[]> {
        // Lọc theo tên và loại thể thao
        const filter: any = {};
        if (query?.name) filter.name = { $regex: query.name, $options: 'i' };
        if (query?.sportType) filter.sportType = new RegExp(`^${query.sportType}$`, 'i');

        const fields = await this.fieldModel
            .find(filter)
            .lean();

        return fields.map(field => ({
            id: field._id.toString(),
            owner: field.owner?.toString() || '',
            name: field.name,
            sportType: field.sportType,
            description: field.description,
            location: field.location || 'Unknown',
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
            .lean();

        if (!field) {
            throw new NotFoundException(`Field with ID ${id} not found`);
        }

        return {
            id: field._id.toString(),
            owner: field.owner?.toString() || '',
            name: field.name,
            sportType: field.sportType,
            description: field.description,
            location: field.location || 'Unknown',
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

    async create(createFieldDto: CreateFieldDto, ownerId: string): Promise<FieldsDto> {
        try {
            // Validate owner exists
            // TODO: Add owner validation if needed
            
            const newField = new this.fieldModel({
                owner: new Types.ObjectId(ownerId),
                name: createFieldDto.name,
                sportType: createFieldDto.sportType,
                description: createFieldDto.description,
                location: createFieldDto.location,
                images: createFieldDto.images || [],
                operatingHours: createFieldDto.operatingHours,
                slotDuration: createFieldDto.slotDuration || 60,
                minSlots: createFieldDto.minSlots || 1,
                maxSlots: createFieldDto.maxSlots || 4,
                priceRanges: createFieldDto.priceRanges,
                basePrice: createFieldDto.basePrice,
                isActive: true,
                rating: 0,
                totalReviews: 0,
            });

            const savedField = await newField.save();
            
            this.logger.log(`Created new field: ${savedField.name} (ID: ${savedField._id})`);

            return {
                id: (savedField._id as Types.ObjectId).toString(),
                owner: savedField.owner.toString(),
                name: savedField.name,
                sportType: savedField.sportType,
                description: savedField.description,
                location: savedField.location,
                images: savedField.images,
                operatingHours: savedField.operatingHours,
                slotDuration: savedField.slotDuration,
                minSlots: savedField.minSlots,
                maxSlots: savedField.maxSlots,
                priceRanges: savedField.priceRanges,
                basePrice: savedField.basePrice,
                isActive: savedField.isActive,
                maintenanceNote: savedField.maintenanceNote,
                maintenanceUntil: savedField.maintenanceUntil,
                rating: savedField.rating,
                totalReviews: savedField.totalReviews,
            };

        } catch (error) {
            this.logger.error('Error creating field', error);
            throw new InternalServerErrorException('Failed to create field');
        }
    }

    async update(fieldId: string, updateFieldDto: UpdateFieldDto, ownerId: string): Promise<FieldsDto> {
        try {
            const field = await this.fieldModel.findById(fieldId);
            
            if (!field) {
                throw new NotFoundException('Field not found');
            }

            // Check if user is owner
            if (field.owner.toString() !== ownerId) {
                throw new UnauthorizedException('Only field owner can update field information');
            }

            const updatedField = await this.fieldModel.findByIdAndUpdate(
                fieldId,
                { $set: updateFieldDto },
                { new: true }
            );

            if (!updatedField) {
                throw new NotFoundException('Field not found');
            }

            this.logger.log(`Updated field: ${updatedField.name} (ID: ${updatedField._id})`);

            return {
                id: (updatedField._id as Types.ObjectId).toString(),
                owner: updatedField.owner.toString(),
                name: updatedField.name,
                sportType: updatedField.sportType,
                description: updatedField.description,
                location: updatedField.location || 'Unknown',
                images: updatedField.images,
                operatingHours: updatedField.operatingHours,
                slotDuration: updatedField.slotDuration,
                minSlots: updatedField.minSlots,
                maxSlots: updatedField.maxSlots,
                priceRanges: updatedField.priceRanges,
                basePrice: updatedField.basePrice,
                isActive: updatedField.isActive,
                maintenanceNote: updatedField.maintenanceNote,
                maintenanceUntil: updatedField.maintenanceUntil,
                rating: updatedField.rating,
                totalReviews: updatedField.totalReviews,
            };

        } catch (error) {
            if (error instanceof NotFoundException || error instanceof UnauthorizedException) {
                throw error;
            }
            this.logger.error('Error updating field', error);
            throw new InternalServerErrorException('Failed to update field');
        }
    }

    async delete(fieldId: string, ownerId: string): Promise<{ success: boolean; message: string }> {
        try {
            const field = await this.fieldModel.findById(fieldId);
            
            if (!field) {
                throw new NotFoundException('Field not found');
            }

            // Check if user is owner
            if (field.owner.toString() !== ownerId) {
                throw new UnauthorizedException('Only field owner can delete field');
            }

            // TODO: Check if field has pending bookings before deletion
            
            await this.fieldModel.findByIdAndDelete(fieldId);
            
            this.logger.log(`Deleted field: ${field.name} (ID: ${fieldId})`);

            return {
                success: true,
                message: 'Field deleted successfully'
            };

        } catch (error) {
            if (error instanceof NotFoundException || error instanceof UnauthorizedException) {
                throw error;
            }
            this.logger.error('Error deleting field', error);
            throw new InternalServerErrorException('Failed to delete field');
        }
    }

    // ============================================================================
    // PURE LAZY CREATION HELPER METHODS
    // ============================================================================

    /**
     * Get field configuration with caching for Pure Lazy Creation
     * Used by booking service to generate virtual slots
     */
    async getFieldConfig(fieldId: string): Promise<Field> {
        try {
            // Check cache first
            const cached = this.fieldConfigCache.get(fieldId);
            if (cached && (Date.now() - cached.timestamp) < this.CACHE_TTL) {
                return cached.field;
            }

            // Validate field ID format
            if (!Types.ObjectId.isValid(fieldId)) {
                throw new BadRequestException('Invalid field ID format');
            }

            // Fetch from database
            const field = await this.fieldModel.findById(fieldId).exec();
            if (!field) {
                throw new NotFoundException(`Field with ID ${fieldId} not found`);
            }

            if (!field.isActive) {
                throw new BadRequestException('Field is not active');
            }

            // Cache the result
            this.fieldConfigCache.set(fieldId, {
                field,
                timestamp: Date.now()
            });

            // Clean up old cache entries periodically
            this.cleanupCache();

            this.logger.log(`Retrieved field config for ${fieldId}`);
            return field;

        } catch (error) {
            this.logger.error(`Error getting field config for ${fieldId}`, error);
            if (error instanceof BadRequestException || error instanceof NotFoundException) {
                throw error;
            }
            throw new BadRequestException('Failed to retrieve field configuration');
        }
    }

    /**
     * Get multiple field configurations efficiently
     */
    async getMultipleFieldConfigs(fieldIds: string[]): Promise<Map<string, Field>> {
        try {
            const validIds = fieldIds.filter(id => Types.ObjectId.isValid(id));
            if (validIds.length !== fieldIds.length) {
                throw new BadRequestException('One or more field IDs are invalid');
            }

            const result = new Map<string, Field>();
            const uncachedIds: string[] = [];

            // Check cache for each field
            for (const fieldId of validIds) {
                const cached = this.fieldConfigCache.get(fieldId);
                if (cached && (Date.now() - cached.timestamp) < this.CACHE_TTL) {
                    result.set(fieldId, cached.field);
                } else {
                    uncachedIds.push(fieldId);
                }
            }

            // Fetch uncached fields from database
            if (uncachedIds.length > 0) {
                const fields = await this.fieldModel
                    .find({
                        _id: { $in: uncachedIds.map(id => new Types.ObjectId(id)) },
                        isActive: true
                    })
                    .exec();

                // Add to result and cache
                for (const field of fields) {
                    const fieldId = (field._id as Types.ObjectId).toString();
                    result.set(fieldId, field);
                    
                    this.fieldConfigCache.set(fieldId, {
                        field,
                        timestamp: Date.now()
                    });
                }
            }

            this.logger.log(`Retrieved ${result.size} field configurations`);
            return result;

        } catch (error) {
            this.logger.error('Error getting multiple field configs', error);
            throw new BadRequestException('Failed to retrieve field configurations');
        }
    }

    /**
     * Generate virtual time slots from field configuration
     * Core method for Pure Lazy Creation pattern
     */
    generateVirtualSlots(field: Field): Array<{
        startTime: string;
        endTime: string;
        basePrice: number;
        multiplier: number;
        finalPrice: number;
    }> {
        try {
            const slots: Array<{
                startTime: string;
                endTime: string;
                basePrice: number;
                multiplier: number;
                finalPrice: number;
            }> = [];

            const startMinutes = this.timeStringToMinutes(field.operatingHours.start);
            const endMinutes = this.timeStringToMinutes(field.operatingHours.end);

            for (let currentMinutes = startMinutes; currentMinutes < endMinutes; currentMinutes += field.slotDuration) {
                const slotEndMinutes = currentMinutes + field.slotDuration;
                if (slotEndMinutes > endMinutes) break;

                const startTime = this.minutesToTimeString(currentMinutes);
                const endTime = this.minutesToTimeString(slotEndMinutes);
                
                // Find applicable price range
                const multiplier = this.getPriceMultiplier(startTime, field.priceRanges);
                const finalPrice = field.basePrice * multiplier;

                slots.push({
                    startTime,
                    endTime,
                    basePrice: field.basePrice,
                    multiplier,
                    finalPrice
                });
            }

            return slots;

        } catch (error) {
            this.logger.error('Error generating virtual slots', error);
            throw new BadRequestException('Failed to generate virtual slots');
        }
    }

    /**
     * Validate booking time constraints against field rules
     */
    validateBookingConstraints(
        startTime: string,
        endTime: string,
        field: Field
    ): {
        isValid: boolean;
        errors: string[];
        numSlots: number;
        duration: number;
    } {
        const errors: string[] = [];
        
        try {
            const startMinutes = this.timeStringToMinutes(startTime);
            const endMinutes = this.timeStringToMinutes(endTime);
            const operatingStart = this.timeStringToMinutes(field.operatingHours.start);
            const operatingEnd = this.timeStringToMinutes(field.operatingHours.end);

            // Check if within operating hours
            if (startMinutes < operatingStart || endMinutes > operatingEnd) {
                errors.push(`Booking time must be within operating hours ${field.operatingHours.start} - ${field.operatingHours.end}`);
            }

            // Check if end time is after start time
            if (endMinutes <= startMinutes) {
                errors.push('End time must be after start time');
            }

            // Calculate duration and slots
            const duration = endMinutes - startMinutes;
            const numSlots = Math.ceil(duration / field.slotDuration);
            
            // Check slot constraints
            if (numSlots < field.minSlots) {
                errors.push(`Minimum booking is ${field.minSlots} slots (${field.minSlots * field.slotDuration} minutes)`);
            }

            if (numSlots > field.maxSlots) {
                errors.push(`Maximum booking is ${field.maxSlots} slots (${field.maxSlots * field.slotDuration} minutes)`);
            }

            // Check slot alignment
            if ((startMinutes - operatingStart) % field.slotDuration !== 0) {
                errors.push('Start time must align with slot boundaries');
            }

            if (duration % field.slotDuration !== 0) {
                errors.push('Booking duration must be multiple of slot duration');
            }

            return {
                isValid: errors.length === 0,
                errors,
                numSlots,
                duration
            };

        } catch (error) {
            this.logger.error('Error validating booking constraints', error);
            return {
                isValid: false,
                errors: ['Invalid time format or field configuration'],
                numSlots: 0,
                duration: 0
            };
        }
    }

    /**
     * Calculate total pricing for a booking period
     */
    calculateBookingPrice(
        startTime: string,
        endTime: string,
        field: Field
    ): {
        totalPrice: number;
        breakdown: Array<{
            startTime: string;
            endTime: string;
            basePrice: number;
            multiplier: number;
            slotPrice: number;
        }>;
        averageMultiplier: number;
    } {
        try {
            const breakdown: Array<{
                startTime: string;
                endTime: string;
                basePrice: number;
                multiplier: number;
                slotPrice: number;
            }> = [];

            const startMinutes = this.timeStringToMinutes(startTime);
            const endMinutes = this.timeStringToMinutes(endTime);
            let totalPrice = 0;
            let totalMultiplier = 0;
            let slotCount = 0;

            // Calculate price for each slot within the booking period
            for (let currentMinutes = startMinutes; currentMinutes < endMinutes; currentMinutes += field.slotDuration) {
                const slotEndMinutes = Math.min(currentMinutes + field.slotDuration, endMinutes);
                const slotStart = this.minutesToTimeString(currentMinutes);
                const slotEnd = this.minutesToTimeString(slotEndMinutes);
                
                const multiplier = this.getPriceMultiplier(slotStart, field.priceRanges);
                const slotPrice = field.basePrice * multiplier;
                
                breakdown.push({
                    startTime: slotStart,
                    endTime: slotEnd,
                    basePrice: field.basePrice,
                    multiplier,
                    slotPrice
                });

                totalPrice += slotPrice;
                totalMultiplier += multiplier;
                slotCount++;
            }

            const averageMultiplier = slotCount > 0 ? totalMultiplier / slotCount : 1;

            return {
                totalPrice,
                breakdown,
                averageMultiplier: parseFloat(averageMultiplier.toFixed(2))
            };

        } catch (error) {
            this.logger.error('Error calculating booking price', error);
            throw new BadRequestException('Failed to calculate booking price');
        }
    }

    /**
     * Get field operating status for a specific date
     */
    async getFieldOperatingStatus(fieldId: string, date: Date): Promise<{
        isOperating: boolean;
        reason?: string;
        maintenanceUntil?: Date;
    }> {
        try {
            const field = await this.getFieldConfig(fieldId);

            // Check if field is generally active
            if (!field.isActive) {
                return {
                    isOperating: false,
                    reason: 'Field is permanently inactive',
                };
            }

            // Check maintenance schedule
            if (field.maintenanceUntil && date <= field.maintenanceUntil) {
                return {
                    isOperating: false,
                    reason: field.maintenanceNote || 'Field is under maintenance',
                    maintenanceUntil: field.maintenanceUntil,
                };
            }

            return {
                isOperating: true,
            };

        } catch (error) {
            this.logger.error('Error checking field operating status', error);
            throw new BadRequestException('Failed to check field operating status');
        }
    }

    // ============================================================================
    // PRICE SCHEDULING OPERATIONS
    // ============================================================================

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
        
        // Clear cache for this field
        this.clearCache(fieldId);
        
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
        
        // Clear cache for this field
        if (after < before) {
            this.clearCache(fieldId);
        }
        
        return after < before;
    }

    // Get scheduled price updates cho field
    async getScheduledPriceUpdates(fieldId: string) {
        const field = await this.fieldModel.findById(fieldId).lean();
        return field?.pendingPriceUpdates?.filter(u => !u.applied).sort((a, b) => new Date(a.effectiveDate).getTime() - new Date(b.effectiveDate).getTime()) || [];
    }

    // ============================================================================
    // HELPER METHODS
    // ============================================================================

    /**
     * Get price multiplier for a specific time
     */
    private getPriceMultiplier(
        time: string,
        priceRanges: Array<{ start: string; end: string; multiplier: number }>
    ): number {
        const timeMinutes = this.timeStringToMinutes(time);

        const applicableRange = priceRanges.find(range => {
            const rangeStart = this.timeStringToMinutes(range.start);
            const rangeEnd = this.timeStringToMinutes(range.end);
            return timeMinutes >= rangeStart && timeMinutes < rangeEnd;
        });

        return applicableRange?.multiplier || 1;
    }

    /**
     * Convert time string (HH:MM) to minutes since midnight
     */
    private timeStringToMinutes(timeString: string): number {
        const [hours, minutes] = timeString.split(':').map(Number);
        return hours * 60 + minutes;
    }

    /**
     * Convert minutes since midnight to time string (HH:MM)
     */
    private minutesToTimeString(minutes: number): string {
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
    }

    /**
     * Clean up expired cache entries
     */
    private cleanupCache(): void {
        const now = Date.now();
        for (const [fieldId, cached] of this.fieldConfigCache.entries()) {
            if (now - cached.timestamp > this.CACHE_TTL) {
                this.fieldConfigCache.delete(fieldId);
            }
        }
    }

    /**
     * Clear cache manually (for testing or forced refresh)
     */
    clearCache(fieldId?: string): void {
        if (fieldId) {
            this.fieldConfigCache.delete(fieldId);
            this.logger.log(`Cleared cache for field ${fieldId}`);
        } else {
            this.fieldConfigCache.clear();
            this.logger.log('Cleared all field config cache');
        }
    }

    /**
     * Get cache statistics for monitoring
     */
    getCacheStats(): {
        size: number;
        hitRate?: number;
        entries: Array<{ fieldId: string; age: number }>;
    } {
        const now = Date.now();
        const entries = Array.from(this.fieldConfigCache.entries()).map(([fieldId, cached]) => ({
            fieldId,
            age: now - cached.timestamp
        }));

        return {
            size: this.fieldConfigCache.size,
            entries
        };
    }
}
