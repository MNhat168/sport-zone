import {
  Injectable,
  Logger,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { FieldOwnerRegistrationRequest } from '../field-owner/entities/field-owner-registration-request.entity';
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
  private readonly isMockMode: boolean;

  constructor(
    private readonly configService: ConfigService,
    @InjectModel(FieldOwnerRegistrationRequest.name)
    private readonly registrationRequestModel: Model<FieldOwnerRegistrationRequest>,
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
    this.isMockMode =
      this.configService.get<string>('app.didit.mockMode') === 'true';

    if (this.isMockMode) {
      this.logger.warn('⚠️  didit eKYC running in MOCK MODE');
    } else if (!this.diditApiKey) {
      this.logger.warn('⚠️  DIDIT_API_KEY is not set. Consider enabling MOCK MODE for local development.');
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
    try {
      // Mock mode for development/testing
      if (this.isMockMode) {
        const sessionId = `mock_${Date.now()}_${userId}`;
        const redirectUrl = `${this.configService.get('app.frontendUrl')}/mock-ekyc?session=${sessionId}`;

        this.logger.log(
          `[MOCK] Created eKYC session ${sessionId} for user ${userId}`,
        );

        return { sessionId, redirectUrl };
      }

      // Call didit API để tạo session
      const response = await firstValueFrom(
        this.httpService.post(
          `${this.diditBaseUrl}/v1/ekyc/sessions`,
          {
            userId,
            // Các params khác theo didit docs
            // locale: 'vi',
            // documentTypes: ['NATIONAL_ID'],
          },
          {
            headers: {
              Authorization: `Bearer ${this.diditApiKey}`,
              'Content-Type': 'application/json',
            },
          },
        ),
      );

      const { sessionId, redirectUrl } = response.data;

      this.logger.log(`Created eKYC session ${sessionId} for user ${userId}`);

      return { sessionId, redirectUrl };
    } catch (error: any) {
      const errorMessage = error?.response?.data?.message || error?.message || 'Unknown error';
      const errorStatus = error?.response?.status || error?.code;
      
      this.logger.error('Failed to create eKYC session:', {
        message: errorMessage,
        status: errorStatus,
        url: `${this.diditBaseUrl}/v1/ekyc/sessions`,
        hasApiKey: !!this.diditApiKey,
        isMockMode: this.isMockMode,
      });
      
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

      // Call didit API để lấy session status
      const response = await firstValueFrom(
        this.httpService.get(
          `${this.diditBaseUrl}/v1/ekyc/sessions/${sessionId}`,
          {
            headers: {
              Authorization: `Bearer ${this.diditApiKey}`,
            },
          },
        ),
      );

      const diditData = response.data;

      // Map didit response sang format của mình
      let status: 'pending' | 'verified' | 'failed' = 'pending';
      let ekycData: {
        fullName: string;
        idNumber: string;
        address: string;
      } | undefined = undefined;
      let verifiedAt: Date | undefined = undefined;

      if (
        diditData.status === 'completed' ||
        diditData.status === 'verified'
      ) {
        status = 'verified';
        verifiedAt = new Date(
          diditData.completedAt || diditData.verifiedAt || Date.now(),
        );
        ekycData = {
          fullName: diditData.data?.fullName || diditData.data?.full_name,
          idNumber: diditData.data?.idNumber || diditData.data?.id_number,
          address: diditData.data?.address,
        };
      } else if (
        diditData.status === 'failed' ||
        diditData.status === 'rejected'
      ) {
        status = 'failed';
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
   * @private
   */
  private async updateLocalRegistrationRequest(
    sessionId: string,
    status: 'pending' | 'verified' | 'failed',
    ekycData?: any,
    verifiedAt?: Date,
  ): Promise<void> {
    const request = await this.registrationRequestModel.findOne({
      ekycSessionId: sessionId,
    });

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
   */
  private async syncUserFromEkyc(
    sessionId: string,
    ekycData: { fullName: string; idNumber: string; address: string },
  ): Promise<void> {
    const request = await this.registrationRequestModel.findOne({
      ekycSessionId: sessionId,
    });

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
   * @param sessionId - eKYC session ID
   * @param userId - User ID để kiểm tra ownership
   * @throws NotFoundException nếu session không tồn tại hoặc không thuộc về user
   */
  async verifyEkycSessionOwnership(
    sessionId: string,
    userId: string,
  ): Promise<FieldOwnerRegistrationRequest | null> {
    const request = await this.registrationRequestModel.findOne({
      ekycSessionId: sessionId,
    });

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
