#!/usr/bin/env ts-node

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../src/app.module';
import { AmenitiesService } from '../../src/modules/amenities/amenities.service';
import { FieldOwnerService } from '@modules/field-owner/field-owner.service';
import { InjectModel, getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Booking } from '../../src/modules/bookings/entities/booking.entity';
import { Schedule } from '../../src/modules/schedules/entities/schedule.entity';
import { Transaction } from '../../src/modules/transactions/entities/transaction.entity';
import { TransactionType } from '../../src/common/enums/transaction.enum';
import { Types } from 'mongoose';
import { Field } from '../../src/modules/fields/entities/field.entity';
import { Court } from '../../src/modules/courts/entities/court.entity';

const amenitiesLibrary = require('./amenities-library.json');
const fieldLibrary = require('./field-library.json');
const fieldLibraryV2 = require('./field-library-v2.json');
const courtLibrary = require('./court-library.json');
const bookingLibrary = require('./bookìng-libary.json');
const scheduleLibrary = require('./schedule-library.json');
const transactionLibrary = require('./transaction-libary.json');

interface ImportOptions {
  amenities?: boolean;
  users?: boolean;
  fields?: boolean;
  fieldsV2?: boolean;
  courts?: boolean;
  bookings?: boolean;
  schedules?: boolean;
  transactions?: boolean;
  reviews?: boolean;
  clear?: boolean;
  skipDuplicates?: boolean;
  updateDuplicates?: boolean; // Xóa và update record trùng
}

class CLIImporter {
  private app: any;
  private amenitiesService: AmenitiesService;
  private fieldOwnerService: FieldOwnerService;
  private fieldModel: Model<Field>;
  private courtModel: Model<Court>;
  private bookingModel: Model<Booking>;
  private scheduleModel: Model<Schedule>;
  private transactionModel: Model<Transaction>;

  async initialize() {
    console.log('🚀 Initializing CLI Mock Data Importer...');
    this.app = await NestFactory.createApplicationContext(AppModule);
    this.amenitiesService = this.app.get(AmenitiesService);
    this.fieldOwnerService = this.app.get(FieldOwnerService);
    this.fieldModel = this.app.get(getModelToken(Field.name));
    this.courtModel = this.app.get(getModelToken(Court.name));
    this.bookingModel = this.app.get(getModelToken(Booking.name));
    this.scheduleModel = this.app.get(getModelToken(Schedule.name));
    this.transactionModel = this.app.get(getModelToken(Transaction.name));
    console.log('✅ Application context initialized');
  }

  async importAmenities(options: ImportOptions) {
    console.log('📦 Importing amenities...');
    
    try {
      let importedCount = 0;
      let skippedCount = 0;

      for (const amenityData of amenitiesLibrary) {
        try {
          // Check if amenity already exists (if skipDuplicates is enabled)
          if (options.skipDuplicates !== false) {
            const existing = await this.amenitiesService.findAll({
              search: amenityData.name,
              limit: 1
            });
            
            if (existing.data && existing.data.length > 0) {
              console.log(`⏭️  Skipping existing amenity: ${amenityData.name}`);
              skippedCount++;
              continue;
            }
          }

          // Create amenity
          await this.amenitiesService.create(amenityData);
          console.log(`✅ Imported: ${amenityData.name}`);
          importedCount++;

        } catch (error) {
          console.error(`❌ Failed to import ${amenityData.name}:`, error.message);
        }
      }

      console.log(`\n📊 Amenities Import Summary:`);
      console.log(`   ✅ Imported: ${importedCount}`);
      console.log(`   ⏭️  Skipped: ${skippedCount}`);
      console.log(`   📦 Total: ${amenitiesLibrary.length}`);

    } catch (error) {
      console.error('❌ Error importing amenities:', error);
    }
  }

  async importFields(options: ImportOptions) {
    console.log('🏟️  Importing fields...');

    try {
      let importedCount = 0;
      let skippedCount = 0;

      for (const fieldData of fieldLibrary) {
        try {
          // Skip duplicates by name (and sportType) when enabled
          if (options.skipDuplicates !== false) {
            const existing = await this.fieldOwnerService.findByOwner(fieldData.owner, {
              name: fieldData.name,
              sportType: fieldData.sportType,
            });

            if (existing?.fields?.length > 0) {
              console.log(`⏭️  Skipping existing field: ${fieldData.name}`);
              skippedCount++;
              continue;
            }
          }

          // Map amenities from { amenity, price } -> { amenityId, price }
          const amenities = Array.isArray(fieldData.amenities)
            ? fieldData.amenities.map((a: any) => ({ amenityId: a.amenity, price: a.price }))
            : [];

          // Build CreateFieldDto
          const createFieldDto: any = {
            name: fieldData.name,
            sportType: fieldData.sportType,
            description: fieldData.description,
            location: fieldData.location,
            images: fieldData.images || [],
            operatingHours: fieldData.operatingHours,
            slotDuration: fieldData.slotDuration,
            minSlots: fieldData.minSlots,
            maxSlots: fieldData.maxSlots,
            priceRanges: fieldData.priceRanges || [],
            basePrice: fieldData.basePrice,
            amenities,
          };

          // Owner comes from JSON
          const ownerId: string = fieldData.owner;

          await this.fieldOwnerService.create(createFieldDto, ownerId);
          console.log(`✅ Imported field: ${fieldData.name}`);
          importedCount++;

        } catch (error) {
          console.error(`❌ Failed to import field ${fieldData?.name}:`, (error as any)?.message || error);
        }
      }

      console.log(`\n📊 Fields Import Summary:`);
      console.log(`   ✅ Imported: ${importedCount}`);
      console.log(`   ⏭️  Skipped: ${skippedCount}`);
      console.log(`   📦 Total: ${fieldLibrary.length}`);

    } catch (error) {
      console.error('❌ Error importing fields:', error);
    }
  }

  // Helper function to safely parse ObjectId
  private safeObjectId(id: string | { $oid: string }): Types.ObjectId | null {
    try {
      const idStr = typeof id === 'string' ? id : id.$oid;
      // Validate ObjectId format (24 hex characters)
      if (!/^[0-9a-fA-F]{24}$/.test(idStr)) {
        console.warn(`⚠️  Invalid ObjectId format: ${idStr}`);
        return null;
      }
      return new Types.ObjectId(idStr);
    } catch (error) {
      console.warn(`⚠️  Failed to parse ObjectId: ${id}`);
      return null;
    }
  }

  private sanitizeOperatingHours(operatingHours?: Array<any>) {
    if (!Array.isArray(operatingHours)) return [];
    return operatingHours.map((oh) => ({
      day: oh.day,
      start: oh.start,
      end: oh.end,
      duration: oh.duration,
    }));
  }

  private sanitizePriceRanges(priceRanges?: Array<any>) {
    if (!Array.isArray(priceRanges)) return [];
    return priceRanges.map((pr) => ({
      day: pr.day,
      start: pr.start,
      end: pr.end,
      multiplier: pr.multiplier,
    }));
  }

  async importFieldsV2(options: ImportOptions) {
    console.log('🏟️  Importing fields (fixed IDs)...');

    try {
      let importedCount = 0;
      let updatedCount = 0;
      let skippedCount = 0;
      let errorCount = 0;

      for (const fieldData of fieldLibraryV2) {
        try {
          const fieldId = this.safeObjectId(fieldData._id);
          const ownerId = this.safeObjectId(fieldData.owner);

          if (!fieldId || !ownerId) {
            console.error(`❌ Invalid field or owner ID for field ${fieldData?.name || '<unknown>'}`);
            errorCount++;
            continue;
          }

          const existing = await this.fieldModel.findById(fieldId);

          if (existing) {
            if (options.updateDuplicates) {
              await this.fieldModel.findByIdAndDelete(fieldId);
              console.log(`🔄 Deleted existing field: ${fieldId} (will update)`);
            } else if (options.skipDuplicates !== false) {
              console.log(`⏭️  Skipping existing field: ${fieldId}`);
              skippedCount++;
              continue;
            } else {
              await this.fieldModel.findByIdAndDelete(fieldId);
              console.log(`🔄 Deleted existing field: ${fieldId} (will update)`);
            }
          }

          const fieldDoc = new this.fieldModel({
            _id: fieldId,
            owner: ownerId,
            name: fieldData.name,
            sportType: fieldData.sportType,
            description: fieldData.description,
            images: fieldData.images || [],
            operatingHours: this.sanitizeOperatingHours(fieldData.operatingHours),
            slotDuration: fieldData.slotDuration,
            minSlots: fieldData.minSlots,
            maxSlots: fieldData.maxSlots,
            priceRanges: this.sanitizePriceRanges(fieldData.priceRanges),
            basePrice: fieldData.basePrice,
            isActive: fieldData.isActive !== false,
            rating: fieldData.rating ?? 0,
            totalReviews: fieldData.totalReviews ?? 0,
            location: fieldData.location,
            pendingPriceUpdates: Array.isArray(fieldData.pendingPriceUpdates) ? fieldData.pendingPriceUpdates : [],
            amenities: Array.isArray(fieldData.amenities)
              ? fieldData.amenities
                  .map((a: any) => ({
                    amenity: this.safeObjectId(a.amenity) || a.amenity,
                    price: a.price ?? 0,
                  }))
                  .filter((a: any) => a.amenity)
              : [],
            createdAt: fieldData.createdAt?.$date ? new Date(fieldData.createdAt.$date) : undefined,
            updatedAt: fieldData.updatedAt?.$date ? new Date(fieldData.updatedAt.$date) : undefined,
          });

          await fieldDoc.save();

          if (existing) {
            console.log(`🔄 Updated field: ${fieldData.name} (${fieldId})`);
            updatedCount++;
          } else {
            console.log(`✅ Imported field: ${fieldData.name} (${fieldId})`);
            importedCount++;
          }
        } catch (error) {
          console.error(`❌ Failed to import field ${fieldData?.name || 'unknown'}:`, (error as any)?.message || error);
          errorCount++;
        }
      }

      console.log(`
📊 Fields (v2) Import Summary:`);
      console.log(`   ✅ Imported: ${importedCount}`);
      console.log(`   🔄 Updated: ${updatedCount}`);
      console.log(`   ⏭️  Skipped: ${skippedCount}`);
      console.log(`   ❌ Errors: ${errorCount}`);
      console.log(`   📦 Total: ${fieldLibraryV2.length}`);
    } catch (error) {
      console.error('❌ Error importing fields (v2):', error);
    }
  }

  async importCourts(options: ImportOptions) {
    console.log('🎾 Importing courts...');

    try {
      let importedCount = 0;
      let updatedCount = 0;
      let skippedCount = 0;
      let errorCount = 0;

      for (const courtData of courtLibrary) {
        try {
          const courtId = this.safeObjectId(courtData._id);
          const fieldId = this.safeObjectId(courtData.field);

          if (!courtId || !fieldId) {
            console.error(`❌ Invalid court or field ID for court ${courtData?.name || '<unknown>'}`);
            errorCount++;
            continue;
          }

          const fieldExists = await this.fieldModel.findById(fieldId);
          if (!fieldExists) {
            console.error(`❌ Field not found for court ${courtId}: ${fieldId}`);
            errorCount++;
            continue;
          }

          const existing = await this.courtModel.findById(courtId);

          if (existing) {
            if (options.updateDuplicates) {
              await this.courtModel.findByIdAndDelete(courtId);
              console.log(`🔄 Deleted existing court: ${courtId} (will update)`);
            } else if (options.skipDuplicates !== false) {
              console.log(`⏭️  Skipping existing court: ${courtId}`);
              skippedCount++;
              continue;
            } else {
              await this.courtModel.findByIdAndDelete(courtId);
              console.log(`🔄 Deleted existing court: ${courtId} (will update)`);
            }
          }

          const pricingOverride = courtData.pricingOverride
            ? {
                ...(courtData.pricingOverride.basePrice !== undefined
                  ? { basePrice: courtData.pricingOverride.basePrice }
                  : {}),
                ...(this.sanitizePriceRanges(courtData.pricingOverride.priceRanges).length
                  ? { priceRanges: this.sanitizePriceRanges(courtData.pricingOverride.priceRanges) }
                  : {}),
              }
            : undefined;

          const courtDoc = new this.courtModel({
            _id: courtId,
            field: fieldId,
            name: courtData.name,
            courtNumber: courtData.courtNumber,
            isActive: courtData.isActive !== false,
            ...(pricingOverride ? { pricingOverride } : {}),
            createdAt: courtData.createdAt?.$date ? new Date(courtData.createdAt.$date) : undefined,
            updatedAt: courtData.updatedAt?.$date ? new Date(courtData.updatedAt.$date) : undefined,
          });

          await courtDoc.save();

          if (existing) {
            console.log(`🔄 Updated court: ${courtData.name} (${courtId})`);
            updatedCount++;
          } else {
            console.log(`✅ Imported court: ${courtData.name} (${courtId})`);
            importedCount++;
          }
        } catch (error) {
          console.error(`❌ Failed to import court ${courtData?.name || 'unknown'}:`, (error as any)?.message || error);
          errorCount++;
        }
      }

      console.log(`
📊 Courts Import Summary:`);
      console.log(`   ✅ Imported: ${importedCount}`);
      console.log(`   🔄 Updated: ${updatedCount}`);
      console.log(`   ⏭️  Skipped: ${skippedCount}`);
      console.log(`   ❌ Errors: ${errorCount}`);
      console.log(`   📦 Total: ${courtLibrary.length}`);
    } catch (error) {
      console.error('❌ Error importing courts:', error);
    }
  }

  async importBookings(options: ImportOptions) {
    console.log('📅 Importing bookings...');

    try {
      let importedCount = 0;
      let updatedCount = 0;
      let skippedCount = 0;
      let errorCount = 0;

      for (const bookingData of bookingLibrary) {
        try {
          const bookingId = this.safeObjectId(bookingData._id);
          if (!bookingId) {
            console.error(`❌ Invalid booking ID: ${JSON.stringify(bookingData._id)}`);
            errorCount++;
            continue;
          }

          // Check if booking already exists
          const existing = await this.bookingModel.findById(bookingId);
          
          if (existing) {
            if (options.updateDuplicates) {
              // Delete existing and update with new data
              await this.bookingModel.findByIdAndDelete(bookingId);
              console.log(`🔄 Deleted existing booking: ${bookingId} (will update)`);
            } else if (options.skipDuplicates !== false) {
              console.log(`⏭️  Skipping existing booking: ${bookingId}`);
              skippedCount++;
              continue;
            } else {
              // Delete existing and update with new data (default behavior when skipDuplicates is false)
              await this.bookingModel.findByIdAndDelete(bookingId);
              console.log(`🔄 Deleted existing booking: ${bookingId} (will update)`);
            }
          }

          // Validate required ObjectIds
          const userId = this.safeObjectId(bookingData.user);
          const fieldId = this.safeObjectId(bookingData.field);
          if (!userId || !fieldId) {
            console.error(`❌ Invalid user or field ID for booking ${bookingId}`);
            errorCount++;
            continue;
          }

          // Ensure pricingSnapshot has required fields
          const pricingSnapshot = bookingData.pricingSnapshot || {};
          if (!pricingSnapshot.basePrice && bookingData.bookingAmount) {
            // Calculate basePrice from bookingAmount and numSlots
            pricingSnapshot.basePrice = Math.round(bookingData.bookingAmount / (bookingData.numSlots || 1));
          }
          if (!pricingSnapshot.appliedMultiplier) {
            pricingSnapshot.appliedMultiplier = 1;
          }
          if (!pricingSnapshot.priceBreakdown) {
            pricingSnapshot.priceBreakdown = `${bookingData.startTime}-${bookingData.endTime}: ${bookingData.bookingAmount}đ`;
          }

          // Convert MongoDB extended JSON format to regular format
          const booking = new this.bookingModel({
            _id: bookingId,
            user: userId,
            field: fieldId,
            date: new Date(bookingData.date.$date),
            type: bookingData.type,
            startTime: bookingData.startTime,
            endTime: bookingData.endTime,
            numSlots: bookingData.numSlots,
            status: bookingData.status,
            bookingAmount: bookingData.bookingAmount,
            platformFee: bookingData.platformFee,
            totalPrice: bookingData.totalPrice,
            selectedAmenities: bookingData.selectedAmenities?.map((a: any) => {
              const amenityId = this.safeObjectId(a);
              return amenityId || new Types.ObjectId();
            }) || [],
            amenitiesFee: bookingData.amenitiesFee || 0,
            pricingSnapshot: pricingSnapshot,
            transaction: bookingData.transaction ? this.safeObjectId(bookingData.transaction) : undefined,
            createdAt: bookingData.createdAt?.$date ? new Date(bookingData.createdAt.$date) : new Date(),
            updatedAt: bookingData.updatedAt?.$date ? new Date(bookingData.updatedAt.$date) : new Date(),
          });

          await booking.save();
          if (existing) {
            console.log(`🔄 Updated booking: ${bookingId}`);
            updatedCount++;
          } else {
            console.log(`✅ Imported booking: ${bookingId}`);
            importedCount++;
          }

        } catch (error) {
          console.error(`❌ Failed to import booking ${bookingData._id?.$oid || 'unknown'}:`, (error as any)?.message || error);
          errorCount++;
        }
      }

      console.log(`\n📊 Bookings Import Summary:`);
      console.log(`   ✅ Imported: ${importedCount}`);
      console.log(`   🔄 Updated: ${updatedCount}`);
      console.log(`   ⏭️  Skipped: ${skippedCount}`);
      console.log(`   ❌ Errors: ${errorCount}`);
      console.log(`   📦 Total: ${bookingLibrary.length}`);

    } catch (error) {
      console.error('❌ Error importing bookings:', error);
    }
  }

  async importSchedules(options: ImportOptions) {
    console.log('📆 Importing schedules...');

    try {
      let importedCount = 0;
      let updatedCount = 0;
      let skippedCount = 0;
      let errorCount = 0;

      for (const scheduleData of scheduleLibrary) {
        try {
          const scheduleId = this.safeObjectId(scheduleData._id);
          if (!scheduleId) {
            console.error(`❌ Invalid schedule ID: ${JSON.stringify(scheduleData._id)}`);
            errorCount++;
            continue;
          }

          const fieldId = this.safeObjectId(scheduleData.field);
          if (!fieldId) {
            console.error(`❌ Invalid field ID for schedule ${scheduleId}`);
            errorCount++;
            continue;
          }

          const scheduleDate = new Date(scheduleData.date.$date);

          // Check if schedule already exists by ID or by field+date unique index
          const existingById = await this.scheduleModel.findById(scheduleId);
          const existingByFieldDate = await this.scheduleModel.findOne({
            field: fieldId,
            date: scheduleDate
          });

          if (existingById || existingByFieldDate) {
            const existing = existingById || existingByFieldDate;
            
            if (!existing) {
              // This should not happen, but TypeScript needs this check
              continue;
            }
            
            if (options.updateDuplicates) {
              // Delete existing and update with new data
              await this.scheduleModel.findByIdAndDelete(existing._id);
              console.log(`🔄 Deleted existing schedule: ${existing._id} (will update)`);
            } else if (options.skipDuplicates !== false) {
              console.log(`⏭️  Skipping existing schedule: ${existing._id}`);
              skippedCount++;
              continue;
            } else {
              // Delete existing and update with new data (default behavior when skipDuplicates is false)
              await this.scheduleModel.findByIdAndDelete(existing._id);
              console.log(`🔄 Deleted existing schedule: ${existing._id} (will update)`);
            }
          }

          // Convert MongoDB extended JSON format to regular format
          const schedule = new this.scheduleModel({
            _id: scheduleId,
            field: fieldId,
            date: scheduleDate,
            isHoliday: scheduleData.isHoliday || false,
            version: scheduleData.version || 0,
            bookedSlots: scheduleData.bookedSlots?.map((slot: any) => ({
              startTime: slot.startTime,
              endTime: slot.endTime,
              _id: slot._id?.$oid ? this.safeObjectId(slot._id) || new Types.ObjectId() : new Types.ObjectId(),
            })) || [],
            createdAt: scheduleData.createdAt?.$date ? new Date(scheduleData.createdAt.$date) : new Date(),
            updatedAt: scheduleData.updatedAt?.$date ? new Date(scheduleData.updatedAt.$date) : new Date(),
          });

          await schedule.save();
          if (existingById || existingByFieldDate) {
            console.log(`🔄 Updated schedule: ${scheduleId}`);
            updatedCount++;
          } else {
            console.log(`✅ Imported schedule: ${scheduleId}`);
            importedCount++;
          }

        } catch (error) {
          // Handle duplicate key error specifically
          if ((error as any)?.code === 11000) {
            // Duplicate key error - try to find and update
            try {
              const fieldId = this.safeObjectId(scheduleData.field);
              const scheduleDate = new Date(scheduleData.date.$date);
              const existing = await this.scheduleModel.findOne({ field: fieldId, date: scheduleDate });
              
              if (existing && (options.updateDuplicates || options.skipDuplicates === false)) {
                // Update existing
                existing.isHoliday = scheduleData.isHoliday || false;
                existing.version = scheduleData.version || 0;
                existing.bookedSlots = scheduleData.bookedSlots?.map((slot: any) => ({
                  startTime: slot.startTime,
                  endTime: slot.endTime,
                  _id: slot._id?.$oid ? this.safeObjectId(slot._id) || new Types.ObjectId() : new Types.ObjectId(),
                })) || [];
                existing.updatedAt = scheduleData.updatedAt?.$date ? new Date(scheduleData.updatedAt.$date) : new Date();
                await existing.save();
                console.log(`🔄 Updated schedule (duplicate key): ${existing._id}`);
                updatedCount++;
              } else {
                console.log(`⏭️  Skipping duplicate schedule: field ${fieldId}, date ${scheduleDate.toISOString()}`);
                skippedCount++;
              }
            } catch (updateError) {
              console.error(`❌ Failed to handle duplicate schedule:`, (updateError as any)?.message || updateError);
              errorCount++;
            }
          } else {
            console.error(`❌ Failed to import schedule ${scheduleData._id?.$oid || 'unknown'}:`, (error as any)?.message || error);
            errorCount++;
          }
        }
      }

      console.log(`\n📊 Schedules Import Summary:`);
      console.log(`   ✅ Imported: ${importedCount}`);
      console.log(`   🔄 Updated: ${updatedCount}`);
      console.log(`   ⏭️  Skipped: ${skippedCount}`);
      console.log(`   ❌ Errors: ${errorCount}`);
      console.log(`   📦 Total: ${scheduleLibrary.length}`);

    } catch (error) {
      console.error('❌ Error importing schedules:', error);
    }
  }

  async importTransactions(options: ImportOptions) {
    console.log('💳 Importing transactions...');

    try {
      let importedCount = 0;
      let updatedCount = 0;
      let skippedCount = 0;
      let errorCount = 0;

      for (const transactionData of transactionLibrary) {
        try {
          const transactionId = this.safeObjectId(transactionData._id);
          if (!transactionId) {
            console.error(`❌ Invalid transaction ID: ${JSON.stringify(transactionData._id)}`);
            errorCount++;
            continue;
          }

          // Check if transaction already exists
          const existing = await this.transactionModel.findById(transactionId);
          
          if (existing) {
            if (options.updateDuplicates) {
              // Delete existing and update with new data
              await this.transactionModel.findByIdAndDelete(transactionId);
              console.log(`🔄 Deleted existing transaction: ${transactionId} (will update)`);
            } else if (options.skipDuplicates !== false) {
              console.log(`⏭️  Skipping existing transaction: ${transactionId}`);
              skippedCount++;
              continue;
            } else {
              // Delete existing and update with new data (default behavior when skipDuplicates is false)
              await this.transactionModel.findByIdAndDelete(transactionId);
              console.log(`🔄 Deleted existing transaction: ${transactionId} (will update)`);
            }
          }

          // Validate required ObjectIds
          const bookingId = this.safeObjectId(transactionData.booking);
          const userId = this.safeObjectId(transactionData.user);
          if (!bookingId || !userId) {
            console.error(`❌ Invalid booking or user ID for transaction ${transactionId}`);
            errorCount++;
            continue;
          }

          // Map transaction type - handle "refund" to proper enum
          let transactionType = transactionData.type;
          if (transactionType === 'refund') {
            // Determine if full or partial refund based on direction
            transactionType = transactionData.direction === 'out' 
              ? TransactionType.REFUND_FULL 
              : TransactionType.REFUND_PARTIAL;
          } else if (!Object.values(TransactionType).includes(transactionType as TransactionType)) {
            // Default to PAYMENT if invalid type
            console.warn(`⚠️  Invalid transaction type "${transactionType}", defaulting to PAYMENT`);
            transactionType = TransactionType.PAYMENT;
          }

          // Convert MongoDB extended JSON format to regular format
          const transaction = new this.transactionModel({
            _id: transactionId,
            booking: bookingId,
            user: userId,
            amount: transactionData.amount,
            direction: transactionData.direction,
            method: transactionData.method,
            type: transactionType,
            status: transactionData.status,
            notes: transactionData.notes || null,
            vnpayResponseCode: transactionData.vnpayResponseCode || null,
            externalTransactionId: transactionData.externalTransactionId || null,
            createdAt: transactionData.createdAt?.$date ? new Date(transactionData.createdAt.$date) : new Date(),
            completedAt: transactionData.completedAt?.$date ? new Date(transactionData.completedAt.$date) : null,
          });

          await transaction.save();
          if (existing) {
            console.log(`🔄 Updated transaction: ${transactionId}`);
            updatedCount++;
          } else {
            console.log(`✅ Imported transaction: ${transactionId}`);
            importedCount++;
          }

        } catch (error) {
          console.error(`❌ Failed to import transaction ${transactionData._id?.$oid || 'unknown'}:`, (error as any)?.message || error);
          errorCount++;
        }
      }

      console.log(`\n📊 Transactions Import Summary:`);
      console.log(`   ✅ Imported: ${importedCount}`);
      console.log(`   🔄 Updated: ${updatedCount}`);
      console.log(`   ⏭️  Skipped: ${skippedCount}`);
      console.log(`   ❌ Errors: ${errorCount}`);
      console.log(`   📦 Total: ${transactionLibrary.length}`);

    } catch (error) {
      console.error('❌ Error importing transactions:', error);
    }
  }

  async run(options: ImportOptions) {
    try {
      await this.initialize();
      
      console.log('\n🎯 Starting CLI mock data import...');
      console.log('📋 Options:');
      console.log(`   Amenities: ${options.amenities ? '✅' : '❌'}`);
      console.log(`   Users: ${options.users ? '✅' : '❌'}`);
      console.log(`   Fields (legacy): ${options.fields ? '✅' : '❌'}`);
      console.log(`   Fields (v2 - fixed IDs): ${options.fieldsV2 ? '✅' : '❌'}`);
      console.log(`   Courts: ${options.courts ? '✅' : '❌'}`);
      console.log(`   Bookings: ${options.bookings ? '✅' : '❌'}`);
      console.log(`   Schedules: ${options.schedules ? '✅' : '❌'}`);
      console.log(`   Transactions: ${options.transactions ? '✅' : '❌'}`);
      console.log(`   Reviews: ${options.reviews ? '✅' : '❌'}`);
      console.log(`   Clear existing: ${options.clear ? '✅' : '❌'}`);
      console.log(`   Skip duplicates: ${options.skipDuplicates !== false ? '✅' : '❌'}`);
      console.log(`   Update duplicates: ${options.updateDuplicates ? '✅' : '❌'}`);
      console.log('');

      if (options.amenities) {
        await this.importAmenities(options);
      }

      if (options.users) {
        console.log('👥 Users import not implemented yet');
      }

      if (options.fields) {
        await this.importFields(options);
      }

      if (options.fieldsV2) {
        await this.importFieldsV2(options);
      }

      if (options.courts) {
        await this.importCourts(options);
      }

      if (options.bookings) {
        await this.importBookings(options);
      }

      if (options.schedules) {
        await this.importSchedules(options);
      }

      if (options.transactions) {
        await this.importTransactions(options);
      }

      if (options.reviews) {
        console.log('⭐ Reviews import not implemented yet');
      }

      console.log('\n🎉 CLI mock data import completed!');

    } catch (error) {
      console.error('❌ Import failed:', error);
      process.exit(1);
    } finally {
      if (this.app) {
        await this.app.close();
      }
    }
  }
}

// Parse command line arguments
function parseArgs(): ImportOptions {
  const args = process.argv.slice(2);
  const options: ImportOptions = {};

  args.forEach(arg => {
    switch (arg) {
      case '--amenities':
        options.amenities = true;
        break;
      case '--users':
        options.users = true;
        break;
      case '--fields':
        options.fields = true;
        break;
      case '--fields-v2':
        options.fieldsV2 = true;
        break;
      case '--courts':
        options.courts = true;
        break;
      case '--bookings':
        options.bookings = true;
        break;
      case '--schedules':
        options.schedules = true;
        break;
      case '--transactions':
        options.transactions = true;
        break;
      case '--reviews':
        options.reviews = true;
        break;
      case '--clear':
        options.clear = true;
        break;
      case '--no-skip-duplicates':
        options.skipDuplicates = false;
        break;
      case '--update-duplicates':
      case '--replace-duplicates':
        options.updateDuplicates = true;
        options.skipDuplicates = false; // Can't skip if updating
        break;
      case '--all':
        options.amenities = true;
        options.users = true;
        options.fields = true;
        options.fieldsV2 = true;
        options.courts = true;
        options.bookings = true;
        options.schedules = true;
        options.transactions = true;
        options.reviews = true;
        break;
    }
  });

  // Default to amenities if no specific options provided
  if (!options.amenities && !options.users && !options.fields && !options.fieldsV2 && !options.courts && !options.bookings && !options.schedules && !options.transactions && !options.reviews) {
    options.amenities = true;
  }

  return options;
}

// Show help
function showHelp() {
  console.log(`
🎯 Mock Data Importer CLI

Usage: npm run import:mock [options]

Options:
  --amenities              Import amenities data
  --users                  Import users data
  --fields                 Import fields data (legacy, generated IDs)
  --fields-v2              Import fields data (fixed IDs for cross-ref)
  --courts                 Import courts data (requires fields-v2/all)
  --bookings               Import bookings data
  --schedules              Import schedules data
  --transactions           Import transactions data
  --reviews                Import reviews data
  --all                    Import all data types
  --clear                  Clear existing data before import
  --no-skip-duplicates     Don't skip duplicate entries
  --update-duplicates      Delete and update duplicate entries with new data
  --replace-duplicates     Alias for --update-duplicates

Examples:
  npm run import:mock -- --amenities
  npm run import:mock -- --all
  npm run import:mock -- --amenities --clear
  npm run import:mock -- --help
`);
}

// Main execution
const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  showHelp();
  process.exit(0);
}

const options = parseArgs();
const importer = new CLIImporter();
importer.run(options);
