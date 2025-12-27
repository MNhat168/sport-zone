import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Court } from './entities/court.entity';
import { Field } from '../fields/entities/field.entity';
import { FieldOwnerProfile } from '../field-owner/entities/field-owner-profile.entity';
import { CreateCourtDto } from './dto/create-court.dto';
import { UpdateCourtDto } from './dto/update-court.dto';
import { UserRole } from '@common/enums/user.enum';

type RequestUser = {
  userId: string;
  role?: string;
};

@Injectable()
export class CourtsService {
  constructor(
    @InjectModel(Court.name) private readonly courtModel: Model<Court>,
    @InjectModel(Field.name) private readonly fieldModel: Model<Field>,
    @InjectModel(FieldOwnerProfile.name) private readonly fieldOwnerProfileModel: Model<FieldOwnerProfile>,
  ) { }

  private normalizeUser(user: any): RequestUser {
    const userId = user?._id?.toString?.() || user?.id || user?.userId;
    if (!userId) {
      throw new UnauthorizedException('User not found in request');
    }
    return { userId, role: user?.role };
  }

  private async assertFieldAccess(fieldId: string, user: RequestUser): Promise<Field> {
    if (!Types.ObjectId.isValid(fieldId)) {
      throw new BadRequestException('Invalid field ID format');
    }

    const field = await this.fieldModel.findById(fieldId);
    if (!field) {
      throw new NotFoundException('Field not found');
    }

    const role = (user.role || '').toLowerCase();
    if (role === UserRole.ADMIN) {
      return field;
    }
    if (role !== UserRole.FIELD_OWNER) {
      throw new ForbiddenException('Only field owners or admins can manage courts');
    }

    const ownerProfile = await this.fieldOwnerProfileModel.findOne({ user: new Types.ObjectId(user.userId) });
    if (!ownerProfile) {
      throw new UnauthorizedException('Field owner profile not found');
    }

    const ownerProfileId = (ownerProfile._id as Types.ObjectId).toString();

    if (field.owner.toString() !== ownerProfileId) {
      throw new ForbiddenException('You are not the owner of this field');
    }

    return field;
  }



  async create(fieldId: string, dto: CreateCourtDto, rawUser: any): Promise<Court> {
    const user = this.normalizeUser(rawUser);
    await this.assertFieldAccess(fieldId, user);

    const exists = await this.courtModel.exists({ field: new Types.ObjectId(fieldId), courtNumber: dto.courtNumber });
    if (exists) {
      throw new BadRequestException('Court number already exists for this field');
    }

    const court = await this.courtModel.create({
      field: new Types.ObjectId(fieldId),
      name: dto.name,
      courtNumber: dto.courtNumber,
    });

    return court;
  }

  async findByField(fieldId: string, includeInactive: boolean, rawUser: any): Promise<Court[]> {
    const user = this.normalizeUser(rawUser);
    await this.assertFieldAccess(fieldId, user);

    const filter: any = { field: new Types.ObjectId(fieldId) };
    if (!includeInactive) {
      filter.isActive = true;
    }

    return this.courtModel.find(filter).sort({ courtNumber: 1 }).exec();
  }

  async findActiveByFieldPublic(fieldId: string): Promise<Court[]> {
    if (!Types.ObjectId.isValid(fieldId)) {
      throw new BadRequestException('Invalid field ID format');
    }

    const field = await this.fieldModel.findById(fieldId);
    if (!field || !field.isActive) {
      throw new NotFoundException('Field not found or inactive');
    }

    return this.courtModel.find({ field: field._id, isActive: true }).sort({ courtNumber: 1 }).exec();
  }

  async update(fieldId: string, courtId: string, dto: UpdateCourtDto, rawUser: any): Promise<Court> {
    const user = this.normalizeUser(rawUser);
    await this.assertFieldAccess(fieldId, user);

    if (!Types.ObjectId.isValid(courtId)) {
      throw new BadRequestException('Invalid court ID format');
    }

    const court = await this.courtModel.findOne({ _id: courtId, field: fieldId });
    if (!court) {
      throw new NotFoundException('Court not found for this field');
    }

    if (dto.courtNumber && dto.courtNumber !== court.courtNumber) {
      const duplicate = await this.courtModel.exists({
        field: new Types.ObjectId(fieldId),
        courtNumber: dto.courtNumber,
        _id: { $ne: new Types.ObjectId(courtId) },
      });
      if (duplicate) {
        throw new BadRequestException('Court number already exists for this field');
      }
    }

    if (dto.name !== undefined) court.name = dto.name;
    if (dto.courtNumber !== undefined) court.courtNumber = dto.courtNumber;
    if (dto.isActive !== undefined) court.isActive = dto.isActive;

    await court.save();
    return court;
  }
}

