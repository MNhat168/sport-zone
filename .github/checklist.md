# 📋 Checklist Coding Principles cho Team SportZone

## 🔄 **1. DRY (Don't Repeat Yourself)**
- [ ] ✅ Tạo service/utility chung cho logic được sử dụng > 2 lần
- [ ] ✅ Tách constants vào file enum hoặc constants
- [ ] ✅ Sử dụng decorators cho các thao tác chung
- [ ] ✅ Tạo base classes/interfaces cho các entity tương tự
- [ ] ✅ Sử dụng Repository Pattern cho data access
- [ ] ❌ Copy-paste code giống nhau ở nhiều nơi
- [ ] ❌ Viết lại logic đã có sẵn trong hệ thống

```typescript
// ✅ TỐT - Tạo utility function chung
export class StringUtils {
    static toSlug(text: string): string {
        return text?.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]+/g, '');
    }
}

// ✅ TỐT - Sử dụng decorator chung
@UseGuards(JwtAccessTokenGuard)
@ApiTags('Users')
export class UsersController { ... }

// ❌ KHÔNG TỐT - Copy paste logic
createUserSlug(name: string) { return name?.toLowerCase().replace(" ", "-"); }
createFieldSlug(title: string) { return title?.toLowerCase().replace(" ", "-"); }
```

## 🚫 **2. Không Hard-code và Magic Number**
- [ ] ✅ Tạo constants cho tất cả giá trị cố định
- [ ] ✅ Sử dụng enum cho các giá trị có nghĩa cụ thể  
- [ ] ✅ Config values vào `.env` và `env.config.ts`
- [ ] ✅ Sử dụng `error-dictionary.constraint.ts` cho error messages
- [ ] ❌ Để số và chuỗi trực tiếp trong code

```typescript
// ✅ TỐT - Sử dụng constants
export const FileConstants = {
    MAX_FILE_SIZE: 10 * 1024 * 1024, // 10MB
    ALLOWED_EXTENSIONS: ['.jpg', '.png', '.pdf'],
    UPLOAD_PATH: 'uploads/'
} as const;

// ✅ TỐT - Sử dụng enum
export enum UserRole {
    USER = 'user',
    COACH = 'coach', 
    FIELD_OWNER = 'field_owner',
    ADMIN = 'admin'
}

export enum SportType {
    FOOTBALL = 'football',
    BASKETBALL = 'basketball',
    TENNIS = 'tennis'
}

// ❌ KHÔNG TỐT  
if (fileSize > 10485760) // Magic number
if (role === "ADMIN") // Hard-code string
```

## 🎯 **3. Thay Đổi Ít - Hiệu Quả Nhiều**
- [ ] ✅ Thiết kế method có thể tái sử dụng với parameters
- [ ] ✅ Sử dụng Generic types khi có thể
- [ ] ✅ Tạo base repository interfaces chung
- [ ] ✅ Sử dụng ConfigService cho settings
- [ ] ✅ Tạo base DTOs cho CRUD operations
- [ ] ❌ Tạo nhiều method/class tương tự nhau

```typescript
// ✅ TỐT - Generic repository interface
export interface BaseRepositoryInterface<T> {
    findAll(): Promise<T[]>;
    findById(id: string): Promise<T | null>;
    create(data: Partial<T>): Promise<T>;
    update(id: string, data: Partial<T>): Promise<T | null>;
    delete(id: string): Promise<T | null>;
}

// ✅ TỐT - Base service method
async findEntityById<T>(
    repository: BaseRepositoryInterface<T>,
    id: string,
    entityName: string
): Promise<T> {
    const entity = await repository.findById(id);
    if (!entity) {
        throw new NotFoundException(`${entityName} not found`);
    }
    return entity;
}

// ❌ KHÔNG TỐT - tạo riêng method cho từng entity
async findUserById(id: string): Promise<User> { ... }
async findFieldById(id: string): Promise<Field> { ... }
async findBookingById(id: string): Promise<Booking> { ... }
```

## ⚡ **4. Tránh N+1 Query Problem với MongoDB**
- [ ] ✅ Sử dụng `.populate()` cho related data
- [ ] ✅ Sử dụng aggregation pipeline cho complex queries
- [ ] ✅ Review MongoDB query logs để phát hiện N+1
- [ ] ✅ Sử dụng projection để chỉ lấy fields cần thiết
- [ ] ❌ Load data trong vòng lặp
- [ ] ❌ Populate không kiểm soát

```typescript
// ✅ TỐT - Populate related data
const bookings = await this.bookingModel
    .find({ userId: new Types.ObjectId(userId) })
    .populate('field', 'name address hourlyRate')
    .populate('user', 'fullName email')
    .select('startTime endTime totalPrice status')
    .exec();

// ✅ TỐT - Sử dụng aggregation pipeline
const bookingStats = await this.bookingModel.aggregate([
    { $match: { userId: new Types.ObjectId(userId) } },
    { $lookup: {
        from: 'fields',
        localField: 'field',
        foreignField: '_id',
        as: 'fieldInfo'
    }},
    { $unwind: '$fieldInfo' },
    { $group: {
        _id: '$fieldInfo.name',
        totalBookings: { $sum: 1 },
        totalSpent: { $sum: '$totalPrice' }
    }}
]);

// ❌ KHÔNG TỐT - Gây N+1
const bookings = await this.bookingModel.find().exec();
for (const booking of bookings) {
    const field = await this.fieldModel.findById(booking.field).exec(); // N+1!
    const user = await this.userModel.findById(booking.user).exec(); // N+1!
}
```

## 🎯 **5. Làm ĐÚNG Trước - Tối Ưu Sau**
- [ ] ✅ Code hoạt động đúng logic nghiệp vụ trước
- [ ] ✅ Viết unit tests để đảm bảo đúng chức năng
- [ ] ✅ Code review và test kỹ trước khi optimize
- [ ] ✅ Đo performance thực tế trước khi tối ưu
- [ ] ✅ Focus vào readability và maintainability trước
- [ ] ❌ Tối ưu khi chưa hiểu rõ requirements
- [ ] ❌ Micro-optimization quá sớm

```typescript
// ✅ TỐT - Đúng trước, rõ ràng trước
@Injectable()
export class UsersService {
    constructor(
        @Inject(USER_REPOSITORY) 
        private readonly userRepository: UserRepositoryInterface,
        private readonly logger: Logger
    ) {}

    async getActiveUsers(): Promise<User[]> {
        try {
            // Step 1: Làm đúng logic nghiệp vụ trước
            const activeUsers = await this.userRepository.findByCondition({
                isActive: true,
                role: { $in: [UserRole.USER, UserRole.COACH] }
            });
            
            return activeUsers;
        } catch (error) {
            this.logger.error('Error getting active users', error);
            throw new InternalServerErrorException('Failed to get active users');
        }
        
        // Step 2: Sau khi test đúng, có thể optimize thêm:
        // - Caching với Redis
        // - Pagination
        // - Field projection
        // - Indexing
    }
}
```

## 📝 **6. Không Dùng Anonymous Models**
- [ ] ✅ Tạo DTO riêng cho query results
- [ ] ✅ Tạo models có thể tái sử dụng
- [ ] ✅ Include JSDoc documentation cho DTOs
- [ ] ✅ Sử dụng class-transformer khi cần mapping
- [ ] ✅ Sử dụng class-validator cho validation
- [ ] ❌ Dùng anonymous objects trong queries
- [ ] ❌ Trả về `any` hoặc `object`

```typescript
// ✅ TỐT - Tạo DTO riêng với documentation
import { IsString, IsNumber, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO cho thông tin tóm tắt người dùng
 */
export class UserSummaryDto {
    /**
     * ID người dùng
     * @example "507f1f77bcf86cd799439011"
     */
    @ApiProperty({ example: "507f1f77bcf86cd799439011" })
    @IsString()
    id: string;
    
    /**
     * Tên đầy đủ của người dùng
     * @example "Nguyễn Văn A"
     */
    @ApiProperty({ example: "Nguyễn Văn A" })
    @IsString()
    fullName: string;
    
    /**
     * Số lượng booking đã thực hiện
     * @example 5
     */
    @ApiProperty({ example: 5 })
    @IsNumber()
    @IsOptional()
    bookingCount?: number;
}

// ✅ TỐT - Sử dụng DTO trong aggregation
const users = await this.userModel.aggregate([
    { $match: { isActive: true } },
    { $lookup: {
        from: 'bookings',
        localField: '_id',
        foreignField: 'user',
        as: 'bookings'
    }},
    { $project: {
        id: '$_id',
        fullName: 1,
        bookingCount: { $size: '$bookings' }
    }}
]).exec();

// ❌ KHÔNG TỐT - Anonymous object
const users = await this.userModel.find().select({
    id: '$_id', fullName: 1 // Không có type safety
}).exec();
```

## ⚠️ **7. Exception Handling Đúng Cách**
- [ ] ✅ Để Global Exception Filter xử lý các exception thông thường
- [ ] ✅ Chỉ throw NestJS built-in exceptions hoặc custom exceptions khi cần
- [ ] ✅ Log chi tiết trước khi throw exception
- [ ] ✅ Sử dụng `error-dictionary.constraint.ts` cho error messages
- [ ] ✅ Sử dụng proper HTTP status codes
- [ ] ❌ Try-catch mọi thứ trong Controllers
- [ ] ❌ Throw generic Error objects
- [ ] ❌ Nuốt exceptions mà không log

```typescript
// ✅ TỐT - Để global exception filter xử lý
@Controller('users')
export class UsersController {
    constructor(private readonly usersService: UsersService) {}

    @Get(':id')
    @UseGuards(JwtAccessTokenGuard)
    async getUser(@Param('id') id: string): Promise<User> {
        // Throw tự nhiên nếu có lỗi, global filter sẽ xử lý
        return await this.usersService.findById(id);
    }
}

// ✅ TỐT - Custom exception khi cần business logic
@Injectable()
export class UsersService {
    constructor(
        @Inject(USER_REPOSITORY) 
        private readonly userRepository: UserRepositoryInterface,
        private readonly logger: Logger
    ) {}

    async activateUser(userId: string): Promise<User> {
        const user = await this.userRepository.findById(userId);
        if (!user) {
            throw new NotFoundException('User not found');
        }
        
        if (user.role === UserRole.ADMIN) {
            this.logger.warn(`Attempt to activate admin user ${userId}`);
            throw new ForbiddenException('Cannot activate admin user');
        }
        
        user.isActive = true;
        const updatedUser = await this.userRepository.update(userId, user);
        
        this.logger.log(`User ${userId} activated successfully`);
        return updatedUser;
    }
}

// ❌ KHÔNG TỐT - Try-catch không cần thiết trong Controller
@Controller('users')
export class UsersController {
    @Get(':id')
    async getUser(@Param('id') id: string) {
        try {
            const user = await this.usersService.findById(id);
            return { success: true, data: user };
        } catch (error) { // Global filter sẽ xử lý
            return { success: false, message: 'Có lỗi xảy ra' };
        }
    }
}
```

---

## 🔍 **Code Review Checklist**
Trước khi submit PR, kiểm tra:
- [ ] ✅ Có tuân thủ 7 nguyên tắc trên không?
- [ ] ✅ Code có thể hiểu và maintain không?
- [ ] ✅ Có unit tests đầy đủ không?
- [ ] ✅ Performance có OK không? (MongoDB queries, memory)
- [ ] ✅ Security có đảm bảo không? (Guards, validation pipes)
- [ ] ✅ API documentation đầy đủ (JSDoc, Swagger decorators)
- [ ] ✅ Sử dụng đúng Repository Pattern
- [ ] ✅ Naming conventions đúng chuẩn NestJS
- [ ] ✅ DTOs có validation decorators
- [ ] ✅ Proper error handling với NestJS exceptions

---

## 🎯 **Quick Reference**

### ✅ **Patterns To Follow**
```typescript
// Repository Pattern
@Injectable()
export class UserRepository implements UserRepositoryInterface {
    constructor(@InjectModel(User.name) private userModel: Model<UserDocument>) {}
    
    async findById(id: string): Promise<User | null> {
        return this.userModel.findById(id).exec();
    }
}

// Service method structure
@Injectable()
export class UsersService {
    async getUser(id: string): Promise<User> {
        const user = await this.userRepository.findById(id);
        if (!user) {
            throw new NotFoundException('User not found');
        }
        return user;
    }
}

// Controller method structure
@Controller('users')
@ApiTags('Users')
@UseGuards(JwtAccessTokenGuard)
export class UsersController {
    @Get(':id')
    @ApiOperation({ summary: 'Lấy thông tin user theo ID' })
    @ApiResponse({ status: 200, description: 'Thành công', type: User })
    async getUser(@Param('id') id: string): Promise<User> {
        return await this.usersService.getUser(id);
    }
}

// DTO with validation
export class CreateUserDto {
    @ApiProperty({ example: 'john@example.com' })
    @IsEmail()
    email: string;
    
    @ApiProperty({ example: 'John Doe' })
    @IsString()
    @Length(2, 50)
    fullName: string;
}
```

### ❌ **Anti-Patterns To Avoid**
```typescript
// Avoid magic numbers
if (role === 1) // ❌ Use enum instead

// Avoid anonymous objects  
.select({ id: 1, name: 1 }) // ❌ Create proper DTO

// Avoid N+1 queries
for (const booking of bookings) {
    const field = await this.fieldModel.findById(booking.fieldId); // ❌
}

// Avoid try-catch in controllers
@Get()
async getUsers() {
    try {
        return await this.service.getUsers();
    } catch (error) {
        return { error: 'Something went wrong' }; // ❌
    }
}
```

---

**💡 Tip**: In checklist này ra và dán bên màn hình để nhớ check khi code SportZone!