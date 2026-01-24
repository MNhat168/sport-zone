// Script to check field ownership data consistency
// Checks if Field.owner correctly references FieldOwnerProfile._id
// Chạy: mongosh "mongodb+srv://nhatnmde180:helloworld@cluster0.zufvinh.mongodb.net/SportZone" --file check_field_ownership.js

// Use current database (SportZone)

print("=".repeat(80));
print("Checking Field Ownership Data Consistency");
print("=".repeat(80));
print("");

// Get all fields
const fields = db.fields.find({}).toArray();
print(`Total fields found: ${fields.length}`);
print("");

let issuesFound = 0;
let correctFields = 0;
let fieldsWithUserIdAsOwner = 0;
let fieldsWithInvalidOwner = 0;

fields.forEach((field, index) => {
    const fieldId = field._id.toString();
    const fieldOwnerId = field.owner ? field.owner.toString() : null;
    const fieldName = field.name || "Unnamed";
    
    if (!fieldOwnerId) {
        print(`❌ Field ${fieldId} (${fieldName}): No owner set`);
        issuesFound++;
        fieldsWithInvalidOwner++;
        return;
    }
    
    // Check if owner is a FieldOwnerProfile
    const ownerProfile = db.fieldownerprofiles.findOne({ _id: ObjectId(fieldOwnerId) });
    
    if (ownerProfile) {
        // Owner is a FieldOwnerProfile - correct!
        correctFields++;
        if (index < 5) { // Show first 5 correct ones
            print(`✅ Field ${fieldId} (${fieldName}): Owner is FieldOwnerProfile ${fieldOwnerId}`);
        }
    } else {
        // Check if owner is a User ID
        const user = db.users.findOne({ _id: ObjectId(fieldOwnerId) });
        
        if (user) {
            // Owner is a User ID - this is a legacy data issue
            fieldsWithUserIdAsOwner++;
            issuesFound++;
            
            // Try to find the FieldOwnerProfile for this user
            const userProfile = db.fieldownerprofiles.findOne({ user: ObjectId(fieldOwnerId) });
            
            if (userProfile) {
                print(`⚠️  Field ${fieldId} (${fieldName}): Owner is User ID ${fieldOwnerId} (should be FieldOwnerProfile ${userProfile._id})`);
                print(`   User: ${user.email || user.fullName || fieldOwnerId}`);
                print(`   Should migrate to FieldOwnerProfile: ${userProfile._id}`);
            } else {
                print(`❌ Field ${fieldId} (${fieldName}): Owner is User ID ${fieldOwnerId} but no FieldOwnerProfile exists for this user`);
                print(`   User: ${user.email || user.fullName || fieldOwnerId}`);
            }
        } else {
            // Owner is neither User nor FieldOwnerProfile
            fieldsWithInvalidOwner++;
            issuesFound++;
            print(`❌ Field ${fieldId} (${fieldName}): Owner ${fieldOwnerId} is invalid (not found in users or fieldownerprofiles)`);
        }
    }
});

print("");
print("=".repeat(80));
print("Summary:");
print("=".repeat(80));
print(`Total fields: ${fields.length}`);
print(`✅ Correct (FieldOwnerProfile ID): ${correctFields}`);
print(`⚠️  Legacy data (User ID as owner): ${fieldsWithUserIdAsOwner}`);
print(`❌ Invalid owner: ${fieldsWithInvalidOwner}`);
print(`Total issues: ${issuesFound}`);
print("");

if (issuesFound > 0) {
    print("RECOMMENDATION:");
    print("Fields with User ID as owner should be migrated to use FieldOwnerProfile ID.");
    print("The backend code now handles this case as a fallback, but data should be fixed.");
    print("");
    print("Migration script example:");
    print(`
// Migrate fields with User ID as owner to FieldOwnerProfile ID
db.fields.find({}).forEach(function(field) {
    const ownerId = field.owner.toString();
    
    // Check if owner is a User ID
    const user = db.users.findOne({ _id: ObjectId(ownerId) });
    if (user) {
        // Find the FieldOwnerProfile for this user
        const profile = db.fieldownerprofiles.findOne({ user: ObjectId(ownerId) });
        if (profile) {
            print("Migrating field " + field._id + " from User " + ownerId + " to Profile " + profile._id);
            db.fields.updateOne(
                { _id: field._id },
                { $set: { owner: profile._id } }
            );
        }
    }
});
    `);
} else {
    print("✅ All fields have correct ownership references!");
}
