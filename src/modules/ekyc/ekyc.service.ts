import {
  Injectable,
  Logger,
  InternalServerErrorException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { FieldOwnerRegistrationRequest } from '../field-owner/entities/field-owner-registration-request.entity';
import { CoachRegistrationRequest } from '../coaches/entities/coach-registration-request.entity';
import { User } from '../users/entities/user.entity';

/**
 * Service xử lý tích hợp didit eKYC
 * Sử dụng polling approach thay vì webhook để đơn giản hóa implementation
 */
@Injectable()
export class EkycService {
  private readonly logger = new Logger(EkycService.name);
  private readonly diditApiKey: string;
  private readonly diditApiSecret: string;
  private readonly diditBaseUrl: string;
  private readonly diditWorkflowId: string;
  private readonly isMockMode: boolean;

  constructor(
    private readonly configService: ConfigService,
    @InjectModel(FieldOwnerRegistrationRequest.name)
    private readonly fieldOwnerRegistrationRequestModel: Model<FieldOwnerRegistrationRequest>,
    @InjectModel(CoachRegistrationRequest.name)
    private readonly coachRegistrationRequestModel: Model<CoachRegistrationRequest>,
    @InjectModel(User.name)
    private readonly userModel: Model<User>,
    private readonly httpService: HttpService,
  ) {
    this.diditApiKey = this.configService.get<string>('app.didit.apiKey') || '';
    this.diditApiSecret =
      this.configService.get<string>('app.didit.apiSecret') || '';
    this.diditBaseUrl =
      this.configService.get<string>('app.didit.baseUrl') ||
      'https://verification.didit.me';
    this.diditWorkflowId =
      this.configService.get<string>('app.didit.workflowId') || '';
    this.isMockMode =
      this.configService.get<string>('app.didit.mockMode') === 'true';

    if (this.isMockMode) {
      this.logger.warn('⚠️  didit eKYC running in MOCK MODE');
    } else if (!this.diditApiKey) {
      this.logger.warn('⚠️  DIDIT_API_KEY is not set. Consider enabling MOCK MODE for local development.');
    } else if (!this.diditWorkflowId) {
      this.logger.warn('⚠️  DIDIT_WORKFLOW_ID is not set. This is required for creating eKYC sessions.');
    }
  }

  /**
   * Tạo eKYC session với didit
   * @param userId - ID của user đang đăng ký
   * @returns sessionId và redirectUrl
   */
  async createEkycSession(
    userId: string,
  ): Promise<{ sessionId: string; redirectUrl: string }> {
    // Validate userId
    if (!userId || userId.trim() === '') {
      this.logger.error('Invalid userId provided to createEkycSession', {
        userId,
      });
      throw new BadRequestException('User ID không hợp lệ.');
    }

    try {
      // Fallback to mock mode if API key is missing (for development)
      const shouldUseMockMode = this.isMockMode || (!this.diditApiKey && !this.diditApiSecret);
      
      if (shouldUseMockMode) {
        if (!this.isMockMode && !this.diditApiKey) {
          this.logger.warn(
            `[MOCK FALLBACK] DIDIT_API_KEY not set, using mock mode for user ${userId}`,
          );
        }
        
        const sessionId = `mock_${Date.now()}_${userId}`;
        const frontendUrl = this.configService.get('app.frontendUrl') || 'http://localhost:3001';
        const redirectUrl = `${frontendUrl}/mock-ekyc?session=${sessionId}`;

        this.logger.log(
          `[MOCK] Created eKYC session ${sessionId} for user ${userId}`,
        );

        return { sessionId, redirectUrl };
      }

      // Validate workflow ID is set
      if (!this.diditWorkflowId) {
        this.logger.error('DIDIT_WORKFLOW_ID is not configured', { userId });
        throw new BadRequestException(
          'Cấu hình eKYC chưa hoàn tất. Vui lòng liên hệ quản trị viên.',
        );
      }

      // Call didit API v2 để tạo session
      // Default to port 5173 (Vite dev server) if FRONTEND_URL is not set
      const frontendUrl = this.configService.get('app.frontendUrl') || 'http://localhost:5173';
      const callbackUrl = `${frontendUrl}/field-owner/ekyc/callback`;

      const response = await firstValueFrom(
        this.httpService.post(
          `${this.diditBaseUrl}/v2/session/`,
          {
            workflow_id: this.diditWorkflowId,
            callback: callbackUrl,
            vendor_data: userId,
            metadata: {
              user_id: userId,
            },
          },
          {
            headers: {
              'x-api-key': this.diditApiKey,
              'Content-Type': 'application/json',
            },
          },
        ),
      );

      // Didit v2 API returns session_id and url
      const { session_id, url } = response.data;

      if (!session_id || !url) {
        this.logger.error('Invalid response from didit API', {
          response: response.data,
          userId,
        });
        throw new InternalServerErrorException(
          'Phản hồi không hợp lệ từ hệ thống xác thực.',
        );
      }

      this.logger.log(`Created eKYC session ${session_id} for user ${userId}`);

      // Map to expected format
      return { 
        sessionId: session_id, 
        redirectUrl: url 
      };
    } catch (error: any) {
      const errorMessage = error?.response?.data?.message || error?.message || 'Unknown error';
      const errorStatus = error?.response?.status || error?.code;
      
      this.logger.error('Failed to create eKYC session:', {
        userId,
        message: errorMessage,
        status: errorStatus,
        url: `${this.diditBaseUrl}/v2/session/`,
        hasApiKey: !!this.diditApiKey,
        hasWorkflowId: !!this.diditWorkflowId,
        isMockMode: this.isMockMode,
        errorStack: error?.stack,
        responseData: error?.response?.data,
      });
      
      // If it's a BadRequestException, re-throw it
      if (error instanceof BadRequestException) {
        throw error;
      }
      
      throw new InternalServerErrorException(
        'Không thể tạo phiên xác thực eKYC. Vui lòng thử lại sau.',
      );
    }
  }

  /**
   * Lấy status của eKYC session từ didit
   * Được FE gọi mỗi 3-5s để polling kết quả
   * @param sessionId - eKYC session ID
   */
  async getEkycSessionStatus(sessionId: string): Promise<{
    status: 'pending' | 'verified' | 'failed';
    data?: {
      fullName: string;
      idNumber: string;
      address: string;
    };
    verifiedAt?: Date;
  }> {
    try {
      // Mock mode for development/testing
      if (this.isMockMode) {
        return this.getMockEkycStatus(sessionId);
      }

      // Call didit API v2 để lấy session decision/status
      const response = await firstValueFrom(
        this.httpService.get(
          `${this.diditBaseUrl}/v2/session/${sessionId}/decision/`,
          {
            headers: {
              'x-api-key': this.diditApiKey,
            },
          },
        ),
      );

      const diditData = response.data;

      // Map didit v2 response sang format của mình
      let status: 'pending' | 'verified' | 'failed' = 'pending';
      let ekycData: {
        fullName: string;
        idNumber: string;
        address: string;
      } | undefined = undefined;
      let verifiedAt: Date | undefined = undefined;

      // Didit v2 decision response structure
      // Check decision status: 'approved', 'rejected', 'pending', etc.
      const decisionStatus = diditData.decision?.status || diditData.status;
      
      this.logger.log(`[EkycService] Checking status for ${sessionId}: Raw status = ${decisionStatus}`);
      
      const normalizedStatus = String(decisionStatus || '').toLowerCase();
      
      if (['approved', 'completed', 'verified'].includes(normalizedStatus)) {
        status = 'verified';
        
        this.logger.log(`[EkycService] ✅ Didit response for ${sessionId}: ${JSON.stringify(diditData)}`);

        verifiedAt = new Date(
          diditData.decision?.completed_at || 
          diditData.completed_at || 
          diditData.verified_at || 
          Date.now(),
        );
        
        // Extract data from didit response
        // Priority: id_verification (new structure) > decision.data > data > extracted_data (old structures)
        const idVerification = diditData.id_verification;
        const decisionData = diditData.decision?.data || diditData.data || {};
        const extractedData = decisionData.extracted_data || decisionData;

        // Use id_verification if available (new Didit API structure)
        if (idVerification) {
          // Construct full name from first_name + last_name if full_name is not available
          const fullName = idVerification.full_name || 
            (idVerification.first_name && idVerification.last_name 
              ? `${idVerification.first_name} ${idVerification.last_name}`.trim()
              : '');

          ekycData = {
            fullName: fullName || '',
            // Prefer personal_number (12 digits) over document_number (9 digits)
            idNumber: idVerification.personal_number || idVerification.document_number || '',
            // Use formatted_address if available, fallback to address, or empty string if null
            address: idVerification.formatted_address || idVerification.address || '',
          };
        } else {
          // Fallback to old structure for backward compatibility
          ekycData = {
            fullName: extractedData.fullName || extractedData.full_name || extractedData.name || extractedData.ocr_name || '',
            idNumber: extractedData.idNumber || extractedData.id_number || extractedData.document_number || extractedData.ocr_id_number || '',
            address: extractedData.address || extractedData.residential_address || extractedData.ocr_address || '',
          };
        }
        
        this.logger.log(`[EkycService] Extracted eKYC data: ${JSON.stringify(ekycData)}`);
      } else if (
        decisionStatus === 'rejected' ||
        decisionStatus === 'failed' ||
        decisionStatus === 'declined'
      ) {
        status = 'failed';
      } else {
        // Still pending or in progress
        status = 'pending';
      }

      // Update local DB
      await this.updateLocalRegistrationRequest(
        sessionId,
        status,
        ekycData,
        verifiedAt,
      );

      // Nếu đã verified và có dữ liệu, đồng bộ sang User
      if (status === 'verified' && ekycData) {
        await this.syncUserFromEkyc(sessionId, ekycData);
      }

      return { status, data: ekycData, verifiedAt };
    } catch (error) {
      this.logger.error(
        `Failed to get eKYC session status for ${sessionId}:`,
        error,
      );
      throw new InternalServerErrorException(
        'Không thể lấy trạng thái xác thực. Vui lòng thử lại sau.',
      );
    }
  }

  /**
   * Mock eKYC status cho development/testing
   * Simulate verified sau 5s
   */
  private getMockEkycStatus(sessionId: string): {
    status: 'pending' | 'verified' | 'failed';
    data?: {
      fullName: string;
      idNumber: string;
      address: string;
    };
    verifiedAt?: Date;
  } {
    // Extract timestamp từ mock sessionId: mock_{timestamp}_{userId}
    const timestampMatch = sessionId.match(/mock_(\d+)_/);

    if (!timestampMatch) {
      this.logger.warn(`[MOCK] Invalid mock session ID format: ${sessionId}`);
      return { status: 'failed' };
    }

    const createdAt = parseInt(timestampMatch[1]);
    const elapsedSeconds = (Date.now() - createdAt) / 1000;

    // Simulate verified sau 5 giây
    if (elapsedSeconds >= 5) {
      this.logger.log(`[MOCK] Session ${sessionId} verified`);
      return {
        status: 'verified',
        data: {
          fullName: 'Nguyễn Văn A (Mock)',
          idNumber: '001234567890',
          address: '123 Mock Street, Hanoi, Vietnam',
        },
        verifiedAt: new Date(),
      };
    }

    this.logger.log(
      `[MOCK] Session ${sessionId} pending (${elapsedSeconds.toFixed(1)}s elapsed)`,
    );
    return { status: 'pending' };
  }

  /**
   * Update registration request với eKYC data (internal)
   * Hỗ trợ cả FieldOwner và Coach registration
   * @private
   */
  private async updateLocalRegistrationRequest(
    sessionId: string,
    status: 'pending' | 'verified' | 'failed',
    ekycData?: any,
    verifiedAt?: Date,
  ): Promise<void> {
    // Tìm trong FieldOwnerRegistrationRequest trước
    let request = await this.fieldOwnerRegistrationRequestModel.findOne({
      ekycSessionId: sessionId,
    });

    // Nếu không tìm thấy, tìm trong CoachRegistrationRequest
    if (!request) {
      request = await this.coachRegistrationRequestModel.findOne({
        ekycSessionId: sessionId,
      }) as any;
    }

    if (!request) {
      this.logger.warn(
        `No registration found for eKYC session ${sessionId}. Will be updated when registration is created.`,
      );
      return;
    }

    request.ekycStatus = status;
    if (ekycData) {
      request.ekycData = ekycData;
    }
    if (verifiedAt) {
      request.ekycVerifiedAt = verifiedAt;
    }

    await request.save();
    this.logger.log(
      `Updated registration ${request._id} with eKYC status: ${status}`,
    );
  }

  /**
   * Đồng bộ một số thông tin từ eKYC sang User (không thay đổi schema User)
   * Hỗ trợ cả FieldOwner và Coach registration
   */
  private async syncUserFromEkyc(
    sessionId: string,
    ekycData: { fullName: string; idNumber: string; address: string },
  ): Promise<void> {
    // Tìm trong FieldOwnerRegistrationRequest trước
    let request = await this.fieldOwnerRegistrationRequestModel.findOne({
      ekycSessionId: sessionId,
    });

    // Nếu không tìm thấy, tìm trong CoachRegistrationRequest
    if (!request) {
      request = await this.coachRegistrationRequestModel.findOne({
        ekycSessionId: sessionId,
      }) as any;
    }

    if (!request) {
      this.logger.warn(
        `No registration found for eKYC session ${sessionId} when syncing user`,
      );
      return;
    }

    const userId = request.userId;
    if (!userId) {
      return;
    }

    await this.userModel.updateOne(
      { _id: userId },
      {
        fullName: ekycData.fullName,
      },
    );

    this.logger.log(
      `Synced user ${userId.toString()} data from eKYC session ${sessionId}`,
    );
  }

  /**
   * Verify eKYC session belongs to user (security check)
   * Hỗ trợ cả FieldOwner và Coach registration
   * @param sessionId - eKYC session ID
   * @throws NotFoundException nếu session không tồn tại hoặc không thuộc về user
   */
  async verifyEkycSessionOwnership(
    sessionId: string,
    userId: string,
  ): Promise<FieldOwnerRegistrationRequest | CoachRegistrationRequest | null> {
    // Tìm trong FieldOwnerRegistrationRequest trước
    let request = await this.fieldOwnerRegistrationRequestModel.findOne({
      ekycSessionId: sessionId,
    });

    // Nếu không tìm thấy, tìm trong CoachRegistrationRequest
    if (!request) {
      request = await this.coachRegistrationRequestModel.findOne({
        ekycSessionId: sessionId,
      }) as any;
    }

    // Nếu chưa có registration (user mới tạo session), cho phép
    if (!request) {
      return null;
    }

    // Nếu đã có registration, check ownership
    if (request.userId.toString() !== userId) {
      throw new NotFoundException(
        'eKYC session không tồn tại hoặc không thuộc về bạn',
      );
    }

    return request;
  }
}
