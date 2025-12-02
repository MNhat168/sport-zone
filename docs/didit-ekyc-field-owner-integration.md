## didit eKYC integration – Verify user → Field Owner

Tài liệu này mô tả cách tích hợp didit eKYC để xác thực danh tính user trước khi trở thành **Field Owner**, dựa trên các thay đổi cleanup đã làm sẵn.

**Approach:** Sử dụng **FE Polling** thay vì Webhook để đơn giản hóa implementation và dễ dàng development.

---

### 1. Kiến trúc tổng quan

- **FE (sport-zone-fe)**  
  - Trang `field-owner-registration-page` step 1 (`PersonalInfoStep`): trigger didit eKYC, nhận `ekycSessionId`.
  - Sau khi user hoàn thành eKYC trên didit, FE **polling** endpoint `/field-owner/ekyc/status/:sessionId` để lấy kết quả.
  - Auto-fill form với `ekycData` (fullName, idNumber, address) khi status = `verified`.
  - Step 2 (`DocumentsStep`): chỉ upload **business license** cho ownerType `business`/`household`.  
  - Gửi request lên backend bằng `CreateFieldOwnerRegistrationPayload` mới (ekycSessionId + ekycData + optional businessLicense).

- **BE (sport-zone)**  
  - Cung cấp 2 endpoints đơn giản:
    - `POST /field-owner/ekyc/session` - tạo eKYC session với didit
    - `GET /field-owner/ekyc/status/:sessionId` - FE polling để lấy kết quả
  - Lưu thông tin eKYC vào `FieldOwnerRegistrationRequest` (ekycSessionId, ekycStatus, ekycVerifiedAt, ekycData).  
  - Đảm bảo chỉ những request có eKYC `verified` mới được approve (tùy rule).  
  - Business license vẫn upload qua S3 như hiện tại.

- **Admin (sport-zone-admin)**  
  - Hiển thị eKYC status + dữ liệu extract trong màn Request Detail.  
  - Cho admin thấy rõ request nào dùng eKYC, request nào legacy dùng ảnh CCCD cũ.

---

### 2. Backend – didit eKYC flow

#### 2.1. Model & DTO đã sẵn sàng

- `FieldOwnerRegistrationRequest` có thêm:

```typescript
export class FieldOwnerRegistrationRequest extends BaseEntity {
  // ...
  documents?: {
    idFront?: string; // deprecated
    idBack?: string;  // deprecated
    businessLicense?: string;
  };

  @Prop({ type: String })
  ekycSessionId?: string;

  @Prop({ type: String, enum: ['pending', 'verified', 'failed'] })
  ekycStatus?: 'pending' | 'verified' | 'failed';

  @Prop({ type: Date })
  ekycVerifiedAt?: Date;

  @Prop({
    type: {
      fullName: { type: String },
      idNumber: { type: String },
      address: { type: String },
    },
    required: false,
    _id: false,
  })
  ekycData?: {
    fullName: string;
    idNumber: string;
    address: string;
  };
}
```

- DTO đã hỗ trợ eKYC:

```typescript
class DocumentsDto {
  // idFront/idBack: deprecated – optional
}

export class CreateFieldOwnerRegistrationDto {
  // ...
  @ApiPropertyOptional()
  @IsOptional()
  @ValidateNested()
  @Type(() => DocumentsDto)
  documents?: DocumentsDto; // deprecated for CCCD

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ekycSessionId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateNested()
  @Type(() => PersonalInfoDto)
  ekycData?: PersonalInfoDto;
}
```

`FieldOwnerRegistrationResponseDto` cũng đã expose các field eKYC (qua `mapToRegistrationDto`).

#### 2.2. Tích hợp didit eKYC service

##### 2.2.1. Tạo DiditEkycService

```typescript
// src/modules/ekyc/didit-ekyc.service.ts
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import axios from 'axios';

@Injectable()
export class DiditEkycService {
  private readonly logger = new Logger(DiditEkycService.name);
  private readonly diditApiKey: string;
  private readonly diditApiSecret: string;
  private readonly diditBaseUrl: string;

  constructor(
    private configService: ConfigService,
    @InjectModel('FieldOwnerRegistrationRequest')
    private registrationRequestModel: Model<any>,
  ) {
    this.diditApiKey = this.configService.get<string>('DIDIT_API_KEY');
    this.diditApiSecret = this.configService.get<string>('DIDIT_API_SECRET');
    this.diditBaseUrl = this.configService.get<string>('DIDIT_BASE_URL');
  }

  /**
   * Tạo eKYC session với didit
   * @param userId - ID của user đang đăng ký
   * @param redirectUrlAfterEkyc - URL để redirect sau khi hoàn thành eKYC (optional)
   */
  async createEkycSession(
    userId: string,
    redirectUrlAfterEkyc?: string,
  ): Promise<{ sessionId: string; redirectUrl: string }> {
    try {
      // Call didit API để tạo session
      const response = await axios.post(
        `${this.diditBaseUrl}/v1/ekyc/sessions`,
        {
          userId,
          redirectUrl: redirectUrlAfterEkyc,
          // Các params khác theo didit docs
        },
        {
          headers: {
            'Authorization': `Bearer ${this.diditApiKey}`,
            'Content-Type': 'application/json',
          },
        },
      );

      const { sessionId, redirectUrl } = response.data;

      this.logger.log(`Created eKYC session ${sessionId} for user ${userId}`);

      return { sessionId, redirectUrl };
    } catch (error) {
      this.logger.error('Failed to create eKYC session:', error);
      throw error;
    }
  }

  /**
   * Lấy status của eKYC session từ didit
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
      // Call didit API để lấy session status
      const response = await axios.get(
        `${this.diditBaseUrl}/v1/ekyc/sessions/${sessionId}`,
        {
          headers: {
            'Authorization': `Bearer ${this.diditApiKey}`,
          },
        },
      );

      const diditData = response.data;

      // Map didit response sang format của mình
      let status: 'pending' | 'verified' | 'failed' = 'pending';
      let ekycData = null;
      let verifiedAt = null;

      if (diditData.status === 'completed' || diditData.status === 'verified') {
        status = 'verified';
        verifiedAt = new Date(diditData.completedAt || diditData.verifiedAt);
        ekycData = {
          fullName: diditData.data.fullName || diditData.data.full_name,
          idNumber: diditData.data.idNumber || diditData.data.id_number,
          address: diditData.data.address,
        };
      } else if (diditData.status === 'failed' || diditData.status === 'rejected') {
        status = 'failed';
      }

      // Update local DB
      await this.updateLocalRegistrationRequest(sessionId, status, ekycData, verifiedAt);

      return { status, data: ekycData, verifiedAt };
    } catch (error) {
      this.logger.error(`Failed to get eKYC session status for ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Update registration request với eKYC data (internal)
   */
  private async updateLocalRegistrationRequest(
    sessionId: string,
    status: 'pending' | 'verified' | 'failed',
    ekycData?: any,
    verifiedAt?: Date,
  ) {
    const request = await this.registrationRequestModel.findOne({
      ekycSessionId: sessionId,
    });

    if (!request) {
      this.logger.warn(`No registration found for eKYC session ${sessionId}`);
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
    this.logger.log(`Updated registration ${request._id} with eKYC status: ${status}`);
  }
}
```

##### 2.2.2. Environment config

```env
# .env / .env.development / .env.production
DIDIT_API_KEY=your_api_key_here
DIDIT_API_SECRET=your_api_secret_here
DIDIT_BASE_URL=https://api.didit.com  # hoặc sandbox URL
```

```typescript
// src/config/env.config.ts
export default () => ({
  // ...existing config
  didit: {
    apiKey: process.env.DIDIT_API_KEY,
    apiSecret: process.env.DIDIT_API_SECRET,
    baseUrl: process.env.DIDIT_BASE_URL || 'https://api.didit.com',
  },
});
```

##### 2.2.3. Controller endpoints

```typescript
// src/modules/field-owner/field-owner.controller.ts
import { Controller, Post, Get, Body, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { DiditEkycService } from '../ekyc/didit-ekyc.service';

@Controller('field-owner')
export class FieldOwnerController {
  constructor(
    private readonly diditEkycService: DiditEkycService,
    // ...other services
  ) {}

  /**
   * Tạo eKYC session với didit
   * FE gọi endpoint này trước khi mở didit widget
   */
  @Post('ekyc/session')
  @UseGuards(JwtAuthGuard)
  async createEkycSession(
    @CurrentUser() user: any,
    @Body() body: { redirectUrlAfterEkyc?: string },
  ) {
    const { sessionId, redirectUrl } = await this.diditEkycService.createEkycSession(
      user._id.toString(),
      body.redirectUrlAfterEkyc,
    );

    return {
      sessionId,
      redirectUrl,
    };
  }

  /**
   * Lấy eKYC status (cho FE polling)
   * FE sẽ gọi endpoint này mỗi 3-5s để check xem user đã hoàn thành eKYC chưa
   */
  @Get('ekyc/status/:sessionId')
  @UseGuards(JwtAuthGuard)
  async getEkycStatus(
    @Param('sessionId') sessionId: string,
    @CurrentUser() user: any,
  ) {
    // Get status from didit API
    const result = await this.diditEkycService.getEkycSessionStatus(sessionId);

    // Security check: verify session belongs to current user
    const request = await this.registrationRequestModel.findOne({
      ekycSessionId: sessionId,
      userId: user._id,
    });

    if (!request) {
      throw new NotFoundException('eKYC session not found or does not belong to you');
    }

    return result;
  }

  // ...existing endpoints
}
```

##### 2.2.4. Rule khi approve registration

```typescript
// src/modules/field-owner/field-owner.service.ts
async approveRegistrationRequest(
  requestId: string,
  adminId: string,
): Promise<FieldOwnerRegistrationRequest> {
  const request = await this.registrationRequestModel.findById(requestId);

  if (!request) {
    throw new NotFoundException('Registration request not found');
  }

  // ✅ Kiểm tra eKYC nếu có ekycSessionId
  if (request.ekycSessionId) {
    if (request.ekycStatus !== 'verified') {
      throw new BadRequestException(
        'Cannot approve: eKYC not verified. Current status: ' + request.ekycStatus,
      );
    }

    if (!request.ekycData) {
      throw new BadRequestException('Cannot approve: eKYC data missing');
    }
  }
  // Legacy: nếu không có ekycSessionId, check CCCD documents (backward compatibility)
  else {
    if (!request.documents?.idFront || !request.documents?.idBack) {
      throw new BadRequestException('Cannot approve: ID documents missing');
    }
  }

  // Approve logic...
  request.status = 'approved';
  request.reviewedBy = new Types.ObjectId(adminId);
  request.reviewedAt = new Date();

  await request.save();

  // Create FieldOwner record...
  // ...

  return request;
}
```

---

### 3. Frontend – sport-zone-fe

#### 3.1. API client

```typescript
// src/api/field-owner/registrationAPI.ts
import { apiClient } from '../apiClient';

export const registrationAPI = {
  // ...existing APIs

  // Tạo eKYC session
  createEkycSession: async (redirectUrlAfterEkyc?: string) => {
    const response = await apiClient.post('/field-owner/ekyc/session', {
      redirectUrlAfterEkyc,
    });
    return response.data; // { sessionId, redirectUrl }
  },

  // Lấy eKYC status (cho polling)
  getEkycStatus: async (sessionId: string) => {
    const response = await apiClient.get(`/field-owner/ekyc/status/${sessionId}`);
    return response.data; // { status, data, verifiedAt }
  },
};
```

#### 3.2. Polling Hook

```typescript
// src/hooks/useEkycPolling.ts
import { useState, useEffect, useCallback } from 'react';
import { registrationAPI } from '@/api/field-owner/registrationAPI';

export interface EkycData {
  fullName: string;
  idNumber: string;
  address: string;
}

export interface UseEkycPollingReturn {
  status: 'idle' | 'polling' | 'verified' | 'failed' | 'timeout';
  data: EkycData | null;
  error: string | null;
  startPolling: (sessionId: string) => void;
  stopPolling: () => void;
}

export const useEkycPolling = (): UseEkycPollingReturn => {
  const [status, setStatus] = useState<'idle' | 'polling' | 'verified' | 'failed' | 'timeout'>('idle');
  const [data, setData] = useState<EkycData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [intervalId, setIntervalId] = useState<NodeJS.Timeout | null>(null);
  const [attempts, setAttempts] = useState(0);

  const MAX_ATTEMPTS = 40; // 40 * 3s = 2 phút
  const POLL_INTERVAL = 3000; // 3 giây

  const stopPolling = useCallback(() => {
    if (intervalId) {
      clearInterval(intervalId);
      setIntervalId(null);
    }
    setAttempts(0);
  }, [intervalId]);

  const startPolling = useCallback((sessionId: string) => {
    setStatus('polling');
    setError(null);
    setAttempts(0);

    const poll = async () => {
      try {
        const response = await registrationAPI.getEkycStatus(sessionId);

        if (response.status === 'verified') {
          setStatus('verified');
          setData(response.data);
          stopPolling();
        } else if (response.status === 'failed') {
          setStatus('failed');
          setError('Xác thực danh tính thất bại');
          stopPolling();
        }
        // else status === 'pending', continue polling

        setAttempts((prev) => prev + 1);
      } catch (err: any) {
        console.error('Poll error:', err);
        setError(err.message || 'Lỗi khi kiểm tra trạng thái xác thực');
      }
    };

    // Poll ngay lần đầu
    poll();

    // Setup interval
    const id = setInterval(poll, POLL_INTERVAL);
    setIntervalId(id);
  }, [stopPolling]);

  // Auto stop khi timeout
  useEffect(() => {
    if (attempts >= MAX_ATTEMPTS && status === 'polling') {
      setStatus('timeout');
      setError('Hết thời gian chờ. Vui lòng thử lại.');
      stopPolling();
    }
  }, [attempts, status, stopPolling]);

  // Cleanup on unmount
  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  return {
    status,
    data,
    error,
    startPolling,
    stopPolling,
  };
};
```

#### 3.3. Tích hợp vào PersonalInfoStep

```typescript
// src/pages/field-owner-registration-page/PersonalInfoStep.tsx
import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, Shield, CheckCircle2, XCircle } from 'lucide-react';
import { useEkycPolling } from '@/hooks/useEkycPolling';
import { registrationAPI } from '@/api/field-owner/registrationAPI';
import { CustomSuccessToast, CustomFailedToast } from '@/components/ui/toast';

interface PersonalInfoStepProps {
  formData: RegistrationFormData;
  onFormDataChange: (data: Partial<RegistrationFormData>) => void;
  onNext: () => void;
}

export const PersonalInfoStep: React.FC<PersonalInfoStepProps> = ({
  formData,
  onFormDataChange,
  onNext,
}) => {
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const { status, data, error, startPolling } = useEkycPolling();

  // Auto-fill form khi eKYC verified
  useEffect(() => {
    if (status === 'verified' && data) {
      onFormDataChange({
        ekycSessionId: formData.ekycSessionId!,
        ekycData: data,
        personalInfo: {
          fullName: data.fullName,
          idNumber: data.idNumber,
          address: data.address,
        },
      });
      CustomSuccessToast('Xác thực danh tính thành công!');
    } else if (status === 'failed' || status === 'timeout') {
      CustomFailedToast(error || 'Xác thực thất bại, vui lòng thử lại');
    }
  }, [status, data, error]);

  const handleStartEkyc = async () => {
    try {
      setIsCreatingSession(true);

      // 1. Tạo eKYC session
      const currentUrl = window.location.origin + window.location.pathname;
      const { sessionId, redirectUrl } = await registrationAPI.createEkycSession(currentUrl);

      // 2. Lưu sessionId
      onFormDataChange({ ekycSessionId: sessionId });

      // 3. Mở didit eKYC
      // Option A: Redirect (user rời khỏi trang)
      // window.location.href = redirectUrl;

      // Option B: Popup (recommend)
      const popup = window.open(
        redirectUrl,
        'didit-ekyc',
        'width=600,height=800,scrollbars=yes',
      );

      if (!popup) {
        CustomFailedToast('Vui lòng cho phép popup để tiếp tục xác thực');
        return;
      }

      // 4. Bắt đầu polling ngay
      startPolling(sessionId);

      // 5. Monitor popup close (optional)
      const checkPopupClosed = setInterval(() => {
        if (popup.closed) {
          clearInterval(checkPopupClosed);
          // Popup đóng nhưng chưa verified -> user có thể đã cancel
          if (status === 'polling') {
            CustomFailedToast('Cửa sổ xác thực đã đóng. Vui lòng hoàn thành xác thực.');
          }
        }
      }, 1000);
    } catch (err: any) {
      console.error('Create eKYC session error:', err);
      CustomFailedToast('Không thể khởi tạo xác thực. Vui lòng thử lại.');
    } finally {
      setIsCreatingSession(false);
    }
  };

  const isEkycVerified = status === 'verified';
  const isEkycPending = status === 'polling';

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
        <div className="flex items-start gap-3">
          <Shield className="h-5 w-5 text-blue-600 mt-0.5" />
          <div className="flex-1">
            <h3 className="font-semibold text-blue-900">Xác thực danh tính bằng didit eKYC</h3>
            <p className="text-sm text-blue-700 mt-1">
              Để trở thành Field Owner, bạn cần xác thực danh tính qua hệ thống eKYC của didit.
              Quá trình chỉ mất 2-3 phút.
            </p>

            <div className="mt-4">
              {!isEkycVerified && !isEkycPending && (
                <Button
                  type="button"
                  onClick={handleStartEkyc}
                  disabled={isCreatingSession}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  {isCreatingSession ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Đang khởi tạo...
                    </>
                  ) : (
                    <>
                      <Shield className="mr-2 h-4 w-4" />
                      Xác thực ngay
                    </>
                  )}
                </Button>
              )}

              {isEkycPending && (
                <div className="flex items-center gap-2 text-blue-600">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm font-medium">
                    Đang chờ xác thực... Vui lòng hoàn thành trên cửa sổ didit
                  </span>
                </div>
              )}

              {isEkycVerified && (
                <div className="flex items-center gap-2 text-green-600">
                  <CheckCircle2 className="h-5 w-5" />
                  <span className="text-sm font-medium">
                    Xác thực thành công! Thông tin đã được tự động điền.
                  </span>
                </div>
              )}

              {(status === 'failed' || status === 'timeout') && (
                <div className="flex items-center gap-2 text-red-600">
                  <XCircle className="h-5 w-5" />
                  <span className="text-sm font-medium">{error}</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleStartEkyc}
                    className="ml-2"
                  >
                    Thử lại
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Form fields - auto-filled nếu có ekycData */}
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-2">
            Họ và tên <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={formData.personalInfo?.fullName || ''}
            onChange={(e) =>
              onFormDataChange({
                personalInfo: {
                  ...formData.personalInfo!,
                  fullName: e.target.value,
                },
              })
            }
            className="w-full px-3 py-2 border rounded-md"
            disabled={isEkycVerified}
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">
            Số CCCD/CMND <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={formData.personalInfo?.idNumber || ''}
            onChange={(e) =>
              onFormDataChange({
                personalInfo: {
                  ...formData.personalInfo!,
                  idNumber: e.target.value,
                },
              })
            }
            className="w-full px-3 py-2 border rounded-md"
            disabled={isEkycVerified}
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">
            Địa chỉ <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={formData.personalInfo?.address || ''}
            onChange={(e) =>
              onFormDataChange({
                personalInfo: {
                  ...formData.personalInfo!,
                  address: e.target.value,
                },
              })
            }
            className="w-full px-3 py-2 border rounded-md"
            disabled={isEkycVerified}
          />
        </div>

        {/* Other fields... */}
      </div>

      {/* Next button */}
      <div className="flex justify-end">
        <Button
          onClick={onNext}
          disabled={!isEkycVerified}
        >
          Tiếp theo
        </Button>
      </div>
    </div>
  );
};
```

#### 3.4. Validation khi submit registration

```typescript
// src/pages/field-owner-registration-page/field-owner-registration-page.tsx
const handleSubmit = async () => {
  // Validate eKYC
  if (!formData.ekycSessionId || !formData.ekycData) {
    CustomFailedToast("Vui lòng hoàn thành xác thực danh tính bằng didit eKYC ở bước 1");
    return;
  }

  // Upload business license (nếu có)
  let businessLicenseUrl: string | undefined;
  if (formData.documents?.businessLicense) {
    businessLicenseUrl = await uploadToS3(formData.documents.businessLicense);
  }

  // Submit
  const payload: CreateRegistrationRequestPayload = {
    ownerType: formData.ownerType || "individual",
    personalInfo: formData.personalInfo!,
    documents: businessLicenseUrl ? { businessLicense: businessLicenseUrl } : undefined,
    ekycSessionId: formData.ekycSessionId,
    ekycData: formData.ekycData,
  };

  await dispatch(createRegistrationRequest(payload));
};
```

---

### 4. Admin – sport-zone-admin

Schema & UI đã hỗ trợ eKYC:

```typescript
// src/features/field-owners/data/schema.ts
export const fieldOwnerRequestSchema = z.object({
  // ...
  documents: documentsSchema.optional(), // deprecated for CCCD
  ekycSessionId: z.string().optional(),
  ekycStatus: z.enum(['pending', 'verified', 'failed']).optional(),
  ekycVerifiedAt: z.coerce.date().optional(),
  ekycData: personalInfoSchema.optional(),
  status: registrationStatusSchema,
  // ...
});
```

`RequestDetailDialog` hiển thị eKYC:

```typescript
// src/features/field-owners/components/request-detail-dialog.tsx
{request.ekycSessionId ? (
  <div className="space-y-2">
    <div className="flex items-center gap-2">
      <Shield className="h-4 w-4 text-blue-600" />
      <span className="font-medium">Identity Verified via didit eKYC</span>
      <Badge variant={request.ekycStatus === 'verified' ? 'success' : 'warning'}>
        {request.ekycStatus}
      </Badge>
    </div>
    {request.ekycData && (
      <div className="pl-6 text-sm space-y-1">
        <p>• Full Name: {request.ekycData.fullName}</p>
        <p>• ID Number: {request.ekycData.idNumber}</p>
        <p>• Address: {request.ekycData.address}</p>
        {request.ekycVerifiedAt && (
          <p className="text-muted-foreground">
            Verified at: {new Date(request.ekycVerifiedAt).toLocaleString()}
          </p>
        )}
      </div>
    )}
  </div>
) : (
  // Legacy: CCCD documents
  <div>
    <Button onClick={() => handleViewDocuments('id')}>
      View ID Documents (Legacy)
    </Button>
  </div>
)}

{request.documents?.businessLicense && (
  <Button onClick={() => handleViewDocuments('business')}>
    View Business License
  </Button>
)}
```

Không cần thay đổi lớn thêm ở admin.

---

### 5. So sánh Polling vs Webhook

#### 5.1. Tại sao chọn Polling?

| Tiêu chí | FE Polling | Webhook |
|----------|------------|---------|
| **Code complexity** | ✅ Rất đơn giản (~50 lines) | ❌ Phức tạp (webhook handler, signature, retry, ~200+ lines) |
| **Dev experience** | ✅ Không cần ngrok/tunnel | ❌ Cần ngrok mỗi lần dev local |
| **Latency** | ⚠️ 0-3s delay (acceptable) | ✅ ~0s (instant) |
| **Reliability** | ✅ Ít edge cases | ⚠️ Webhook có thể miss, duplicate, out-of-order |
| **Debugging** | ✅ Dễ debug (logs ở FE) | ❌ Khó debug (cần monitor webhook, replay) |
| **Maintenance** | ✅ Ít bugs | ⚠️ Nhiều edge cases (timeout, retry, idempotency) |
| **Network overhead** | ⚠️ ~4 requests * 1KB = 4KB | ✅ 1 webhook call = 1KB |

**Kết luận:** Với use case **field owner registration** (không phải realtime critical, volume thấp), **Polling đơn giản hơn và đủ tốt**.

#### 5.2. Khi nào nên migrate sang Webhook?

Chỉ khi:
- Scale lớn (1000+ registrations/giờ) → tốn nhiều polling requests
- Cần realtime (< 1s latency)
- Team đã có webhook infrastructure sẵn

Lúc đó có thể **thêm webhook** mà **không phá code hiện tại**:

```typescript
// Backend có thêm webhook endpoint (optional)
@Post('ekyc/webhook')
async handleWebhook(@Body() payload: any) {
  await this.diditService.processWebhook(payload);
  // FE polling sẽ lấy được ngay, không cần đợi
}
```

---

### 6. Checklist triển khai

#### Backend
- [ ] Tạo `DiditEkycService` với 2 methods:
  - [ ] `createEkycSession(userId)`
  - [ ] `getEkycSessionStatus(sessionId)` - call didit API + update DB
- [ ] Thêm 2 endpoints:
  - [ ] `POST /field-owner/ekyc/session`
  - [ ] `GET /field-owner/ekyc/status/:sessionId`
- [ ] Update `approveRegistrationRequest` để check `ekycStatus === 'verified'`
- [ ] Config environment variables (DIDIT_API_KEY, DIDIT_BASE_URL, etc.)

#### Frontend
- [ ] Tạo `useEkycPolling` hook
- [ ] Update `registrationAPI` với 2 methods:
  - [ ] `createEkycSession()`
  - [ ] `getEkycStatus(sessionId)`
- [ ] Update `PersonalInfoStep`:
  - [ ] Button "Xác thực ngay" → call create session + open popup
  - [ ] Integrate polling hook
  - [ ] Auto-fill form khi verified
  - [ ] Disable Next button nếu chưa verified
- [ ] Update submit validation để require eKYC

#### Admin
- [x] Schema đã hỗ trợ eKYC fields
- [x] UI đã hiển thị eKYC status + data

#### Testing
- [ ] Test flow hoàn chỉnh: create session → complete eKYC → polling → auto-fill → submit
- [ ] Test timeout case (user không complete eKYC trong 2 phút)
- [ ] Test failed case (didit reject eKYC)
- [ ] Test security: user A không thể poll eKYC session của user B
- [ ] Test admin approval: chỉ approve khi ekycStatus = 'verified'

#### Ops
- [ ] Deploy backend với env variables
- [ ] Test với didit sandbox environment trước
- [ ] Document API keys và backup procedure
- [ ] Setup monitoring/logging cho eKYC flow

---

### 7. Testing & Debugging

#### 7.1. Test với mock data (không cần didit account)

```typescript
// DiditEkycService - thêm mock mode
async createEkycSession(userId: string) {
  if (process.env.DIDIT_MOCK_MODE === 'true') {
    const sessionId = `mock_${Date.now()}`;
    return {
      sessionId,
      redirectUrl: `http://localhost:3000/mock-ekyc?session=${sessionId}`,
    };
  }
  // Real implementation...
}

async getEkycSessionStatus(sessionId: string) {
  if (process.env.DIDIT_MOCK_MODE === 'true') {
    // Simulate verified after 5s
    const isOld = sessionId.includes('mock_') && 
                  Date.now() - parseInt(sessionId.split('_')[1]) > 5000;
    
    if (isOld) {
      return {
        status: 'verified' as const,
        data: {
          fullName: 'Nguyễn Văn A (Mock)',
          idNumber: '001234567890',
          address: '123 Mock Street, Mock City',
        },
        verifiedAt: new Date(),
      };
    }
    return { status: 'pending' as const };
  }
  // Real implementation...
}
```

#### 7.2. Debug checklist

- [ ] Check backend logs: `DiditEkycService` tạo session thành công?
- [ ] Check FE: polling hook có được trigger?
- [ ] Check network tab: polling requests có đang gửi đều đặn?
- [ ] Check DB: `ekycSessionId`, `ekycStatus`, `ekycData` có được update?
- [ ] Check didit dashboard: session có được tạo trên didit?

---

### 8. Migration từ CCCD cũ sang eKYC

#### Backward compatibility

Code đã support cả 2 flows:

```typescript
// Approve logic
if (request.ekycSessionId) {
  // ✅ New flow: check eKYC
  if (request.ekycStatus !== 'verified') {
    throw new BadRequestException('eKYC not verified');
  }
} else {
  // ✅ Legacy flow: check CCCD images
  if (!request.documents?.idFront) {
    throw new BadRequestException('ID documents missing');
  }
}
```

#### Migration plan

**Phase 1:** Soft launch (optional)
- Deploy code nhưng giữ CCCD upload option song song với eKYC
- User có thể chọn 1 trong 2 cách

**Phase 2:** eKYC only (recommend)
- Bắt buộc dùng eKYC cho mọi registration mới
- Legacy requests với CCCD vẫn có thể approve được

**Phase 3:** Cleanup (future)
- Remove deprecated `idFront`, `idBack` fields
- Archive old CCCD images

---

## Kết luận

Với approach **FE Polling**, bạn có:

✅ **Ít code nhất:** ~150 lines tổng cộng (BE service + FE hook)  
✅ **Dev dễ nhất:** Không cần ngrok hay webhook setup  
✅ **Performance đủ tốt:** 3s delay acceptable cho registration flow  
✅ **Maintain đơn giản:** Ít bugs, ít edge cases  

Bắt đầu implement từ `DiditEkycService` → 2 endpoints → `useEkycPolling` hook → integrate vào `PersonalInfoStep`! 🚀