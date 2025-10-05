import { Injectable, NotFoundException, InternalServerErrorException, Logger, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Field } from './entities/field.entity';
import { Model, Types } from 'mongoose';
import { FieldsDto, CreateFieldDto, UpdateFieldDto, CreateFieldWithFilesDto } from './dtos/fields.dto';
import { FieldOwnerProfile } from './entities/field-owner-profile.entity';
import { AwsS3Service } from '../../service/aws-s3.service';
import type { IFile } from '../../interfaces/file.interface';
// Import Schedule and Booking models for availability checking
import { Schedule } from '../schedules/entities/schedule.entity';
import { Booking } from '../bookings/entities/booking.entity';
// Import utility function
import { timeToMinutes } from '../../utils/utils';


@Injectable()
export class FieldsService {
    private readonly logger = new Logger(FieldsService.name);
    
    // Cache field configs for short periods to improve performance
    private fieldConfigCache = new Map<string, { field: Field; timestamp: number }>();
    private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

    constructor(
        @InjectModel(Field.name) private fieldModel: Model<Field>,
        @InjectModel(Schedule.name) private scheduleModel: Model<Schedule>,
        @InjectModel(Booking.name) private bookingModel: Model<Booking>,
        private awsS3Service: AwsS3Service,
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
            createdAt: field.createdAt,
            updatedAt: field.updatedAt,
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
            createdAt: field.createdAt,
            updatedAt: field.updatedAt,
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
                slotDuration: createFieldDto.slotDuration,
                minSlots: createFieldDto.minSlots,
                maxSlots: createFieldDto.maxSlots,
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
                createdAt: savedField.createdAt,
                updatedAt: savedField.updatedAt,
            };

        } catch (error) {
            this.logger.error('Error creating field', error);
            throw new InternalServerErrorException('Failed to create field');
        }
    }

    /**
     * Create new field with image upload support
     * @param createFieldDto Field data from form
     * @param files Uploaded image files
     * @param ownerId Field owner ID from JWT
     * @returns Created field DTO
     */
    async createWithFiles(createFieldDto: CreateFieldWithFilesDto, files: IFile[], ownerId: string): Promise<FieldsDto> {
        try {
            this.logger.log(`Creating field with ${files?.length || 0} images for owner: ${ownerId}`);

            // Upload images to S3 if files are provided
            let imageUrls: string[] = [];
            if (files && files.length > 0) {
                this.logger.log(`Uploading ${files.length} images to S3...`);
                
                const uploadPromises = files.map(file => this.awsS3Service.uploadImage(file));
                imageUrls = await Promise.all(uploadPromises);
                
                this.logger.log(`Successfully uploaded ${imageUrls.length} images to S3`);
            }

            // Parse JSON strings from form data
            const operatingHours = JSON.parse(createFieldDto.operatingHours);
            let priceRanges = JSON.parse(createFieldDto.priceRanges);
            const slotDuration = parseInt(createFieldDto.slotDuration);
            const minSlots = parseInt(createFieldDto.minSlots);
            const maxSlots = parseInt(createFieldDto.maxSlots);
            const basePrice = parseInt(createFieldDto.basePrice);

            // Validate parsed data for day-based structure
            if (!Array.isArray(operatingHours) || operatingHours.length === 0) {
                throw new BadRequestException('Invalid operating hours format - must be array of day objects');
            }
            
            // Validate each provided day has required fields
            const validDays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
            for (const dayHours of operatingHours) {
                if (!validDays.includes(dayHours.day)) {
                    throw new BadRequestException(`Invalid day: ${dayHours.day}`);
                }
                if (!dayHours.start || !dayHours.end || !dayHours.duration) {
                    throw new BadRequestException(`Invalid operating hours for ${dayHours.day} - missing start, end, or duration`);
                }
            }

            // Price ranges are optional - field can operate with base price only
            if (priceRanges && Array.isArray(priceRanges) && priceRanges.length > 0) {
                // Validate each provided price range has required fields
                for (const range of priceRanges) {
                    if (!validDays.includes(range.day)) {
                        throw new BadRequestException(`Invalid day in price range: ${range.day}`);
                    }
                    if (!range.start || !range.end || range.multiplier === undefined) {
                        throw new BadRequestException(`Invalid price range for ${range.day} - missing start, end, or multiplier`);
                    }
                }
                
                // Ensure all operating days have default pricing if no specific ranges provided
                for (const dayHours of operatingHours) {
                    const dayRanges = priceRanges.filter(pr => pr.day === dayHours.day);
                    if (dayRanges.length === 0) {
                        // Add default price range for the entire operating hours
                        priceRanges.push({
                            day: dayHours.day,
                            start: dayHours.start,
                            end: dayHours.end,
                            multiplier: 1.0
                        });
                    }
                }
            } else {
                // No price ranges provided - create default 1.0x multiplier for all operating hours
                priceRanges = operatingHours.map(dayHours => ({
                    day: dayHours.day,
                    start: dayHours.start,
                    end: dayHours.end,
                    multiplier: 1.0
                }));
            }

            if (isNaN(slotDuration) || isNaN(minSlots) || isNaN(maxSlots) || isNaN(basePrice)) {
                throw new BadRequestException('Invalid numeric values');
            }

            // Create new field document using simple structure
            const newField = new this.fieldModel({
                owner: new Types.ObjectId(ownerId),
                name: createFieldDto.name,
                sportType: createFieldDto.sportType,
                description: createFieldDto.description,
                location: createFieldDto.location,
                images: imageUrls,
                operatingHours,
                slotDuration,
                minSlots,
                maxSlots,
                priceRanges,
                basePrice,
                isActive: true,
                rating: 0,
                totalReviews: 0,
            });

            const savedField = await newField.save();
            
            this.logger.log(`Created new field with images: ${savedField.name} (ID: ${savedField._id})`);

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
                createdAt: savedField.createdAt,
                updatedAt: savedField.updatedAt,
            };

        } catch (error) {
            this.logger.error('Error creating field with files', error);
            if (error instanceof BadRequestException) {
                throw error;
            }
            throw new InternalServerErrorException('Failed to create field with images');
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
                createdAt: updatedField.createdAt,
                updatedAt: updatedField.updatedAt,
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

    /**
     * Get field availability for date range with dynamic pricing
     * Updated with full booking integration
     * @param fieldId Field ID
     * @param startDate Start date
     * @param endDate End date
     * @returns Field availability with pricing and booking status
     */
    async getFieldAvailability(fieldId: string, startDate: Date, endDate: Date) {
        try {
            const field = await this.fieldModel.findById(fieldId);
            
            if (!field) {
                throw new NotFoundException('Field not found');
            }

            if (!field.isActive) {
                throw new BadRequestException('Field is currently inactive');
            }

            const availability: any[] = [];
            const currentDate = new Date(startDate);
            
            while (currentDate <= endDate) {
                // Get day of week for the current date
                const dayOfWeek = currentDate.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
                
                // Find operating hours for this day
                const dayOperatingHours = field.operatingHours.find(oh => oh.day === dayOfWeek);
                
                if (!dayOperatingHours) {
                    // Field is not operating on this day
                    availability.push({
                        date: currentDate.toISOString().split('T')[0],
                        isHoliday: this.isHoliday(currentDate),
                        slots: [],
                        message: `Field is not operating on ${dayOfWeek}`
                    });
                } else {
                    // Generate virtual slots for the field
                    const allSlots = this.generateTimeSlots(
                        dayOperatingHours.start,
                        dayOperatingHours.end,
                        field.slotDuration
                    );
                    
                    // Get existing bookings for this date
                    const existingBookings = await this.getExistingBookingsForDate(fieldId, currentDate);
                    
                    // Apply pricing and availability logic
                    const slotsWithPricing = allSlots.map(slot => {
                        const pricing = this.calculateSlotPricing(field, slot.startTime, slot.endTime, dayOfWeek);
                        
                        // Check if slot is booked
                        const isBooked = existingBookings.some(booking => 
                            this.slotsOverlap(
                                { start: slot.startTime, end: slot.endTime },
                                { start: booking.startTime, end: booking.endTime }
                            )
                        );
                        
                        return {
                            startTime: slot.startTime,
                            endTime: slot.endTime,
                            available: !isBooked,
                            price: pricing.totalPrice,
                            priceBreakdown: pricing.breakdown
                        };
                    });
                    
                    availability.push({
                        date: currentDate.toISOString().split('T')[0],
                        isHoliday: this.isHoliday(currentDate),
                        slots: slotsWithPricing
                    });
                }
                
                currentDate.setDate(currentDate.getDate() + 1);
            }

            return availability;
        } catch (error) {
            if (error instanceof NotFoundException || error instanceof BadRequestException) {
                throw error;
            }
            this.logger.error('Error getting field availability', error);
            throw new InternalServerErrorException('Failed to get field availability');
        }
    }

    /**
     * Get existing bookings for a specific field and date
     */
    private async getExistingBookingsForDate(fieldId: string, date: Date) {
        try {
            // Normalize date to start/end of day in Vietnam timezone (UTC+7)
            const startOfDay = new Date(date);
            startOfDay.setUTCHours(-7, 0, 0, 0); // Start of day in Vietnam = UTC-7

            const endOfDay = new Date(date);
            endOfDay.setUTCHours(16, 59, 59, 999); // End of day in Vietnam = UTC+17-1ms

            this.logger.log(`Searching bookings for field ${fieldId} on ${date.toISOString().split('T')[0]}`);

            // Get bookings from Booking collection (Pure Lazy Creation pattern)
            const bookings = await this.bookingModel.find({
                field: new Types.ObjectId(fieldId),
                date: {
                    $gte: startOfDay,
                    $lte: endOfDay
                },
                status: { $in: ['confirmed', 'pending'] } // Include both confirmed and pending bookings
            }).exec();

            this.logger.log(`Found ${bookings.length} bookings in Booking collection`);

            // Also check Schedule collection for legacy booked slots
            const schedule = await this.scheduleModel.findOne({
                field: new Types.ObjectId(fieldId),
                date: {
                    $gte: startOfDay,
                    $lte: endOfDay
                }
            }).exec();

            const scheduleSlots = schedule?.bookedSlots || [];
            this.logger.log(`Found ${scheduleSlots.length} booked slots in Schedule collection`);

            // Combine both sources
            const allBookedSlots = [
                // From Booking collection
                ...bookings.map(booking => ({
                    startTime: booking.startTime,
                    endTime: booking.endTime,
                    bookedBy: booking.user,
                    status: booking.status,
                    source: 'booking'
                })),
                // From Schedule collection
                ...scheduleSlots.map(slot => ({
                    startTime: slot.startTime,
                    endTime: slot.endTime,
                    bookedBy: null,
                    status: 'confirmed',
                    source: 'schedule'
                }))
            ];

            this.logger.log(`Total booked slots found: ${allBookedSlots.length}`);
            return allBookedSlots;

        } catch (error) {
            this.logger.error('Error getting existing bookings', error);
            return [];
        }
    }

    /**
     * Calculate pricing for a specific slot
     */
    private calculateSlotPricing(field: Field, startTime: string, endTime: string, dayOfWeek: string) {
        // Find price range for this time slot and day
        const priceRange = field.priceRanges.find(pr => {
            if (pr.day !== dayOfWeek) return false;
            
            const slotStart = timeToMinutes(startTime);
            const prStart = timeToMinutes(pr.start);
            const prEnd = timeToMinutes(pr.end);
            
            return slotStart >= prStart && slotStart < prEnd;
        });
        
        const basePrice = field.basePrice;
        const multiplier = priceRange?.multiplier || 1;
        const totalPrice = basePrice * multiplier;
        
        return {
            totalPrice,
            multiplier,
            breakdown: `${startTime}-${endTime}: ${multiplier}x base price (${basePrice})`
        };
    }

    /**
     * Check if two time slots overlap
     */
    private slotsOverlap(slot1: { start: string, end: string }, slot2: { start: string, end: string }): boolean {
        const slot1Start = timeToMinutes(slot1.start);
        const slot1End = timeToMinutes(slot1.end);
        const slot2Start = timeToMinutes(slot2.start);
        const slot2End = timeToMinutes(slot2.end);

        // Two slots overlap if one starts before the other ends
        return slot1Start < slot2End && slot2Start < slot1End;
    }

    /**
     * Check if a date is a holiday
     * @param date Date to check
     * @returns True if holiday
     */
    private isHoliday(date: Date): boolean {
        // Simple implementation - can be extended with actual holiday data
        const dayOfWeek = date.getDay();
        return dayOfWeek === 0 || dayOfWeek === 6; // Weekend as holidays for now
    }

    // ============================================================================
    // PURE LAZY CREATION HELPER METHODS - CẦN SỬA LẠI
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
    generateVirtualSlots(field: Field, date?: Date): Array<{
        startTime: string;
        endTime: string;
        basePrice: number;
        multiplier: number;
        finalPrice: number;
        day: string;
    }> {
        try {
            const slots: Array<{
                startTime: string;
                endTime: string;
                basePrice: number;
                multiplier: number;
                finalPrice: number;
                day: string;
            }> = [];

            if (!field.operatingHours || !field.slotDuration) {
                return slots; // No operating hours defined
            }

            // Get day of week for the date (default to monday if no date provided)
            const dayOfWeek = date ? this.getDayOfWeek(date) : 'monday';
            
            // Find operating hours for the specific day
            const dayOperatingHours = field.operatingHours.find(oh => oh.day === dayOfWeek);
            if (!dayOperatingHours) {
                return slots; // No operating hours for this day
            }

            const startMinutes = this.timeStringToMinutes(dayOperatingHours.start);
            const endMinutes = this.timeStringToMinutes(dayOperatingHours.end);

            for (let currentMinutes = startMinutes; currentMinutes < endMinutes; currentMinutes += field.slotDuration) {
                const slotEndMinutes = currentMinutes + field.slotDuration;
                if (slotEndMinutes > endMinutes) break;

                const startTime = this.minutesToTimeString(currentMinutes);
                const endTime = this.minutesToTimeString(slotEndMinutes);
                
                // Find applicable price range for this day
                const multiplier = this.getPriceMultiplierForDay(startTime, field.priceRanges, dayOfWeek);
                const finalPrice = field.basePrice * multiplier;

                slots.push({
                    startTime,
                    endTime,
                    basePrice: field.basePrice,
                    multiplier,
                    finalPrice,
                    day: dayOfWeek
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
        field: Field,
        date?: Date
    ): {
        isValid: boolean;
        errors: string[];
        numSlots: number;
        duration: number;
    } {
        const errors: string[] = [];
        
        try {
            if (!field.operatingHours || !field.slotDuration) {
                errors.push('Field operating hours or slot duration not configured');
                return {
                    isValid: false,
                    errors,
                    numSlots: 0,
                    duration: 0
                };
            }

            // Get day of week for the date (default to monday if no date provided)
            const dayOfWeek = date ? this.getDayOfWeek(date) : 'monday';
            
            // Find operating hours for the specific day
            const dayOperatingHours = field.operatingHours.find(oh => oh.day === dayOfWeek);
            if (!dayOperatingHours) {
                errors.push(`No operating hours defined for ${dayOfWeek}`);
                return {
                    isValid: false,
                    errors,
                    numSlots: 0,
                    duration: 0
                };
            }

            const startMinutes = this.timeStringToMinutes(startTime);
            const endMinutes = this.timeStringToMinutes(endTime);
            const operatingStart = this.timeStringToMinutes(dayOperatingHours.start);
            const operatingEnd = this.timeStringToMinutes(dayOperatingHours.end);

            // Check if within operating hours
            if (startMinutes < operatingStart || endMinutes > operatingEnd) {
                errors.push(`Booking time must be within operating hours ${dayOperatingHours.start} - ${dayOperatingHours.end} for ${dayOfWeek}`);
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
        field: Field,
        date?: Date
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

            if (!field.operatingHours || !field.slotDuration || !field.basePrice) {
                throw new BadRequestException('Field configuration incomplete');
            }

            // Get day of week for the date (default to monday if no date provided)
            const dayOfWeek = date ? this.getDayOfWeek(date) : 'monday';

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
                
                const multiplier = this.getPriceMultiplierForDay(slotStart, field.priceRanges, dayOfWeek);
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
    // PRICE SCHEDULING OPERATIONS - SỬA LẠI
    // ============================================================================

    // Schedule price update cho field
    async schedulePriceUpdate(
        fieldId: string,
        newOperatingHours: { day: string; start: string; end: string; duration: number }[],
        newPriceRanges: { day: string; start: string; end: string; multiplier: number }[],
        newBasePrice: number,
        effectiveDate: Date,
        ownerId: string,
    ) {
        // Kiểm tra field tồn tại và thuộc về owner
        const field = await this.fieldModel.findById(fieldId);
        if (!field) {
            throw new NotFoundException(`Field with ID ${fieldId} not found`);
        }

        // Kiểm tra quyền owner
        if (field.owner.toString() !== ownerId) {
            throw new UnauthorizedException('You are not the owner of this field');
        }

        // Chuẩn hóa effectiveDate về 00:00:00
        const effectiveDateMidnight = new Date(effectiveDate);
        effectiveDateMidnight.setHours(0, 0, 0, 0);

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (effectiveDateMidnight <= today) {
            throw new BadRequestException('effectiveDate must be in the future (after today)');
        }

        // Khởi tạo pendingPriceUpdates nếu chưa có
        if (!field.pendingPriceUpdates) {
            field.pendingPriceUpdates = [];
        }

        // Xóa các pending cùng effectiveDate (chưa applied)
        field.pendingPriceUpdates = field.pendingPriceUpdates.filter(
            u => !(u.effectiveDate && new Date(u.effectiveDate).getTime() === effectiveDateMidnight.getTime() && !u.applied)
        );

        // Thêm pending mới
        field.pendingPriceUpdates.push({
            newOperatingHours,
            newPriceRanges,
            newBasePrice,
            effectiveDate: effectiveDateMidnight,
            applied: false,
            createdBy: new Types.ObjectId(ownerId),
        });

        await field.save();
        
        // Clear cache for this field
        this.clearCache(fieldId);
        
        return { success: true };
    }

    // Cancel scheduled price update
    async cancelScheduledPriceUpdate(fieldId: string, effectiveDate: Date): Promise<boolean> {
        const field = await this.fieldModel.findById(fieldId);
        if (!field) return false;

        const effectiveDateMidnight = new Date(effectiveDate);
        effectiveDateMidnight.setHours(0, 0, 0, 0);

        // Khởi tạo pendingPriceUpdates nếu chưa có
        if (!field.pendingPriceUpdates) {
            field.pendingPriceUpdates = [];
        }

        const before = field.pendingPriceUpdates.length;
        field.pendingPriceUpdates = field.pendingPriceUpdates.filter(
            u => new Date(u.effectiveDate).getTime() !== effectiveDateMidnight.getTime() || u.applied
        );
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
        return field?.pendingPriceUpdates?.filter(u => !u.applied)
            .sort((a, b) => new Date(a.effectiveDate).getTime() - new Date(b.effectiveDate).getTime()) || [];
    }

    // ============================================================================
    // HELPER METHODS
    // ============================================================================

    /**
     * Get price multiplier for a specific time and day
     */
    private getPriceMultiplierForDay(
        time: string,
        priceRanges: Array<{ day: string; start: string; end: string; multiplier: number }>,
        day: string
    ): number {
        const timeMinutes = this.timeStringToMinutes(time);

        const applicableRange = priceRanges.find(range => {
            if (range.day !== day) return false;
            const rangeStart = this.timeStringToMinutes(range.start);
            const rangeEnd = this.timeStringToMinutes(range.end);
            return timeMinutes >= rangeStart && timeMinutes < rangeEnd;
        });

        return applicableRange?.multiplier || 1;
    }

    /**
     * Get day of week from date
     */
    private getDayOfWeek(date: Date): string {
        const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        return days[date.getDay()];
    }

    /**
     * Convert time string (HH:MM) to minutes since midnight
     */
    private timeStringToMinutes(timeString: string): number {
        const [hours, minutes] = timeString.split(':').map(Number);
        return hours * 60 + minutes;
    }

    /**
     * Generate time slots for a specific time range
     */
    private generateTimeSlots(startTime: string, endTime: string, slotDuration: number): Array<{ startTime: string; endTime: string }> {
        const slots: Array<{ startTime: string; endTime: string }> = [];
        const startMinutes = timeToMinutes(startTime);
        const endMinutes = timeToMinutes(endTime);

        for (let currentMinutes = startMinutes; currentMinutes < endMinutes; currentMinutes += slotDuration) {
            const slotEndMinutes = Math.min(currentMinutes + slotDuration, endMinutes);
            
            slots.push({
                startTime: this.minutesToTimeString(currentMinutes),
                endTime: this.minutesToTimeString(slotEndMinutes)
            });
        }

        return slots;
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
