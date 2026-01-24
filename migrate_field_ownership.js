// Script to migrate fields with User ID as owner to FieldOwnerProfile ID
// Chạy: mongosh "mongodb+srv://nhatnmde180:helloworld@cluster0.zufvinh.mongodb.net/SportZone" --file migrate_field_ownership.js

print("=".repeat(80));
print("Migrating Field Ownership from User ID to FieldOwnerProfile ID");
print("=".repeat(80));
print("");

let migratedCount = 0;
let skippedCount = 0;
let errorCount = 0;

// Get all fields
const fields = db.fields.find({}).toArray();
print(`Total fields to check: ${fields.length}`);
print("");

fields.forEach(function(field) {
    const fieldId = field._id.toString();
    const ownerId = field.owner ? field.owner.toString() : null;
    const fieldName = field.name || "Unnamed";
    
    if (!ownerId) {
        print(`⚠️  Skipping field ${fieldId} (${fieldName}): No owner set`);
        skippedCount++;
        return;
    }
    
    // Check if owner is already a FieldOwnerProfile
    const ownerProfile = db.fieldownerprofiles.findOne({ _id: ObjectId(ownerId) });
    
    if (ownerProfile) {
        // Already correct, skip
        return;
    }
    
    // Check if owner is a User ID
    const user = db.users.findOne({ _id: ObjectId(ownerId) });
    
    if (user) {
        // Find the FieldOwnerProfile for this user
        const profile = db.fieldownerprofiles.findOne({ user: ObjectId(ownerId) });
        
        if (profile) {
            print(`🔄 Migrating field ${fieldId} (${fieldName})`);
            print(`   From: User ID ${ownerId} (${user.email || user.fullName || ownerId})`);
            print(`   To:   FieldOwnerProfile ${profile._id}`);
            
            try {
                const result = db.fields.updateOne(
                    { _id: field._id },
                    { $set: { owner: profile._id } }
                );
                
                if (result.modifiedCount === 1) {
                    migratedCount++;
                    print(`   ✅ Successfully migrated`);
                } else {
                    print(`   ⚠️  No changes made (may already be migrated)`);
                    skippedCount++;
                }
            } catch (error) {
                errorCount++;
                print(`   ❌ Error: ${error.message}`);
            }
            print("");
        } else {
            print(`❌ Field ${fieldId} (${fieldName}): User ${ownerId} (${user.email || user.fullName || ownerId}) has no FieldOwnerProfile`);
            print(`   ⚠️  Cannot migrate - user needs to create FieldOwnerProfile first`);
            print("");
            skippedCount++;
        }
    } else {
        // Owner is neither User nor FieldOwnerProfile
        print(`❌ Field ${fieldId} (${fieldName}): Owner ${ownerId} is invalid`);
        print("");
        skippedCount++;
    }
});

print("");
print("=".repeat(80));
print("Migration Summary:");
print("=".repeat(80));
print(`✅ Successfully migrated: ${migratedCount}`);
print(`⚠️  Skipped: ${skippedCount}`);
print(`❌ Errors: ${errorCount}`);
print(`Total fields processed: ${fields.length}`);
print("");

if (migratedCount > 0) {
    print("✅ Migration completed! Fields have been updated to use FieldOwnerProfile ID.");
} else if (skippedCount > 0) {
    print("⚠️  No fields were migrated. Some fields may need manual attention.");
} else {
    print("✅ All fields already have correct ownership references!");
}
