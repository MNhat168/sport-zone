import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUrl } from 'class-validator';

/**
 * DTO cho việc tạo eKYC session
 */
export class CreateEkycSessionDto {
  /**
   * URL để redirect sau khi hoàn thành eKYC
   * @example "https://sportzone.com/field-owner/registration"
   */
  @ApiPropertyOptional({
    description: 'URL để redirect sau khi hoàn thành eKYC',
    example: 'https://sportzone.com/field-owner/registration',
  })
  @IsOptional()
  @IsString()
  @IsUrl()
  redirectUrlAfterEkyc?: string;
}
