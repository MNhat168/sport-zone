import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { BadRequestException, Logger, ValidationError, ValidationPipe } from '@nestjs/common';
import { ERRORS_DICTIONARY } from './constraints/error-dictionary.constraint';
import { json, urlencoded } from 'express';
import * as cookieParser from 'cookie-parser';
import { ResponseInterceptor } from './interceptors/response.interceptor';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const logger = new Logger(bootstrap.name);
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: ['http://localhost:5173', 'http://localhost:5174', 'https://sportzone-fe.vercel.app'],
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
    credentials: true,
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

  await app.listen(port, () => {
    logger.log(`🚀 Server running on: http://localhost:${port}`);
    logger.log(`📚 Swagger docs available at: http://localhost:${port}/api/docs`);
  });
}

bootstrap();