import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { BadRequestException, Logger, ValidationError, ValidationPipe } from '@nestjs/common';
import { ERRORS_DICTIONARY } from './constraints/error-dictionary.constraint';
import { json, urlencoded } from 'express';
import { ResponseInterceptor } from './interceptors/response.interceptor';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  const logger = new Logger(bootstrap.name);
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: ['http://localhost:5173', 'https://sportzone-fe.vercel.app'],
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    allowedHeaders: '*',
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
  await app.listen(port, () =>
    logger.log(` Server running on: http://localhost:${port}/api-docs`),
  );
}

bootstrap();