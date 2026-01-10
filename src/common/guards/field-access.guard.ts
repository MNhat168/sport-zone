import { Injectable, CanActivate, ExecutionContext, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { FieldOwnerProfile } from '../../modules/field-owner/entities/field-owner-profile.entity';
import { UserRole } from '../enums/user.enum';

/**
 * FieldAccessGuard - Allows both Field Owners and their Staff to access field operations
 * 
 * This guard extends access beyond just field owners to include staff members.
 * When a staff member accesses an endpoint, we inject the owner context into the request
 * so downstream services know which owner the staff is representing.
 * 
 * Usage: @UseGuards(AuthGuard('jwt'), FieldAccessGuard)
 */
@Injectable()
export class FieldAccessGuard implements CanActivate {
    private readonly logger = new Logger(FieldAccessGuard.name);

    constructor(
        @InjectModel(FieldOwnerProfile.name)
        private readonly fieldOwnerProfileModel: Model<FieldOwnerProfile>,
    ) { }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest();
        const user = request.user; // From JWT (populated by AuthGuard)

        if (!user || !user.userId) {
            this.logger.warn('No user found in request');
            return false;
        }

        // Case 1: User is the actual Field Owner
        if (user.role === UserRole.FIELD_OWNER) {
            this.logger.debug(`Field owner ${user.userId} accessing field operations`);
            return true;
        }

        // Case 2: User is a Staff member (role = USER)
        // Check if this user is in any owner's staffAccounts array
        const ownerProfile = await this.fieldOwnerProfileModel
            .findOne({
                staffAccounts: new Types.ObjectId(user.userId)
            })
            .lean();

        if (ownerProfile) {
            // Staff member found - inject owner context for downstream services
            request['ownerContext'] = {
                ownerId: ownerProfile.user.toString(),
                ownerProfileId: ownerProfile._id.toString(),
                isStaff: true,
                staffId: user.userId
            };

            this.logger.debug(`Staff ${user.userId} accessing field operations for owner ${ownerProfile.user}`);
            return true;
        }

        // Case 3: User is neither owner nor staff - deny access
        this.logger.warn(`User ${user.userId} with role ${user.role} denied field access`);
        return false;
    }
}
