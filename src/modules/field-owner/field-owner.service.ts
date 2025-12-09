import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnauthorizedException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Field } from '../fields/entities/field.entity';
import { FieldOwnerProfile } from './entities/field-owner-profile.entity';
import {
  FieldOwnerRegistrationRequest,
} from './entities/field-owner-registration-request.entity';
import { RegistrationStatus } from '@common/enums/field-owner-registration.enum';
import { BankAccount } from './entities/bank-account.entity';
import { BankAccountStatus } from '@common/enums/bank-account.enum';
import {
  FieldsDto,
  CreateFieldDto,
  UpdateFieldDto,
  CreateFieldWithFilesDto,
  OwnerFieldsResponseDto,
} from '../fields/dtos/fields.dto';
import {
  FieldOwnerProfileDto,
  CreateFieldOwnerProfileDto,
  UpdateFieldOwnerProfileDto,
} from './dtos/field-owner-profile.dto';
import {
  CreateFieldOwnerRegistrationDto,
  FieldOwnerRegistrationResponseDto,
  ApproveFieldOwnerRegistrationDto,
  RejectFieldOwnerRegistrationDto,
} from './dtos/field-owner-registration.dto';
import {
  CreateBankAccountDto,
  UpdateBankAccountDto,
  BankAccountResponseDto,
} from './dtos/bank-account.dto';
import { AwsS3Service } from '../../service/aws-s3.service';
import type { IFile } from '../../interfaces/file.interface';
import { Booking } from '../bookings/entities/booking.entity';
import { User } from '../users/entities/user.entity';
import { UserRole } from '@common/enums/user.enum';
import { PriceFormatService } from '../../service/price-format.service';
import { Transaction } from '../transactions/entities/transaction.entity';
import { TransactionStatus, TransactionType } from '@common/enums/transaction.enum';
import { PayOSService } from '../transactions/payos.service';
import { EmailService } from '../email/email.service';
import { FieldsService } from '../fields/fields.service';
import { CreatePayOSUrlDto } from '../transactions/dto/payos.dto';
import { generatePayOSOrderCode } from '../transactions/utils/payos.utils';
import { PaymentMethod } from 'src/common/enums/payment-method.enum';
import { Court } from '../courts/entities/court.entity';

@Injectable()
export class FieldOwnerService {
  private readonly logger = new Logger(FieldOwnerService.name);

  constructor(
    @InjectModel(Field.name) private readonly fieldModel: Model<Field>,
    @InjectModel(FieldOwnerProfile.name) private readonly fieldOwnerProfileModel: Model<FieldOwnerProfile>,
    @InjectModel(FieldOwnerRegistrationRequest.name)
    private readonly registrationRequestModel: Model<FieldOwnerRegistrationRequest>,
    @InjectModel(BankAccount.name) private readonly bankAccountModel: Model<BankAccount>,
    @InjectModel(Booking.name) private readonly bookingModel: Model<Booking>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(Transaction.name) private readonly transactionModel: Model<Transaction>,
    @InjectModel(Court.name) private readonly courtModel: Model<Court>,
    private readonly priceFormatService: PriceFormatService,
    private readonly awsS3Service: AwsS3Service,
    private readonly payosService: PayOSService,
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => FieldsService))
    private readonly fieldsService: FieldsService,
  ) {}

  async findByOwner(
    ownerId: string,
    query?: {
      name?: string;
      sportType?: string;
      isActive?: boolean;
      page?: number;
      limit?: number;
    },
  ): Promise<OwnerFieldsResponseDto> {
    try {
      const filter: any = {
        owner: new Types.ObjectId(ownerId),
      };

      if (query?.name) {
        filter.name = { $regex: query.name, $options: 'i' };
      }
      if (query?.sportType) {
        filter.sportType = new RegExp(`^${query.sportType}$`, 'i');
      }
      if (query?.isActive !== undefined) {
        filter.isActive = query.isActive;
      }

      const user = await this.userModel.findById(ownerId).exec();
      if (user) {
        const userFieldOwnerProfile = await this.fieldOwnerProfileModel
          .findOne({ user: new Types.ObjectId(ownerId) })
          .exec();

        if (userFieldOwnerProfile) {
          filter.owner = userFieldOwnerProfile._id;
        }
      }

      const page = query?.page || 1;
      const limit = query?.limit || 10;
      const skip = (page - 1) * limit;

      const total = await this.fieldModel.countDocuments(filter);

      const fields = await this.fieldModel
        .find(filter)
        .populate({
          path: 'owner',
          select: 'user businessName businessRegistration contactInfo',
        })
        .populate('amenities.amenity', 'name')
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .exec();

      const totalPages = Math.ceil(total / limit);

      const fieldsDto: FieldsDto[] = fields.map((field) => {
        const price = this.priceFormatService.formatPrice(field.basePrice);

        const validImages = (field.images || []).filter((img: string) => {
          if (!img || typeof img !== 'string') return false;
          if (img.includes('placeholder') || img.includes('placehold.co')) {
            return false;
          }
          return img.trim().length > 0;
        });

        return {
          id: field._id?.toString() || '',
          owner: (field.owner as any)?._id?.toString() || field.owner?.toString() || '',
          name: field.name,
          sportType: field.sportType,
          description: field.description,
          location: field.location,
          images: validImages,
          amenities: Array.isArray((field as any).amenities)
            ? (field as any).amenities
                .filter((a: any) => a && a.amenity)
                .map((a: any) => ({
                  amenityId: (a.amenity._id as Types.ObjectId).toString(),
                  name: a.amenity.name,
                  price: a.price ?? 0,
                }))
            : [],
          operatingHours: field.operatingHours,
          slotDuration: field.slotDuration,
          minSlots: field.minSlots,
          maxSlots: field.maxSlots,
          priceRanges: field.priceRanges,
          basePrice: field.basePrice,
          price,
          isActive: field.isActive,
          isAdminVerify: field.isAdminVerify ?? false,
          maintenanceNote: field.maintenanceNote,
          maintenanceUntil: field.maintenanceUntil,
          rating: field.rating,
          totalReviews: field.totalReviews,
          createdAt: field.createdAt,
          updatedAt: field.updatedAt,
        };
      });

      return {
        fields: fieldsDto,
        pagination: {
          total,
          page,
          limit,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
      };
    } catch (error) {
      this.logger.error(`Error getting fields for owner ${ownerId}:`, error);
      throw new InternalServerErrorException('Failed to get owner fields');
    }
  }

  async getTodayBookingsByOwner(userId: string): Promise<any[]> {
    try {
      if (!Types.ObjectId.isValid(userId)) {
        throw new BadRequestException('Invalid user ID format');
      }

      const vietnamTime = new Date();
      const vietnamDate = new Date(
        vietnamTime.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }),
      );
      const todayString = vietnamDate.toISOString().split('T')[0];

      const user = await this.userModel.findById(userId).select('_id role').exec();
      if (!user) {
        throw new NotFoundException('User not found');
      }

      if (user.role !== 'field_owner') {
        throw new UnauthorizedException('User is not a field owner');
      }

      const ownerProfile = await this.fieldOwnerProfileModel
        .findOne({ user: new Types.ObjectId(userId) })
        .select('_id facilityName')
        .exec();

      if (!ownerProfile) {
        return [];
      }

      const ownerFields = await this.fieldModel
        .find({
          owner: ownerProfile._id,
          isActive: true,
        })
        .select('_id name')
        .exec();

      if (ownerFields.length === 0) {
        return [];
      }

      const fieldIds = ownerFields.map((field) => field._id);

      const startOfDay = new Date(todayString + 'T00:00:00.000Z');
      const endOfDay = new Date(todayString + 'T23:59:59.999Z');

      const bookingQuery = {
        field: { $in: fieldIds },
        date: {
          $gte: startOfDay,
          $lte: endOfDay,
        },
        status: { $in: ['pending', 'confirmed', 'completed'] },
      };

      const todayBookings = await this.bookingModel
        .find(bookingQuery)
        .populate({
          path: 'field',
          select: 'name _id',
        })
        .populate({
          path: 'user',
          select: 'fullName phone email',
        })
        .populate({
          path: 'selectedAmenities',
          select: 'name price',
        })
        .sort({ startTime: 1 })
        .exec();

      return todayBookings.map((booking) => ({
        bookingId: booking._id?.toString(),
        fieldId: booking.field?._id?.toString(),
        fieldName: (booking.field as any)?.name || 'Unknown Field',
        date:
          typeof booking.date === 'string'
            ? booking.date
            : booking.date.toISOString().split('T')[0],
        startTime: booking.startTime,
        endTime: booking.endTime,
        status: booking.status,
        totalPrice: booking.totalPrice,
        customer: {
          fullName: (booking.user as any)?.fullName || 'Unknown',
          phone: (booking.user as any)?.phone || 'N/A',
          email: (booking.user as any)?.email || 'N/A',
        },
        selectedAmenities: booking.selectedAmenities?.map((amenity: any) => amenity.name) || [],
        amenitiesFee: booking.amenitiesFee || 0,
        createdAt: booking.createdAt,
      }));
    } catch (error) {
      this.logger.error(`Error getting today bookings for user ${userId}:`, error);
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException ||
        error instanceof UnauthorizedException
      ) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to get today bookings');
    }
  }

  async getAllBookingsByOwner(
    userId: string,
    filters: {
      fieldName?: string;
      status?: string;
      transactionStatus?: string;
      startDate?: string;
      endDate?: string;
      page?: number;
      limit?: number;
    },
  ) {
    try {
      if (!Types.ObjectId.isValid(userId)) {
        throw new BadRequestException('Invalid user ID format');
      }

      const user = await this.userModel.findById(userId).select('_id role').exec();
      if (!user) {
        throw new NotFoundException('User not found');
      }

      if (user.role !== 'field_owner') {
        throw new UnauthorizedException('User is not a field owner');
      }

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
            hasPrevPage: false,
          },
        };
      }

      const fieldFilter: any = {
        owner: ownerProfile._id,
        isActive: true,
      };

      if (filters.fieldName) {
        fieldFilter.name = { $regex: filters.fieldName, $options: 'i' };
      }

      const ownerFields = await this.fieldModel.find(fieldFilter).select('_id name').exec();
      if (ownerFields.length === 0) {
        return {
          bookings: [],
          pagination: {
            total: 0,
            page: filters.page || 1,
            limit: filters.limit || 10,
            totalPages: 0,
            hasNextPage: false,
            hasPrevPage: false,
          },
        };
      }

      const fieldIds = ownerFields.map((field) => field._id);

      const bookingFilter: any = {
        field: { $in: fieldIds },
      };

      if (filters.status) {
        bookingFilter.status = filters.status;
      }

      if (filters.startDate || filters.endDate) {
        bookingFilter.date = {};
        if (filters.startDate) {
          const startDate = new Date(filters.startDate + 'T00:00:00.000Z');
          bookingFilter.date.$gte = startDate;
        }
        if (filters.endDate) {
          const endDate = new Date(filters.endDate + 'T23:59:59.999Z');
          bookingFilter.date.$lte = endDate;
        }
      }

      if (filters.transactionStatus) {
        const transactions = await this.transactionModel
          .find({ status: filters.transactionStatus })
          .select('_id')
          .lean()
          .exec();

        const transactionIds = transactions.map((t) => t._id);
        if (transactionIds.length > 0) {
          bookingFilter.transaction = { $in: transactionIds };
        } else {
          return {
            bookings: [],
            pagination: {
              total: 0,
              page: filters.page || 1,
              limit: filters.limit || 10,
              totalPages: 0,
              hasNextPage: false,
              hasPrevPage: false,
            },
          };
        }
      }

      const page = filters.page || 1;
      const limit = filters.limit || 10;
      const skip = (page - 1) * limit;

      const total = await this.bookingModel.countDocuments(bookingFilter);

      const bookings = await this.bookingModel
        .find(bookingFilter)
        .populate({
          path: 'field',
          select: 'name _id',
        })
        .populate({
          path: 'user',
          select: 'fullName phone email',
        })
        .populate({
          path: 'selectedAmenities',
          select: 'name price',
        })
        .populate({
          path: 'transaction',
          select: 'status',
        })
        .sort({ date: -1, startTime: -1 })
        .skip(skip)
        .limit(limit)
        .exec();

      const formattedBookings = bookings.map((booking) => ({
        bookingId: booking._id?.toString(),
        fieldId: booking.field?._id?.toString(),
        fieldName: (booking.field as any)?.name || 'Unknown Field',
        date:
          typeof booking.date === 'string'
            ? booking.date
            : booking.date.toISOString().split('T')[0],
        startTime: booking.startTime,
        endTime: booking.endTime,
        status: booking.status,
        transactionStatus: (booking.transaction as any)?.status || null,
        totalPrice: booking.totalPrice,
        customer: {
          fullName: (booking.user as any)?.fullName || 'Unknown',
          phone: (booking.user as any)?.phone || 'N/A',
          email: (booking.user as any)?.email || 'N/A',
        },
        selectedAmenities: booking.selectedAmenities?.map((amenity: any) => amenity.name) || [],
        amenitiesFee: booking.amenitiesFee || 0,
        createdAt: booking.createdAt,
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
          hasPrevPage: page > 1,
        },
      };
    } catch (error) {
      this.logger.error(`Error getting all bookings for user ${userId}:`, error);
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException ||
        error instanceof UnauthorizedException
      ) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to get all bookings');
    }
  }

  async create(createFieldDto: CreateFieldDto, ownerId: string): Promise<FieldsDto> {
    try {
      const validatedLocation = this.validateAndNormalizeLocation(createFieldDto.location);

      let amenities: Array<{ amenity: Types.ObjectId; price: number }> = [];
      if (createFieldDto.amenities && createFieldDto.amenities.length > 0) {
        amenities = createFieldDto.amenities.map((amenityDto) => {
          if (!Types.ObjectId.isValid(amenityDto.amenityId)) {
            throw new BadRequestException(`Invalid amenity ID format: ${amenityDto.amenityId}`);
          }
          if (amenityDto.price < 0) {
            throw new BadRequestException(`Price must be non-negative: ${amenityDto.price}`);
          }
          return {
            amenity: new Types.ObjectId(amenityDto.amenityId),
            price: amenityDto.price,
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
        amenities,
        isActive: true,
        rating: 0,
        totalReviews: 0,
      });

      const savedField = await newField.save();

      // Create courts if numberOfCourts is specified and > 0
      const numberOfCourts = createFieldDto.numberOfCourts ?? 1;
      if (numberOfCourts > 0) {
        try {
          const fieldId = (savedField._id as Types.ObjectId).toString();
          const fieldName = savedField.name;
          
          // Prepare pricing override from field's basePrice and priceRanges
          const pricingOverride = {
            basePrice: savedField.basePrice,
            priceRanges: savedField.priceRanges || [],
          };

          // Create courts
          const courtPromises = [];
          for (let i = 1; i <= numberOfCourts; i++) {
            const courtName = `${fieldName} - Court ${i}`;
            courtPromises.push(
              this.courtModel.create({
                field: savedField._id,
                name: courtName,
                courtNumber: i,
                pricingOverride,
                isActive: true,
              })
            );
          }

          await Promise.all(courtPromises);
          this.logger.log(`Successfully created ${numberOfCourts} court(s) for field ${fieldId}`);
        } catch (courtError) {
          // Log error but don't fail the field creation
          this.logger.error(`Failed to create courts for field ${savedField._id}:`, courtError);
          // Field is already created, so we continue
        }
      }

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
        isAdminVerify: savedField.isAdminVerify ?? false,
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

  async createWithFiles(
    createFieldDto: CreateFieldWithFilesDto,
    files: IFile[],
    ownerId: string,
  ): Promise<FieldsDto> {
    try {
      let imageUrls: string[] = [];
      if (files && files.length > 0) {
        const uploadPromises = files.map((file) =>
          this.awsS3Service.uploadImageFromBuffer(file.buffer, file.mimetype),
        );
        imageUrls = await Promise.all(uploadPromises);
      }

      const operatingHours = JSON.parse(createFieldDto.operatingHours);
      let priceRanges = JSON.parse(createFieldDto.priceRanges);
      const slotDuration = parseInt(createFieldDto.slotDuration);
      const minSlots = parseInt(createFieldDto.minSlots);
      const maxSlots = parseInt(createFieldDto.maxSlots);
      const basePrice = parseInt(createFieldDto.basePrice);

      let location;
      try {
        location = JSON.parse(createFieldDto.location);
      } catch {
        location = {
          address: createFieldDto.location,
          geo: {
            type: 'Point',
            coordinates: [0, 0],
          },
        };
      }

      const validatedLocation = this.validateAndNormalizeLocation(location);

      let amenities: Array<{ amenity: Types.ObjectId; price: number }> = [];
      if (createFieldDto.amenities) {
        try {
          const amenitiesArray = JSON.parse(createFieldDto.amenities);
          if (Array.isArray(amenitiesArray) && amenitiesArray.length > 0) {
            amenities = amenitiesArray.map((amenityDto) => {
              if (!Types.ObjectId.isValid(amenityDto.amenityId)) {
                throw new BadRequestException(`Invalid amenity ID format: ${amenityDto.amenityId}`);
              }
              if (amenityDto.price < 0) {
                throw new BadRequestException(`Price must be non-negative: ${amenityDto.price}`);
              }
              return {
                amenity: new Types.ObjectId(amenityDto.amenityId),
                price: amenityDto.price,
              };
            });
          }
        } catch {
          throw new BadRequestException('Invalid amenities JSON format');
        }
      }

      if (!Array.isArray(operatingHours) || operatingHours.length === 0) {
        throw new BadRequestException('Invalid operating hours format - must be array of day objects');
      }

      const validDays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
      for (const dayHours of operatingHours) {
        if (!validDays.includes(dayHours.day)) {
          throw new BadRequestException(`Invalid day: ${dayHours.day}`);
        }
        if (!dayHours.start || !dayHours.end || !dayHours.duration) {
          throw new BadRequestException(
            `Invalid operating hours for ${dayHours.day} - missing start, end, or duration`,
          );
        }
      }

      if (priceRanges && Array.isArray(priceRanges) && priceRanges.length > 0) {
        for (const range of priceRanges) {
          if (!validDays.includes(range.day)) {
            throw new BadRequestException(`Invalid day in price range: ${range.day}`);
          }
          if (!range.start || !range.end || range.multiplier === undefined) {
            throw new BadRequestException(
              `Invalid price range for ${range.day} - missing start, end, or multiplier`,
            );
          }
        }

        for (const dayHours of operatingHours) {
          const dayRanges = priceRanges.filter((pr: any) => pr.day === dayHours.day);
          if (dayRanges.length === 0) {
            priceRanges.push({
              day: dayHours.day,
              start: dayHours.start,
              end: dayHours.end,
              multiplier: 1.0,
            });
          }
        }
      } else {
        priceRanges = operatingHours.map((dayHours: any) => ({
          day: dayHours.day,
          start: dayHours.start,
          end: dayHours.end,
          multiplier: 1.0,
        }));
      }

      if (isNaN(slotDuration) || isNaN(minSlots) || isNaN(maxSlots) || isNaN(basePrice)) {
        throw new BadRequestException('Invalid numeric values');
      }

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
        amenities,
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
        isAdminVerify: savedField.isAdminVerify ?? false,
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

      if (field.owner.toString() !== ownerId) {
        throw new UnauthorizedException('Only field owner can update field information');
      }

      const updateData: any = { ...updateFieldDto };
      if (updateFieldDto.amenities !== undefined) {
        if (updateFieldDto.amenities.length > 0) {
          const validAmenities = updateFieldDto.amenities.map((amenityDto) => {
            if (!Types.ObjectId.isValid(amenityDto.amenityId)) {
              throw new BadRequestException(`Invalid amenity ID format: ${amenityDto.amenityId}`);
            }
            if (amenityDto.price < 0) {
              throw new BadRequestException(`Price must be non-negative: ${amenityDto.price}`);
            }
            return {
              amenity: new Types.ObjectId(amenityDto.amenityId),
              price: amenityDto.price,
            };
          });
          updateData.amenities = validAmenities;
        } else {
          updateData.amenities = [];
        }
      }

      if (updateFieldDto.location) {
        updateData.location = this.validateAndNormalizeLocation(updateFieldDto.location);
      }

      const updatedField = await this.fieldModel.findByIdAndUpdate(
        fieldId,
        { $set: updateData },
        { new: true },
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
        isAdminVerify: updatedField.isAdminVerify ?? false,
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

      if (field.owner.toString() !== ownerId) {
        throw new UnauthorizedException('Only field owner can delete field');
      }

      await this.fieldModel.findByIdAndDelete(fieldId);

      return {
        success: true,
        message: 'Field deleted successfully',
      };
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof UnauthorizedException) {
        throw error;
      }
      this.logger.error('Error deleting field', error);
      throw new InternalServerErrorException('Failed to delete field');
    }
  }

  async schedulePriceUpdate(
    fieldId: string,
    newOperatingHours: { day: string; start: string; end: string; duration: number }[],
    newPriceRanges: { day: string; start: string; end: string; multiplier: number }[],
    newBasePrice: number,
    effectiveDate: Date,
    ownerId: string,
  ) {
    const field = await this.fieldModel.findById(fieldId);
    if (!field) {
      throw new NotFoundException(`Field with ID ${fieldId} not found`);
    }

    if (field.owner.toString() !== ownerId) {
      throw new UnauthorizedException('You are not the owner of this field');
    }

    // ✅ CRITICAL: Use UTC methods to normalize date
    const effectiveDateMidnight = new Date(effectiveDate);
    effectiveDateMidnight.setUTCHours(0, 0, 0, 0);

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    if (effectiveDateMidnight <= today) {
      throw new BadRequestException('effectiveDate must be in the future (after today)');
    }

    if (!field.pendingPriceUpdates) {
      field.pendingPriceUpdates = [];
    }

    field.pendingPriceUpdates = field.pendingPriceUpdates.filter(
      (u) =>
        !(
          u.effectiveDate &&
          new Date(u.effectiveDate).getTime() === effectiveDateMidnight.getTime() &&
          !u.applied
        ),
    );

    field.pendingPriceUpdates.push({
      newOperatingHours,
      newPriceRanges,
      newBasePrice,
      effectiveDate: effectiveDateMidnight,
      applied: false,
      createdBy: new Types.ObjectId(ownerId),
    });

    await field.save();
    this.fieldsService.clearCache(fieldId);
    return { success: true };
  }

  async cancelScheduledPriceUpdate(fieldId: string, effectiveDate: Date): Promise<boolean> {
    const field = await this.fieldModel.findById(fieldId);
    if (!field) return false;

    // ✅ CRITICAL: Use UTC methods to normalize date
    const effectiveDateMidnight = new Date(effectiveDate);
    effectiveDateMidnight.setUTCHours(0, 0, 0, 0);

    if (!field.pendingPriceUpdates) {
      field.pendingPriceUpdates = [];
    }

    const before = field.pendingPriceUpdates.length;
    field.pendingPriceUpdates = field.pendingPriceUpdates.filter(
      (u) =>
        new Date(u.effectiveDate).getTime() !== effectiveDateMidnight.getTime() || u.applied,
    );
    await field.save();
    const after = field.pendingPriceUpdates.length;

    if (after < before) {
      this.fieldsService.clearCache(fieldId);
    }

    return after < before;
  }

  async getScheduledPriceUpdates(fieldId: string) {
    const field = await this.fieldModel.findById(fieldId).lean();
    return (
      field?.pendingPriceUpdates
        ?.filter((u) => !u.applied)
        .sort(
          (a, b) => new Date(a.effectiveDate).getTime() - new Date(b.effectiveDate).getTime(),
        ) || []
    );
  }

  async updateFieldAmenities(
    fieldId: string,
    amenitiesData: Array<{ amenityId: string; price: number }>,
    ownerId: string,
  ) {
    const field = await this.fieldModel.findById(fieldId);
    if (!field) {
      throw new NotFoundException(`Field with ID ${fieldId} not found`);
    }

    if (field.owner.toString() !== ownerId) {
      throw new UnauthorizedException('Access denied. Field owner only.');
    }

    if (!Array.isArray(amenitiesData)) {
      throw new BadRequestException('Amenities data must be an array');
    }

    const validAmenities = amenitiesData.map((amenityData) => {
      if (!Types.ObjectId.isValid(amenityData.amenityId)) {
        throw new BadRequestException(`Invalid amenity ID format: ${amenityData.amenityId}`);
      }
      if (amenityData.price < 0) {
        throw new BadRequestException(`Price must be non-negative: ${amenityData.price}`);
      }
      return {
        amenity: new Types.ObjectId(amenityData.amenityId),
        price: amenityData.price,
      };
    });

    const updatedField = await this.fieldModel
      .findByIdAndUpdate(
        fieldId,
        { amenities: validAmenities },
        { new: true },
      )
      .populate('amenities.amenity', 'name description sportType isActive imageUrl type');

    if (!updatedField) {
      throw new NotFoundException(`Field with ID ${fieldId} not found`);
    }

    this.fieldsService.clearCache(fieldId);

    return {
      success: true,
      message: `Updated field amenities`,
      field: {
        id: (updatedField._id as Types.ObjectId).toString(),
        name: updatedField.name,
        amenities: updatedField.amenities,
      },
    };
  }

  async createFieldOwnerProfile(
    userId: string,
    createDto: CreateFieldOwnerProfileDto,
  ): Promise<FieldOwnerProfileDto> {
    try {
      const existingProfile = await this.fieldOwnerProfileModel
        .findOne({ user: new Types.ObjectId(userId) })
        .exec();
      if (existingProfile) {
        throw new BadRequestException('User already has a field owner profile');
      }

      const newProfile = new this.fieldOwnerProfileModel({
        user: new Types.ObjectId(userId),
        facility: {
          facilityName: createDto.facilityName,
          facilityLocation: createDto.facilityLocation,
          supportedSports: createDto.supportedSports,
          description: createDto.description,
          amenities: createDto.amenities || [],
          businessHours: createDto.businessHours,
          contactPhone: createDto.contactPhone,
          website: createDto.website,
        },
        verificationDocument: createDto.verificationDocument,
        rating: 0,
        totalReviews: 0,
        isVerified: false,
      });

      const savedProfile = await newProfile.save();

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

  async updateFieldOwnerProfile(
    userId: string,
    updateDto: UpdateFieldOwnerProfileDto,
  ): Promise<FieldOwnerProfileDto> {
    try {
      const profile = await this.fieldOwnerProfileModel
        .findOne({ user: new Types.ObjectId(userId) })
        .exec();

      if (!profile) {
        throw new NotFoundException('Field owner profile not found');
      }

      const updateData: any = {};
      const facilityUpdate: any = {};
      if (updateDto.facilityName !== undefined) facilityUpdate.facilityName = updateDto.facilityName;
      if (updateDto.facilityLocation !== undefined)
        facilityUpdate.facilityLocation = updateDto.facilityLocation;
      if (updateDto.supportedSports !== undefined)
        facilityUpdate.supportedSports = updateDto.supportedSports;
      if (updateDto.description !== undefined) facilityUpdate.description = updateDto.description;
      if (updateDto.amenities !== undefined) facilityUpdate.amenities = updateDto.amenities;
      if (updateDto.verificationDocument !== undefined)
        updateData.verificationDocument = updateDto.verificationDocument;
      if (updateDto.businessHours !== undefined) facilityUpdate.businessHours = updateDto.businessHours;
      if (updateDto.contactPhone !== undefined) facilityUpdate.contactPhone = updateDto.contactPhone;
      if (updateDto.website !== undefined) facilityUpdate.website = updateDto.website;

      if (Object.keys(facilityUpdate).length > 0) {
        updateData.facility = {
          ...(profile.facility || {}),
          ...facilityUpdate,
        };
      }

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

  async getAllFieldOwnerProfiles(
    page: number = 1,
    limit: number = 10,
    search?: string,
    isVerified?: boolean,
    sortBy: string = 'createdAt',
    sortOrder: 'asc' | 'desc' = 'desc',
  ) {
    try {
      const filter: any = {};

      if (search) {
        filter.$or = [
          { facilityName: { $regex: search, $options: 'i' } },
          { facilityLocation: { $regex: search, $options: 'i' } },
        ];
      }

      if (isVerified !== undefined) {
        filter.isVerified = isVerified;
      }

      const sortValue = sortOrder === 'asc' ? 1 : -1;
      const sortField = ['facilityName', 'rating', 'createdAt'].includes(sortBy) ? sortBy : 'createdAt';

      const skip = (page - 1) * limit;

      const [profiles, total] = await Promise.all([
        this.fieldOwnerProfileModel
          .find(filter)
          .populate('user', 'fullName email phone role')
          .sort({ [sortField]: sortValue })
          .skip(skip)
          .limit(limit)
          .exec(),
        this.fieldOwnerProfileModel.countDocuments(filter),
      ]);

      const data = profiles
        .filter((profile) => profile.user !== null)
        .map((profile) => this.mapToFieldOwnerProfileDto(profile));

      return {
        data,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      this.logger.error('Error getting all field owner profiles', error);
      throw new InternalServerErrorException('Failed to get field owner profiles');
    }
  }

  async createRegistrationRequest(
    userId: string,
    dto: CreateFieldOwnerRegistrationDto,
  ): Promise<FieldOwnerRegistrationResponseDto> {
    try {
      const existingRequest = await this.registrationRequestModel.findOne({
        userId: new Types.ObjectId(userId),
        status: { $in: [RegistrationStatus.PENDING, RegistrationStatus.APPROVED] },
      });

      if (existingRequest) {
        throw new BadRequestException('You already have a pending or approved registration request');
      }

      const existingProfile = await this.fieldOwnerProfileModel.findOne({
        user: new Types.ObjectId(userId),
      });

      if (existingProfile) {
        throw new BadRequestException('You are already a field owner');
      }

      // Business documents: only businessLicense is still used, identity handled via eKYC
      // Facility info is optional during registration (can be filled later during approval)
      // Field images can be stored temporarily or used as verification document
      const registrationRequest = new this.registrationRequestModel({
        userId: new Types.ObjectId(userId),
        personalInfo: dto.personalInfo,
        // Only include documents if provided (for backward compatibility and business license)
        documents: dto.documents
          ? {
              businessLicense: dto.documents.businessLicense,
            }
          : undefined,
        // eKYC fields
        ekycSessionId: dto.ekycSessionId,
        ekycData: dto.ekycData,
        // If ekycData exists, eKYC is verified; otherwise pending if session exists
        ekycStatus: dto.ekycData ? 'verified' : (dto.ekycSessionId ? 'pending' : undefined),
        // Set verifiedAt timestamp when eKYC is verified
        ekycVerifiedAt: dto.ekycData ? new Date() : undefined,
        // Facility info (optional during registration, can be filled during approval)
        facility: {
          facilityName: dto.facilityName || '',
          facilityLocation: dto.facilityLocation || '',
          // Convert frontend format {lat, lng} to GeoJSON format [lng, lat]
          facilityLocationCoordinates: dto.facilityLocationCoordinates
            ? {
                type: 'Point' as const,
                coordinates: [
                  dto.facilityLocationCoordinates.lng,
                  dto.facilityLocationCoordinates.lat,
                ],
              }
            : undefined,
          supportedSports: dto.supportedSports || [],
          description: dto.description || '',
          amenities: dto.amenities || [],
          businessHours: dto.businessHours,
          contactPhone: dto.contactPhone || '',
          website: dto.website,
        },
        // Store all field images
        fieldImages: dto.fieldImages || [],
        status: RegistrationStatus.PENDING,
        submittedAt: new Date(),
      });

      const savedRequest = await registrationRequest.save();

      // Send notification email (non-blocking)
      try {
        const user = await this.userModel.findById(userId).exec();
        if (user) {
          await this.emailService.sendFieldOwnerRegistrationSubmitted(user.email, user.fullName);
        }
      } catch (emailError) {
        this.logger.warn('Failed to send registration email', emailError);
        // Don't fail the registration if email fails
      }

      return this.mapToRegistrationDto(savedRequest);
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error('Error creating registration request', error);
      throw new InternalServerErrorException('Failed to create registration request');
    }
  }

  async getMyRegistrationRequest(userId: string) {
    try {
      const request = await this.registrationRequestModel
        .findOne({ userId: new Types.ObjectId(userId) })
        .sort({ submittedAt: -1 })
        .exec();

      if (!request) {
        return null;
      }

      return this.mapToRegistrationDto(request);
    } catch (error) {
      this.logger.error('Error getting registration request', error);
      throw new InternalServerErrorException('Failed to get registration request');
    }
  }

  async getPendingRegistrationRequests(page: number = 1, limit: number = 10) {
    try {
      const skip = (page - 1) * limit;

      const [requests, total] = await Promise.all([
        this.registrationRequestModel
          .find()
          .populate('userId', 'fullName email phone')
          .sort({ submittedAt: -1 })
          .skip(skip)
          .limit(limit)
          .exec(),
        this.registrationRequestModel.countDocuments(),
      ]);

      return {
        data: requests.map((request) => this.mapToRegistrationDto(request)),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      this.logger.error('Error getting registration requests', error);
      throw new InternalServerErrorException('Failed to get registration requests');
    }
  }

  async getRegistrationRequest(requestId: string): Promise<FieldOwnerRegistrationResponseDto> {
    try {
      const request = await this.registrationRequestModel
        .findById(requestId)
        .populate('userId', 'fullName email phone')
        .exec();

      if (!request) {
        throw new NotFoundException('Registration request not found');
      }

      return this.mapToRegistrationDto(request);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Error getting registration request', error);
      throw new InternalServerErrorException('Failed to get registration request');
    }
  }

  async approveRegistrationRequest(
    requestId: string,
    adminId: string,
    dto: ApproveFieldOwnerRegistrationDto,
  ): Promise<FieldOwnerProfileDto> {
    const session = await this.fieldModel.db.startSession();
    session.startTransaction();

    try {
      const request = await this.registrationRequestModel
        .findById(requestId)
        .session(session)
        .exec();

      if (!request) {
        throw new NotFoundException('Registration request not found');
      }

      if (request.status !== RegistrationStatus.PENDING) {
        throw new BadRequestException('Registration request is not pending');
      }

      // ✅ Kiểm tra eKYC nếu có ekycSessionId
      if (request.ekycSessionId) {
        if (request.ekycStatus !== 'verified') {
          throw new BadRequestException(
            `Cannot approve: eKYC not verified. Current status: ${request.ekycStatus || 'unknown'}`,
          );
        }

        const idNumber = request.ekycData?.identityCardNumber || request.ekycData?.idNumber;
        if (!request.ekycData || !request.ekycData.fullName || !idNumber) {
          throw new BadRequestException('Cannot approve: eKYC data missing or incomplete');
        }

        this.logger.log(
          `Registration request ${requestId} has verified eKYC: ${request.ekycData.fullName} (${idNumber})`,
        );
      }
      // Legacy branch for non-eKYC requests đã bỏ; production nên yêu cầu eKYC

      // Admin can override request data with dto, otherwise use request data
      // Since request now has required fields, we can simplify the logic
      const baseFacility = request.facility || ({} as any);
      const facilityName = dto.facilityName ?? baseFacility.facilityName;
      const facilityLocation = dto.facilityLocation ?? baseFacility.facilityLocation;
      const supportedSports = dto.supportedSports ?? baseFacility.supportedSports;
      const description = dto.description ?? baseFacility.description;
      const amenities = dto.amenities ?? baseFacility.amenities;
      // Use first field image as verification document for profile
      const verificationDocument = request.fieldImages && request.fieldImages.length > 0 ? request.fieldImages[0] : undefined;
      const businessHours = dto.businessHours ?? baseFacility.businessHours;
      const contactPhone = dto.contactPhone ?? baseFacility.contactPhone;
      const website = dto.website ?? baseFacility.website;

      // Validate required fields (should always be present now, but check for safety)
      if (!facilityName || !facilityLocation || !description || !contactPhone) {
        throw new BadRequestException('Missing required facility information to approve registration');
      }

      // Validate supportedSports if provided
      if (supportedSports && supportedSports.length === 0) {
        throw new BadRequestException('Supported sports cannot be empty if provided');
      }

      const profile = new this.fieldOwnerProfileModel({
        user: request.userId,
        facility: {
          facilityName,
          facilityLocation,
          supportedSports,
          description,
          amenities,
          businessHours,
          contactPhone,
          website,
        },
        verificationDocument,
        rating: 0,
        totalReviews: 0,
        isVerified: true,
        verifiedAt: new Date(),
        verifiedBy: new Types.ObjectId(adminId),
      });

      const savedProfile = await profile.save({ session });

      request.status = RegistrationStatus.APPROVED;
      request.facility = {
        ...(request.facility || {}),
        facilityName,
        facilityLocation,
        supportedSports,
        description,
        amenities,
        businessHours,
        contactPhone,
        website,
      };
      request.processedAt = new Date();
      request.processedBy = new Types.ObjectId(adminId);
      await request.save({ session });

      // Update user role to field_owner and sync EKYC data
      const userUpdateData: any = {
        role: UserRole.FIELD_OWNER,
      };

      // Sync EKYC data to User if available
      if (request.ekycData) {
        // Sync idNumber (prefer identityCardNumber, fallback to idNumber)
        const idNumber = request.ekycData.identityCardNumber || request.ekycData.idNumber;
        if (idNumber) {
          userUpdateData.idNumber = idNumber;
        }

        // Sync address (prefer permanentAddress, fallback to address)
        const address = request.ekycData.permanentAddress || request.ekycData.address;
        if (address) {
          userUpdateData.address = address;
        }

        // Sync fullName if available and different from current
        if (request.ekycData.fullName) {
          userUpdateData.fullName = request.ekycData.fullName;
        }
      }

      await this.userModel.updateOne(
        { _id: request.userId },
        { $set: userUpdateData },
      ).session(session).exec();

      this.logger.log(
        `Updated user ${request.userId.toString()} role to ${UserRole.FIELD_OWNER} and synced EKYC data upon registration approval`,
      );

      await session.commitTransaction();

      const populatedProfile = await this.fieldOwnerProfileModel
        .findById(savedProfile._id)
        .populate('user', 'fullName phone email')
        .exec();

      if (request.userId) {
        const user = await this.userModel.findById(request.userId).exec();
        if (user) {
          await this.emailService.sendFieldOwnerRegistrationApproved(user.email, user.fullName);
        }
      }

      return this.mapToFieldOwnerProfileDto(populatedProfile);
    } catch (error) {
      await session.abortTransaction();
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error('Error approving registration request', error);
      throw new InternalServerErrorException('Failed to approve registration request');
    } finally {
      session.endSession();
    }
  }

  async rejectRegistrationRequest(
    requestId: string,
    adminId: string,
    dto: RejectFieldOwnerRegistrationDto,
  ): Promise<FieldOwnerRegistrationResponseDto> {
    try {
      const request = await this.registrationRequestModel.findById(requestId).exec();

      if (!request) {
        throw new NotFoundException('Registration request not found');
      }

      if (request.status !== RegistrationStatus.PENDING) {
        throw new BadRequestException('Registration request is not pending');
      }

      request.status = RegistrationStatus.REJECTED;
      request.processedAt = new Date();
      request.processedBy = new Types.ObjectId(adminId);
      request.rejectionReason = dto.reason;
      await request.save();

      if (request.userId) {
        const user = await this.userModel.findById(request.userId).exec();
        if (user) {
          await this.emailService.sendFieldOwnerRegistrationRejected(user.email, user.fullName, dto.reason);
        }
      }

      return this.mapToRegistrationDto(request);
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error('Error rejecting registration request', error);
      throw new InternalServerErrorException('Failed to reject registration request');
    }
  }

  async addBankAccount(
    profileId: string,
    dto: CreateBankAccountDto,
  ): Promise<BankAccountResponseDto> {
    try {
      if (!dto.verificationDocument) {
        throw new BadRequestException('Vui lòng cung cấp ảnh/QR tài khoản ngân hàng để rút tiền');
      }

      // Check for duplicate bank account
      const existingAccount = await this.bankAccountModel.findOne({
        fieldOwner: new Types.ObjectId(profileId),
        accountNumber: dto.accountNumber,
        bankCode: dto.bankCode,
      }).exec();

      if (existingAccount) {
        throw new BadRequestException(
          `Tài khoản ngân hàng ${dto.accountNumber} (${dto.bankCode}) đã được khai báo. Vui lòng kiểm tra lại.`
        );
      }

      const bankAccount = new this.bankAccountModel({
        fieldOwner: new Types.ObjectId(profileId),
        bankCode: dto.bankCode,
        bankName: dto.bankName,
        accountNumber: dto.accountNumber,
        accountName: dto.accountName,
        branch: dto.branch,
        verificationDocument: dto.verificationDocument,
        status: BankAccountStatus.PENDING,
        isDefault: dto.isDefault ?? false,
        verificationAmount: 10000, // Default verification amount
        verificationPaymentStatus: 'pending',
      });

      const savedAccount = await bankAccount.save();

      await this.fieldOwnerProfileModel.findByIdAndUpdate(profileId, {
        $push: { bankAccounts: savedAccount._id },
      });

      // Automatically create verification payment unless skipped
      let verificationUrl: string | undefined;
      let verificationQrCode: string | undefined;

      if (!dto.skipVerification) {
        try {
          const verification = await this.createVerificationPayment(
            (savedAccount._id as Types.ObjectId).toString(),
          );
          verificationUrl = verification.verificationUrl;
          verificationQrCode = verification.verificationQrCode;
        } catch (verificationError) {
          this.logger.warn(
            `Failed to create verification payment for bank account ${savedAccount._id}:`,
            verificationError,
          );
          // Continue without verification payment - admin can create it later
        }
      }

      const response = this.mapToBankAccountDto(savedAccount);
      response.verificationUrl = verificationUrl;
      response.verificationQrCode = verificationQrCode;
      response.needsVerification = !dto.skipVerification;
      response.verificationPaymentStatus = savedAccount.verificationPaymentStatus || 'pending';
      response.verificationOrderCode = savedAccount.verificationOrderCode;

      return response;
    } catch (error) {
      this.logger.error('Error adding bank account', error);
      throw new InternalServerErrorException('Failed to add bank account');
    }
  }

  async getBankAccountsByFieldOwner(profileId: string): Promise<BankAccountResponseDto[]> {
    try {
      const accounts = await this.bankAccountModel
        .find({ fieldOwner: new Types.ObjectId(profileId) })
        .sort({ isDefault: -1, createdAt: -1 })
        .exec();

      return accounts.map((account) => this.mapToBankAccountDto(account));
    } catch (error) {
      this.logger.error('Error getting bank accounts', error);
      throw new InternalServerErrorException('Failed to get bank accounts');
    }
  }


  /**
   * Create verification payment for bank account
   * Creates a PayOS payment link (10,000 VND) to verify bank account ownership
   */
  async createVerificationPayment(bankAccountId: string): Promise<{
    verificationUrl: string;
    verificationQrCode: string;
    orderCode: number;
  }> {
    try {
      const bankAccount = await this.bankAccountModel.findById(bankAccountId).exec();
      if (!bankAccount) {
        throw new NotFoundException('Bank account not found');
      }

      // Generate unique order code
      const orderCode = generatePayOSOrderCode();
      const verificationAmount = bankAccount.verificationAmount || 10000;

      const frontendUrl = this.configService.get<string>('app.frontendUrl');
      if (!frontendUrl) {
        this.logger.error(
          'app.frontendUrl is not configured. Cannot build PayOS return/cancel URL for bank account verification.',
        );
        throw new InternalServerErrorException('Frontend URL is not configured');
      }

      // Create fee transaction record FIRST to ensure it exists
      // This ensures we don't have "gap" where payment exists but transaction record doesn't
      try {
        const ownerProfile = await this.fieldOwnerProfileModel
          .findById(bankAccount.fieldOwner)
          .select('user')
          .exec();

        if (!ownerProfile || !ownerProfile.user) {
          throw new BadRequestException(
            `Cannot create verification fee transaction: field owner profile not found for bank account ${bankAccountId}`,
          );
        }

        const verificationTransaction = new this.transactionModel({
          booking: undefined,
          user: ownerProfile.user as Types.ObjectId,
          amount: verificationAmount,
          direction: 'in',
          method: PaymentMethod.PAYOS,
          type: TransactionType.FEE,
          status: TransactionStatus.PENDING,
          externalTransactionId: String(orderCode),
          notes: 'Bank account verification fee',
          metadata: {
            bankAccountId: (bankAccount._id as Types.ObjectId).toString(),
            verificationType: 'BANK_ACCOUNT_VERIFICATION',
            verificationAmount,
          },
        });

        const savedTx = await verificationTransaction.save();
        this.logger.log(
          `Created bank account verification fee transaction ${savedTx._id} for bank account ${bankAccountId} (orderCode=${orderCode})`,
        );
      } catch (txError) {
        this.logger.error(
          `Failed to create verification fee transaction for bank account ${bankAccountId}:`,
          txError,
        );
        throw new InternalServerErrorException('Failed to initialize verification transaction');
      }

      // Create PayOS payment link
      // Note: PayOS requires description to be max 25 characters
      const paymentLink = await this.payosService.createPaymentUrl({
        orderCode,
        orderId: `bank-verify-${bankAccountId}`,
        amount: verificationAmount,
        // Prefix-based description to easily detect verification payments in webhook
        // Format: "BANKACCVERIFY" (no underscore - PayOS may strip special chars)
        description: 'BANKACCVERIFY',
        items: [
          {
            name: 'Bank account verification fee',
            quantity: 1,
            price: verificationAmount,
          },
        ],
        // Sau khi thanh toán phí xác thực, đưa user về trang Ví (wallet) field owner
        returnUrl: `${frontendUrl}/field-owner/wallet`,
        cancelUrl: `${frontendUrl}/field-owner/wallet`,
      });

      // Update bank account with verification order code
      bankAccount.verificationOrderCode = String(orderCode);
      bankAccount.verificationPaymentStatus = 'pending';
      bankAccount.verificationAmount = verificationAmount;
      bankAccount.verificationUrl = paymentLink.checkoutUrl;
      bankAccount.verificationQrCode = paymentLink.qrCodeUrl || '';
      await bankAccount.save();

      this.logger.log(
        `Created verification payment for bank account ${bankAccountId}: orderCode=${orderCode}`,
      );

      return {
        verificationUrl: paymentLink.checkoutUrl,
        verificationQrCode: paymentLink.qrCodeUrl || '',
        orderCode,
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Error creating verification payment', error);
      throw new InternalServerErrorException('Failed to create verification payment');
    }
  }

  /**
   * Process verification webhook from PayOS
   * Compares counterAccountNumber with registered accountNumber to verify ownership
   */
  async processVerificationWebhook(
    orderCode: number,
    webhookData: {
      counterAccountNumber?: string;
      counterAccountName?: string;
      amount: number;
      status: string;
      reference?: string;
      transactionDateTime?: string;
    },
  ): Promise<void> {
    try {
      this.logger.log(`[Verification Webhook] Processing orderCode: ${orderCode}, status: ${webhookData.status}`);
      
      // Find bank account by verification order code
      const bankAccount = await this.bankAccountModel
        .findOne({
          verificationOrderCode: String(orderCode),
        })
        .exec();

      if (!bankAccount) {
        this.logger.warn(`[Verification Webhook] Bank account not found for verification orderCode: ${orderCode}`);
        return;
      }

      this.logger.log(
        `[Verification Webhook] Found bank account ${bankAccount._id} for field owner ${bankAccount.fieldOwner}. ` +
        `Registered account: ${bankAccount.accountNumber}, Current status: ${bankAccount.status}`,
      );

      // Update payment status
      if (webhookData.status === 'PAID') {
        bankAccount.verificationPaymentStatus = 'paid';
        this.logger.log(
          `[Verification Webhook] Payment status updated to 'paid' for bank account ${bankAccount._id}`,
        );
      } else if (webhookData.status === 'CANCELLED' || webhookData.status === 'EXPIRED') {
        bankAccount.verificationPaymentStatus = 'failed';
        this.logger.warn(
          `[Verification Webhook] Payment ${webhookData.status.toLowerCase()} for bank account ${bankAccount._id}. Marking as failed.`,
        );
        await bankAccount.save();
      }

      // Update Transaction status
      try {
        const transaction = await this.transactionModel.findOne({ externalTransactionId: String(orderCode) }).exec();
        if (transaction) {
            if (webhookData.status === 'PAID') {
                transaction.status = TransactionStatus.SUCCEEDED;
                transaction.notes = 'Bank account verification fee paid successfully';
            } else if (webhookData.status === 'CANCELLED' || webhookData.status === 'EXPIRED') {
                transaction.status = TransactionStatus.FAILED;
                transaction.notes = `Bank account verification fee ${webhookData.status.toLowerCase()}`;
            }
            // Update PayOS metadata
            transaction.metadata = {
                ...transaction.metadata,
                payosOrderCode: orderCode,
                payosAccountNumber: webhookData.counterAccountNumber,
                payosReference: webhookData.reference || 'PayOS Webhook',
                payosTransactionDateTime: webhookData.transactionDateTime,
            };
            await transaction.save();
            this.logger.log(`[Verification Webhook] Updated transaction ${transaction._id} status to ${transaction.status}`);
        } else {
            this.logger.warn(`[Verification Webhook] Transaction not found for orderCode ${orderCode}`);
        }
      } catch (txError) {
        this.logger.error(`[Verification Webhook] Error updating transaction for orderCode ${orderCode}`, txError);
        // Don't throw here, continue to update BankAccount
      }
      
      if (webhookData.status === 'CANCELLED' || webhookData.status === 'EXPIRED') {
          return;
      }

      // Verify account number match (if counter account information is available)
      const registeredAccountNumber = bankAccount.accountNumber.trim();
      const counterAccountNumber = webhookData.counterAccountNumber?.trim() || '';

      this.logger.log(
        `[Verification Webhook] Account comparison - Registered: "${registeredAccountNumber}", ` +
        `Counter: "${counterAccountNumber || 'NOT PROVIDED'}"`,
      );

      if (webhookData.status === 'PAID' && counterAccountNumber) {
        if (counterAccountNumber === registeredAccountNumber) {
          // ✅ Verified - Account numbers match
          bankAccount.status = BankAccountStatus.VERIFIED;
          bankAccount.counterAccountNumber = counterAccountNumber;
          bankAccount.counterAccountName = webhookData.counterAccountName || bankAccount.accountName;
          bankAccount.accountNameFromPayOS = webhookData.counterAccountName;
          bankAccount.verifiedAt = new Date();
          bankAccount.isValidatedByPayOS = true;
          bankAccount.verificationPaymentStatus = 'paid';

          this.logger.log(
            `[Verification Webhook] ✅ Bank account ${bankAccount._id} verified successfully. ` +
              `Account: ${counterAccountNumber}, Name: ${webhookData.counterAccountName || 'N/A'}`,
          );
        } else {
          // ❌ Mismatch - Reject
          bankAccount.status = BankAccountStatus.REJECTED;
          bankAccount.verificationPaymentStatus = 'failed';
          bankAccount.rejectionReason = `Số tài khoản không khớp. Đã đăng ký: ${registeredAccountNumber}, Chuyển từ: ${counterAccountNumber}`;
          bankAccount.counterAccountNumber = counterAccountNumber;
          bankAccount.counterAccountName = webhookData.counterAccountName;

          this.logger.warn(
            `[Verification Webhook] ❌ Bank account ${bankAccount._id} verification failed. ` +
              `Registered: ${registeredAccountNumber}, Payer: ${counterAccountNumber}`,
          );
        }
      } else if (webhookData.status === 'PAID' && !counterAccountNumber) {
        // Payment successful but no counter account number provided.
        // For better UX we still mark the bank account as verified based on successful 10,000 VND payment.
        bankAccount.status = BankAccountStatus.VERIFIED;
        bankAccount.verificationPaymentStatus = 'paid';
        bankAccount.isValidatedByPayOS = true;
        bankAccount.verifiedAt = new Date();
        // Fallback: store registered account info as counter account if none is provided
        bankAccount.counterAccountNumber = registeredAccountNumber;
        bankAccount.counterAccountName = webhookData.counterAccountName || bankAccount.accountName;
        bankAccount.accountNameFromPayOS = webhookData.counterAccountName;

        this.logger.warn(
          `[Verification Webhook] ⚠️ Payment PAID for orderCode ${orderCode} but counterAccountNumber is missing. ` +
            `Marking bank account ${bankAccount._id} as VERIFIED based on successful verification payment.`,
        );
      }

      await bankAccount.save();
      this.logger.log(`[Verification Webhook] Bank account ${bankAccount._id} saved with status: ${bankAccount.status}`);
    } catch (error) {
      this.logger.error(`[Verification Webhook] Error processing verification webhook for orderCode ${orderCode}:`, error);
      throw error;
    }
  }

  /**
   * Get verification status for a bank account
   */
  async getVerificationStatus(bankAccountId: string): Promise<{
    needsVerification: boolean;
    verificationPaymentStatus?: 'pending' | 'paid' | 'failed';
    verificationUrl?: string;
    verificationQrCode?: string;
    verificationOrderCode?: string;
    status?: string; // Frontend expects 'status'
    qrCodeUrl?: string; // Frontend expects 'qrCodeUrl'
  }> {
    try {
      const bankAccount = await this.bankAccountModel.findById(bankAccountId).exec();
      if (!bankAccount) {
        throw new NotFoundException('Bank account not found');
      }

      // Auto-heal: if payment is marked as paid but status is still pending, promote to VERIFIED
      if (
        bankAccount.verificationPaymentStatus === 'paid' &&
        bankAccount.status === BankAccountStatus.PENDING
      ) {
        this.logger.warn(
          `Bank account ${bankAccountId} has paid verification but status is still pending. Promoting to VERIFIED...`,
        );
        bankAccount.status = BankAccountStatus.VERIFIED;
        bankAccount.isValidatedByPayOS = true;
        if (!bankAccount.verifiedAt) {
          bankAccount.verifiedAt = new Date();
        }
        await bankAccount.save();
      }

      const needsVerification =
        bankAccount.status === BankAccountStatus.PENDING &&
        bankAccount.verificationPaymentStatus !== 'paid';

      if (!needsVerification) {
        // Already verified or no verification required
        return {
          needsVerification: false,
          verificationPaymentStatus: bankAccount.verificationPaymentStatus,
          status: bankAccount.status,
          verificationOrderCode: bankAccount.verificationOrderCode,
          verificationUrl: bankAccount.verificationUrl,
          verificationQrCode: bankAccount.verificationQrCode,
          qrCodeUrl: bankAccount.verificationQrCode,
        };
      }

      // If verification payment exists, return status
      if (bankAccount.verificationOrderCode) {
        // Auto-recover: If pending but missing URL/QR (legacy data issue), regenerate payment link
        if (
          bankAccount.verificationPaymentStatus !== 'paid' &&
          (!bankAccount.verificationUrl || !bankAccount.verificationQrCode)
        ) {
          this.logger.warn(
            `Bank account ${bankAccountId} has order code but missing URL/QR. Regenerating payment link...`,
          );
          const verification = await this.createVerificationPayment(bankAccountId);
          const paymentStatus = 'pending';
          return {
            needsVerification: true,
            verificationPaymentStatus: paymentStatus,
            status: paymentStatus, // Frontend expects 'status'
            verificationOrderCode: String(verification.orderCode),
            verificationUrl: verification.verificationUrl,
            verificationQrCode: verification.verificationQrCode,
            qrCodeUrl: verification.verificationQrCode, // Frontend expects 'qrCodeUrl'
          };
        }

        const paymentStatus = bankAccount.verificationPaymentStatus || 'pending';
        const status = paymentStatus === 'paid' ? 'verified' : paymentStatus;

        return {
          needsVerification: true,
          verificationPaymentStatus: paymentStatus,
          status, // Frontend expects 'status'
          verificationOrderCode: bankAccount.verificationOrderCode,
          verificationUrl: bankAccount.verificationUrl,
          verificationQrCode: bankAccount.verificationQrCode,
          qrCodeUrl: bankAccount.verificationQrCode, // Frontend expects 'qrCodeUrl'
        };
      }

      // No verification payment created yet - create one now
      this.logger.log(`Bank account ${bankAccountId} needs verification but has no payment. Creating one...`);
      const verification = await this.createVerificationPayment(bankAccountId);
      const paymentStatus = 'pending';
      
      return {
        needsVerification: true,
        verificationPaymentStatus: paymentStatus,
        status: paymentStatus, // Frontend expects 'status'
        verificationOrderCode: String(verification.orderCode),
        verificationUrl: verification.verificationUrl,
        verificationQrCode: verification.verificationQrCode,
        qrCodeUrl: verification.verificationQrCode, // Frontend expects 'qrCodeUrl'
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Error getting verification status', error);
      throw new InternalServerErrorException('Failed to get verification status');
    }
  }

  async updateBankAccountStatus(
    accountId: string,
    status: BankAccountStatus,
    adminId: string,
    notes?: string,
    rejectionReason?: string,
  ): Promise<BankAccountResponseDto> {
    try {
      const bankAccount = await this.bankAccountModel.findById(accountId).exec();

      if (!bankAccount) {
        throw new NotFoundException('Bank account not found');
      }

      bankAccount.status = status;
      bankAccount.verifiedBy = new Types.ObjectId(adminId);
      bankAccount.notes = notes;
      bankAccount.rejectionReason = rejectionReason;
      bankAccount.verifiedAt = new Date();

      const updatedAccount = await bankAccount.save();

      return this.mapToBankAccountDto(updatedAccount);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Error updating bank account status', error);
      throw new InternalServerErrorException('Failed to update bank account status');
    }
  }

  async updateBankAccount(
    accountId: string,
    profileId: string,
    dto: UpdateBankAccountDto,
  ): Promise<BankAccountResponseDto> {
    try {
      const bankAccount = await this.bankAccountModel.findById(accountId).exec();

      if (!bankAccount) {
        throw new NotFoundException('Bank account not found');
      }

      // Verify account belongs to the field owner
      const accountOwnerId = (bankAccount.fieldOwner as Types.ObjectId).toString();
      if (accountOwnerId !== profileId) {
        throw new ForbiddenException('You do not have permission to update this bank account');
      }

      // Track if account details changed (to reset status)
      const detailsChanged =
        (dto.accountName && dto.accountName !== bankAccount.accountName) ||
        (dto.accountNumber && dto.accountNumber !== bankAccount.accountNumber) ||
        (dto.bankCode && dto.bankCode !== bankAccount.bankCode) ||
        (dto.bankName && dto.bankName !== bankAccount.bankName);

      // Update provided fields
      if (dto.accountName !== undefined) bankAccount.accountName = dto.accountName;
      if (dto.accountNumber !== undefined) bankAccount.accountNumber = dto.accountNumber;
      if (dto.bankCode !== undefined) bankAccount.bankCode = dto.bankCode;
      if (dto.bankName !== undefined) bankAccount.bankName = dto.bankName;
      if (dto.branch !== undefined) bankAccount.branch = dto.branch;
      if (dto.verificationDocument !== undefined) bankAccount.verificationDocument = dto.verificationDocument;

      // Reset status to PENDING if account details changed
      if (detailsChanged) {
        bankAccount.status = BankAccountStatus.PENDING;
        bankAccount.isValidatedByPayOS = false;
        bankAccount.accountNameFromPayOS = undefined;
        bankAccount.verifiedAt = undefined;
        bankAccount.verifiedBy = undefined;
        bankAccount.rejectionReason = undefined;
        bankAccount.notes = undefined;
      }

      // Handle isDefault update
      if (dto.isDefault !== undefined && dto.isDefault === true) {
        // Set all other accounts' isDefault to false
        await this.bankAccountModel.updateMany(
          {
            fieldOwner: new Types.ObjectId(profileId),
            _id: { $ne: new Types.ObjectId(accountId) },
          },
          { isDefault: false },
        );
        bankAccount.isDefault = true;
      } else if (dto.isDefault !== undefined) {
        bankAccount.isDefault = dto.isDefault;
      }

      const updatedAccount = await bankAccount.save();

      return this.mapToBankAccountDto(updatedAccount);
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ForbiddenException) {
        throw error;
      }
      this.logger.error('Error updating bank account', error);
      throw new InternalServerErrorException('Failed to update bank account');
    }
  }

  async deleteBankAccount(accountId: string, profileId: string): Promise<{ success: boolean; message: string }> {
    try {
      const bankAccount = await this.bankAccountModel.findById(accountId).exec();

      if (!bankAccount) {
        throw new NotFoundException('Bank account not found');
      }

      // Verify account belongs to the field owner
      const accountOwnerId = (bankAccount.fieldOwner as Types.ObjectId).toString();
      if (accountOwnerId !== profileId) {
        throw new ForbiddenException('You do not have permission to delete this bank account');
      }

      const wasDefault = bankAccount.isDefault;

      // Remove account from field owner profile's bankAccounts array
      await this.fieldOwnerProfileModel.findByIdAndUpdate(profileId, {
        $pull: { bankAccounts: new Types.ObjectId(accountId) },
      });

      // Delete the bank account document
      await this.bankAccountModel.findByIdAndDelete(accountId);

      // If deleted account was default, set next verified account as default if available
      if (wasDefault) {
        const nextVerifiedAccount = await this.bankAccountModel
          .findOne({
            fieldOwner: new Types.ObjectId(profileId),
            status: BankAccountStatus.VERIFIED,
          })
          .sort({ createdAt: -1 })
          .exec();

        if (nextVerifiedAccount) {
          nextVerifiedAccount.isDefault = true;
          await nextVerifiedAccount.save();
        } else {
          // If no verified account, set any account as default
          const anyAccount = await this.bankAccountModel
            .findOne({
              fieldOwner: new Types.ObjectId(profileId),
            })
            .sort({ createdAt: -1 })
            .exec();

          if (anyAccount) {
            anyAccount.isDefault = true;
            await anyAccount.save();
          }
        }
      }

      return { success: true, message: 'Bank account deleted successfully' };
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ForbiddenException) {
        throw error;
      }
      this.logger.error('Error deleting bank account', error);
      throw new InternalServerErrorException('Failed to delete bank account');
    }
  }

  async setDefaultBankAccount(accountId: string, profileId: string): Promise<BankAccountResponseDto> {
    try {
      const bankAccount = await this.bankAccountModel.findById(accountId).exec();

      if (!bankAccount) {
        throw new NotFoundException('Bank account not found');
      }

      // Verify account belongs to the field owner
      const accountOwnerId = (bankAccount.fieldOwner as Types.ObjectId).toString();
      if (accountOwnerId !== profileId) {
        throw new ForbiddenException('You do not have permission to modify this bank account');
      }

      // Set all other accounts' isDefault to false
      await this.bankAccountModel.updateMany(
        {
          fieldOwner: new Types.ObjectId(profileId),
          _id: { $ne: new Types.ObjectId(accountId) },
        },
        { isDefault: false },
      );

      // Set target account's isDefault to true
      bankAccount.isDefault = true;
      const updatedAccount = await bankAccount.save();

      return this.mapToBankAccountDto(updatedAccount);
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ForbiddenException) {
        throw error;
      }
      this.logger.error('Error setting default bank account', error);
      throw new InternalServerErrorException('Failed to set default bank account');
    }
  }

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

  private validateAndNormalizeLocation(location: any): {
    address: string;
    geo: { type: 'Point'; coordinates: [number, number] };
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
        coordinates: [longitude, latitude],
      },
    };
  }

  private mapToFieldOwnerProfileDto(profile: any): FieldOwnerProfileDto {
    return {
      id: profile._id.toString(),
      user: profile.user?._id?.toString() || profile.user?.toString() || '',
      userFullName: profile.user?.fullName || undefined,
      userEmail: profile.user?.email || undefined,
      facilityName: profile.facility?.facilityName ?? profile.facilityName ?? '',
      facilityLocation: profile.facility?.facilityLocation ?? profile.facilityLocation ?? '',
      supportedSports: profile.facility?.supportedSports ?? profile.supportedSports ?? [],
      description: profile.facility?.description ?? profile.description ?? '',
      amenities: profile.facility?.amenities ?? profile.amenities ?? [],
      rating: profile.rating ?? 0,
      totalReviews: profile.totalReviews ?? 0,
      isVerified: profile.isVerified ?? false,
      verifiedAt: profile.verifiedAt,
      verifiedBy: profile.verifiedBy?._id?.toString() || profile.verifiedBy?.toString() || undefined,
      verificationDocument: profile.verificationDocument,
      businessHours: profile.facility?.businessHours ?? profile.businessHours,
      contactPhone: profile.facility?.contactPhone ?? profile.contactPhone ?? '',
      website: profile.facility?.website ?? profile.website,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    };
  }

  private mapToRegistrationDto(
    request: FieldOwnerRegistrationRequest,
  ): FieldOwnerRegistrationResponseDto {
    const facility = request.facility as any;
    return {
      id: (request._id as Types.ObjectId).toString(),
      userId: request.userId?.toString(),
      personalInfo: request.personalInfo,
      documents: request.documents, // @deprecated - idFront/idBack replaced by eKYC
      ekycSessionId: request.ekycSessionId,
      ekycStatus: request.ekycStatus,
      ekycVerifiedAt: request.ekycVerifiedAt,
      ekycData: request.ekycData,
      status: request.status,
      facilityName: facility?.facilityName,
      facilityLocation: facility?.facilityLocation,
      // Convert GeoJSON format [lng, lat] back to frontend format {lat, lng}
      facilityLocationCoordinates: facility?.facilityLocationCoordinates?.coordinates
        ? {
            lat: facility.facilityLocationCoordinates.coordinates[1],
            lng: facility.facilityLocationCoordinates.coordinates[0],
          }
        : undefined,
      supportedSports: facility?.supportedSports,
      description: facility?.description,
      amenities: facility?.amenities,
      businessHours: facility?.businessHours,
      contactPhone: facility?.contactPhone,
      website: facility?.website,
      fieldImages: request.fieldImages || [],
      submittedAt: request.submittedAt,
      processedAt: request.processedAt,
      processedBy: request.processedBy?.toString(),
      reviewedAt: request.reviewedAt,
      reviewedBy: request.reviewedBy?.toString(),
      rejectionReason: request.rejectionReason,
    };
  }

  private mapToBankAccountDto(account: BankAccount): BankAccountResponseDto {
    const needsVerification =
      account.status === BankAccountStatus.PENDING &&
      account.verificationPaymentStatus !== 'paid';
    
    return {
      id: (account._id as Types.ObjectId).toString(),
      fieldOwner: (account.fieldOwner as Types.ObjectId)?.toString() || '',
      bankCode: account.bankCode,
      bankName: account.bankName,
      accountNumber: account.accountNumber,
      accountName: account.accountName,
      branch: account.branch,
      verificationDocument: account.verificationDocument,
      status: account.status,
      isDefault: account.isDefault,
      accountNameFromPayOS: account.accountNameFromPayOS,
      isValidatedByPayOS: account.isValidatedByPayOS,
      verifiedBy: account.verifiedBy?._id?.toString() || account.verifiedBy?.toString(),
      notes: account.notes,
      rejectionReason: account.rejectionReason,
      verifiedAt: account.verifiedAt,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
      // Verification payment fields
      needsVerification,
      verificationPaymentStatus: account.verificationPaymentStatus,
      verificationOrderCode: account.verificationOrderCode,
      verificationUrl: account.verificationUrl,
      verificationQrCode: account.verificationQrCode,
    };
  }
}

