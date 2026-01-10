import { IsEmail, IsNotEmpty, IsOptional, IsString, MinLength, IsArray, IsMongoId } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreateStaffAccountDto {
    @ApiProperty({
        description: 'Full name of the staff member',
        example: 'Nguyen Van A'
    })
    @IsNotEmpty()
    @IsString()
    fullName: string;

    @ApiProperty({
        description: 'Email address for staff login',
        example: 'staff@example.com'
    })
    @IsNotEmpty()
    @IsEmail()
    email: string;

    @ApiProperty({
        description: 'Password for staff account (min 8 characters)',
        example: 'password123',
        minLength: 8
    })
    @IsNotEmpty()
    @IsString()
    @MinLength(8, { message: 'Password must be at least 8 characters long' })
    password: string;

    @ApiPropertyOptional({
        description: 'Optional phone number',
        example: '0912345678'
    })
    @IsOptional()
    @IsString()
    phone?: string;

    @ApiPropertyOptional({
        description: 'IDs of fields this staff can access (optional for future use)',
        type: [String],
        example: ['507f1f77bcf86cd799439011']
    })
    @IsOptional()
    @IsArray()
    @IsMongoId({ each: true })
    assignedFields?: string[];
}

export class UpdateStaffAccountDto {
    @ApiPropertyOptional({
        description: 'Full name of the staff member',
        example: 'Nguyen Van A'
    })
    @IsOptional()
    @IsString()
    fullName?: string;

    @ApiPropertyOptional({
        description: 'Email address for staff login',
        example: 'staff@example.com'
    })
    @IsOptional()
    @IsEmail()
    email?: string;

    @ApiPropertyOptional({
        description: 'Optional phone number',
        example: '0912345678'
    })
    @IsOptional()
    @IsString()
    phone?: string;

    @ApiPropertyOptional({
        description: 'IDs of fields this staff can access',
        type: [String]
    })
    @IsOptional()
    @IsArray()
    @IsMongoId({ each: true })
    assignedFields?: string[];
}

export class StaffAccountResponseDto {
    @ApiProperty({
        description: 'Staff user ID',
        example: '507f1f77bcf86cd799439011'
    })
    id: string;

    @ApiProperty({
        description: 'Full name',
        example: 'Nguyen Van A'
    })
    fullName: string;

    @ApiProperty({
        description: 'Email address',
        example: 'staff@example.com'
    })
    email: string;

    @ApiPropertyOptional({
        description: 'Phone number',
        example: '0912345678'
    })
    phone?: string;

    @ApiPropertyOptional({
        description: 'Assigned field IDs',
        type: [String]
    })
    assignedFields?: string[];

    @ApiProperty({
        description: 'Account creation date'
    })
    createdAt: Date;

    @ApiProperty({
        description: 'Is account active',
        example: true
    })
    isActive: boolean;

    @ApiProperty({
        description: 'Role (always USER for staff)',
        example: 'user'
    })
    role: string;
}

export class ListStaffAccountsQueryDto {
    @ApiPropertyOptional({
        description: 'Page number',
        example: 1,
        default: 1
    })
    @IsOptional()
    @Type(() => Number)
    page?: number;

    @ApiPropertyOptional({
        description: 'Items per page',
        example: 10,
        default: 10
    })
    @IsOptional()
    @Type(() => Number)
    limit?: number;

    @ApiPropertyOptional({
        description: 'Filter by field ID',
        example: '507f1f77bcf86cd799439011'
    })
    @IsOptional()
    @IsMongoId()
    fieldId?: string;
}
