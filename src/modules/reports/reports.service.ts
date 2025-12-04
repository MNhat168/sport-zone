import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AwsS3Service } from 'src/service/aws-s3.service';
import { Report, ReportDocument } from './entities/report.entity';
import { ReportMessage, ReportMessageDocument } from './entities/report-message.entity';
import { CreateReportDto } from './dtos/create-report.dto';
import { CreateReportMessageDto } from './dtos/create-report-message.dto';
import { ReportCategory } from 'src/common/enums/report-category.enum';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from 'src/common/enums/notification-type.enum';

@Injectable()
export class ReportsService {
  private readonly MAX_OPEN_REPORTS_PER_USER = 3;
  private readonly MAX_REPORTS_PER_USER_PER_24H = 3;
  private readonly MAX_OPEN_REPORTS_PER_USER_PER_FIELD = 1;

  constructor(
    @InjectModel(Report.name) private readonly reportModel: Model<ReportDocument>,
    @InjectModel(ReportMessage.name) private readonly messageModel: Model<ReportMessageDocument>,
    private readonly s3: AwsS3Service,
    private readonly notificationsService: NotificationsService,
  ) {}

  private ensureDescriptionRule(dto: CreateReportDto) {
    if (dto.category === ReportCategory.OTHER && !dto.description?.trim()) {
      throw new BadRequestException('Description is required for category "other"');
    }
  }

  private async ensureCreateQuota(userId: string, dto: CreateReportDto) {
    const reporterId = new Types.ObjectId(userId);

    // 1. Giới hạn số report đang mở (open, in_review)
    const openFilter: any = {
      reporter: reporterId,
      status: { $in: ['open', 'in_review'] },
    };

    const [openCount, recent24hCount, openSameFieldCount] = await Promise.all([
      this.reportModel.countDocuments(openFilter),
      // 2. Giới hạn số report trong 24h gần nhất
      this.reportModel.countDocuments({
        reporter: reporterId,
        createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      }),
      // 3. Giới hạn theo field (nếu có)
      dto.fieldId
        ? this.reportModel.countDocuments({
            reporter: reporterId,
            field: new Types.ObjectId(dto.fieldId),
            status: { $in: ['open', 'in_review'] },
          })
        : Promise.resolve(0),
    ]);

    if (openCount >= this.MAX_OPEN_REPORTS_PER_USER) {
      throw new BadRequestException(
        'Bạn đang có quá nhiều báo cáo chưa xử lý. Vui lòng chờ admin phản hồi hoặc cập nhật thêm thông tin trong các báo cáo hiện có trước khi tạo báo cáo mới.',
      );
    }

    if (recent24hCount >= this.MAX_REPORTS_PER_USER_PER_24H) {
      throw new BadRequestException(
        'Bạn đã gửi quá nhiều báo cáo trong 24 giờ qua. Vui lòng thử lại sau.',
      );
    }

    if (dto.fieldId && openSameFieldCount >= this.MAX_OPEN_REPORTS_PER_USER_PER_FIELD) {
      throw new BadRequestException(
        'Bạn đã có báo cáo đang mở cho sân này. Vui lòng theo dõi báo cáo hiện tại thay vì tạo báo cáo mới.',
      );
    }
  }

  async createReport(userId: string, dto: CreateReportDto, files?: Express.Multer.File[]) {
    this.ensureDescriptionRule(dto);

    await this.ensureCreateQuota(userId, dto);

    const attachments: string[] = [];
    if (files?.length) {
      if (files.length > 3) throw new BadRequestException('Max 3 attachments');
      for (const f of files) {
        const url = await this.s3.uploadDocument({
          buffer: f.buffer,
          mimetype: f.mimetype,
          originalname: f.originalname,
          size: f.size,
          encoding: f.encoding,
          fieldname: f.fieldname,
        });
        attachments.push(url);
      }
    }

    const report = await this.reportModel.create({
      reporter: new Types.ObjectId(userId),
      field: dto.fieldId ? new Types.ObjectId(dto.fieldId) : undefined,
      category: dto.category,
      subject: undefined,
      description: dto.description,
      initialAttachments: attachments,
      status: 'open',
      lastActivityAt: new Date(),
    });

    if (dto.description || attachments.length) {
      await this.messageModel.create({
        reportId: report._id,
        sender: new Types.ObjectId(userId),
        senderRole: 'user',
        content: dto.description,
        attachments,
      });
    }

    // Gửi thông báo cho người dùng: báo cáo đã được tiếp nhận
    try {
      await this.notificationsService.create({
        recipient: new Types.ObjectId(userId),
        type: NotificationType.REPORT_SUBMITTED,
        title: 'Báo cáo đã được tiếp nhận',
        message:
          'Yêu cầu báo cáo của bạn đã được tiếp nhận và đang được đội ngũ hỗ trợ xem xét.',
        metadata: {
          reportId: report._id,
          category: dto.category,
          fieldId: dto.fieldId ?? null,
        },
      });
    } catch {
      // Không để lỗi notification chặn luồng tạo report
    }

    return report;
  }

  async assertCanAccessReport(userId: string, userRole: 'user' | 'admin', reportId: string) {
    const report = await this.reportModel.findById(reportId);
    if (!report) throw new NotFoundException('Report not found');
    if (userRole !== 'admin' && report.reporter.toString() !== userId) {
      throw new ForbiddenException('Not allowed');
    }
    return report;
  }

  async addMessage(userId: string, userRole: 'user'|'admin', reportId: string, dto: CreateReportMessageDto, files?: Express.Multer.File[]) {
    const report = await this.assertCanAccessReport(userId, userRole, reportId);

    const attachments: string[] = [];
    if (files?.length) {
      if (files.length > 3) throw new BadRequestException('Max 3 attachments');
      for (const f of files) {
        const url = await this.s3.uploadDocument({
          buffer: f.buffer,
          mimetype: f.mimetype,
          originalname: f.originalname,
          size: f.size,
          encoding: f.encoding,
          fieldname: f.fieldname,
        });
        attachments.push(url);
      }
    }

    if (!dto.content && attachments.length === 0) {
      throw new BadRequestException('Message content or at least one attachment is required');
    }

    const message = await this.messageModel.create({
      reportId: report._id,
      sender: new Types.ObjectId(userId),
      senderRole: userRole,
      content: dto.content,
      attachments,
    });

    await this.reportModel.findByIdAndUpdate(report._id, { lastActivityAt: new Date() });

    return message;
  }

  async getReport(userId: string, userRole: 'user'|'admin', reportId: string) {
    const report = await this.assertCanAccessReport(userId, userRole, reportId);
    return report;
  }

  async getMessages(userId: string, userRole: 'user'|'admin', reportId: string, page = 1, limit = 20) {
    await this.assertCanAccessReport(userId, userRole, reportId);
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      this.messageModel.find({ reportId }).sort({ createdAt: 1 }).skip(skip).limit(limit).lean(),
      this.messageModel.countDocuments({ reportId }),
    ]);
    const totalPages = Math.ceil(total / limit) || 1;
    return { data: items, total, page, limit, totalPages, hasNextPage: page < totalPages };
  }

  async userList(userId: string, query: { status?: string[]; category?: ReportCategory[]; search?: string; page?: number; limit?: number; fieldId?: string; }) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const filter: any = { reporter: new Types.ObjectId(userId) };
    if (query.status?.length) filter.status = { $in: query.status };
    if (query.category?.length) filter.category = { $in: query.category };
    if (query.search) {
      const regex = new RegExp(query.search, 'i');
      filter.$or = [{ description: regex }, { subject: regex }];
    }
    if (query.fieldId) {
      filter.field = new Types.ObjectId(query.fieldId);
    }
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.reportModel
        .find(filter)
        .sort({ lastActivityAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('reporter', 'fullName email phoneNumber')
        .populate('field', 'name address')
        .lean(),
      this.reportModel.countDocuments(filter),
    ]);
    const totalPages = Math.ceil(total / limit) || 1;
    return { data, total, page, limit, totalPages, hasNextPage: page < totalPages };
  }

  async adminList(query: { status?: string[]; category?: ReportCategory[]; search?: string; page?: number; limit?: number; }) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const filter: any = {};
    if (query.status?.length) filter.status = { $in: query.status };
    if (query.category?.length) filter.category = { $in: query.category };
    if (query.search) {
      const regex = new RegExp(query.search, 'i');
      filter.$or = [{ description: regex }, { subject: regex }];
    }
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.reportModel
        .find(filter)
        .sort({ lastActivityAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('reporter', 'fullName email phoneNumber')
        .populate('field', 'name address')
        .lean(),
      this.reportModel.countDocuments(filter),
    ]);
    const totalPages = Math.ceil(total / limit) || 1;
    return { data, total, page, limit, totalPages, hasNextPage: page < totalPages };
  }

  async updateStatus(reportId: string, status: 'open'|'in_review'|'resolved'|'closed') {
    const r = await this.reportModel.findByIdAndUpdate(reportId, { status, lastActivityAt: new Date() }, { new: true });
    if (!r) throw new NotFoundException('Report not found');
    return r;
  }
}