import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { BadRequestException, Logger, ValidationError, ValidationPipe } from '@nestjs/common';
import { ERRORS_DICTIONARY } from './constraints/error-dictionary.constraint';
import { json, urlencoded } from 'express';
import * as cookieParser from 'cookie-parser';
import { ResponseInterceptor } from './interceptors/response.interceptor';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { execSync } from 'child_process';

async function bootstrap() {
  const logger = new Logger(bootstrap.name);
  
  // Xử lý unhandled errors và rejections để tránh server crash
  process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
    logger.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
    // Không exit ngay, chỉ log để server tiếp tục chạy
  });
  
  process.on('uncaughtException', (error: Error) => {
    logger.error('❌ Uncaught Exception:', error);
    // Exit process để tránh undefined state, nhưng có thể restart bằng PM2/systemd
    process.exit(1);
  });
  
  const app = await NestFactory.create(AppModule);

  // Enable trust proxy để đọc x-forwarded-proto từ reverse proxy (Nginx)
  // Quan trọng khi chạy trên AWS với Let's Encrypt (HTTPS)
  // NestJS wraps Express, cần lấy Express instance
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.set('trust proxy', true);

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      
      const allowedPatterns = [
        /^https:\/\/sport-zone-fe-deploy\.vercel\.app$/,  // Production
        /^https:\/\/.*\.vercel\.app$/,                     // All Vercel deployments
        /^http:\/\/localhost:\d+$/,                        // All localhost ports
      ];
      
      const isAllowed = allowedPatterns.some(pattern => pattern.test(origin));
      
      if (isAllowed) {
        callback(null, true);
      } else {
        // Log rejected origin for debugging
        logger.warn(`CORS: Rejected origin: ${origin}`);
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'Accept',
      'Origin',
      'X-Client-Type',
      'x-client-type',
      // Add headers for multipart/form-data
      'Content-Length',
      'Content-Disposition',
    ],
    exposedHeaders: [
      'Content-Type',
      'Content-Length',
      'Authorization',
    ],
    credentials: true,
    maxAge: 86400, // Cache preflight requests for 24 hours
  });
  const config_service = app.get(ConfigService);
  // Áp dụng ValidationPipe cho toàn bộ ứng dụng NestJS
  app.useGlobalPipes(
    new ValidationPipe({
      // Bật whitelist: Tự động loại bỏ các thuộc tính không khai báo trong DTO
      whitelist: true,

      // Tùy chỉnh cách format lỗi trả về khi validation thất bại
      exceptionFactory: (errors: ValidationError[]) =>
        new BadRequestException({
          // Thông báo chung cho lỗi validation (lấy từ constant ERRORS_DICTIONARY)
          message: ERRORS_DICTIONARY.VALIDATION_ERROR,

          // Lấy toàn bộ thông điệp lỗi từ từng field trong DTO
          details: errors
            .map((error) =>
              error.constraints
                ? Object.values(error.constraints) // Lấy tất cả message của field
                : [] // Nếu không có constraint nào thì trả về mảng rỗng
            )
            .flat(), // Gộp tất cả các mảng con thành 1 mảng phẳng
        }),
    }),
  );

  const port = process.env.PORT || config_service.get('PORT') || 3000;

  // 1. Dùng interceptor để chuẩn hóa response trước khi trả về client
  app.useGlobalInterceptors(new ResponseInterceptor());
  // 2. Cho phép backend parse dữ liệu JSON trong body request
  // và giới hạn dung lượng tối đa là 10MB
  app.use(json({ limit: '10mb' }));
  // 3. Cho phép parse dữ liệu form-urlencoded (dạng key=value&key2=value2)
  // extended: true => cho phép parse nested object
  // limit: '10mb' => giới hạn dung lượng
  app.use(urlencoded({ extended: true, limit: '10mb' }));
  // 4. Parse cookies for reading refresh_token in guards
  app.use(cookieParser());

  // 5. Setup Swagger Documentation
  const config = new DocumentBuilder()
    .setTitle('SportZone API')
    .setDescription('API documentation for SportZone - Sports Field Booking Platform')
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'JWT',
        description: 'Enter JWT token',
        in: 'header',
      },
      'JWT-auth', // This name here is important for matching up with @ApiBearerAuth() in your controller!
    )
    .addTag('Auth', 'Authentication endpoints')
    .addTag('Users', 'User management endpoints')
    .addTag('Fields', 'Field management endpoints')
    .addTag('Bookings', 'Booking management endpoints')
    .addTag('Payments', 'Payment processing endpoints')
    .addTag('Reviews', 'Review management endpoints')
    .addTag('Tournaments', 'Tournament management endpoints')
    .addTag('Amenities', 'Amenity management endpoints')
    .addTag('Coaches', 'Coach management endpoints')
    .addTag('Notifications', 'Notification management endpoints')
    .addTag('Admin', 'Admin management endpoints')
    .addTag('AI', 'AI-powered features')
    .addTag('Lesson Types', 'Lesson type management endpoints')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true, // Keep JWT token after page refresh
    },
  });

  try {
    await app.listen(port, () => {
      logger.log(`🚀 Server running on: http://localhost:${port}`);
      logger.log(`📚 Swagger docs available at: http://localhost:${port}/api/docs`);
    });
  } catch (error: any) {
    if (error.code === 'EADDRINUSE') {
      logger.error(`❌ Port ${port} is already in use. Killing existing process...`);
      // Try to kill the process using the port
      try {
        execSync(`lsof -ti:${port} | xargs kill -9`, { stdio: 'ignore' });
        logger.log(`✅ Killed process on port ${port}. Retrying...`);
        // Retry after a short delay
        await new Promise(resolve => setTimeout(resolve, 1000));
        await app.listen(port, () => {
          logger.log(`🚀 Server running on: http://localhost:${port}`);
          logger.log(`📚 Swagger docs available at: http://localhost:${port}/api/docs`);
        });
      } catch (killError) {
        logger.error(`❌ Failed to free port ${port}. Please kill the process manually.`);
        process.exit(1);
      }
    } else {
      throw error;
    }
  }
}

bootstrap();
