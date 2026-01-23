const { MongoClient } = require('mongodb');

const MONGODB_URI = 'mongodb+srv://nhatnmde180:helloworld@cluster0.zufvinh.mongodb.net/SportZone?retryWrites=true&w=majority';

async function addPolicyFields() {
    const client = new MongoClient(MONGODB_URI);

    try {
        await client.connect();
        console.log('Connected to MongoDB successfully');

        const db = client.db('SportZone');

        // Update FieldOwnerProfile collection
        console.log('\nUpdating fieldownerprofiles collection...');
        const fieldOwnerResult = await db.collection('fieldownerprofiles').updateMany(
            { hasReadPolicy: { $exists: false } },
            {
                $set: {
                    hasReadPolicy: false,
                    policyReadAt: null
                }
            }
        );
        console.log(`FieldOwnerProfiles updated: ${fieldOwnerResult.modifiedCount} documents`);

        // Update CoachProfile collection
        console.log('\nUpdating coachprofiles collection...');
        const coachResult = await db.collection('coachprofiles').updateMany(
            { hasReadPolicy: { $exists: false } },
            {
                $set: {
                    hasReadPolicy: false,
                    policyReadAt: null
                }
            }
        );
        console.log(`CoachProfiles updated: ${coachResult.modifiedCount} documents`);

        console.log('\n✅ All updates completed successfully!');

    } catch (error) {
        console.error('Error updating collections:', error);
        throw error;
    } finally {
        await client.close();
        console.log('MongoDB connection closed');
    }
}

addPolicyFields().catch(console.error);
