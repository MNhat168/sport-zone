
import { MongoClient, ObjectId } from 'mongodb';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

// Load .env from current directory
dotenv.config();

const logFile = path.resolve(__dirname, 'debug-qr-output.txt');
const log = (msg: string) => {
    console.log(msg);
    fs.appendFileSync(logFile, msg + '\n');
};

async function run() {
    // Clear log file
    fs.writeFileSync(logFile, '');

    log('--- Debugging QR Check-in Round 2 ---');

    // 1. Date Logic
    const vietnamTime = new Date();
    const vietnamDate = new Date(
        vietnamTime.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }),
    );
    vietnamDate.setHours(0, 0, 0, 0);

    const tomorrow = new Date(vietnamDate);
    tomorrow.setDate(tomorrow.getDate() + 1);

    log(`Query Range (VN Today): $gte ${vietnamDate.toISOString()} , $lt ${tomorrow.toISOString()}`);

    // 2. Connect
    const uri = process.env.DATABASE_URL || process.env.MONGODB_URI;
    if (!uri) {
        log('ERROR: No MongoDB URI');
        return;
    }

    const client = new MongoClient(uri);
    try {
        await client.connect();
        log('Connected to MongoDB');

        const db = client.db();
        const bookingsCol = db.collection('bookings');
        const fieldsCol = db.collection('fields');

        const userId = '694d6bb6e923bd5563f1e10a';
        const fieldId = '69723ef87a7e635e0d02f09d';

        // A. Check bookings for user + field (ANY DATE) - to see if they have future bookings
        log(`\n[A] Checking user's bookings for field ${fieldId} (ANY DATE):`);
        const userFieldBookings = await bookingsCol.find({
            user: new ObjectId(userId),
            field: new ObjectId(fieldId)
        }).toArray();

        if (userFieldBookings.length === 0) {
            log(' -> No bookings found for this user at this field ever.');
        } else {
            userFieldBookings.forEach(b => {
                log(` - Date: ${b.date ? b.date.toISOString() : 'N/A'}, Status: ${b.status}, Payment: ${b.paymentStatus}`);
            });
        }

        // B. Check bookings for user for TODAY (ANY FIELD) - to see if they booked wrong field
        log(`\n[B] Checking user's bookings for TODAY (${vietnamDate.toISOString().split('T')[0]}) (ANY FIELD):`);
        const userTodayBookings = await bookingsCol.find({
            user: new ObjectId(userId),
            date: { $gte: vietnamDate, $lt: tomorrow }
        }).toArray();

        if (userTodayBookings.length === 0) {
            log(' -> No bookings found for this user TODAY at ANY field.');
        } else {
            for (const b of userTodayBookings) {
                const field = await fieldsCol.findOne({ _id: b.field });
                log(` - Field: ${field ? field.name : b.field}, Date: ${b.date.toISOString()}, Status: ${b.status}`);
            }
        }

    } catch (err) {
        log(`Error: ${err}`);
    } finally {
        await client.close();
        process.exit(0);
    }
}

run();
