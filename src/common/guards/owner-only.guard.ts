import { Injectable, CanActivate, ExecutionContext, Logger, ForbiddenException } from '@nestjs/common';
import { UserRole } from '../enums/user.enum';

/**
 * OwnerOnlyGuard - Restricts access to actual Field Owners only (not staff)
 * 
 * This guard is used for sensitive operations that should only be performed
 * by the actual field owner, such as:
 * - Managing staff accounts
 * - Withdrawing funds
 * - Managing bank accounts
 * - Updating owner profile
 * - Scheduling price updates
 * 
 * Usage: @UseGuards(AuthGuard('jwt'), OwnerOnlyGuard)
 */
@Injectable()
export class OwnerOnlyGuard implements CanActivate {
    private readonly logger = new Logger(OwnerOnlyGuard.name);

    canActivate(context: ExecutionContext): boolean {
        const request = context.switchToHttp().getRequest();
        const user = request.user; // From JWT (populated by AuthGuard)

        if (!user || !user.userId) {
            this.logger.warn('No user found in request');
            throw new ForbiddenException('Authentication required');
        }

        // Only allow actual field owners (not staff members)
        const isOwner = user.role === UserRole.FIELD_OWNER;

        if (!isOwner) {
            this.logger.warn(`User ${user.userId} with role ${user.role} denied owner-only access`);
            throw new ForbiddenException('This action is restricted to field owners only');
        }

        this.logger.debug(`Field owner ${user.userId} accessing owner-only operation`);
        return true;
    }
}
