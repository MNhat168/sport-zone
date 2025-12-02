import { ApiProperty } from '@nestjs/swagger';

/**
 * Response DTO cho eKYC session
 */
export class EkycSessionResponseDto {
  /**
   * ID của eKYC session
   * @example "ekyc_123456789"
   */
  @ApiProperty({
    description: 'ID của eKYC session',
    example: 'ekyc_123456789',
  })
  sessionId: string;

  /**
   * URL để redirect user đến didit eKYC
   * @example "https://didit.com/ekyc/verify?session=ekyc_123456789"
   */
  @ApiProperty({
    description: 'URL để redirect user đến didit eKYC',
    example: 'https://didit.com/ekyc/verify?session=ekyc_123456789',
  })
  redirectUrl: string;
}
