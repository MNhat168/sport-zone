import { Injectable, Logger, Inject } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Types } from 'mongoose';
import { NotificationsService } from '../notifications.service';
import { NotificationType } from 'src/common/enums/notification-type.enum';
import { CreateNotificationDto } from '../dtos/create-notification.dto';
import { UserRepositoryInterface, USER_REPOSITORY } from 'src/modules/users/interface/users.interface';

/**
 * Service xử lý notification cho users đã bookmark field/coach
 * Lắng nghe event thay đổi từ field/coach và tạo notification batch
 */
@Injectable()
export class BookmarkNotificationService {
  private readonly logger = new Logger(BookmarkNotificationService.name);

  constructor(
    private readonly notificationsService: NotificationsService,
    @Inject(USER_REPOSITORY)
    private readonly userRepository: UserRepositoryInterface,
  ) {}

  /**
   * Xử lý khi field status thay đổi
   */
  @OnEvent('field.statusChanged')
  async handleFieldStatusChanged(payload: {
    fieldId: string;
    fieldName: string;
    oldStatus: boolean;
    newStatus: boolean;
  }): Promise<void> {
    try {
      this.logger.log(`Field status changed: ${payload.fieldName} (${payload.oldStatus} -> ${payload.newStatus})`);

      // Query users who bookmarked this field
      const usersWithBookmark = await this.userRepository.findByCondition({
        bookmarkFields: new Types.ObjectId(payload.fieldId),
      });

      if (usersWithBookmark.length === 0) {
        this.logger.log(`No users bookmarked field ${payload.fieldId}`);
        return;
      }

      // Prepare batch notifications
      const statusText = payload.newStatus ? 'đang hoạt động' : 'tạm ngưng';
      const notifications: CreateNotificationDto[] = usersWithBookmark.map((user) => ({
        recipient: user._id as any,
        type: NotificationType.BOOKMARKED_FIELD_STATUS_CHANGED,
        title: 'Sân đã bookmark thay đổi trạng thái',
        message: `${payload.fieldName} hiện ${statusText}`,
        metadata: {
          fieldId: payload.fieldId,
          fieldName: payload.fieldName,
          oldStatus: payload.oldStatus,
          newStatus: payload.newStatus,
        },
      }));

      // Create notifications in batch
      await this.notificationsService.createBatch(notifications);
      this.logger.log(`Created ${notifications.length} field status change notifications`);
    } catch (error) {
      this.logger.error('Error handling field status change', error);
    }
  }

  /**
   * Xử lý khi field price thay đổi
   */
  @OnEvent('field.priceChanged')
  async handleFieldPriceChanged(payload: {
    fieldId: string;
    fieldName: string;
    oldPrice: number;
    newPrice: number;
  }): Promise<void> {
    try {
      this.logger.log(`Field price changed: ${payload.fieldName} (${payload.oldPrice} -> ${payload.newPrice})`);

      // Query users who bookmarked this field
      const usersWithBookmark = await this.userRepository.findByCondition({
        bookmarkFields: new Types.ObjectId(payload.fieldId),
      });

      if (usersWithBookmark.length === 0) {
        this.logger.log(`No users bookmarked field ${payload.fieldId}`);
        return;
      }

      // Prepare batch notifications
      const oldPriceText = `${payload.oldPrice.toLocaleString('vi-VN')}đ`;
      const newPriceText = `${payload.newPrice.toLocaleString('vi-VN')}đ`;

      const notifications: CreateNotificationDto[] = usersWithBookmark.map((user) => ({
        recipient: user._id as any,
        type: NotificationType.BOOKMARKED_FIELD_PRICE_CHANGED,
        title: 'Sân đã bookmark thay đổi giá',
        message: `${payload.fieldName} thay đổi giá: ${oldPriceText} → ${newPriceText}`,
        metadata: {
          fieldId: payload.fieldId,
          fieldName: payload.fieldName,
          oldPrice: payload.oldPrice,
          newPrice: payload.newPrice,
        },
      }));

      // Create notifications in batch
      await this.notificationsService.createBatch(notifications);
      this.logger.log(`Created ${notifications.length} field price change notifications`);
    } catch (error) {
      this.logger.error('Error handling field price change', error);
    }
  }

  /**
   * Xử lý khi coach status thay đổi
   */
  @OnEvent('coach.statusChanged')
  async handleCoachStatusChanged(payload: {
    coachId: string;
    coachName: string;
    oldStatus: boolean;
    newStatus: boolean;
  }): Promise<void> {
    try {
      this.logger.log(`Coach status changed: ${payload.coachName} (${payload.oldStatus} -> ${payload.newStatus})`);

      // Query users who bookmarked this coach
      const usersWithBookmark = await this.userRepository.findByCondition({
        bookmarkCoaches: new Types.ObjectId(payload.coachId),
      });

      if (usersWithBookmark.length === 0) {
        this.logger.log(`No users bookmarked coach ${payload.coachId}`);
        return;
      }

      // Prepare batch notifications
      const statusText = payload.newStatus ? 'đang hoạt động' : 'tạm ngưng nhận học viên';
      const notifications: CreateNotificationDto[] = usersWithBookmark.map((user) => ({
        recipient: user._id as any,
        type: NotificationType.BOOKMARKED_COACH_STATUS_CHANGED,
        title: 'Huấn luyện viên đã bookmark thay đổi trạng thái',
        message: `${payload.coachName} hiện ${statusText}`,
        metadata: {
          coachId: payload.coachId,
          coachName: payload.coachName,
          oldStatus: payload.oldStatus,
          newStatus: payload.newStatus,
        },
      }));

      // Create notifications in batch
      await this.notificationsService.createBatch(notifications);
      this.logger.log(`Created ${notifications.length} coach status change notifications`);
    } catch (error) {
      this.logger.error('Error handling coach status change', error);
    }
  }

  /**
   * Xử lý khi coach price thay đổi
   */
  @OnEvent('coach.priceChanged')
  async handleCoachPriceChanged(payload: {
    coachId: string;
    coachName: string;
    oldPrice: number;
    newPrice: number;
  }): Promise<void> {
    try {
      this.logger.log(`Coach price changed: ${payload.coachName} (${payload.oldPrice} -> ${payload.newPrice})`);

      // Query users who bookmarked this coach
      const usersWithBookmark = await this.userRepository.findByCondition({
        bookmarkCoaches: new Types.ObjectId(payload.coachId),
      });

      if (usersWithBookmark.length === 0) {
        this.logger.log(`No users bookmarked coach ${payload.coachId}`);
        return;
      }

      // Prepare batch notifications
      const oldPriceText = `${payload.oldPrice.toLocaleString('vi-VN')}đ/giờ`;
      const newPriceText = `${payload.newPrice.toLocaleString('vi-VN')}đ/giờ`;

      const notifications: CreateNotificationDto[] = usersWithBookmark.map((user) => ({
        recipient: user._id as any,
        type: NotificationType.BOOKMARKED_COACH_PRICE_CHANGED,
        title: 'Huấn luyện viên đã bookmark thay đổi giá',
        message: `${payload.coachName} thay đổi giá: ${oldPriceText} → ${newPriceText}`,
        metadata: {
          coachId: payload.coachId,
          coachName: payload.coachName,
          oldPrice: payload.oldPrice,
          newPrice: payload.newPrice,
        },
      }));

      // Create notifications in batch
      await this.notificationsService.createBatch(notifications);
      this.logger.log(`Created ${notifications.length} coach price change notifications`);
    } catch (error) {
      this.logger.error('Error handling coach price change', error);
    }
  }
}
