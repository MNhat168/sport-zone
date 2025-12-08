import 'dotenv/config';
import mongoose from 'mongoose';
import { Field, FieldSchema } from '../../src/modules/fields/entities/field.entity';
import { Court, CourtSchema } from '../../src/modules/courts/entities/court.entity';

/**
 * Migration: seed one Court per existing Field for backward-compatible dual writes.
 */
async function run() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/sportzone';

  await mongoose.connect(uri);
  const FieldModel = mongoose.model(Field.name, FieldSchema);
  const CourtModel = mongoose.model(Court.name, CourtSchema);

  const fields = await FieldModel.find({}).lean();
  let created = 0;
  let skipped = 0;

  for (const field of fields) {
    const existing = await CourtModel.findOne({ field: field._id, courtNumber: 1 }).lean();
    if (existing) {
      skipped += 1;
      continue;
    }

    await CourtModel.create({
      field: field._id,
      name: field.name,
      courtNumber: 1,
      isActive: field.isActive !== false,
      pricingOverride: {
        basePrice: field.basePrice,
        priceRanges: field.priceRanges || [],
      },
    });
    created += 1;
  }

  console.log(`Migration completed. Created: ${created}, skipped: ${skipped}`);
  await mongoose.disconnect();
}

run().catch(async (error) => {
  console.error('Migration failed:', error);
  await mongoose.disconnect();
  process.exit(1);
});

