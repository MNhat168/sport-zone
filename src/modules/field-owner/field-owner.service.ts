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
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Field } from '../fields/entities/field.entity';
import { FieldOwnerProfile } from './entities/field-owner-profile.entity';
import {
  FieldOwnerRegistrationRequest,
} from './entities/field-owner-registration-request.entity';
import { CoachRegistrationRequest } from '../coaches/entities/coach-registration-request.entity';
import { CoachProfile } from '../coaches/entities/coach-profile.entity';
import { RegistrationStatus } from '@common/enums/field-owner-registration.enum';
import { BankAccount } from './entities/bank-account.entity';
import { BankAccountStatus } from '@common/enums/bank-account.enum';
import { FieldQrCode } from './entities/field-qr-code.entity';
import {
  FieldsDto,
  CreateFieldDto,
  UpdateFieldDto,
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
  RequestAdditionalInfoRegistrationDto,
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
import { BookingStatus } from '@common/enums/booking.enum';
import { SportType } from '@common/enums/sport-type.enum';
import { QrCheckinService } from '../qr-checkin/qr-checkin.service';
import { EkycService } from '../ekyc/ekyc.service';

@Injectable()
export class FieldOwnerService {
  private readonly logger = new Logger(FieldOwnerService.name);

  constructor(
    @InjectModel(Field.name) private readonly fieldModel: Model<Field>,
    @InjectModel(FieldOwnerProfile.name) private readonly fieldOwnerProfileModel: Model<FieldOwnerProfile>,
    @InjectModel(FieldOwnerRegistrationRequest.name)
    private readonly registrationRequestModel: Model<FieldOwnerRegistrationRequest>,
    @InjectModel(CoachRegistrationRequest.name)
    private readonly coachRegistrationRequestModel: Model<CoachRegistrationRequest>,
    @InjectModel(BankAccount.name) private readonly bankAccountModel: Model<BankAccount>,
    @InjectModel(FieldQrCode.name) private readonly fieldQrCodeModel: Model<FieldQrCode>,
    @InjectModel(Booking.name) private readonly bookingModel: Model<Booking>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(Transaction.name) private readonly transactionModel: Model<Transaction>,
    @InjectModel(Court.name) private readonly courtModel: Model<Court>,
    @InjectModel(CoachProfile.name) private readonly coachProfileModel: Model<CoachProfile>,
    private readonly priceFormatService: PriceFormatService,
    private readonly awsS3Service: AwsS3Service,
    private readonly payosService: PayOSService,
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => FieldsService))
    private readonly fieldsService: FieldsService,
    @Inject(forwardRef(() => QrCheckinService))
    private readonly qrCheckinService: QrCheckinService,
    private readonly ekycService: EkycService,
    private readonly eventEmitter: EventEmitter2,
  ) { }

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

      // Fetch courts for each field to populate numberOfCourts
      const fieldsWithCourts = await Promise.all(fields.map(async (field) => {
        const courts = await this.courtModel.find({ field: field._id }).countDocuments();
        return {
          ...field.toObject(),
          numberOfCourts: courts
        };
      }));

      const totalPages = Math.ceil(total / limit);

      const fieldsDto: FieldsDto[] = fieldsWithCourts.map((field: any) => {
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
        // Special case: when filtering by 'pending' transaction status,
        // also include bookings with paymentStatus = 'paid'
        if (filters.transactionStatus === 'pending') {
          const transactions = await this.transactionModel
            .find({ status: filters.transactionStatus })
            .select('_id')
            .lean()
            .exec();

          const transactionIds = transactions.map((t) => t._id);

          // Create $or condition: transaction status = 'pending' OR paymentStatus = 'paid'
          const orConditions: any[] = [];

          if (transactionIds.length > 0) {
            orConditions.push({ transaction: { $in: transactionIds } });
          }

          // Also include bookings with paymentStatus = 'paid'
          orConditions.push({ paymentStatus: 'paid' });

          // ✅ FIX: Include bookings WITHOUT transaction (FIELD_COACH pending)
          orConditions.push({ transaction: { $exists: false } });
          orConditions.push({ transaction: null });

          if (orConditions.length > 0) {
            bookingFilter.$or = orConditions;
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
        } else {
          // For other transaction statuses, use the original logic
          const transactions = await this.transactionModel
            .find({ status: filters.transactionStatus })
            .select('_id')
            .lean()
            .exec();

          const transactionIds = transactions.map((t) => t._id);

          const orConditions: any[] = [];

          if (transactionIds.length > 0) {
            orConditions.push({ transaction: { $in: transactionIds } });
          }

          // FIX: If filtering by cancelled, also include bookings with status = 'cancelled'
          if (filters.transactionStatus === 'cancelled') {
            orConditions.push({ status: 'cancelled' });
          }

          if (orConditions.length > 0) {
            bookingFilter.$or = orConditions;
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
          path: 'court',
          select: 'name courtNumber',
        })
        .populate({
          path: 'user',
          select: 'fullName phone email',
        })
        .populate({
          path: 'selectedAmenities',
          select: 'name price',
        })
        // ✅ REMOVED: transaction populate (bidirectional reference cleanup)
        .sort({ date: -1, startTime: -1 })
        .skip(skip)
        .limit(limit)
        .exec();

      // ✅ Query transactions separately to avoid bidirectional reference
      // ✅ Query transactions using IDs stored in bookings
      const transactionIds = bookings
        .map(b => (b as any).transaction)
        .filter(id => id && Types.ObjectId.isValid(id.toString()));

      const transactions = await this.transactionModel
        .find({ _id: { $in: transactionIds } })
        .select('_id status')
        .lean()
        .exec();

      // Create a map for quick lookup: transactionId -> transaction status
      const transactionStatusMap = new Map<string, string>();
      transactions.forEach(tx => {
        transactionStatusMap.set(tx._id.toString(), tx.status);
      });

      const formattedBookings = bookings.map((booking) => {
        const court = booking.court as any;
        const courtName = court?.name || (court?.courtNumber ? `Sân ${court.courtNumber}` : null);
        const courtNumber = court?.courtNumber;

        return {
          bookingId: booking._id?.toString(),
          fieldId: booking.field?._id?.toString(),
          fieldName: (booking.field as any)?.name || 'Unknown Field',
          courtName,
          courtNumber,
          date:
            typeof booking.date === 'string'
              ? booking.date
              : booking.date.toISOString().split('T')[0],
          startTime: booking.startTime,
          endTime: booking.endTime,
          status: booking.status,
          transactionStatus: (booking as any).transaction
            ? transactionStatusMap.get(((booking as any).transaction).toString())
            : null,
          approvalStatus: (booking as any).approvalStatus || (booking as any).noteStatus || undefined,
          totalPrice: booking.totalPrice,
          customer: {
            fullName: (booking.user as any)?.fullName || 'Unknown',
            phone: (booking.user as any)?.phone || 'N/A',
            email: (booking.user as any)?.email || 'N/A',
          },
          selectedAmenities: booking.selectedAmenities?.map((amenity: any) => amenity.name) || [],
          amenitiesFee: booking.amenitiesFee || 0,
          createdAt: booking.createdAt,
        };
      });

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

  async getAllBookingsByOwnerWithType(
    userId: string,
    filters: {
      type?: string;
      fieldName?: string;
      status?: string;
      transactionStatus?: string;
      startDate?: string;
      endDate?: string;
      recurringFilter?: 'none' | 'only' | 'all';
      recurringType?: 'CONSECUTIVE' | 'WEEKLY';
      sortBy?: 'createdAt' | 'date' | 'totalPrice';
      sortOrder?: 'asc' | 'desc';
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

      // Add type filter if provided
      if (filters.type) {
        bookingFilter.type = filters.type;
      }

      // Add recurringFilter logic
      if (filters.recurringFilter) {
        if (filters.recurringFilter === 'none') {
          // Only bookings WITHOUT recurringGroupId (single bookings)
          bookingFilter.recurringGroupId = { $exists: false };
        } else if (filters.recurringFilter === 'only') {
          // Only bookings WITH recurringGroupId (recurring bookings)
          bookingFilter.recurringGroupId = { $exists: true };
        }
        // 'all' means no filter on recurringGroupId
      }

      // Add recurringType filter (CONSECUTIVE vs WEEKLY)
      if (filters.recurringType) {
        bookingFilter.recurringType = filters.recurringType;
      }

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
        if (filters.transactionStatus === 'pending') {
          const transactions = await this.transactionModel
            .find({ status: filters.transactionStatus })
            .select('_id')
            .lean()
            .exec();

          const transactionIds = transactions.map((t) => t._id);

          const orConditions: any[] = [];

          if (transactionIds.length > 0) {
            orConditions.push({ transaction: { $in: transactionIds } });
          }

          // ✅ FIX: Include bookings WITHOUT transaction (FIELD_COACH pending)
          // BUT exclude cancelled/completed bookings
          orConditions.push({
            transaction: { $exists: false },
            status: { $nin: ['cancelled', 'completed'] }
          });
          orConditions.push({
            transaction: null,
            status: { $nin: ['cancelled', 'completed'] }
          });

          if (orConditions.length > 0) {
            bookingFilter.$or = orConditions;
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
        } else {
          const transactions = await this.transactionModel
            .find({ status: filters.transactionStatus })
            .select('_id')
            .lean()
            .exec();

          const transactionIds = transactions.map((t) => t._id);

          const orConditions: any[] = [];

          if (transactionIds.length > 0) {
            orConditions.push({ transaction: { $in: transactionIds } });
          }

          // FIX: If filtering by cancelled, also include bookings with status = 'cancelled'
          if (filters.transactionStatus === 'cancelled') {
            orConditions.push({ status: 'cancelled' });
          }

          if (orConditions.length > 0) {
            bookingFilter.$or = orConditions;
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
      }

      const page = filters.page || 1;
      const limit = filters.limit || 10;
      const skip = (page - 1) * limit;

      const total = await this.bookingModel.countDocuments(bookingFilter);

      // Build sort object
      const sortField = filters.sortBy || 'createdAt';
      const sortDirection = filters.sortOrder === 'asc' ? 1 : -1;
      const sortObject: any = {};

      if (sortField === 'date') {
        sortObject.date = sortDirection;
        sortObject.startTime = sortDirection;  // Secondary sort by startTime
      } else if (sortField === 'totalPrice') {
        sortObject.totalPrice = sortDirection;
        sortObject.date = -1;  // Secondary sort by date (newest first)
      } else {
        // Default: sort by createdAt
        sortObject.createdAt = sortDirection;
        sortObject._id = sortDirection;  // For consistent pagination
      }

      const bookings = await this.bookingModel
        .find(bookingFilter)
        .populate({
          path: 'field',
          select: 'name _id',
        })
        .populate({
          path: 'court',
          select: 'name courtNumber',
        })
        .populate({
          path: 'user',
          select: 'fullName phone email',
        })
        .populate({
          path: 'selectedAmenities',
          select: 'name price',
        })
        // ✅ REMOVED: transaction populate (bidirectional reference cleanup)
        .populate({
          path: 'requestedCoach',
          select: 'fullName phoneNumber',
        })
        .sort(sortObject)
        .skip(skip)
        .limit(limit)
        .exec();

      // ✅ Query transactions using IDs stored in bookings
      const transactionIds = bookings
        .map(b => (b as any).transaction)
        .filter(id => id && Types.ObjectId.isValid(id.toString()));

      const transactions = await this.transactionModel
        .find({ _id: { $in: transactionIds } })
        .select('_id status')
        .lean()
        .exec();

      // Create a map for quick lookup: transactionId -> transaction status
      const transactionStatusMap = new Map<string, string>();
      transactions.forEach(tx => {
        transactionStatusMap.set(tx._id.toString(), tx.status);
      });

      const formattedBookings = bookings.map((booking) => {
        const court = booking.court as any;
        const courtName = court?.name || (court?.courtNumber ? `Sân ${court.courtNumber}` : null);
        const courtNumber = court?.courtNumber;

        return {
          bookingId: booking._id?.toString(),
          fieldId: booking.field?._id?.toString(),
          fieldName: (booking.field as any)?.name || 'Unknown Field',
          courtName,
          courtNumber,
          date:
            typeof booking.date === 'string'
              ? booking.date
              : booking.date.toISOString().split('T')[0],
          startTime: booking.startTime,
          endTime: booking.endTime,
          status: booking.status,
          type: booking.type,
          transactionStatus: (booking as any).transaction
            ? transactionStatusMap.get(((booking as any).transaction).toString())
            : null,
          approvalStatus: (booking as any).approvalStatus || (booking as any).noteStatus || undefined,
          totalPrice: booking.totalPrice,
          customer: {
            fullName: (booking.user as any)?.fullName || 'Unknown',
            phone: (booking.user as any)?.phone || 'N/A',
            email: (booking.user as any)?.email || 'N/A',
          },
          requestedCoach: booking.requestedCoach ? {
            fullName: (booking.requestedCoach as any)?.fullName || 'Unknown',
            phoneNumber: (booking.requestedCoach as any)?.phoneNumber || 'N/A',
          } : null,
          selectedAmenities: booking.selectedAmenities?.map((amenity: any) => amenity.name) || [],
          amenitiesFee: booking.amenitiesFee || 0,
          createdAt: booking.createdAt,
        };
      });

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
      this.logger.error(`Error getting all bookings with type for user ${userId}:`, error);
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

  async create(
    createFieldDto: CreateFieldDto,
    ownerId: string,
    files?: IFile[],
  ): Promise<FieldsDto> {
    try {
      // 1. Handle Images
      let imageUrls: string[] = createFieldDto.images || [];
      if (files && files.length > 0) {
        const uploadPromises = files.map((file) =>
          this.awsS3Service.uploadImageFromBuffer(file.buffer, file.mimetype),
        );
        const uploadedUrls = await Promise.all(uploadPromises);
        imageUrls = [...imageUrls, ...uploadedUrls];
      }

      // Enforce at least one image
      if (imageUrls.length === 0) {
        throw new BadRequestException('At least one image is required for the field.');
      }

      // 2. Validate Location
      const validatedLocation = this.validateAndNormalizeLocation(createFieldDto.location);

      // 3. Process Amenities
      let amenities: Array<{ amenity: Types.ObjectId; price: number }> = [];
      if (createFieldDto.amenities && createFieldDto.amenities.length > 0) {
        amenities = createFieldDto.amenities.map((amenityDto) => {
          if (!Types.ObjectId.isValid(amenityDto.amenityId)) {
            throw new BadRequestException(`Invalid amenity ID format: ${amenityDto.amenityId}`);
          }
          return {
            amenity: new Types.ObjectId(amenityDto.amenityId),
            price: amenityDto.price || 0,
          };
        });
      }

      // 4. Validate Operating Hours
      let operatingHours = createFieldDto.operatingHours;

      if (!Array.isArray(operatingHours) || operatingHours.length === 0) {
        throw new BadRequestException('Invalid operating hours format - must be array of day objects');
      }

      // Filter out null/undefined entries
      const originalLength = operatingHours.length;
      operatingHours = operatingHours.filter((oh: any) => oh != null && typeof oh === 'object');
      if (operatingHours.length !== originalLength) {
        this.logger.warn(`Filtered out ${originalLength - operatingHours.length} invalid operating hours entries`);
      }
      if (operatingHours.length === 0) {
        throw new BadRequestException('Invalid operating hours format - all entries are null or invalid');
      }

      const validDays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
      for (let i = 0; i < operatingHours.length; i++) {
        const dayHours = operatingHours[i];

        // Check if dayHours is a valid object
        if (!dayHours || typeof dayHours !== 'object') {
          this.logger.error(`Invalid operating hours entry at index ${i}:`, dayHours);
          throw new BadRequestException(`Invalid operating hours entry at index ${i} - must be an object`);
        }

        // Check if day exists and is valid
        if (!dayHours.day || typeof dayHours.day !== 'string') {
          this.logger.error(`Missing or invalid day at index ${i}:`, dayHours);
          throw new BadRequestException(`Invalid day at index ${i}: ${dayHours.day || 'undefined'}`);
        }

        if (!validDays.includes(dayHours.day)) {
          this.logger.error(`Invalid day value at index ${i}:`, dayHours);
          throw new BadRequestException(`Invalid day: ${dayHours.day}. Valid days are: ${validDays.join(', ')}`);
        }

        if (!dayHours.start || !dayHours.end || !dayHours.duration) {
          throw new BadRequestException(
            `Invalid operating hours for ${dayHours.day} - missing start, end, or duration`,
          );
        }
      }

      // 5. Process Price Ranges
      let priceRanges = createFieldDto.priceRanges || [];

      if (priceRanges && Array.isArray(priceRanges) && priceRanges.length > 0) {
        // Filter out null/undefined entries
        const originalLength = priceRanges.length;
        priceRanges = priceRanges.filter((pr: any) => pr != null && typeof pr === 'object');
        if (priceRanges.length !== originalLength) {
          this.logger.warn(`Filtered out ${originalLength - priceRanges.length} invalid price range entries`);
        }

        for (let i = 0; i < priceRanges.length; i++) {
          const range = priceRanges[i];

          // Check if range is a valid object
          if (!range || typeof range !== 'object') {
            this.logger.error(`Invalid price range entry at index ${i}:`, range);
            throw new BadRequestException(`Invalid price range entry at index ${i} - must be an object`);
          }

          // Check if day exists and is valid
          if (!range.day || typeof range.day !== 'string') {
            this.logger.error(`Missing or invalid day in price range at index ${i}:`, range);
            throw new BadRequestException(`Invalid day in price range at index ${i}: ${range.day || 'undefined'}`);
          }

          if (!validDays.includes(range.day)) {
            this.logger.error(`Invalid day value in price range at index ${i}:`, range);
            throw new BadRequestException(`Invalid day in price range: ${range.day}. Valid days are: ${validDays.join(', ')}`);
          }

          if (!range.start || !range.end || range.multiplier === undefined) {
            throw new BadRequestException(
              `Invalid price range for ${range.day} - missing start, end, or multiplier`,
            );
          }
        }

        // Fill in missing days for price ranges if not provided
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

      // 6. Create Field
      const newField = new this.fieldModel({
        owner: new Types.ObjectId(ownerId),
        name: createFieldDto.name,
        sportType: createFieldDto.sportType,
        description: createFieldDto.description,
        location: validatedLocation,
        images: imageUrls,
        operatingHours,
        slotDuration: createFieldDto.slotDuration,
        minSlots: createFieldDto.minSlots,
        maxSlots: createFieldDto.maxSlots,
        priceRanges,
        basePrice: createFieldDto.basePrice,
        amenities,
        isActive: true,
        rating: 0,
        totalReviews: 0,
      });

      const savedField = await newField.save();

      // 7. Create Courts
      const numberOfCourts = createFieldDto.numberOfCourts ?? 1;
      if (numberOfCourts > 0) {
        try {
          const courtPromises: Promise<any>[] = [];
          for (let i = 1; i <= numberOfCourts; i++) {
            courtPromises.push(
              this.courtModel.create({
                field: savedField._id,
                name: `Court ${i}`,
                courtNumber: i,
                isActive: true,
              }),
            );
          }
          await Promise.all(courtPromises);
        } catch (courtError) {
          this.logger.error(`Failed to create courts for field ${savedField._id}:`, courtError);
        }
      }

      return this.mapToFieldsDto(savedField);
    } catch (error) {
      this.logger.error('Error creating field', error);
      if (error instanceof BadRequestException) throw error;
      throw new InternalServerErrorException('Failed to create field');
    }
  }

  // Helper to map Field model to FieldsDto
  private mapToFieldsDto(field: any): FieldsDto {
    const price = this.priceFormatService.formatPrice(field.basePrice);
    return {
      id: field._id?.toString() || '',
      owner: field.owner?.toString() || '',
      name: field.name,
      sportType: field.sportType,
      description: field.description,
      location: field.location,
      images: field.images || [],
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
      amenities: Array.isArray(field.amenities)
        ? field.amenities.map((a: any) => ({
          amenityId: a.amenity?._id?.toString() || a.amenity?.toString(),
          name: (a.amenity as any)?.name,
          price: a.price || 0,
        }))
        : [],
    };
  }

  async update(
    fieldId: string,
    updateFieldDto: UpdateFieldDto,
    ownerId: string,
    files?: { avatar?: IFile[]; gallery?: IFile[] } | IFile[],
  ): Promise<FieldsDto> {
    try {
      const field = await this.fieldModel.findById(fieldId);

      if (!field) {
        throw new NotFoundException('Field not found');
      }

      if (field.owner.toString() !== ownerId) {
        throw new UnauthorizedException('Only field owner can update field information');
      }

      const updateData: any = {};

      // 1. Handle Images
      let finalImages: string[] = field.images || [];

      // If keptImages is provided, it replaces the CURRENT images
      if (updateFieldDto.keptImages !== undefined) {
        finalImages = updateFieldDto.keptImages;
      }

      const newImages: string[] = [];
      if (files) {
        if (Array.isArray(files)) {
          // Simple array of files
          const uploadPromises = files.map((file) =>
            this.awsS3Service.uploadACLImage(file),
          );
          newImages.push(...(await Promise.all(uploadPromises)));
        } else {
          // Avatar and Gallery fields
          if (files.avatar && files.avatar.length > 0) {
            const avatarUrl = await this.awsS3Service.uploadACLImage(files.avatar[0]);
            newImages.unshift(avatarUrl); // Avatar usually goes first
          }
          if (files.gallery && files.gallery.length > 0) {
            for (const file of files.gallery) {
              const url = await this.awsS3Service.uploadACLImage(file);
              newImages.push(url);
            }
          }
        }
      }

      // If we have new images or keptImages was explicitly provided, update the images array
      if (newImages.length > 0 || updateFieldDto.keptImages !== undefined) {
        updateData.images = [...newImages, ...finalImages];
      }

      // 2. Process Basic Fields
      const excludeFields = ['images', 'keptImages', 'courtsToDelete', 'amenities', 'location', 'numberOfCourts', 'files'];
      for (const [key, value] of Object.entries(updateFieldDto)) {
        if (!excludeFields.includes(key) && value !== undefined) {
          updateData[key] = value;
        }
      }

      // 3. Process Amenities
      if (updateFieldDto.amenities) {
        updateData.amenities = updateFieldDto.amenities.map((a) => ({
          amenity: new Types.ObjectId(a.amenityId),
          price: a.price || 0,
        }));
      }

      // 4. Process Location - only update if location is provided and valid
      if (updateFieldDto.location && typeof updateFieldDto.location === 'object') {
        // Check if location has the address field - if not, skip location update
        if (updateFieldDto.location.address && typeof updateFieldDto.location.address === 'string') {
          updateData.location = this.validateAndNormalizeLocation(updateFieldDto.location);
        }
        // If location is provided but incomplete, we skip it and keep the existing location
      }

      // 5. Handle Court Deletion and Sync
      if (updateFieldDto.courtsToDelete && updateFieldDto.courtsToDelete.length > 0) {
        const courtObjectIds = updateFieldDto.courtsToDelete.map(id => new Types.ObjectId(id));

        // Validate courts belong to this field and check for bookings
        const courtsToDelete = await this.courtModel.find({
          _id: { $in: courtObjectIds },
          field: new Types.ObjectId(fieldId)
        }).exec();

        if (courtsToDelete.length > 0) {
          const todayStart = new Date();
          todayStart.setHours(0, 0, 0, 0);

          const activeBookings = await this.bookingModel.findOne({
            court: { $in: courtObjectIds },
            status: { $in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] },
            date: { $gte: todayStart }
          }).exec();

          if (activeBookings) {
            throw new BadRequestException('Không thể xóa các sân có lịch đặt đang hoạt động.');
          }

          await this.courtModel.deleteMany({ _id: { $in: courtObjectIds } });
          this.logger.log(`Deleted specific courts: ${updateFieldDto.courtsToDelete.join(', ')}`);
        }
      }

      if (updateFieldDto.numberOfCourts !== undefined) {
        await this.syncCourts(fieldId, updateFieldDto.numberOfCourts);
      }

      // Emit events for bookmark notifications BEFORE final update
      if (updateData.isActive !== undefined && field.isActive !== updateData.isActive) {
        this.eventEmitter.emit('field.statusChanged', {
          fieldId: (field._id as any).toString(),
          fieldName: field.name,
          oldStatus: field.isActive,
          newStatus: updateData.isActive,
        });
        this.logger.log(`Emitted field.statusChanged event for field ${field.name}`);
      }

      if (updateData.basePrice !== undefined && field.basePrice !== updateData.basePrice) {
        this.eventEmitter.emit('field.priceChanged', {
          fieldId: (field._id as any).toString(),
          fieldName: field.name,
          oldPrice: field.basePrice,
          newPrice: updateData.basePrice,
        });
        this.logger.log(`Emitted field.priceChanged event for field ${field.name}`);
      }

      const updatedField = await this.fieldModel
        .findByIdAndUpdate(fieldId, { $set: updateData }, { new: true })
        .populate('amenities.amenity')
        .exec();

      if (!updatedField) {
        throw new NotFoundException('Field not found after update');
      }

      this.fieldsService.clearCache(fieldId);

      return this.mapToFieldsDto(updatedField);
    } catch (error) {
      this.logger.error('Error updating field', error);
      if (error instanceof NotFoundException || error instanceof UnauthorizedException || error instanceof BadRequestException) {
        throw error;
      }
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
        throw new BadRequestException('Bạn đang có yêu cầu đăng ký chủ sân đang chờ duyệt hoặc đã được duyệt.');
      }

      // Check if user has a pending or approved COACH registration
      const existingCoachRequest = await this.coachRegistrationRequestModel.findOne({
        userId: new Types.ObjectId(userId),
        status: { $in: [RegistrationStatus.PENDING, RegistrationStatus.APPROVED] },
      });

      if (existingCoachRequest) {
        throw new BadRequestException('Bạn đang có yêu cầu đăng ký huấn luyện viên đang chờ duyệt hoặc đã được duyệt. Không thể đăng ký làm chủ sân.');
      }

      const existingProfile = await this.fieldOwnerProfileModel.findOne({
        user: new Types.ObjectId(userId),
      });

      if (existingProfile) {
        throw new BadRequestException('Bạn đã là chủ sân.');
      }

      // Check if user is already a COACH
      const existingCoachProfile = await this.coachProfileModel.findOne({
        user: new Types.ObjectId(userId),
      });

      if (existingCoachProfile) {
        throw new BadRequestException('Bạn đã là huấn luyện viên. Không thể đăng ký làm chủ sân.');
      }

      // Security: Prevent ekycSessionId reuse across different users
      if (dto.ekycSessionId) {
        // Check if sessionId is already used by another user in FieldOwnerRegistrationRequest
        const existingFieldOwnerRequest = await this.registrationRequestModel.findOne({
          ekycSessionId: dto.ekycSessionId,
        });

        if (existingFieldOwnerRequest) {
          // If sessionId belongs to current user, allow (resubmit case)
          if (existingFieldOwnerRequest.userId.toString() !== userId) {
            throw new BadRequestException(
              'eKYC session ID đã được sử dụng bởi người dùng khác. Vui lòng tạo session mới.',
            );
          }
        }

        // Check if sessionId is already used by another user in CoachRegistrationRequest
        const existingCoachRequest = await this.coachRegistrationRequestModel.findOne({
          ekycSessionId: dto.ekycSessionId,
        });

        if (existingCoachRequest) {
          // If sessionId belongs to current user, allow (user switching between field owner and coach)
          if (existingCoachRequest.userId.toString() !== userId) {
            throw new BadRequestException(
              'eKYC session ID đã được sử dụng bởi người dùng khác. Vui lòng tạo session mới.',
            );
          }
        }
      }

      // Validate eKYC data: if ekycSessionId exists, ekycData must be provided or fetched
      let finalEkycData = dto.ekycData;
      let finalEkycStatus = dto.ekycData ? 'verified' : (dto.ekycSessionId ? 'pending' : undefined);
      let finalEkycVerifiedAt = dto.ekycData ? new Date() : undefined;

      if (dto.ekycSessionId) {
        // If ekycData is missing, try to fetch from didit API
        if (!dto.ekycData) {
          try {
            const ekycStatusResult = await this.ekycService.getEkycSessionStatus(dto.ekycSessionId);

            if (ekycStatusResult.status === 'verified' && ekycStatusResult.data) {
              finalEkycData = ekycStatusResult.data;
              finalEkycStatus = 'verified';
              finalEkycVerifiedAt = ekycStatusResult.verifiedAt || new Date();
            } else if (ekycStatusResult.status === 'failed') {
              throw new BadRequestException(
                'eKYC verification đã thất bại. Vui lòng tạo session mới và thử lại.',
              );
            }
            // If still pending, keep as pending
          } catch (error) {
            // If fetch fails, require ekycData to be provided
            if (error instanceof BadRequestException) {
              throw error;
            }
            this.logger.warn(
              `Failed to fetch eKYC status for session ${dto.ekycSessionId}:`,
              error,
            );
            throw new BadRequestException(
              'Không thể lấy dữ liệu eKYC. Vui lòng đảm bảo eKYC đã được xác thực hoặc thử lại sau.',
            );
          }
        }

        // Validate ekycData completeness: fullName, idNumber, address must not be empty
        if (finalEkycData) {
          if (
            !finalEkycData.fullName ||
            !finalEkycData.idNumber ||
            !finalEkycData.address ||
            finalEkycData.fullName.trim() === '' ||
            finalEkycData.idNumber.trim() === '' ||
            finalEkycData.address.trim() === ''
          ) {
            throw new BadRequestException(
              'Dữ liệu eKYC không đầy đủ. Vui lòng đảm bảo họ tên, số CMND/CCCD và địa chỉ đã được điền đầy đủ.',
            );
          }
        } else {
          // If sessionId exists but no data after fetch attempt, reject
          throw new BadRequestException(
            'Dữ liệu eKYC chưa sẵn sàng. Vui lòng đợi eKYC được xác thực hoàn tất.',
          );
        }
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
        // eKYC fields (use final values after validation and fetch)
        ekycSessionId: dto.ekycSessionId,
        ekycData: finalEkycData,
        ekycStatus: finalEkycStatus,
        ekycVerifiedAt: finalEkycVerifiedAt,
        fieldImages: dto.fieldImages || [],
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
          description: dto.description || '',
          amenities: dto.amenities || [],
          businessHours: dto.businessHours,
          contactPhone: dto.contactPhone || '',
          website: dto.website,
        },
      });

      const savedRequest = await registrationRequest.save();

      // Send confirmation email (can be async)
      // await this.emailService.sendFieldOwnerRegistrationSubmitted(user.email, user.fullName);

      return this.mapToRegistrationDto(savedRequest);
    } catch (error) {
      this.logger.error('Error creating registration request:', error);
      if (error instanceof BadRequestException) throw error;
      throw new InternalServerErrorException('Failed to create registration request');
    }
  }

  async confirmPolicy(userId: string): Promise<boolean> {
    const user = await this.userModel.findById(userId);
    if (!user || user.role !== UserRole.FIELD_OWNER) {
      throw new BadRequestException('User is not a field owner');
    }

    const result = await this.fieldOwnerProfileModel.updateOne(
      { user: user._id },
      {
        $set: {
          hasReadPolicy: true,
          policyReadAt: new Date()
        }
      }
    );

    if (result.matchedCount === 0) {
      throw new NotFoundException('Field owner profile not found');
    }

    return true;
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
        const address = request.ekycData?.permanentAddress || request.ekycData?.address;

        // Validate ekycData completeness: fullName, idNumber, address must not be empty
        if (
          !request.ekycData ||
          !request.ekycData.fullName ||
          !idNumber ||
          !address ||
          request.ekycData.fullName.trim() === '' ||
          idNumber.trim() === '' ||
          address.trim() === ''
        ) {
          throw new BadRequestException(
            'Cannot approve: eKYC data missing or incomplete. Required fields: fullName, idNumber, address',
          );
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

      const profile = new this.fieldOwnerProfileModel({
        user: request.userId,
        facility: {
          facilityName,
          facilityLocation,
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

  async requestAdditionalInfo(
    requestId: string,
    adminId: string,
    dto: RequestAdditionalInfoRegistrationDto,
  ): Promise<FieldOwnerRegistrationResponseDto> {
    try {
      const request = await this.registrationRequestModel.findById(requestId).exec();

      if (!request) {
        throw new NotFoundException('Registration request not found');
      }

      if (request.status !== RegistrationStatus.PENDING) {
        throw new BadRequestException('Registration request is not pending');
      }

      request.status = RegistrationStatus.CLARIFICATION_REQUESTED;
      request.processedAt = new Date();
      request.processedBy = new Types.ObjectId(adminId);
      request.adminMessage = dto.message;
      await request.save();

      if (request.userId) {
        const user = await this.userModel.findById(request.userId).exec();
        if (user) {
          await this.emailService.sendFieldOwnerRequestInfo(user.email, user.fullName, dto.message);
        }
      }

      return this.mapToRegistrationDto(request);
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error('Error requesting additional info for registration request', error);
      throw new InternalServerErrorException('Failed to request additional info');
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

  /**
   * Auto-heal bank account: promote to VERIFIED if payment is paid but status is still pending
   * @private
   */
  private async autoHealBankAccount(account: any): Promise<void> {
    if (
      account.verificationPaymentStatus === 'paid' &&
      account.status === BankAccountStatus.PENDING
    ) {
      this.logger.warn(
        `[Auto-Heal] Field owner bank account ${account._id} has paid verification but status is still pending. Promoting to VERIFIED...`,
      );
      account.status = BankAccountStatus.VERIFIED;
      account.isValidatedByPayOS = true;
      if (!account.verifiedAt) {
        account.verifiedAt = new Date();
      }
      await account.save();
      this.logger.log(`[Auto-Heal] ✅ Field owner bank account ${account._id} promoted to VERIFIED`);
    }
  }

  async getBankAccountsByFieldOwner(profileId: string): Promise<BankAccountResponseDto[]> {
    try {
      const accounts = await this.bankAccountModel
        .find({ fieldOwner: new Types.ObjectId(profileId) })
        .sort({ isDefault: -1, createdAt: -1 })
        .exec();

      // ✅ AUTO-HEAL: Promote to VERIFIED if payment is paid but status is still pending
      for (const account of accounts) {
        await this.autoHealBankAccount(account);
      }

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

      // ✅ FIX: Update bank account with verification order code FIRST
      // This ensures the webhook can find the bank account by verificationOrderCode
      // even if it arrives very quickly after payment creation
      bankAccount.verificationOrderCode = String(orderCode);
      bankAccount.verificationPaymentStatus = 'pending';
      bankAccount.verificationAmount = verificationAmount;
      await bankAccount.save();

      this.logger.log(
        `Updated bank account ${bankAccountId} with verificationOrderCode=${orderCode} before creating PayOS link`,
      );

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

      // Update bank account with PayOS payment link URLs
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

      // ✅ RETRY LOGIC: Handle edge case where webhook arrives before DB save completes
      let bankAccount: (BankAccount & { _id: any }) | null = null;
      const maxRetries = 3;
      const retryDelayMs = 500;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        // Find bank account by verification order code
        bankAccount = await this.bankAccountModel
          .findOne({
            verificationOrderCode: String(orderCode),
          })
          .exec();

        if (bankAccount) {
          break; // Found it!
        }

        if (attempt < maxRetries) {
          this.logger.warn(
            `[Verification Webhook] Bank account not found for orderCode ${orderCode} (attempt ${attempt}/${maxRetries}). ` +
            `Retrying in ${retryDelayMs}ms...`,
          );
          await new Promise(resolve => setTimeout(resolve, retryDelayMs));
        }
      }

      if (!bankAccount) {
        this.logger.error(
          `[Verification Webhook] ❌ Bank account not found for verification orderCode: ${orderCode} after ${maxRetries} attempts. ` +
          `This may indicate a data consistency issue or timing problem.`,
        );
        throw new NotFoundException(
          `Bank account not found for verification orderCode ${orderCode}. ` +
          `Payment may have arrived before BankAccount was fully saved. PayOS will retry.`
        );
      }

      // Determine owner type (coach vs field owner)
      const ownerType = bankAccount.coach ? 'coach' : 'field owner';
      const ownerId = bankAccount.coach || bankAccount.fieldOwner;

      this.logger.log(
        `[Verification Webhook] Found bank account ${bankAccount._id} for ${ownerType} ${ownerId}. ` +
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

      // Note: Auto-heal logic removed - now handled by getBankAccountsByFieldOwner()
      // This method just returns current state

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

  /**
   * Sync courts for a field based on the desired number of courts
   * @param fieldId The field ID
   * @param targetCount The desired number of courts
   */
  private async syncCourts(fieldId: string, targetCount: number) {
    if (isNaN(targetCount) || targetCount < 0) {
      throw new BadRequestException('Invalid number of courts');
    }

    const fieldObjectId = new Types.ObjectId(fieldId);

    // Fetch all existing courts (active and inactive if any, but usually we care about active or all)
    // We sort by courtNumber to easily identify which ones to remove from the end
    const currentCourts = await this.courtModel
      .find({ field: fieldObjectId })
      .sort({ courtNumber: 1 })
      .exec();

    const currentCount = currentCourts.length;

    if (targetCount === currentCount) {
      return;
    }

    if (targetCount > currentCount) {
      // Add new courts
      const courtsToAdd: any[] = [];
      const field = await this.fieldModel.findById(fieldId).select('sportType').exec();
      const sportType = (field?.sportType as SportType) || SportType.FOOTBALL; // Default fallback

      // Find the maximum court number to avoid duplicate key errors
      const maxCourtNumber = currentCourts.length > 0
        ? Math.max(...currentCourts.map(c => c.courtNumber))
        : 0;

      const courtsNeeded = targetCount - currentCount;
      for (let i = 1; i <= courtsNeeded; i++) {
        const courtNumber = maxCourtNumber + i;
        courtsToAdd.push({
          name: `Sân ${courtNumber}`,
          courtNumber: courtNumber,
          field: fieldObjectId,
          isActive: true, // Default active
        });
      }

      if (courtsToAdd.length > 0) {
        await this.courtModel.insertMany(courtsToAdd);
        this.logger.log(`Added ${courtsToAdd.length} courts to field ${fieldId}`);
      }


    } else if (targetCount < currentCount) {
      // Remove excess courts from the end (highest court numbers)
      const courtsToRemove = currentCourts.slice(targetCount); // Get elements from index targetCount to end
      const courtIdsToRemove = courtsToRemove.map(c => c._id);
      const courtNumbersToRemove = courtsToRemove.map(c => c.courtNumber).join(', ');

      this.logger.log(`Attempting to remove courts: ${courtNumbersToRemove} from field ${fieldId}`);

      // CHECK FOR BOOKINGS ON THESE COURTS
      // We check for active bookings that are relevant
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const activeBookings = await this.bookingModel.findOne({
        court: { $in: courtIdsToRemove },
        status: { $in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] },
        date: { $gte: todayStart }
      }).exec();

      if (activeBookings) {
        throw new BadRequestException(
          `Không thể giảm số lượng sân vì đang có lịch đặt trên các sân sẽ bị xóa (Sân ${courtNumbersToRemove}). Vui lòng kiểm tra và hủy lịch đặt trước.`
        );
      }

      // If safe, delete them
      await this.courtModel.deleteMany({
        _id: { $in: courtIdsToRemove }
      });

      this.logger.log(`Deleted ${courtsToRemove.length} courts from field ${fieldId}`);
    }



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

  // ============================================================================
  // FIELD QR CODE MANAGEMENT
  // ============================================================================

  /**
   * Generate or get existing QR code for a field
   * @param fieldId - The field ID
   * @param ownerId - The owner user ID
   * @returns QR code information
   */
  async generateFieldQrCode(fieldId: string, ownerId: string) {
    try {
      // 1. Verify field existence and ownership
      const field = await this.verifyFieldOwnership(fieldId, ownerId);

      // 2. Check if QR code already exists
      let existingQrCode = await this.fieldQrCodeModel.findOne({
        field: new Types.ObjectId(fieldId),
        isActive: true
      });

      if (existingQrCode) {
        this.logger.log(`[Field QR] QR code already exists for field ${fieldId}, returning existing`);
        return {
          fieldId: (field._id as Types.ObjectId).toString(),
          fieldName: field.name,
          qrToken: existingQrCode.qrToken,
          qrCodeUrl: this.generateQrCodeUrl(existingQrCode.qrToken),
          generatedAt: existingQrCode.generatedAt,
          isActive: existingQrCode.isActive,
        };
      }

      // 3. Generate new QR token
      const qrToken = await this.qrCheckinService.generateFieldQrToken(fieldId);

      // 4. Save to database
      const qrCode = new this.fieldQrCodeModel({
        field: new Types.ObjectId(fieldId),
        qrToken,
        generatedAt: new Date(),
        isActive: true,
        generatedBy: new Types.ObjectId(ownerId),
      });

      await qrCode.save();

      this.logger.log(`[Field QR] Generated new QR code for field ${fieldId}`);

      return {
        fieldId: (field._id as Types.ObjectId).toString(),
        fieldName: field.name,
        qrToken,
        qrCodeUrl: this.generateQrCodeUrl(qrToken),
        generatedAt: qrCode.generatedAt,
        isActive: qrCode.isActive,
      };
    } catch (error) {
      this.logger.error(`[Field QR] Error generating QR code for field ${fieldId}:`, error);
      if (error instanceof BadRequestException || error instanceof ForbiddenException || error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to generate field QR code');
    }
  }

  /**
   * Get existing QR code for a field
   * @param fieldId - The field ID
   * @param ownerId - The owner user ID
   * @returns QR code information or null
   */
  async getFieldQrCode(fieldId: string, ownerId: string) {
    try {
      // 1. Verify field ownership
      const field = await this.verifyFieldOwnership(fieldId, ownerId);

      // 2. Find QR code
      const qrCode = await this.fieldQrCodeModel.findOne({
        field: new Types.ObjectId(fieldId),
        isActive: true,
      });

      if (!qrCode) {
        return null;
      }

      return {
        fieldId: (field._id as Types.ObjectId).toString(),
        fieldName: field.name,
        qrToken: qrCode.qrToken,
        qrCodeUrl: this.generateQrCodeUrl(qrCode.qrToken),
        generatedAt: qrCode.generatedAt,
        isActive: qrCode.isActive,
      };
    } catch (error) {
      this.logger.error(`[Field QR] Error getting QR code for field ${fieldId}:`, error);
      if (error instanceof BadRequestException || error instanceof ForbiddenException || error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to get field QR code');
    }
  }

  /**
   * Regenerate QR code for a field (invalidate old, create new)
   * @param fieldId - The field ID
   * @param ownerId - The owner user ID
   * @returns New QR code information
   */
  async regenerateFieldQrCode(fieldId: string, ownerId: string) {
    try {
      // 1. Verify field ownership
      const field = await this.verifyFieldOwnership(fieldId, ownerId);

      // 2. Mark old QR codes as inactive
      await this.fieldQrCodeModel.updateMany(
        { field: new Types.ObjectId(fieldId) },
        { isActive: false }
      );

      this.logger.log(`[Field QR] Marked old QR codes as inactive for field ${fieldId}`);

      // 3. Generate new QR token
      const qrToken = await this.qrCheckinService.generateFieldQrToken(fieldId);

      // 4. Save new QR code
      const qrCode = new this.fieldQrCodeModel({
        field: new Types.ObjectId(fieldId),
        qrToken,
        generatedAt: new Date(),
        isActive: true,
        generatedBy: new Types.ObjectId(ownerId),
      });

      await qrCode.save();

      this.logger.log(`[Field QR] Regenerated QR code for field ${fieldId}`);

      return {
        fieldId: (field._id as Types.ObjectId).toString(),
        fieldName: field.name,
        qrToken,
        qrCodeUrl: this.generateQrCodeUrl(qrToken),
        generatedAt: qrCode.generatedAt,
        isActive: qrCode.isActive,
      };
    } catch (error) {
      this.logger.error(`[Field QR] Error regenerating QR code for field ${fieldId}:`, error);
      if (error instanceof BadRequestException || error instanceof ForbiddenException || error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to regenerate field QR code');
    }
  }

  /**
   * Helper: Verify field exists and user owns it
   */
  private async verifyFieldOwnership(fieldId: string, ownerId: string) {
    if (!Types.ObjectId.isValid(fieldId)) {
      throw new BadRequestException('Invalid field ID format');
    }

    const field = await this.fieldModel.findById(fieldId).exec();
    if (!field) {
      throw new NotFoundException('Field not found');
    }

    // Get field owner profile
    const ownerProfile = await this.fieldOwnerProfileModel.findOne({
      user: new Types.ObjectId(ownerId)
    }).exec();

    if (!ownerProfile) {
      this.logger.warn(`[verifyFieldOwnership] Field owner profile not found for user ${ownerId}`);
      throw new ForbiddenException('You are not a field owner. Please ensure your field owner profile is set up correctly.');
    }

    const fieldOwnerId = field.owner.toString();
    const ownerProfileId = (ownerProfile._id as Types.ObjectId).toString();

    // Log detailed information for debugging
    this.logger.debug(`[verifyFieldOwnership] Checking ownership:`, {
      fieldId,
      fieldName: field.name,
      userId: ownerId,
      fieldOwnerId,
      ownerProfileId,
      match: fieldOwnerId === ownerProfileId,
    });

    // Check if user owns this field
    if (fieldOwnerId !== ownerProfileId) {
      // Additional check: maybe field.owner is User ID instead of FieldOwnerProfile ID
      // This can happen if fields were created before the FieldOwnerProfile system was implemented
      if (field.owner.toString() === ownerId) {
        this.logger.warn(`[verifyFieldOwnership] Field ${fieldId} has User ID as owner instead of FieldOwnerProfile ID. Field owner: ${fieldOwnerId}, User ID: ${ownerId}`);
        // Allow access but log warning - this is a data inconsistency that should be fixed
        this.logger.warn(`[verifyFieldOwnership] Allowing access due to legacy data format. Consider migrating field ${fieldId} to use FieldOwnerProfile ID.`);
        return field;
      }

      this.logger.error(`[verifyFieldOwnership] Ownership mismatch for field ${fieldId}:`, {
        fieldOwnerId,
        ownerProfileId,
        userId: ownerId,
        fieldName: field.name,
      });
      throw new ForbiddenException(
        `You do not own this field. Field owner ID: ${fieldOwnerId}, Your profile ID: ${ownerProfileId}. ` +
        `If you believe this is an error, please contact support.`
      );
    }

    return field;
  }

  /**
   * Helper: Generate QR code URL from token
   */
  private generateQrCodeUrl(token: string): string {
    // You can integrate with a QR code generation service here
    // For now, return a URL that can be used to generate QR code on frontend
    const clientUrl = this.configService.get('CLIENT_URL') || 'http://localhost:5173';
    return `${clientUrl}/qr-checkin?token=${encodeURIComponent(token)}`;
  }
}

