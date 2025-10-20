import { Injectable, NotFoundException, InternalServerErrorException, Logger, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Field } from './entities/field.entity';
import { Model, Types } from 'mongoose';
import { FieldsDto, CreateFieldDto, UpdateFieldDto, CreateFieldWithFilesDto } from './dtos/fields.dto';
import { FieldOwnerProfileDto, CreateFieldOwnerProfileDto, UpdateFieldOwnerProfileDto } from './dtos/field-owner-profile.dto';
import { FieldOwnerProfile } from './entities/field-owner-profile.entity';
import { AwsS3Service } from '../../service/aws-s3.service';
import type { IFile } from '../../interfaces/file.interface';
// Import Schedule and Booking models for availability checking
import { Schedule } from '../schedules/entities/schedule.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { User } from '../users/entities/user.entity';
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
        @InjectModel(FieldOwnerProfile.name) private fieldOwnerProfileModel: Model<FieldOwnerProfile>,
        @InjectModel(Schedule.name) private scheduleModel: Model<Schedule>,
        @InjectModel(Booking.name) private bookingModel: Model<Booking>,
        @InjectModel(User.name) private userModel: Model<User>,
        private awsS3Service: AwsS3Service,
    ) {}



    // ============================================================================
    // CRUD OPERATIONS
    // ============================================================================

    async findAll(query?: { 
        name?: string; 
        location?: string; 
        sportType?: string;
        latitude?: number;
        longitude?: number;
        radius?: number; // in kilometers
    }): Promise<FieldsDto[]> {
        // Lọc theo tên và loại thể thao
        const filter: any = { isActive: true };
        if (query?.name) filter.name = { $regex: query.name, $options: 'i' };
        if (query?.sportType) filter.sportType = new RegExp(`^${query.sportType}$`, 'i');
        if (query?.location) filter['location.address'] = { $regex: query.location, $options: 'i' };

        // Location-based search with radius
        if (query?.latitude && query?.longitude && query?.radius) {
            const radiusInMeters = query.radius * 1000; // Convert km to meters
            filter['location.geo'] = {
                $near: {
                    $geometry: {
                        type: 'Point',
                        coordinates: [query.longitude, query.latitude]
                    },
                    $maxDistance: radiusInMeters
                }
            };
        }

        const fields = await this.fieldModel
            .find(filter)
            .lean();

        return fields.map(field => ({
            id: field._id.toString(),
            owner: field.owner?.toString() || '',
            name: field.name,
            sportType: field.sportType,
            description: field.description,
            location: field.location,
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

    /**
     * Lấy danh sách field của field-owner
     * @param ownerId - ID của field owner
     * @param query - Optional query filters
     * @returns Danh sách field của owner
     */
    async findByOwner(ownerId: string, query?: {
        name?: string;
        sportType?: string;
        isActive?: boolean;
        page?: number;
        limit?: number;
    }): Promise<{
        fields: FieldsDto[];
        pagination: {
            total: number;
            page: number;
            limit: number;
            totalPages: number;
            hasNextPage: boolean;
            hasPrevPage: boolean;
        };
    }> {
        try {
            // Build filter query
            const filter: any = { 
                owner: new Types.ObjectId(ownerId)
            };

            // Apply optional filters
            if (query?.name) {
                filter.name = { $regex: query.name, $options: 'i' };
            }
            if (query?.sportType) {
                filter.sportType = new RegExp(`^${query.sportType}$`, 'i');
            }
            if (query?.isActive !== undefined) {
                filter.isActive = query.isActive;
            }

            // Check if this ownerId is a User ID, find the corresponding FieldOwnerProfile
            const user = await this.userModel.findById(ownerId).exec();
            if (user) {
                // ownerId is User ID, find the corresponding FieldOwnerProfile
                const userFieldOwnerProfile = await this.fieldOwnerProfileModel.findOne({ user: new Types.ObjectId(ownerId) }).exec();
                
                if (userFieldOwnerProfile) {
                    filter.owner = userFieldOwnerProfile._id;
                }
            }
            // If ownerId is already FieldOwnerProfile ID, use it directly

            // Pagination setup
            const page = query?.page || 1;
            const limit = query?.limit || 10;
            const skip = (page - 1) * limit;

            // Get total count
            const total = await this.fieldModel.countDocuments(filter);

            // Get fields with owner population
            const fields = await this.fieldModel
                .find(filter)
                .populate({
                    path: 'owner',
                    select: 'user businessName businessRegistration contactInfo'
                })
                .sort({ createdAt: -1, _id: -1 }) // Mới nhất trước
                .skip(skip)
                .limit(limit)
                .exec();

            const totalPages = Math.ceil(total / limit);

            // Convert to DTO format
            const fieldsDto: FieldsDto[] = fields.map(field => ({
                id: field._id?.toString() || '',
                owner: (field.owner as any)?._id?.toString() || field.owner?.toString() || '',
                name: field.name,
                sportType: field.sportType,
                description: field.description,
                location: field.location,
                images: field.images,
                amenities: field.amenities,
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

            return {
                fields: fieldsDto,
                pagination: {
                    total,
                    page,
                    limit,
                    totalPages,
                    hasNextPage: page < totalPages,
                    hasPrevPage: page > 1
                }
            };

        } catch (error) {
            this.logger.error(`Error getting fields for owner ${ownerId}:`, error);
            throw new InternalServerErrorException('Failed to get owner fields');
        }
    }

    /**
     * Lấy danh sách booking hôm nay của các sân thuộc field-owner
     * @param userId - ID của user (từ JWT token)
     * @returns Danh sách booking hôm nay kèm thông tin khách hàng
     */
    async getTodayBookingsByOwner(userId: string): Promise<any[]> {
        try {
            // Validate userId
            if (!Types.ObjectId.isValid(userId)) {
                throw new BadRequestException('Invalid user ID format');
            }

            // Lấy ngày hôm nay theo timezone Việt Nam (UTC+7)
            const vietnamTime = new Date();
            const vietnamDate = new Date(vietnamTime.toLocaleString("en-US", {timeZone: "Asia/Ho_Chi_Minh"}));
            const todayString = vietnamDate.toISOString().split('T')[0]; // Format: YYYY-MM-DD

            // Bước 1: Kiểm tra user có tồn tại và có role field_owner không
            const user = await this.userModel.findById(userId).select('_id role').exec();
            if (!user) {
                throw new NotFoundException('User not found');
            }
            
            if (user.role !== 'field_owner') {
                throw new UnauthorizedException('User is not a field owner');
            }

            // Bước 2: Tìm FieldOwnerProfile của user này
            const ownerProfile = await this.fieldOwnerProfileModel
                .findOne({ user: new Types.ObjectId(userId) })
                .select('_id facilityName')
                .exec();

            if (!ownerProfile) {
                return [];
            }

            // Bước 3: Tìm tất cả fields của owner profile này
            const ownerFields = await this.fieldModel
                .find({ 
                    owner: ownerProfile._id,
                    isActive: true 
                })
                .select('_id name')
                .exec();

            if (ownerFields.length === 0) {
                return [];
            }

            const fieldIds = ownerFields.map(field => field._id);

            // Bước 4: Tìm tất cả bookings hôm nay cho các sân của owner
            // Sử dụng date range để handle cả Date object và string
            const startOfDay = new Date(todayString + 'T00:00:00.000Z');
            const endOfDay = new Date(todayString + 'T23:59:59.999Z');
            
            const bookingQuery = {
                field: { $in: fieldIds },
                date: { 
                    $gte: startOfDay,
                    $lte: endOfDay
                },
                status: { $in: ['pending', 'confirmed', 'completed'] } // Loại bỏ cancelled
            };

            const todayBookings = await this.bookingModel
                .find(bookingQuery)
                .populate({
                    path: 'field',
                    select: 'name _id'
                })
                .populate({
                    path: 'user',
                    select: 'fullName phone email'
                })
                .populate({
                    path: 'selectedAmenities',
                    select: 'name price'
                })
                .sort({ startTime: 1 }) // Sắp xếp theo thời gian bắt đầu
                .exec();

            // Format dữ liệu trả về
            const formattedBookings = todayBookings.map(booking => ({
                bookingId: booking._id?.toString(),
                fieldId: booking.field?._id?.toString(),
                fieldName: (booking.field as any)?.name || 'Unknown Field',
                date: typeof booking.date === 'string' ? booking.date : booking.date.toISOString().split('T')[0],
                startTime: booking.startTime,
                endTime: booking.endTime,
                status: booking.status,
                totalPrice: booking.totalPrice,
                customer: {
                    fullName: (booking.user as any)?.fullName || 'Unknown',
                    phone: (booking.user as any)?.phone || 'N/A',
                    email: (booking.user as any)?.email || 'N/A'
                },
                selectedAmenities: booking.selectedAmenities?.map((amenity: any) => amenity.name) || [],
                amenitiesFee: booking.amenitiesFee || 0,
                createdAt: booking.createdAt
            }));

            return formattedBookings;

        } catch (error) {
            this.logger.error(`Error getting today bookings for user ${userId}:`, error);
            if (error instanceof BadRequestException || error instanceof NotFoundException || error instanceof UnauthorizedException) {
                throw error;
            }
            throw new InternalServerErrorException('Failed to get today bookings');
        }
    }


    /**
     * Lấy tất cả booking của các sân thuộc field-owner với filter và pagination
     * @param userId - ID của user (từ JWT token)
     * @param filters - Bộ lọc: fieldName, status, startDate, endDate, page, limit
     * @returns Danh sách booking với pagination
     */
    async getAllBookingsByOwner(userId: string, filters: {
        fieldName?: string;
        status?: string;
        startDate?: string;
        endDate?: string;
        page?: number;
        limit?: number;
    }): Promise<{
        bookings: any[];
        pagination: {
            total: number;
            page: number;
            limit: number;
            totalPages: number;
            hasNextPage: boolean;
            hasPrevPage: boolean;
        };
    }> {
        try {

            // Validate userId
            if (!Types.ObjectId.isValid(userId)) {
                throw new BadRequestException('Invalid user ID format');
            }

            // Bước 1: Kiểm tra user có tồn tại và có role field_owner không
            const user = await this.userModel.findById(userId).select('_id role').exec();
            if (!user) {
                throw new NotFoundException('User not found');
            }
            
            if (user.role !== 'field_owner') {
                throw new UnauthorizedException('User is not a field owner');
            }

            // Bước 2: Tìm FieldOwnerProfile của user này
            const ownerProfile = await this.fieldOwnerProfileModel
                .findOne({ user: new Types.ObjectId(userId) })
                .select('_id facilityName')
                .exec();

            if (!ownerProfile) {
                return {
                    bookings: [],
                    pagination: {
                        total: 0,
                        page: filters.page || 1,
                        limit: filters.limit || 10,
                        totalPages: 0,
                        hasNextPage: false,
                        hasPrevPage: false
                    }
                };
            }

            // Bước 3: Tìm tất cả fields của owner profile này
            const fieldFilter: any = { 
                owner: ownerProfile._id,
                isActive: true 
            };

            // Filter theo tên sân nếu có
            if (filters.fieldName) {
                fieldFilter.name = { $regex: filters.fieldName, $options: 'i' };
            }

            const ownerFields = await this.fieldModel
                .find(fieldFilter)
                .select('_id name')
                .exec();

            if (ownerFields.length === 0) {
                return {
                    bookings: [],
                    pagination: {
                        total: 0,
                        page: filters.page || 1,
                        limit: filters.limit || 10,
                        totalPages: 0,
                        hasNextPage: false,
                        hasPrevPage: false
                    }
                };
            }

            const fieldIds = ownerFields.map(field => field._id);

            // Build booking filter
            const bookingFilter: any = {
                field: { $in: fieldIds }
            };

            // Filter theo status nếu có
            if (filters.status) {
                bookingFilter.status = filters.status;
            }

            // Filter theo date range nếu có - sử dụng date range để handle cả Date object và string
            if (filters.startDate || filters.endDate) {
                bookingFilter.date = {};
                if (filters.startDate) {
                    // Convert YYYY-MM-DD to start of day
                    const startDate = new Date(filters.startDate + 'T00:00:00.000Z');
                    bookingFilter.date.$gte = startDate;
                }
                if (filters.endDate) {
                    // Convert YYYY-MM-DD to end of day
                    const endDate = new Date(filters.endDate + 'T23:59:59.999Z');
                    bookingFilter.date.$lte = endDate;
                }
            }

            // Pagination setup
            const page = filters.page || 1;
            const limit = filters.limit || 10;
            const skip = (page - 1) * limit;

            // Get total count
            const total = await this.bookingModel.countDocuments(bookingFilter);

            // Get bookings with population
            const bookings = await this.bookingModel
                .find(bookingFilter)
                .populate({
                    path: 'field',
                    select: 'name _id'
                })
                .populate({
                    path: 'user',
                    select: 'fullName phone email'
                })
                .populate({
                    path: 'selectedAmenities',
                    select: 'name price'
                })
                .sort({ date: -1, startTime: -1 }) // Mới nhất trước, sau đó theo thời gian
                .skip(skip)
                .limit(limit)
                .exec();

            // Format dữ liệu trả về
            const formattedBookings = bookings.map(booking => ({
                bookingId: booking._id?.toString(),
                fieldId: booking.field?._id?.toString(),
                fieldName: (booking.field as any)?.name || 'Unknown Field',
                date: typeof booking.date === 'string' ? booking.date : booking.date.toISOString().split('T')[0],
                startTime: booking.startTime,
                endTime: booking.endTime,
                status: booking.status,
                totalPrice: booking.totalPrice,
                customer: {
                    fullName: (booking.user as any)?.fullName || 'Unknown',
                    phone: (booking.user as any)?.phone || 'N/A',
                    email: (booking.user as any)?.email || 'N/A'
                },
                selectedAmenities: booking.selectedAmenities?.map((amenity: any) => amenity.name) || [],
                amenitiesFee: booking.amenitiesFee || 0,
                createdAt: booking.createdAt
            }));

            const totalPages = Math.ceil(total / limit);

            return {
                bookings: formattedBookings,
                pagination: {
                    total,
                    page,
                    limit,
                    totalPages,
                    hasNextPage: page < totalPages,
                    hasPrevPage: page > 1
                }
            };

        } catch (error) {
            this.logger.error(`Error getting all bookings for user ${userId}:`, error);
            if (error instanceof BadRequestException || error instanceof NotFoundException || error instanceof UnauthorizedException) {
                throw error;
            }
            throw new InternalServerErrorException('Failed to get all bookings');
        }
    }

    /**
     * Find nearby fields within a specified radius (public endpoint)
     * @param latitude User's latitude
     * @param longitude User's longitude
     * @param radius Search radius in kilometers
     * @param limit Maximum number of results
     * @param sportType Optional sport type filter
     * @returns Array of nearby fields with distance information
     */
    async findNearbyFieldsPublic(
        latitude: number, 
        longitude: number, 
        radius: number = 10, // Default 10km radius
        limit: number = 20, // Default 20 results
        sportType?: string
    ): Promise<Array<{
        id: string;
        name: string;
        location: string;
        latitude: number;
        longitude: number;
        distance: number;
        rating: number;
        price: string;
        sportType: string;
        images: string[];
        isActive: boolean;
    }>> {
        try {
            const radiusInMeters = radius * 1000; // Convert km to meters
            
            const filter: any = {
                'location.geo': {
                    $near: {
                        $geometry: {
                            type: 'Point',
                            coordinates: [longitude, latitude]
                        },
                        $maxDistance: radiusInMeters
                    }
                },
                isActive: true
            };

            if (sportType) {
                filter.sportType = new RegExp(`^${sportType}$`, 'i');
            }

            const fields = await this.fieldModel
                .find(filter)
                .limit(limit)
                .lean();

            // Calculate distance and format response for each field
            const fieldsWithDistance = fields.map(field => {
                const distance = this.calculateDistance(
                    latitude,
                    longitude,
                    field.location.geo.coordinates[1], // latitude
                    field.location.geo.coordinates[0]  // longitude
                );

                // Format price as "100k/h" style
                const price = this.formatPrice(field.basePrice);

                return {
                    id: field._id.toString(),
                    name: field.name,
                    location: field.location.address,
                    latitude: field.location.geo.coordinates[1],
                    longitude: field.location.geo.coordinates[0],
                    distance: Math.round(distance * 100) / 100, // Round to 2 decimal places
                    rating: field.rating,
                    price: price,
                    sportType: field.sportType,
                    images: field.images,
                    isActive: field.isActive
                };
            });

            // Sort by distance (closest first)
            return fieldsWithDistance.sort((a, b) => a.distance - b.distance);

        } catch (error) {
            this.logger.error('Error finding nearby fields', error);
            throw new InternalServerErrorException('Failed to find nearby fields');
        }
    }

    /**
     * Find nearby fields within a specified radius
     * @param latitude User's latitude
     * @param longitude User's longitude
     * @param radius Search radius in kilometers
     * @param sportType Optional sport type filter
     * @returns Array of nearby fields with distance information
     */
    async findNearbyFields(
        latitude: number, 
        longitude: number, 
        radius: number = 10, // Default 10km radius
        sportType?: string
    ): Promise<Array<FieldsDto & { distance: number }>> {
        try {
            const radiusInMeters = radius * 1000; // Convert km to meters
            
            const filter: any = {
                'location.geo': {
                    $near: {
                        $geometry: {
                            type: 'Point',
                            coordinates: [longitude, latitude]
                        },
                        $maxDistance: radiusInMeters
                    }
                },
                isActive: true
            };

            if (sportType) {
                filter.sportType = new RegExp(`^${sportType}$`, 'i');
            }

            const fields = await this.fieldModel
                .find(filter)
                .lean();

            // Calculate distance for each field
            const fieldsWithDistance = fields.map(field => {
                const distance = this.calculateDistance(
                    latitude,
                    longitude,
                    field.location.geo.coordinates[1], // latitude
                    field.location.geo.coordinates[0]  // longitude
                );

                return {
                    id: field._id.toString(),
                    owner: field.owner?.toString() || '',
                    name: field.name,
                    sportType: field.sportType,
                    description: field.description,
                    location: field.location,
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
                    distance: Math.round(distance * 100) / 100 // Round to 2 decimal places
                };
            });

            // Sort by distance (closest first)
            return fieldsWithDistance.sort((a, b) => a.distance - b.distance);

        } catch (error) {
            this.logger.error('Error finding nearby fields', error);
            throw new InternalServerErrorException('Failed to find nearby fields');
        }
    }

    async findOne(id: string): Promise<FieldsDto> {
        const field = await this.fieldModel
            .findById(id)
            .exec();

        if (!field) {
            throw new NotFoundException(`Field with ID ${id} not found`);
        }

        // Resolve owner info explicitly (robust against non-populated refs)
        let ownerId = '';
        let ownerName: string | undefined = undefined;
        let ownerPhone: string | undefined = undefined;

        const ownerRef: any = (field as any).owner;
        if (ownerRef) {
            if (ownerRef instanceof Types.ObjectId || typeof ownerRef === 'string') {
                ownerId = ownerRef.toString();
            } else if (ownerRef._id) {
                ownerId = ownerRef._id.toString();
            }
        }

        if (ownerId && Types.ObjectId.isValid(ownerId)) {
            try {
                const profile = await this.fieldOwnerProfileModel
                    .findById(ownerId)
                    .populate({ path: 'user', select: 'fullName phone' })
                    .exec();
                if (profile) {
                    ownerName = profile.facilityName;
                    ownerPhone = profile.contactPhone || (profile as any).user?.phone;
                }
            } catch {}
        }

        // Performance: do not query by user; owner must be FieldOwnerProfile ObjectId

        return {
            id: (field._id as Types.ObjectId).toString(),
            owner: ownerId,
            ownerName,
            ownerPhone,
            name: field.name,
            sportType: field.sportType,
            description: field.description,
            location: field.location,
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
            
            // Validate and normalize location
            const validatedLocation = this.validateAndNormalizeLocation(createFieldDto.location);
            
            // Process amenities if provided
            let amenities: Array<{ amenity: Types.ObjectId; price: number }> = [];
            if (createFieldDto.amenities && createFieldDto.amenities.length > 0) {
                // Validate amenity IDs and prices
                amenities = createFieldDto.amenities.map(amenityDto => {
                    if (!Types.ObjectId.isValid(amenityDto.amenityId)) {
                        throw new BadRequestException(`Invalid amenity ID format: ${amenityDto.amenityId}`);
                    }
                    if (amenityDto.price < 0) {
                        throw new BadRequestException(`Price must be non-negative: ${amenityDto.price}`);
                    }
                    return {
                        amenity: new Types.ObjectId(amenityDto.amenityId),
                        price: amenityDto.price
                    };
                });
            }

            const newField = new this.fieldModel({
                owner: new Types.ObjectId(ownerId),
                name: createFieldDto.name,
                sportType: createFieldDto.sportType,
                description: createFieldDto.description,
                location: validatedLocation,
                images: createFieldDto.images || [],
                operatingHours: createFieldDto.operatingHours,
                slotDuration: createFieldDto.slotDuration,
                minSlots: createFieldDto.minSlots,
                maxSlots: createFieldDto.maxSlots,
                priceRanges: createFieldDto.priceRanges,
                basePrice: createFieldDto.basePrice,
                amenities: amenities,
                isActive: true,
                rating: 0,
                totalReviews: 0,
            });

            const savedField = await newField.save();
            
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
            // Upload images to S3 if files are provided
            let imageUrls: string[] = [];
            if (files && files.length > 0) {
                const uploadPromises = files.map(file => this.awsS3Service.uploadImage(file));
                imageUrls = await Promise.all(uploadPromises);
            }

            // Parse JSON strings from form data
            const operatingHours = JSON.parse(createFieldDto.operatingHours);
            let priceRanges = JSON.parse(createFieldDto.priceRanges);
            const slotDuration = parseInt(createFieldDto.slotDuration);
            const minSlots = parseInt(createFieldDto.minSlots);
            const maxSlots = parseInt(createFieldDto.maxSlots);
            const basePrice = parseInt(createFieldDto.basePrice);
            
            // Parse and validate location from form data
            let location;
            try {
                location = JSON.parse(createFieldDto.location);
            } catch (error) {
                // If location is not JSON, treat it as address string only
                // This is a fallback for backward compatibility
                location = {
                    address: createFieldDto.location,
                    geo: {
                        type: 'Point',
                        coordinates: [0, 0] // Default coordinates - should be updated by user
                    }
                };
            }
            
            const validatedLocation = this.validateAndNormalizeLocation(location);
            
            // Parse amenities if provided
            let amenities: Array<{ amenity: Types.ObjectId; price: number }> = [];
            if (createFieldDto.amenities) {
                try {
                    const amenitiesArray = JSON.parse(createFieldDto.amenities);
                    if (Array.isArray(amenitiesArray) && amenitiesArray.length > 0) {
                        amenities = amenitiesArray.map(amenityDto => {
                            if (!Types.ObjectId.isValid(amenityDto.amenityId)) {
                                throw new BadRequestException(`Invalid amenity ID format: ${amenityDto.amenityId}`);
                            }
                            if (amenityDto.price < 0) {
                                throw new BadRequestException(`Price must be non-negative: ${amenityDto.price}`);
                            }
                            return {
                                amenity: new Types.ObjectId(amenityDto.amenityId),
                                price: amenityDto.price
                            };
                        });
                    }
                } catch (error) {
                    throw new BadRequestException('Invalid amenities JSON format');
                }
            }

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
                location: validatedLocation,
                images: imageUrls,
                operatingHours,
                slotDuration,
                minSlots,
                maxSlots,
                priceRanges,
                basePrice,
                amenities: amenities,
                isActive: true,
                rating: 0,
                totalReviews: 0,
            });

            const savedField = await newField.save();
            
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

            // Process amenities if provided
            let updateData: any = { ...updateFieldDto };
            if (updateFieldDto.amenities !== undefined) {
                if (updateFieldDto.amenities.length > 0) {
                    // Validate amenity IDs and prices
                    const validAmenities = updateFieldDto.amenities.map(amenityDto => {
                        if (!Types.ObjectId.isValid(amenityDto.amenityId)) {
                            throw new BadRequestException(`Invalid amenity ID format: ${amenityDto.amenityId}`);
                        }
                        if (amenityDto.price < 0) {
                            throw new BadRequestException(`Price must be non-negative: ${amenityDto.price}`);
                        }
                        return {
                            amenity: new Types.ObjectId(amenityDto.amenityId),
                            price: amenityDto.price
                        };
                    });
                    updateData.amenities = validAmenities;
                } else {
                    updateData.amenities = [];
                }
            }

            // Validate and normalize location if provided
            if (updateFieldDto.location) {
                updateData.location = this.validateAndNormalizeLocation(updateFieldDto.location);
            }

            const updatedField = await this.fieldModel.findByIdAndUpdate(
                fieldId,
                { $set: updateData },
                { new: true }
            );

            if (!updatedField) {
                throw new NotFoundException('Field not found');
            }

            return {
                id: (updatedField._id as Types.ObjectId).toString(),
                owner: updatedField.owner.toString(),
                name: updatedField.name,
                sportType: updatedField.sportType,
                description: updatedField.description,
                location: updatedField.location,
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


            // Get bookings from Booking collection (Pure Lazy Creation pattern)
            const bookings = await this.bookingModel.find({
                field: new Types.ObjectId(fieldId),
                date: {
                    $gte: startOfDay,
                    $lte: endOfDay
                },
                status: { $in: ['confirmed', 'pending'] } // Include both confirmed and pending bookings
            }).exec();

            // Also check Schedule collection for legacy booked slots
            const schedule = await this.scheduleModel.findOne({
                field: new Types.ObjectId(fieldId),
                date: {
                    $gte: startOfDay,
                    $lte: endOfDay
                }
            }).exec();

            const scheduleSlots = schedule?.bookedSlots || [];

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
    // LOCATION HELPER METHODS
    // ============================================================================

    /**
     * Calculate distance between two coordinates using Haversine formula
     * @param lat1 First point latitude
     * @param lon1 First point longitude
     * @param lat2 Second point latitude
     * @param lon2 Second point longitude
     * @returns Distance in kilometers
     */
    private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
        const R = 6371; // Earth's radius in kilometers
        const dLat = this.deg2rad(lat2 - lat1);
        const dLon = this.deg2rad(lon2 - lon1);
        const a = 
            Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(this.deg2rad(lat1)) * Math.cos(this.deg2rad(lat2)) * 
            Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        const distance = R * c; // Distance in kilometers
        return distance;
    }

    /**
     * Convert degrees to radians
     */
    private deg2rad(deg: number): number {
        return deg * (Math.PI/180);
    }

    /**
     * Format price in Vietnamese style (e.g., "100k/h", "1.5tr/h")
     * @param price Price in VND
     * @returns Formatted price string
     */
    private formatPrice(price: number): string {
        if (price >= 1000000) {
            const millions = price / 1000000;
            return `${millions.toFixed(1)}tr/h`;
        } else if (price >= 1000) {
            const thousands = price / 1000;
            return `${thousands}k/h`;
        } else {
            return `${price}/h`;
        }
    }

    /**
     * Validate location coordinates
     * @param latitude Latitude value
     * @param longitude Longitude value
     * @returns Validation result
     */
    private validateCoordinates(latitude: number, longitude: number): { isValid: boolean; error?: string } {
        if (typeof latitude !== 'number' || typeof longitude !== 'number') {
            return { isValid: false, error: 'Latitude and longitude must be numbers' };
        }

        if (latitude < -90 || latitude > 90) {
            return { isValid: false, error: 'Latitude must be between -90 and 90 degrees' };
        }

        if (longitude < -180 || longitude > 180) {
            return { isValid: false, error: 'Longitude must be between -180 and 180 degrees' };
        }

        return { isValid: true };
    }

    /**
     * Validate and normalize location data
     * @param location Location object
     * @returns Normalized location object
     */
    private validateAndNormalizeLocation(location: any): { 
        address: string; 
        geo: { type: 'Point'; coordinates: [number, number] } 
    } {
        if (!location) {
            throw new BadRequestException('Location is required');
        }

        if (!location.address || typeof location.address !== 'string') {
            throw new BadRequestException('Location address is required and must be a string');
        }

        if (!location.geo || !location.geo.coordinates) {
            throw new BadRequestException('Location coordinates are required');
        }

        const [longitude, latitude] = location.geo.coordinates;
        const validation = this.validateCoordinates(latitude, longitude);
        
        if (!validation.isValid) {
            throw new BadRequestException(validation.error);
        }

        return {
            address: location.address.trim(),
            geo: {
                type: 'Point',
                coordinates: [longitude, latitude]
            }
        };
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
        } else {
            this.fieldConfigCache.clear();
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

    // ============================================================================
    // AMENITIES OPERATIONS
    // ============================================================================

    /**
     * Get field amenities with populated data
     */
    async getFieldAmenities(fieldId: string) {
        const field = await this.fieldModel
            .findById(fieldId)
            .populate('amenities.amenity', 'name description sportType isActive imageUrl type')
            .lean();

        if (!field) {
            throw new NotFoundException(`Field with ID ${fieldId} not found`);
        }

        return {
            fieldId: field._id.toString(),
            fieldName: field.name,
            amenities: field.amenities || []
        };
    }



    /**
     * Update field amenities (replace all)
     */
    async updateFieldAmenities(fieldId: string, amenitiesData: Array<{ amenityId: string; price: number }>, ownerId: string) {
        // Verify field exists and user is owner
        const field = await this.fieldModel.findById(fieldId);
        if (!field) {
            throw new NotFoundException(`Field with ID ${fieldId} not found`);
        }

        if (field.owner.toString() !== ownerId) {
            throw new UnauthorizedException('Access denied. Field owner only.');
        }

        // Validate amenities data
        if (!Array.isArray(amenitiesData)) {
            throw new BadRequestException('Amenities data must be an array');
        }

        // Convert to ObjectIds and validate format
        const validAmenities = amenitiesData.map(amenityData => {
            if (!Types.ObjectId.isValid(amenityData.amenityId)) {
                throw new BadRequestException(`Invalid amenity ID format: ${amenityData.amenityId}`);
            }
            if (amenityData.price < 0) {
                throw new BadRequestException(`Price must be non-negative: ${amenityData.price}`);
            }
            return {
                amenity: new Types.ObjectId(amenityData.amenityId),
                price: amenityData.price
            };
        });

        // Update field amenities
        const updatedField = await this.fieldModel.findByIdAndUpdate(
            fieldId,
            { amenities: validAmenities },
            { new: true }
        ).populate('amenities.amenity', 'name description sportType isActive imageUrl type');

        if (!updatedField) {
            throw new NotFoundException(`Field with ID ${fieldId} not found`);
        }

        // Clear cache for this field
        this.clearCache(fieldId);

        return {
            success: true,
            message: `Updated field amenities`,
            field: {
                id: (updatedField._id as Types.ObjectId).toString(),
                name: updatedField.name,
                amenities: updatedField.amenities
            }
        };
    }

    // ============================================================================
    // FIELD OWNER PROFILE OPERATIONS
    // ============================================================================

    /**
     * Tạo FieldOwnerProfile mới
     * @param userId - ID của user
     * @param createDto - Dữ liệu tạo profile
     * @returns FieldOwnerProfileDto
     */
    async createFieldOwnerProfile(userId: string, createDto: CreateFieldOwnerProfileDto): Promise<FieldOwnerProfileDto> {
        try {
            // Kiểm tra xem user đã có profile chưa
            const existingProfile = await this.fieldOwnerProfileModel.findOne({ user: new Types.ObjectId(userId) }).exec();
            if (existingProfile) {
                throw new BadRequestException('User already has a field owner profile');
            }

            // Tạo profile mới
            const newProfile = new this.fieldOwnerProfileModel({
                user: new Types.ObjectId(userId),
                facilityName: createDto.facilityName,
                facilityLocation: createDto.facilityLocation,
                supportedSports: createDto.supportedSports,
                description: createDto.description,
                amenities: createDto.amenities || [],
                verificationDocument: createDto.verificationDocument,
                businessHours: createDto.businessHours,
                contactPhone: createDto.contactPhone,
                website: createDto.website,
                rating: 0,
                totalReviews: 0,
                isVerified: false,
            });

            const savedProfile = await newProfile.save();

            // Populate user info
            const populatedProfile = await this.fieldOwnerProfileModel
                .findById(savedProfile._id)
                .populate('user', 'fullName phone email')
                .exec();

            return this.mapToFieldOwnerProfileDto(populatedProfile);

        } catch (error) {
            if (error instanceof BadRequestException) {
                throw error;
            }
            this.logger.error('Error creating field owner profile', error);
            throw new InternalServerErrorException('Failed to create field owner profile');
        }
    }

    /**
     * Lấy FieldOwnerProfile theo user ID
     * @param userId - ID của user
     * @returns FieldOwnerProfileDto hoặc null
     */
    async getFieldOwnerProfileByUserId(userId: string): Promise<FieldOwnerProfileDto | null> {
        try {
            const profile = await this.fieldOwnerProfileModel
                .findOne({ user: new Types.ObjectId(userId) })
                .populate('user', 'fullName phone email')
                .exec();

            if (!profile) {
                return null;
            }

            return this.mapToFieldOwnerProfileDto(profile);

        } catch (error) {
            this.logger.error('Error getting field owner profile by user ID', error);
            throw new InternalServerErrorException('Failed to get field owner profile');
        }
    }

    /**
     * Lấy FieldOwnerProfile theo profile ID
     * @param profileId - ID của profile
     * @returns FieldOwnerProfileDto
     */
    async getFieldOwnerProfile(profileId: string): Promise<FieldOwnerProfileDto> {
        try {
            const profile = await this.fieldOwnerProfileModel
                .findById(profileId)
                .populate('user', 'fullName phone email')
                .exec();

            if (!profile) {
                throw new NotFoundException('Field owner profile not found');
            }

            return this.mapToFieldOwnerProfileDto(profile);

        } catch (error) {
            if (error instanceof NotFoundException) {
                throw error;
            }
            this.logger.error('Error getting field owner profile', error);
            throw new InternalServerErrorException('Failed to get field owner profile');
        }
    }

    /**
     * Cập nhật FieldOwnerProfile
     * @param userId - ID của user (để verify quyền sở hữu)
     * @param updateDto - Dữ liệu cập nhật
     * @returns FieldOwnerProfileDto
     */
    async updateFieldOwnerProfile(userId: string, updateDto: UpdateFieldOwnerProfileDto): Promise<FieldOwnerProfileDto> {
        try {
            // Tìm profile của user
            const profile = await this.fieldOwnerProfileModel
                .findOne({ user: new Types.ObjectId(userId) })
                .exec();

            if (!profile) {
                throw new NotFoundException('Field owner profile not found');
            }

            // Cập nhật dữ liệu
            const updateData: any = {};
            if (updateDto.facilityName !== undefined) updateData.facilityName = updateDto.facilityName;
            if (updateDto.facilityLocation !== undefined) updateData.facilityLocation = updateDto.facilityLocation;
            if (updateDto.supportedSports !== undefined) updateData.supportedSports = updateDto.supportedSports;
            if (updateDto.description !== undefined) updateData.description = updateDto.description;
            if (updateDto.amenities !== undefined) updateData.amenities = updateDto.amenities;
            if (updateDto.verificationDocument !== undefined) updateData.verificationDocument = updateDto.verificationDocument;
            if (updateDto.businessHours !== undefined) updateData.businessHours = updateDto.businessHours;
            if (updateDto.contactPhone !== undefined) updateData.contactPhone = updateDto.contactPhone;
            if (updateDto.website !== undefined) updateData.website = updateDto.website;

            const updatedProfile = await this.fieldOwnerProfileModel
                .findByIdAndUpdate(profile._id, { $set: updateData }, { new: true })
                .populate('user', 'fullName phone email')
                .exec();

            if (!updatedProfile) {
                throw new NotFoundException('Field owner profile not found');
            }

            return this.mapToFieldOwnerProfileDto(updatedProfile);

        } catch (error) {
            if (error instanceof NotFoundException) {
                throw error;
            }
            this.logger.error('Error updating field owner profile', error);
            throw new InternalServerErrorException('Failed to update field owner profile');
        }
    }

    /**
     * Helper method để map FieldOwnerProfile entity sang DTO
     */
    private mapToFieldOwnerProfileDto(profile: any): FieldOwnerProfileDto {
        return {
            id: profile._id.toString(),
            user: profile.user._id?.toString() || profile.user.toString(),
            facilityName: profile.facilityName,
            facilityLocation: profile.facilityLocation,
            supportedSports: profile.supportedSports,
            description: profile.description,
            amenities: profile.amenities,
            rating: profile.rating,
            totalReviews: profile.totalReviews,
            isVerified: profile.isVerified,
            verificationDocument: profile.verificationDocument,
            businessHours: profile.businessHours,
            contactPhone: profile.contactPhone,
            website: profile.website,
            createdAt: profile.createdAt,
            updatedAt: profile.updatedAt,
        };
    }
}
