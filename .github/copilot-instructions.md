# GitHub Copilot Instructions for SportZone Project

## 🎯 **Context**
You are working on SportZone - a sports facility booking platform built with NestJS, MongoDB, and TypeScript following modular architecture patterns.

## 🏗️ **Architecture Guidelines**

### Follow NestJS Modular Architecture
- **Controller**: Handle HTTP requests, use guards, validation pipes
- **Service**: Business logic, data manipulation, error handling  
- **Repository**: Data access with MongoDB via Mongoose
- **Module**: Group related components, manage dependencies

### Always Use Repository Pattern
```typescript
// ✅ Repository Interface
export interface UserRepositoryInterface {
    findAll(): Promise<User[]>;
    findById(id: string): Promise<User | null>;
    create(data: Partial<User>): Promise<User>;
    update(id: string, data: Partial<User>): Promise<User | null>;
    delete(id: string): Promise<User | null>;
}

// ✅ Repository Implementation
@Injectable()
export class UserRepository implements UserRepositoryInterface {
    constructor(@InjectModel(User.name) private userModel: Model<UserDocument>) {}
    
    async findById(id: string): Promise<User | null> {
        return this.userModel.findById(id).exec();
    }
}
```

## 📝 **Code Generation Rules**

### 1. Controller Methods
- Always include JSDoc documentation with examples
- Use Swagger decorators for API documentation
- Minimal logic - delegate to services
- Include authentication guards and validation pipes

```typescript
/**
 * Lấy thông tin người dùng theo ID
 * @param id - ID của người dùng
 * @returns Thông tin chi tiết người dùng
 */
@Controller('users')
@ApiTags('Users')
@UseGuards(JwtAccessTokenGuard)
export class UsersController {
    constructor(private readonly usersService: UsersService) {}

    @Get(':id')
    @ApiOperation({ summary: 'Lấy thông tin người dùng theo ID' })
    @ApiParam({ name: 'id', description: 'User ID', example: '507f1f77bcf86cd799439011' })
    @ApiResponse({ status: 200, description: 'Thành công', type: User })
    @ApiResponse({ status: 404, description: 'Không tìm thấy người dùng' })
    async getUser(@Param('id') id: string): Promise<User> {
        return await this.usersService.findById(id);
    }
}
```

### 2. Service Methods
- Always async with proper error handling
- Use NestJS built-in exceptions
- Include business logic validation
- Use dependency injection with repository pattern

```typescript
@Injectable()
export class UsersService {
    private readonly logger = new Logger(UsersService.name);

    constructor(
        @Inject(USER_REPOSITORY) 
        private readonly userRepository: UserRepositoryInterface
    ) {}

    async getUsers(filter?: UserFilterDto): Promise<User[]> {
        try {
            let condition: FilterQuery<User> = { isActive: true };
            
            if (filter?.name) {
                condition.fullName = { $regex: filter.name, $options: 'i' };
            }
            
            if (filter?.role) {
                condition.role = filter.role;
            }
            
            const users = await this.userRepository.findByCondition(condition);
            this.logger.log(`Retrieved ${users.length} users`);
            
            return users;
        } catch (error) {
            this.logger.error('Error getting users', error);
            throw new InternalServerErrorException('Failed to retrieve users');
        }
    }

    async findById(id: string): Promise<User> {
        const user = await this.userRepository.findById(id);
        if (!user) {
            throw new NotFoundException(`User with ID ${id} not found`);
        }
        return user;
    }
}
```

### 3. DTOs/Models with Documentation
```typescript
import { IsString, IsEmail, IsEnum, IsOptional, Length } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole } from '@common/enums/user-role.enum';

/**
 * DTO cho việc tạo người dùng mới
 */
export class CreateUserDto {
    /**
     * Email của người dùng
     * @example "john.doe@example.com"
     */
    @ApiProperty({ 
        example: 'john.doe@example.com',
        description: 'Email của người dùng'
    })
    @IsEmail()
    email: string;
    
    /**
     * Tên đầy đủ của người dùng
     * @example "John Doe"
     */
    @ApiProperty({ 
        example: 'John Doe',
        description: 'Tên đầy đủ của người dùng'
    })
    @IsString()
    @Length(2, 50)
    fullName: string;
    
    /**
     * Vai trò của người dùng
     * @example "user"
     */
    @ApiPropertyOptional({ 
        enum: UserRole,
        example: UserRole.USER,
        description: 'Vai trò của người dùng'
    })
    @IsOptional()
    @IsEnum(UserRole)
    role?: UserRole;
}

/**
 * DTO cho việc lọc danh sách người dùng
 */
export class UserFilterDto {
    @ApiPropertyOptional({ description: 'Tên để tìm kiếm' })
    @IsOptional()
    @IsString()
    name?: string;

    @ApiPropertyOptional({ enum: UserRole })
    @IsOptional()
    @IsEnum(UserRole)
    role?: UserRole;
}
```

## 🔧 **Naming Conventions**

- Controllers: `{Entity}Controller` (e.g., `UsersController`, `FieldsController`)
- Services: `{Entity}Service` (e.g., `UsersService`, `BookingsService`)
- Repositories: `{Entity}Repository` (e.g., `UserRepository`, `FieldRepository`)
- Interfaces: `{Entity}RepositoryInterface` (e.g., `UserRepositoryInterface`)
- DTOs: 
  - Create: `Create{Entity}Dto` (e.g., `CreateUserDto`)
  - Update: `Update{Entity}Dto` (e.g., `UpdateUserDto`)
  - Filter: `{Entity}FilterDto` (e.g., `UserFilterDto`)
  - Response: `{Entity}ResponseDto` (optional, when different from entity)
- Entities: `{Entity}` (e.g., `User`, `Field`, `Booking`)
- Enums: `{Entity}Enum` (e.g., `UserRole`, `SportType`)
- Methods: `{action}{Entity}` for services (e.g., `createUser`, `findBookings`)
- Routes: `/{entity-name}` (kebab-case, e.g., `/users`, `/sport-fields`)

## 📊 **Database Access Patterns**

```typescript
// ✅ Efficient queries with populate and projection
const bookings = await this.bookingModel
    .find({ 
        userId: new Types.ObjectId(userId),
        status: BookingStatus.CONFIRMED 
    })
    .populate('field', 'name address hourlyRate')
    .populate('user', 'fullName email')
    .select('startTime endTime totalPrice status createdAt')
    .sort({ createdAt: -1 })
    .exec();

// ✅ Aggregation pipeline for complex queries
const fieldStats = await this.fieldModel.aggregate([
    { $match: { isActive: true } },
    { $lookup: {
        from: 'bookings',
        localField: '_id',
        foreignField: 'field',
        as: 'bookings'
    }},
    { $addFields: {
        totalBookings: { $size: '$bookings' },
        revenue: { $sum: '$bookings.totalPrice' }
    }},
    { $project: {
        name: 1,
        address: 1,
        totalBookings: 1,
        revenue: 1
    }},
    { $sort: { revenue: -1 } }
]);

// ✅ Pagination for list endpoints
const skip = (page - 1) * limit;
const [users, total] = await Promise.all([
    this.userModel
        .find(filterConditions)
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 })
        .exec(),
    this.userModel.countDocuments(filterConditions)
]);

return {
    data: users,
    pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
    }
};
```

## 🚫 **Don't Generate**

- Direct MongoDB queries in controllers
- Generic `any` or `object` return types
- Methods without error handling
- APIs without authentication guards
- Code without JSDoc documentation
- Synchronous I/O operations
- Try-catch blocks in controllers (use global exception filters)
- Services without dependency injection
- DTOs without validation decorators
- Entities without proper Mongoose schemas

## ✅ **Always Include**

- Proper exception handling with NestJS exceptions
- Authentication guards (`@UseGuards(JwtAccessTokenGuard)`)
- Validation pipes with DTOs (`@Body() dto: CreateUserDto`)
- JSDoc documentation with examples
- Swagger decorators (`@ApiOperation`, `@ApiResponse`)
- Async/await for I/O operations
- Dependency injection in constructors
- Repository pattern for data access
- Proper TypeScript typing

## 🔍 **Testing Patterns**

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { NotFoundException } from '@nestjs/common';

describe('UsersService', () => {
    let service: UsersService;
    let mockRepository: jest.Mocked<UserRepositoryInterface>;

    beforeEach(async () => {
        const mockRepo = {
            findById: jest.fn(),
            findByCondition: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                UsersService,
                {
                    provide: USER_REPOSITORY,
                    useValue: mockRepo,
                },
            ],
        }).compile();

        service = module.get<UsersService>(UsersService);
        mockRepository = module.get(USER_REPOSITORY);
    });

    describe('findById', () => {
        it('should return user when found', async () => {
            // Arrange
            const userId = '507f1f77bcf86cd799439011';
            const mockUser = { 
                _id: userId, 
                fullName: 'John Doe', 
                email: 'john@example.com' 
            } as User;
            
            mockRepository.findById.mockResolvedValue(mockUser);

            // Act
            const result = await service.findById(userId);

            // Assert
            expect(result).toEqual(mockUser);
            expect(mockRepository.findById).toHaveBeenCalledWith(userId);
        });

        it('should throw NotFoundException when user not found', async () => {
            // Arrange
            const userId = '507f1f77bcf86cd799439011';
            mockRepository.findById.mockResolvedValue(null);

            // Act & Assert
            await expect(service.findById(userId)).rejects.toThrow(NotFoundException);
        });
    });
});
```

## 📋 **File Structure**

When creating new features, organize files as:
```
src/modules/{entity}/
├── {entity}.controller.ts
├── {entity}.service.ts
├── {entity}.module.ts
├── entities/
│   └── {entity}.entity.ts
├── dto/
│   ├── create-{entity}.dto.ts
│   ├── update-{entity}.dto.ts
│   └── {entity}-filter.dto.ts
├── repositories/
│   └── {entity}.repository.ts
├── interfaces/
│   └── {entity}.interface.ts
└── guards/ (if needed)
    └── {entity}-specific.guard.ts
```

### Example for Users module:
```
src/modules/users/
├── users.controller.ts
├── users.service.ts
├── users.module.ts
├── entities/
│   └── user.entity.ts
├── dto/
│   ├── create-user.dto.ts
│   ├── update-user.dto.ts
│   └── user-filter.dto.ts
├── repositories/
│   └── user.repository.ts
└── interfaces/
    └── users.interface.ts
```

## 🚫 **Terminal Command Restrictions**

**DO NOT suggest or run terminal commands automatically**, especially:
- ❌ `npm start` hoặc `npm run dev` hoặc `any run commands`
- ❌ `nest start` 
- ❌ `pnpm start`
- ❌ Any auto-generated build/test/run commands

**ONLY suggest installation commands when explicitly needed:**
- ✅ `npm install <package>` 
- ✅ `pnpm install <package>`
- ✅ `npm install` or `pnpm install` (for dependency installation)

**Reason**: The user prefers to manually run application commands and only wants assistance with dependency installation.

---

**Remember**: Follow these patterns consistently for all code generation in the SportZone project!