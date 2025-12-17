import {
    CanActivate,
    ExecutionContext,
    Injectable,
    ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../../modules/users/entities/user.entity';
import { UserRole } from '../enums/user.enum';

@Injectable()
export class SubscriptionStatusGuard implements CanActivate {
    constructor(
        @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest();
        const user = request.user;

        if (!user) {
            throw new ForbiddenException('User not authenticated');
        }

        // Only check for field owners
        const userId = user.userId || user._id || user.id;
        const dbUser = await this.userModel.findById(userId).lean();

        if (!dbUser) {
            throw new ForbiddenException('User not found');
        }

        // Only enforce for field owners
        if (dbUser.role !== UserRole.FIELD_OWNER) {
            return true; // Allow other roles
        }

        // Check subscription status
        if (dbUser.subscriptionStatus === 'suspended') {
            throw new ForbiddenException(
                'Tài khoản của bạn đã bị tạm khóa do chưa thanh toán phí duy trì. Vui lòng thanh toán để tiếp tục sử dụng dịch vụ.'
            );
        }

        return true;
    }
}

