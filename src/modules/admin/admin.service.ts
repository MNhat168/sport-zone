import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument, UserRole } from 'src/modules/users/entities/user.entity';
import { Transaction, TransactionDocument } from 'src/modules/transactions/entities/transaction.entity';
import { UserRoleStatDto } from './dto/user-role-stats.dto';
@Injectable()
export class AdminService {
    constructor(
        @InjectModel(User.name) private userModel: Model<UserDocument>,
        @InjectModel(Transaction.name) private transactionModel: Model<TransactionDocument>,
    ) { }

    async findAll(): Promise<User[]> {
        return this.userModel.find().exec();
    }

    async setIsActive(userId: string, isActive: boolean): Promise<User> {
        const user = await this.userModel.findById(userId);
        if (!user) {
            throw new NotFoundException('User not found');
        }

        user.isActive = isActive;
        await user.save();
        return user;
    }

    async getRoleDistribution(): Promise<UserRoleStatDto[]> {
        const result = await this.userModel.aggregate([
            {
                $match: { role: { $ne: UserRole.ADMIN } }, 
            },
            {
                $group: {
                    _id: '$role',
                    count: { $sum: 1 },
                },
            },
        ]);

        const validRoles = [UserRole.USER, UserRole.COACH, UserRole.FIELD_OWNER];

        return validRoles.map((role) => {
            const found = result.find((r) => r._id === role);
            return {
                role,
                count: found ? found.count : 0,
            };
        });
    }

    async getSuccessfulPayments(range: '1y' | '6m' | '3m' | '1m', year: number) {
        const now = new Date();
        const currentYear = now.getFullYear();

        const endDate = year === currentYear
            ? now
            : new Date(year, 11, 31, 23, 59, 59);

        const startOfYear = new Date(year, 0, 1);

        let startDate = new Date(endDate);
        switch (range) {
            case '1y':
                startDate.setFullYear(endDate.getFullYear() - 1);
                break;
            case '6m':
                startDate.setMonth(endDate.getMonth() - 6);
                break;
            case '3m':
                startDate.setMonth(endDate.getMonth() - 3);
                break;
            case '1m':
                startDate.setMonth(endDate.getMonth() - 1);
                break;
        }

        if (startDate < startOfYear) startDate = startOfYear;

        return this.transactionModel
            .find({
                type: 'payment',
                status: 'succeeded',
                createdAt: { $gte: startDate, $lte: endDate },
            })
            .exec();
    }
}
