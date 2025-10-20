#!/usr/bin/env ts-node

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../src/app.module';
import { AmenitiesService } from '../../src/modules/amenities/amenities.service';
import { FieldsService } from '@modules/fields/fields.service';

const amenitiesLibrary = require('./amenities-library.json');
const fieldLibrary = require('./field-library.json');
interface ImportOptions {
  amenities?: boolean;
  users?: boolean;
  fields?: boolean;
  bookings?: boolean;
  reviews?: boolean;
  clear?: boolean;
  skipDuplicates?: boolean;
}

class CLIImporter {
  private app: any;
  private amenitiesService: AmenitiesService;
  private fieldsService: FieldsService;
  async initialize() {
    console.log('🚀 Initializing CLI Mock Data Importer...');
    this.app = await NestFactory.createApplicationContext(AppModule);
    this.amenitiesService = this.app.get(AmenitiesService);
    this.fieldsService = this.app.get(FieldsService);
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
            const existing = await this.fieldsService.findAll({
              name: fieldData.name,
              sportType: fieldData.sportType,
            });

            if (existing && existing.length > 0) {
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

          await this.fieldsService.create(createFieldDto, ownerId);
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

  async run(options: ImportOptions) {
    try {
      await this.initialize();
      
      console.log('\n🎯 Starting CLI mock data import...');
      console.log('📋 Options:');
      console.log(`   Amenities: ${options.amenities ? '✅' : '❌'}`);
      console.log(`   Users: ${options.users ? '✅' : '❌'}`);
      console.log(`   Fields: ${options.fields ? '✅' : '❌'}`);
      console.log(`   Bookings: ${options.bookings ? '✅' : '❌'}`);
      console.log(`   Reviews: ${options.reviews ? '✅' : '❌'}`);
      console.log(`   Clear existing: ${options.clear ? '✅' : '❌'}`);
      console.log(`   Skip duplicates: ${options.skipDuplicates !== false ? '✅' : '❌'}`);
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

      if (options.bookings) {
        console.log('📅 Bookings import not implemented yet');
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
      case '--bookings':
        options.bookings = true;
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
      case '--all':
        options.amenities = true;
        options.users = true;
        options.fields = true;
        options.bookings = true;
        options.reviews = true;
        break;
    }
  });

  // Default to amenities if no specific options provided
  if (!options.amenities && !options.users && !options.fields && !options.bookings && !options.reviews) {
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
  --fields                 Import fields data
  --bookings               Import bookings data
  --reviews                Import reviews data
  --all                    Import all data types
  --clear                  Clear existing data before import
  --no-skip-duplicates     Don't skip duplicate entries

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
