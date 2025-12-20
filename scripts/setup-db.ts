#!/usr/bin/env ts-node

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User } from '../src/modules/users/entities/user.entity';
import { Field } from '../src/modules/fields/entities/field.entity';
import { Court } from '../src/modules/courts/entities/court.entity';
import { Booking } from '../src/modules/bookings/entities/booking.entity';
import { Schedule } from '../src/modules/schedules/entities/schedule.entity';
import { Transaction } from '../src/modules/transactions/entities/transaction.entity';
import { Review } from '../src/modules/reviews/entities/review.entity';
import { Amenity } from '../src/modules/amenities/entities/amenities.entity';

async function bootstrap() {
    console.log('🚀 Initializing Database Setup...');

    try {
        const app = await NestFactory.createApplicationContext(AppModule);
        console.log('✅ Application context initialized (Connection established)');

        const models = [
            { name: 'User', token: User.name },
            { name: 'Field', token: Field.name },
            { name: 'Court', token: Court.name },
            { name: 'Booking', token: Booking.name },
            { name: 'Schedule', token: Schedule.name },
            { name: 'Transaction', token: Transaction.name },
            { name: 'Review', token: Review.name },
            { name: 'Amenity', token: Amenity.name },
        ];

        for (const modelInfo of models) {
            try {
                console.log(`\n📦 Processing model: ${modelInfo.name}`);
                const model = app.get<Model<any>>(getModelToken(modelInfo.token));

                // Ensure collection exists
                await model.createCollection();
                console.log(`   ✅ Collection created (or already exists)`);

                // Sync indexes
                await model.syncIndexes();
                console.log(`   ✅ Indexes synced`);

            } catch (error) {
                console.error(`   ❌ Error processing ${modelInfo.name}:`, error.message);
            }
        }

        console.log('\n🎉 Database setup completed!');
        await app.close();
        process.exit(0);

    } catch (error) {
        console.error('❌ Fatal error during setup:', error);
        process.exit(1);
    }
}

bootstrap();
