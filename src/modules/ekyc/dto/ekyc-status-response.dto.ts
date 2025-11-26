import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Dữ liệu eKYC đã được xác thực
 */
export class EkycDataDto {
  /**
   * Họ và tên đầy đủ
   * @example "Nguyễn Văn A"
   */
  @ApiProperty({
    description: 'Họ và tên đầy đủ',
    example: 'Nguyễn Văn A',
  })
  fullName: string;

  /**
   * Số CCCD/CMND
   * @example "001234567890"
   */
  @ApiProperty({
    description: 'Số CCCD/CMND',
    example: '001234567890',
  })
  idNumber: string;

  /**
   * Địa chỉ
   * @example "123 Nguyen Trai, Hanoi"
   */
  @ApiProperty({
    description: 'Địa chỉ',
    example: '123 Nguyen Trai, Hanoi',
  })
  address: string;
}

/**
 * Response DTO cho trạng thái eKYC
 */
export class EkycStatusResponseDto {
  /**
   * Trạng thái xác thực
   * @example "verified"
   */
  @ApiProperty({
    description: 'Trạng thái xác thực',
    enum: ['pending', 'verified', 'failed'],
    example: 'verified',
  })
  status: 'pending' | 'verified' | 'failed';

  /**
   * Dữ liệu đã được extract từ eKYC (chỉ có khi status = verified)
   */
  @ApiPropertyOptional({
    description: 'Dữ liệu đã được extract từ eKYC (chỉ có khi status = verified)',
    type: EkycDataDto,
  })
  data?: EkycDataDto;

  /**
   * Thời điểm xác thực thành công
   */
  @ApiPropertyOptional({
    description: 'Thời điểm xác thực thành công',
    example: '2025-11-26T10:30:00.000Z',
  })
  verifiedAt?: Date;
}
