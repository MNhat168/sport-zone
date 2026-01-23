// ========================================
// SCRIPT 2: FIX - Tự động fix tất cả fields thiếu cấu hình
// ========================================
// Run this in MongoDB Compass or mongo shell
// Connect to: mongodb+srv://nhatnmde180:helloworld@cluster0.zufvinh.mongodb.net/SportZone

print("=== STARTING AUTOMATIC FIELD FIX ===\n");

// Default configurations
const defaultOperatingHours = [
    { day: "monday", start: "06:00", end: "22:00", duration: 60 },
    { day: "tuesday", start: "06:00", end: "22:00", duration: 60 },
    { day: "wednesday", start: "06:00", end: "22:00", duration: 60 },
    { day: "thursday", start: "06:00", end: "22:00", duration: 60 },
    { day: "friday", start: "06:00", end: "22:00", duration: 60 },
    { day: "saturday", start: "06:00", end: "23:00", duration: 60 },
    { day: "sunday", start: "06:00", end: "23:00", duration: 60 }
];

const defaultPriceRanges = [
    { day: "weekday", start: "06:00", end: "17:00", multiplier: 1.0 },
    { day: "weekday", start: "17:00", end: "22:00", multiplier: 1.5 },
    { day: "weekend", start: "06:00", end: "23:00", multiplier: 2.0 }
];

const defaultLocation = {
    address: "Địa chỉ đang cập nhật",
    geo: {
        type: "Point",
        coordinates: [106.700806, 10.776889] // Ho Chi Minh City center
    }
};

// Counter
let fixCount = 0;

// Fix 1: Add Operating Hours
print("1. Adding Operating Hours to fields...");
const result1 = db.fields.updateMany(
    {
        $or: [
            { operatingHours: { $exists: false } },
            { operatingHours: null },
            { operatingHours: [] }
        ]
    },
    {
        $set: { operatingHours: defaultOperatingHours }
    }
);
print(`   Fixed ${result1.modifiedCount} fields with Operating Hours`);
fixCount += result1.modifiedCount;

// Fix 2: Add Price Ranges
print("2. Adding Price Ranges to fields...");
const result2 = db.fields.updateMany(
    {
        $or: [
            { priceRanges: { $exists: false } },
            { priceRanges: null },
            { priceRanges: [] }
        ]
    },
    {
        $set: { priceRanges: defaultPriceRanges }
    }
);
print(`   Fixed ${result2.modifiedCount} fields with Price Ranges`);
fixCount += result2.modifiedCount;

// Fix 3: Add Slot Duration
print("3. Adding Slot Duration to fields...");
const result3 = db.fields.updateMany(
    {
        $or: [
            { slotDuration: { $exists: false } },
            { slotDuration: null }
        ]
    },
    {
        $set: { slotDuration: 60 }
    }
);
print(`   Fixed ${result3.modifiedCount} fields with Slot Duration`);
fixCount += result3.modifiedCount;

// Fix 4: Add Min Slots
print("4. Adding Min Slots to fields...");
const result4 = db.fields.updateMany(
    {
        $or: [
            { minSlots: { $exists: false } },
            { minSlots: null }
        ]
    },
    {
        $set: { minSlots: 1 }
    }
);
print(`   Fixed ${result4.modifiedCount} fields with Min Slots`);
fixCount += result4.modifiedCount;

// Fix 5: Add Max Slots
print("5. Adding Max Slots to fields...");
const result5 = db.fields.updateMany(
    {
        $or: [
            { maxSlots: { $exists: false } },
            { maxSlots: null }
        ]
    },
    {
        $set: { maxSlots: 4 }
    }
);
print(`   Fixed ${result5.modifiedCount} fields with Max Slots`);
fixCount += result5.modifiedCount;

// Fix 6: Add Base Price (if missing or 0)
print("6. Adding Base Price to fields...");
const result6 = db.fields.updateMany(
    {
        $or: [
            { basePrice: { $exists: false } },
            { basePrice: null },
            { basePrice: 0 }
        ]
    },
    {
        $set: { basePrice: 100000 } // Default 100k VND per hour
    }
);
print(`   Fixed ${result6.modifiedCount} fields with Base Price`);
fixCount += result6.modifiedCount;

// Fix 7: Add Location (if missing)
print("7. Adding Location to fields...");
const result7 = db.fields.updateMany(
    {
        $or: [
            { "location.address": { $exists: false } },
            { "location.address": null },
            { "location.address": "" }
        ]
    },
    {
        $set: { location: defaultLocation }
    }
);
print(`   Fixed ${result7.modifiedCount} fields with Location`);
fixCount += result7.modifiedCount;

// Fix 8: Ensure rating and totalReviews exist
print("8. Adding Rating and Review fields...");
const result8 = db.fields.updateMany(
    { rating: { $exists: false } },
    { $set: { rating: 0 } }
);
const result9 = db.fields.updateMany(
    { totalReviews: { $exists: false } },
    { $set: { totalReviews: 0 } }
);
print(`   Fixed ${result8.modifiedCount} fields with Rating`);
print(`   Fixed ${result9.modifiedCount} fields with Total Reviews`);
fixCount += result8.modifiedCount + result9.modifiedCount;

// Fix 9: Ensure isAdminVerify exists
print("9. Adding isAdminVerify flag...");
const result10 = db.fields.updateMany(
    { isAdminVerify: { $exists: false } },
    { $set: { isAdminVerify: false } }
);
print(`   Fixed ${result10.modifiedCount} fields with isAdminVerify`);
fixCount += result10.modifiedCount;

// Fix 10: Ensure amenities array exists
print("10. Adding amenities array...");
const result11 = db.fields.updateMany(
    { amenities: { $exists: false } },
    { $set: { amenities: [] } }
);
print(`   Fixed ${result11.modifiedCount} fields with amenities`);
fixCount += result11.modifiedCount;

// Summary
print("\n=== FIX SUMMARY ===");
print(`Total fields updated: ${fixCount} field updates`);
print("\nAll fields have been fixed!");
print("Run 'verify_fields.js' to confirm all fixes were applied correctly.");
