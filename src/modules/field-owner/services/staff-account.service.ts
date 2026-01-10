import { Injectable, BadRequestException, NotFoundException, ConflictException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { User } from '../../users/entities/user.entity';
import { FieldOwnerProfile } from '../entities/field-owner-profile.entity';
import { CreateStaffAccountDto, UpdateStaffAccountDto, StaffAccountResponseDto } from '../dtos/staff-account.dto';
import { UserRole } from '@common/enums/user.enum';

@Injectable()
export class StaffAccountService {
    private readonly logger = new Logger(StaffAccountService.name);

    constructor(
        @InjectModel(User.name) private readonly userModel: Model<User>,
        @InjectModel(FieldOwnerProfile.name) private readonly fieldOwnerProfileModel: Model<FieldOwnerProfile>,
    ) { }

    /**
     * Create a staff account for a field owner
     * Staff will have role USER and be linked via FieldOwnerProfile.staffAccounts
     */
    async createStaffAccount(
        ownerProfileId: string,
        dto: CreateStaffAccountDto
    ): Promise<StaffAccountResponseDto> {
        // 1. Validate owner profile exists
        const ownerProfile = await this.fieldOwnerProfileModel.findById(ownerProfileId);
        if (!ownerProfile) {
            throw new NotFoundException('Field owner profile not found');
        }

        // 2. Check if email already exists
        const existingUser = await this.userModel.findOne({ email: dto.email });
        if (existingUser) {
            throw new ConflictException('Email already exists');
        }

        // 3. Hash password
        const hashedPassword = await bcrypt.hash(dto.password, 10);

        // 4. Create User with role USER (not FIELD_OWNER)
        const staffUser = new this.userModel({
            fullName: dto.fullName,
            email: dto.email,
            phone: dto.phone,
            password: hashedPassword,
            role: UserRole.USER,  // Staff uses regular USER role
            isActive: true,
            isVerified: true,  // Auto-verify staff accounts
        });

        await staffUser.save();
        this.logger.log(`Created staff account ${staffUser._id} for owner ${ownerProfileId}`);

        // 5. Add staff to owner's staffAccounts array
        ownerProfile.staffAccounts = ownerProfile.staffAccounts || [];
        ownerProfile.staffAccounts.push(staffUser._id as Types.ObjectId);
        await ownerProfile.save();

        this.logger.log(`Linked staff ${staffUser._id} to owner profile ${ownerProfileId}`);

        // 6. Return response DTO
        return this.mapToResponseDto(staffUser, dto.assignedFields);
    }

    /**
     * List all staff accounts for a field owner
     */
    async listStaffAccounts(
        ownerProfileId: string,
        filters?: { page?: number; limit?: number; fieldId?: string }
    ): Promise<{ staff: StaffAccountResponseDto[]; total: number; page: number; limit: number }> {
        const page = filters?.page || 1;
        const limit = filters?.limit || 10;
        const skip = (page - 1) * limit;

        // 1. Find owner profile
        const ownerProfile = await this.fieldOwnerProfileModel.findById(ownerProfileId);
        if (!ownerProfile) {
            throw new NotFoundException('Field owner profile not found');
        }

        // 2. Get staff users
        const staffIds = ownerProfile.staffAccounts || [];

        const query: any = {
            _id: { $in: staffIds }
        };

        // Optional: filter by assigned field (for future use)
        // if (filters?.fieldId) {
        //   query['metadata.assignedFields'] = filters.fieldId;
        // }

        const total = await this.userModel.countDocuments(query);
        const staffUsers = await this.userModel
            .find(query)
            .skip(skip)
            .limit(limit)
            .lean();

        const staff = staffUsers.map(user => this.mapToResponseDto(user));

        return {
            staff,
            total,
            page,
            limit
        };
    }

    /**
     * Update staff account details
     */
    async updateStaffAccount(
        staffId: string,
        ownerProfileId: string,
        dto: UpdateStaffAccountDto
    ): Promise<StaffAccountResponseDto> {
        // 1. Verify staff belongs to owner
        await this.verifyStaffAccess(staffId, ownerProfileId);

        // 2. Check email uniqueness if updating email
        if (dto.email) {
            const existingUser = await this.userModel.findOne({
                email: dto.email,
                _id: { $ne: new Types.ObjectId(staffId) }
            });
            if (existingUser) {
                throw new ConflictException('Email already exists');
            }
        }

        // 3. Update user
        const updateData: any = {};
        if (dto.fullName) updateData.fullName = dto.fullName;
        if (dto.email) updateData.email = dto.email;
        if (dto.phone !== undefined) updateData.phone = dto.phone;

        const updatedUser = await this.userModel.findByIdAndUpdate(
            staffId,
            { $set: updateData },
            { new: true }
        ).lean();

        if (!updatedUser) {
            throw new NotFoundException('Staff account not found');
        }

        this.logger.log(`Updated staff account ${staffId}`);

        return this.mapToResponseDto(updatedUser, dto.assignedFields);
    }

    /**
     * Remove staff account (soft delete)
     * Sets isActive to false and removes from owner's staffAccounts
     */
    async removeStaffAccount(
        staffId: string,
        ownerProfileId: string
    ): Promise<{ success: boolean; message: string }> {
        // 1. Verify staff belongs to owner
        await this.verifyStaffAccess(staffId, ownerProfileId);

        // 2. Soft delete user (set isActive = false)
        const staffUser = await this.userModel.findByIdAndUpdate(
            staffId,
            { $set: { isActive: false } },
            { new: true }
        );

        if (!staffUser) {
            throw new NotFoundException('Staff account not found');
        }

        // 3. Remove from owner's staffAccounts array
        await this.fieldOwnerProfileModel.findByIdAndUpdate(
            ownerProfileId,
            { $pull: { staffAccounts: new Types.ObjectId(staffId) } }
        );

        this.logger.log(`Removed staff ${staffId} from owner ${ownerProfileId}`);

        return {
            success: true,
            message: 'Staff account removed successfully'
        };
    }

    /**
     * Verify staff belongs to owner
     * Throws NotFoundException if staff doesn't belong to owner
     */
    async verifyStaffAccess(staffId: string, ownerProfileId: string): Promise<void> {
        const ownerProfile = await this.fieldOwnerProfileModel.findById(ownerProfileId);
        if (!ownerProfile) {
            throw new NotFoundException('Field owner profile not found');
        }

        const staffIds = ownerProfile.staffAccounts || [];
        const hasAccess = staffIds.some(id => id.toString() === staffId);

        if (!hasAccess) {
            throw new BadRequestException('Staff account does not belong to this owner');
        }
    }

    /**
     * Get owner profile for a staff member
     * Returns null if staff is not linked to any owner
     */
    async getStaffOwner(staffId: string): Promise<FieldOwnerProfile | null> {
        const ownerProfile = await this.fieldOwnerProfileModel.findOne({
            staffAccounts: new Types.ObjectId(staffId)
        });

        return ownerProfile;
    }

    /**
     * Check if a user is a staff member
     */
    async isStaff(userId: string): Promise<boolean> {
        const ownerProfile = await this.getStaffOwner(userId);
        return ownerProfile !== null;
    }

    /**
     * Map User entity to StaffAccountResponseDto
     */
    private mapToResponseDto(user: any, assignedFields?: string[]): StaffAccountResponseDto {
        return {
            id: user._id.toString(),
            fullName: user.fullName,
            email: user.email,
            phone: user.phone,
            assignedFields: assignedFields || [],
            createdAt: user.createdAt,
            isActive: user.isActive,
            role: user.role
        };
    }
}
