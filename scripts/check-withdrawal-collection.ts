import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { WalletService } from '../src/modules/wallet/wallet.service';
import { PaymentHandlerService } from '../src/modules/bookings/services/payment-handler.service';
import { WithdrawalRequestStatus } from '../src/modules/wallet/entities/withdrawal-request.entity';
import { Types } from 'mongoose';
import { getConnectionToken } from '@nestjs/mongoose';

async function bootstrap() {
    const app = await NestFactory.createApplicationContext(AppModule);

    try {
        const paymentHandlerService = app.get(PaymentHandlerService);
        const connection = app.get(getConnectionToken());

        console.log('Connected to DB:', connection.name);

        // Create a dummy withdrawal request
        // We need a valid user ID. Let's try to find one or use a dummy.
        // Ideally we should query for a user first, but let's just make a random ObjectId.
        // To be safe, we should probably fetch a user.

        // For now, let's just print the collection name from the model
        const model = (paymentHandlerService as any).withdrawalRequestModel;
        console.log('Collection name in model:', model.collection.name);

        // Let's count documents
        const count = await model.countDocuments({});
        console.log('Total documents in withdrawalrequests:', count);

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await app.close();
        process.exit(0);
    }
}

bootstrap();
