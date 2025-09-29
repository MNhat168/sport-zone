# SportZone Coding Principles

## 1. DRY (Don't Repeat Yourself)
Tạo services/utilities chung cho logic được sử dụng nhiều lần. Sử dụng Repository Pattern và decorators.

## 2. Say no to hard-code and magic numbers
Sử dụng enums, constants, và environment variables. Tránh hardcode strings và numbers trong code.

## 3. Change less, do most
Thiết kế generic interfaces và base classes. Sử dụng dependency injection và modular architecture.

## 4. Say no to N+1 queries
Sử dụng MongoDB populate, aggregation pipeline, và projection để tránh multiple queries.

## 5. RIGHT first, then optimize later
Làm đúng business logic trước, sau đó optimize performance. Focus vào maintainability.

## 6. Don't use anonymous models
Tạo DTOs riêng với validation decorators thay vì anonymous objects. Ensure type safety.

## 7. Don't throw scattered exceptions in controllers
Sử dụng global exception filters. Chỉ throw NestJS built-in exceptions hoặc custom exceptions khi cần.
