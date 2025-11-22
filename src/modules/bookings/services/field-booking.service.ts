import { Injectable, NotFoundException, BadRequestException, Logger, InternalServerErrorException } from '@nestjs/common';
import { InjectModel, InjectConnection } from '@nestjs/mongoose';
import { Model, Types, Connection, ClientSession } from 'mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Booking, BookingStatus, BookingType } from '../entities/booking.entity';
import { Schedule } from '../../schedules/entities/schedule.entity';
import { Field } from '../../fields/entities/field.entity';
import { FieldOwnerProfile } from '../../fields/entities/field-owner-profile.entity';
import { User } from '../../users/entities/user.entity';
import { TransactionsService } from '../../transactions/transactions.service';
import { EmailService } from '../../email/email.service';
import { PaymentMethod } from '@common/enums/payment-method.enum';
import { CreateFieldBookingLazyDto } from '../dto/create-field-booking-lazy.dto';
import { AvailabilityService } from './availability.service';

/**
 * Field Booking Service
 * Handles field booking creation and management
 */
@Injectable()
export class FieldBookingService {
  private readonly logger = new Logger(FieldBookingService.name);

  constructor(
    @InjectModel(Booking.name) private readonly bookingModel: Model<Booking>,
    @InjectModel(Schedule.name) private readonly scheduleModel: Model<Schedule>,
    @InjectModel(Field.name) private readonly fieldModel: Model<Field>,
    @InjectModel(FieldOwnerProfile.name) private readonly fieldOwnerProfileModel: Model<FieldOwnerProfile>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectConnection() private readonly connection: Connection,
    private readonly eventEmitter: EventEmitter2,
    private readonly transactionsService: TransactionsService,
    private readonly emailService: EmailService,
    private readonly availabilityService: AvailabilityService,
  ) {}

  /**
   * Create field booking with Pure Lazy Creation pattern
   * Uses atomic upsert for Schedule creation with optimistic locking
   * ✅ SECURITY: Race condition protected, no Redis needed
   */
  async createFieldBookingLazy(
    userId: string,
    bookingData: CreateFieldBookingLazyDto
  ): Promise<Booking> {
    const session: ClientSession = await this.connection.startSession();

    try {
      return await session.withTransaction(async () => {
        // Validate field
        const field = await this.fieldModel.findById(bookingData.fieldId).session(session);
        if (!field || !field.isActive) {
          throw new NotFoundException('Field not found or inactive');
        }

        // Parse booking date
        const bookingDate = new Date(bookingData.date);

        // Validate time slots
        this.availabilityService.validateTimeSlots(bookingData.startTime, bookingData.endTime, field, bookingDate);
        
        // Calculate slots and pricing
        const numSlots = this.availabilityService.calculateNumSlots(bookingData.startTime, bookingData.endTime, field.slotDuration);
        const pricingInfo = this.availabilityService.calculatePricing(bookingData.startTime, bookingData.endTime, field, bookingDate);

        // ✅ SECURITY: Atomic upsert with version initialization (Pure Lazy Creation)
        const scheduleUpdate = await this.scheduleModel.findOneAndUpdate(
          {
            field: new Types.ObjectId(bookingData.fieldId),
            date: bookingDate
          },
          {
            $setOnInsert: {
              field: new Types.ObjectId(bookingData.fieldId),
              date: bookingDate,
              bookedSlots: [],
              isHoliday: false
              // ❌ Không set version ở đây - sẽ conflict với $inc
            },
            // ✅ Increment version: insert sẽ tạo version=1, update sẽ increment
            $inc: { version: 1 }
          },
          {
            upsert: true,
            new: true,
            session
            // ❌ writeConcern không được phép trong transaction - chỉ dùng ở transaction level
          }
        ).exec();

        // Validate slot availability and not holiday
        if (scheduleUpdate.isHoliday) {
          throw new BadRequestException(`Cannot book on holiday: ${scheduleUpdate.holidayReason}`);
        }

        // ✅ CRITICAL SECURITY: Re-check conflicts with LATEST data from transaction
        // This prevents race conditions where 2 requests pass the check simultaneously
        const hasConflict = this.availabilityService.checkSlotConflict(
          bookingData.startTime,
          bookingData.endTime,
          scheduleUpdate.bookedSlots
        );

        if (hasConflict) {
          throw new BadRequestException('Selected time slots are not available');
        }

        // Calculate amenities fee if provided
        let amenitiesFee = 0;
        if (bookingData.selectedAmenities && bookingData.selectedAmenities.length > 0) {
          // TODO: Calculate amenities fee from Amenity model
          amenitiesFee = 0; // Placeholder
        }

        // Calculate booking amount and platform fee
        const bookingAmount = pricingInfo.totalPrice + amenitiesFee; // Court fee + amenities
        const platformFeeRate = 0.05; // 5% platform fee
        const platformFee = Math.round(bookingAmount * platformFeeRate);
        const totalPrice = bookingAmount + platformFee; // For backward compatibility

        // Determine booking status based on payment method and note
        // ✅ CRITICAL: Online payments (PayOS, VNPay, etc.) must be PENDING until payment succeeds
        // Only CASH payments can be CONFIRMED immediately (if no note)
        const paymentMethod = bookingData.paymentMethod ?? PaymentMethod.CASH;
        const isOnlinePayment = paymentMethod === PaymentMethod.PAYOS || 
                                paymentMethod === PaymentMethod.VNPAY ||
                                paymentMethod === PaymentMethod.MOMO ||
                                paymentMethod === PaymentMethod.ZALOPAY ||
                                paymentMethod === PaymentMethod.EBANKING ||
                                paymentMethod === PaymentMethod.CREDIT_CARD ||
                                paymentMethod === PaymentMethod.DEBIT_CARD ||
                                paymentMethod === PaymentMethod.QR_CODE;
        
        // Booking status logic:
        // - Online payments: Always PENDING (wait for payment confirmation)
        // - Cash with note: PENDING (needs confirmation)
        // - Cash without note: CONFIRMED (immediate confirmation)
        const bookingStatus = isOnlinePayment || bookingData.note
          ? BookingStatus.PENDING
          : BookingStatus.CONFIRMED;

        // Create Booking with snapshot data
        const booking = new this.bookingModel({
          user: new Types.ObjectId(userId),
          field: new Types.ObjectId(bookingData.fieldId),
          date: bookingDate,
          type: BookingType.FIELD,
          startTime: bookingData.startTime,
          endTime: bookingData.endTime,
          numSlots,
          status: bookingStatus,
          bookingAmount: bookingAmount,
          platformFee: platformFee,
          totalPrice: totalPrice, // For backward compatibility
          amenitiesFee,
          selectedAmenities: bookingData.selectedAmenities?.map(id => new Types.ObjectId(id)) || [],
          note: bookingData.note,
          pricingSnapshot: {
            basePrice: field.basePrice,
            appliedMultiplier: pricingInfo.multiplier,
            priceBreakdown: pricingInfo.breakdown
          }
        });

        await booking.save({ session });

        // ✅ CRITICAL: Create Payment record WITHIN transaction session
        // This ensures payment is rolled back if booking fails
        // Use totalAmount (bookingAmount + platformFee) for payment amount
        const totalAmount = bookingAmount + platformFee;
        const payment = await this.transactionsService.createPayment({
          bookingId: (booking._id as Types.ObjectId).toString(),
          userId: userId,
          amount: totalAmount,
          method: bookingData.paymentMethod ?? PaymentMethod.CASH,
          paymentNote: bookingData.paymentNote
        }, session);

        // Update booking with transaction reference
        booking.transaction = payment._id as Types.ObjectId;
        await booking.save({ session });

        // ✅ CRITICAL SECURITY: Atomic update with optimistic locking
        // Use current version from scheduleUpdate to prevent concurrent modifications
        const scheduleUpdateResult = await this.scheduleModel.findOneAndUpdate(
          {
            _id: scheduleUpdate._id,
            version: scheduleUpdate.version // ✅ Optimistic locking check
          },
          {
            $push: {
              bookedSlots: {
                startTime: bookingData.startTime,
                endTime: bookingData.endTime
              }
            },
            $inc: { version: 1 }
          },
          { 
            session,
            new: true
            // ❌ writeConcern không được phép trong transaction - chỉ dùng ở transaction level
          }
        ).exec();

        // ✅ SECURITY: If version mismatch (another booking modified it), fail the transaction
        if (!scheduleUpdateResult) {
          throw new BadRequestException('Slot was booked by another user. Please refresh and try again.');
        }

        // Emit event for notifications
        this.eventEmitter.emit('booking.created', {
          bookingId: booking._id,
          userId,
          fieldId: bookingData.fieldId,
          date: bookingData.date,
          startTime: bookingData.startTime,
          endTime: bookingData.endTime
        });

        // Send email notification to field owner and customer
        await this.sendBookingEmails(booking, field, userId, bookingData, pricingInfo, amenitiesFee);

        return booking;
      }, {
        // ✅ SECURITY: Transaction options for data integrity
        readConcern: { level: 'snapshot' },      // Isolation level - prevents dirty reads
        writeConcern: { w: 'majority', j: true }, // Durability - ensures write to majority of replicas
        maxCommitTimeMS: 15000                     // 15 second timeout for the entire transaction
      });

    } catch (error) {
      this.logger.error('Error creating field booking', error);
      
      // Re-throw known exceptions as-is
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      
      // ✅ SECURITY: Detect optimistic locking failures (version mismatch)
      if (error.message?.includes('Slot was booked')) {
        throw new BadRequestException('Slot was booked by another user. Please refresh availability and try again.');
      }
      
      // Generic error for unexpected issues
      throw new InternalServerErrorException('Failed to create booking. Please try again.');
    } finally {
      await session.endSession();
    }
  }

  /**
   * Mark holiday with Pure Lazy Creation
   * Upserts Schedule and handles affected bookings
   */
  async markHoliday(
    fieldId: string,
    date: string,
    reason: string
  ): Promise<{ schedule: Schedule; affectedBookings: Booking[] }> {
    const session: ClientSession = await this.connection.startSession();

    try {
      return await session.withTransaction(async () => {
        // Validate field
        const field = await this.fieldModel.findById(fieldId).session(session);
        if (!field) {
          throw new NotFoundException('Field not found');
        }

        const holidayDate = new Date(date);

        // Atomic upsert Schedule for holiday
        const schedule = await this.scheduleModel.findOneAndUpdate(
          {
            field: new Types.ObjectId(fieldId),
            date: holidayDate
          },
          {
            $set: {
              isHoliday: true,
              holidayReason: reason
            },
            $setOnInsert: {
              field: new Types.ObjectId(fieldId),
              date: holidayDate,
              bookedSlots: [],
              version: 0
            },
            $inc: { version: 1 }
          },
          {
            upsert: true,
            new: true,
            session
          }
        ).exec();

        // Query affected bookings (chỉ cần tìm CONFIRMED vì không còn PENDING)
        const affectedBookings = await this.bookingModel
          .find({
            field: new Types.ObjectId(fieldId),
            date: holidayDate,
            status: BookingStatus.CONFIRMED
          })
          .session(session)
          .exec();

        // Apply cancellation policy for affected bookings
        for (const booking of affectedBookings) {
          booking.status = BookingStatus.CANCELLED;
          booking.cancellationReason = `Holiday: ${reason}`;
          booking.holidayNotified = true;
          await booking.save({ session });

          // Emit notification event
          this.eventEmitter.emit('booking.cancelled.holiday', {
            bookingId: booking._id,
            userId: booking.user,
            fieldId,
            date,
            reason
          });
        }

        // Clear booked slots since all bookings are cancelled
        if (affectedBookings.length > 0) {
          schedule.bookedSlots = [];
          await schedule.save({ session });
        }

        return { schedule, affectedBookings };
      });

    } catch (error) {
      this.logger.error('Error marking holiday', error);
      throw new InternalServerErrorException('Failed to mark holiday');
    } finally {
      await session.endSession();
    }
  }

  /**
   * Send booking confirmation emails
   */
  private async sendBookingEmails(
    booking: any,
    field: any,
    userId: string,
    bookingData: CreateFieldBookingLazyDto,
    pricingInfo: any,
    amenitiesFee: number
  ): Promise<void> {
    try {
      // Get field owner profile and user email
      const ownerProfileId = ((field as any).owner && (field as any).owner.toString) 
        ? (field as any).owner.toString() 
        : (field as any).owner;
      
      let fieldOwnerProfile = await this.fieldOwnerProfileModel
        .findById(ownerProfileId)
        .lean()
        .exec();

      // Fallback: some data may store field.owner as userId instead of FieldOwnerProfileId
      if (!fieldOwnerProfile) {
        fieldOwnerProfile = await this.fieldOwnerProfileModel
          .findOne({ user: new Types.ObjectId(ownerProfileId) })
          .lean()
          .exec();
      }

      let ownerEmail: string | undefined;
      let ownerUserId: string | undefined;
      if (fieldOwnerProfile?.user) {
        ownerUserId = (fieldOwnerProfile.user as any).toString();
      } else {
        // If profile not found, assume ownerProfileId is actually userId
        ownerUserId = ownerProfileId;
      }

      if (ownerUserId && Types.ObjectId.isValid(ownerUserId)) {
        const ownerUser = await this.userModel
          .findById(ownerUserId)
          .select('email fullName phone')
          .lean()
          .exec();
        ownerEmail = ownerUser?.email;
      }

      // Get customer user info
      const customerUser = await this.userModel
        .findById(userId)
        .select('fullName email phone')
        .lean()
        .exec();

      // Send email immediately only for CASH payments; otherwise wait for payment success event
      const shouldSendNow = (bookingData.paymentMethod ?? PaymentMethod.CASH) === PaymentMethod.CASH;
      if (shouldSendNow && customerUser) {
        const toVnd = (amount: number) => amount.toLocaleString('vi-VN') + '₫';
        const emailPayload = {
          field: { name: field.name, address: (field as any)?.location?.address || '' },
          customer: { fullName: customerUser.fullName, phone: (customerUser as any).phone, email: customerUser.email },
          booking: {
            date: new Date(bookingData.date).toLocaleDateString('vi-VN'),
            startTime: bookingData.startTime,
            endTime: bookingData.endTime,
            services: [],
          },
          pricing: {
            services: [],
            fieldPriceFormatted: toVnd(pricingInfo.totalPrice),
            totalFormatted: toVnd(pricingInfo.totalPrice + amenitiesFee),
          },
          paymentMethod: bookingData.paymentMethod,
        };

        // Send email to field owner
        if (ownerEmail) {
          await this.emailService.sendFieldOwnerBookingNotification({
            ...emailPayload,
            to: ownerEmail,
            preheader: 'Thông báo đặt sân mới',
          });
        }

        // Send email to customer
        if (customerUser.email) {
          await this.emailService.sendCustomerBookingConfirmation({
            ...emailPayload,
            to: customerUser.email,
            preheader: 'Xác nhận đặt sân thành công',
          });
        }
      }
    } catch (mailErr) {
      this.logger.warn('Failed to send booking emails', mailErr as any);
    }
  }
}
