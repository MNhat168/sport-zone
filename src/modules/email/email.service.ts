import { MailerService } from '@nestjs-modules/mailer';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentMethod, PaymentMethodLabels } from 'src/common/enums/payment-method.enum';
import * as fs from 'fs';
import * as path from 'path';
import * as Handlebars from 'handlebars';

interface SendMailOptions {
	to: string;
	subject: string;
	template?: string;
	context?: any;
	html?: string;
}

@Injectable()
export class EmailService {
	constructor(
		private readonly mailerService: MailerService,
		private readonly configService: ConfigService,
	) { }

	/**
	 * Gửi email dùng SMTP qua MailerService
	 */
	private async sendMail(options: SendMailOptions) {
		await this.mailerService.sendMail({
			to: options.to,
			subject: options.subject,
			template: options.template,
			context: options.context,
			html: options.html,
		});
	}

	private async renderTemplate(templateName: string, context: any): Promise<string> {
		const templatePath = path.join(process.cwd(), 'src/templates', templateName);
		const source = await fs.promises.readFile(templatePath, 'utf8');
		const template = Handlebars.compile(source);
		return template(context);
	}

	async sendEmailVerification(email: string, token: string) {
		const frontendUrl = this.configService.get<string>('FRONTEND_URL');
		// Use VITE_API_URL as backend base as requested
		const backendUrl = this.configService.get<string>('VITE_API_URL') || '';

		await this.sendMail({
			to: email,
			subject: 'Xác thực tài khoản SportZone',
			template: 'verify-email.hbs',
			context: {
				// Ưu tiên 1-click xác thực qua BE nếu BACKEND_URL được cấu hình
				link: backendUrl
					? `${backendUrl}/auth/verify-email?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`
					: `${frontendUrl}/verify-email?token=${token}`,
			},
		});
	}

	/**
	 * Gửi email yêu cầu thanh toán cho booking (sau khi chủ sân accept ghi chú)
	 */
	async sendBookingPaymentRequest(payload: {
		to: string;
		field: { name: string; address?: string };
		customer: { fullName: string };
		booking: { date: string; startTime: string; endTime: string };
		pricing: { totalFormatted: string };
		paymentLink: string;
		paymentMethod?: PaymentMethod | string;
		expiresAt?: string; // formatted datetime string
		expiresInMinutes?: number; // minutes until expiration
	}) {
		let methodLabel = 'Thanh toán trực tuyến';
		if (payload.paymentMethod !== undefined) {
			if (typeof payload.paymentMethod === 'number') {
				methodLabel = PaymentMethodLabels[payload.paymentMethod as PaymentMethod] || methodLabel;
			} else if (typeof payload.paymentMethod === 'string') {
				methodLabel = payload.paymentMethod;
			}
		}
		await this.sendMail({
			to: payload.to,
			subject: 'Yêu cầu thanh toán đặt sân - SportZone',
			template: 'booking-payment-request.hbs',
			context: {
				title: 'Yêu cầu thanh toán đặt sân',
				field: payload.field,
				customer: payload.customer,
				booking: payload.booking,
				pricing: payload.pricing,
				payment: { methodLabel, link: payload.paymentLink, expiresAt: payload.expiresAt, expiresInMinutes: payload.expiresInMinutes },
			},
		});
	}

	/**
	 * Gửi email thông báo đặt sân tới chủ sân (field owner)
	 */
	async sendFieldOwnerBookingNotification(payload: {
		to: string;
		field: { name: string; address: string };
		customer: { fullName: string; phone?: string; email: string };
		booking: { date: string; startTime: string; endTime: string; services?: string[] };
		pricing: {
			services?: { name: string; priceFormatted: string }[];
			fieldPriceFormatted: string;
			totalFormatted: string;
		};
		preheader?: string;
		viewInBrowserUrl?: string;
		dateLabel?: string;
		createdAt?: string;
		paymentMethod?: PaymentMethod | string;
	}) {
		let methodLabel = 'Chưa chọn';
		if (payload.paymentMethod !== undefined) {
			if (typeof payload.paymentMethod === 'number') {
				methodLabel = PaymentMethodLabels[payload.paymentMethod as PaymentMethod] || 'Unknown';
			} else if (typeof payload.paymentMethod === 'string') {
				methodLabel = payload.paymentMethod;
			}
		}
		await this.sendMail({
			to: payload.to,
			subject: 'Thông báo đặt sân mới - SportZone',
			template: 'Response_Email_bookingField_to_FieldOwner.hbs',
			context: {
				preheader: payload.preheader ?? 'Thông báo đặt sân mới',
				viewInBrowserUrl: payload.viewInBrowserUrl ?? this.configService.get<string>('FRONTEND_URL'),
				date: payload.dateLabel ?? new Date().toISOString().split('T')[0],
				createdAt: payload.createdAt ?? new Date().toLocaleString('vi-VN'),
				field: payload.field,
				customer: payload.customer,
				booking: {
					date: payload.booking.date,
					startTime: payload.booking.startTime,
					endTime: payload.booking.endTime,
					services: payload.booking.services ?? [],
				},
				pricing: payload.pricing,
				payment: { methodLabel },
			},
		});
	}

	/**
	 * Gửi email xác nhận đặt sân tới khách hàng (customer)
	 */
	async sendCustomerBookingConfirmation(payload: {
		to: string;
		field: { name: string; address: string };
		customer: { fullName: string; phone?: string; email: string };
		booking: { date: string; startTime: string; endTime: string; services?: string[] };
		pricing: {
			services?: { name: string; priceFormatted: string }[];
			fieldPriceFormatted: string;
			totalFormatted: string;
		};
		preheader?: string;
		viewInBrowserUrl?: string;
		dateLabel?: string;
		createdAt?: string;
		paymentMethod?: PaymentMethod | string;
	}) {
		let methodLabel = 'Chưa chọn';
		if (payload.paymentMethod !== undefined) {
			if (typeof payload.paymentMethod === 'number') {
				methodLabel = PaymentMethodLabels[payload.paymentMethod as PaymentMethod] || 'Unknown';
			} else if (typeof payload.paymentMethod === 'string') {
				methodLabel = payload.paymentMethod;
			}
		}
		await this.sendMail({
			to: payload.to,
			subject: 'Đặt sân thành công - SportZone',
			template: 'Response_Email_bookingField_to_Customer.hbs',
			context: {
				preheader: payload.preheader ?? 'Đặt sân thành công',
				viewInBrowserUrl: payload.viewInBrowserUrl ?? this.configService.get<string>('FRONTEND_URL'),
				date: payload.dateLabel ?? new Date().toISOString().split('T')[0],
				createdAt: payload.createdAt ?? new Date().toLocaleString('vi-VN'),
				field: payload.field,
				customer: payload.customer,
				booking: {
					date: payload.booking.date,
					startTime: payload.booking.startTime,
					endTime: payload.booking.endTime,
					services: payload.booking.services ?? [],
				},
				pricing: payload.pricing,
				payment: { methodLabel },
			},
		});
	}

	async sendResetPassword(email: string, token: string) {
		const frontendUrl = this.configService.get<string>('FRONTEND_URL');
		// Use VITE_API_URL as backend base if configured, otherwise use frontend URL
		const backendUrl = this.configService.get<string>('VITE_API_URL') || '';
		await this.sendMail({
			to: email,
			subject: 'Đặt lại mật khẩu SportZone',
			template: 'reset-password.hbs',
			context: {
				// Link có thể là backend endpoint hoặc frontend page
				link: backendUrl
					? `${backendUrl}/auth/reset-password?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`
					: `${frontendUrl}/reset-password?token=${encodeURIComponent(token)}`,
			},
		});
	}

	async sendPaymentNotification(
		email: string,
		studentName: string,
		courseName: string,
		paymentLink: string,
		amount?: number,
		paymentMethod?: PaymentMethod | string,
	) {
		const frontendUrl = this.configService.get<string>('FRONTEND_URL');

		// Convert payment method to display label
		let paymentMethodLabel = 'Chưa chọn';
		if (paymentMethod) {
			if (typeof paymentMethod === 'number') {
				// If it's a PaymentMethod enum value
				paymentMethodLabel = PaymentMethodLabels[paymentMethod] || 'Unknown';
			} else {
				// If it's already a string label
				paymentMethodLabel = paymentMethod;
			}
		}

		await this.sendMail({
			to: email,
			subject: 'Thông báo thanh toán SportZone',
			template: 'payment-notification.hbs',
			context: {
				studentName,
				courseName,
				paymentLink,
				amount: amount ? amount.toLocaleString('vi-VN') : 'N/A',
				paymentMethod: paymentMethodLabel,
			},
		});
	}

	/**
	 * Gửi email thông báo tài khoản cho giáo viên mới
	 */
	async sendTeacherAccountInfo(
		email: string,
		accountInfo: {
			fullName: string;
			loginEmail: string;
			password: string;
			notificationEmail: string;
		},
	) {
		const frontendUrl = this.configService.get<string>('FRONTEND_URL');
		await this.sendMail({
			to: email,
			subject: 'Chào mừng bạn đến với SportZone - Thông tin tài khoản giáo viên',
			template: 'teacher-account-info.hbs',
			context: {
				fullName: accountInfo.fullName,
				loginEmail: accountInfo.loginEmail,
				password: accountInfo.password,
				notificationEmail: accountInfo.notificationEmail,
				loginUrl: `${frontendUrl}/login`,
				supportEmail: 'support@sportzone.com',
			},
		});
	}

	async sendInviteTeacherToFillForm(email: string, formUrl: string) {
		await this.sendMail({
			to: email,
			subject: 'Mời bạn trở thành giáo viên SportZone',
			template: 'invite-teacher-fill-form.hbs',
			context: { formUrl },
		});
	}

	/**
	 * Send booking confirmation email to customer (simple inline email)
	 * This is used by enhanced bookings service handlers
	 */
	async sendBookingConfirmation(booking: any) {
		const userEmail = booking?.user?.email || booking?.userEmail;
		if (!userEmail) return;
		const fieldName = booking?.field?.name || 'Sân';
		const address = booking?.field?.location?.address || '';
		const dateStr = booking?.date instanceof Date ? booking.date.toLocaleDateString('vi-VN') : booking?.date;
		const startTime = booking?.startTime || '';
		const endTime = booking?.endTime || '';
		await this.sendMail({
			to: userEmail,
			subject: 'Xác nhận đặt sân thành công',
			html: `
				<div>
					<p>Đặt sân của bạn đã được xác nhận.</p>
					<p><strong>Sân:</strong> ${fieldName}</p>
					<p><strong>Địa chỉ:</strong> ${address}</p>
					<p><strong>Thời gian:</strong> ${dateStr} ${startTime} - ${endTime}</p>
				</div>
			`,
		});
	}

	/**
	 * Send booking cancellation email to customer (simple inline email)
	 * This is used by enhanced bookings service handlers
	 */
	async sendBookingCancellation(booking: any, reason?: string) {
		const userEmail = booking?.user?.email || booking?.userEmail;
		if (!userEmail) return;
		const fieldName = booking?.field?.name || 'Sân';
		const dateStr = booking?.date instanceof Date ? booking.date.toLocaleDateString('vi-VN') : booking?.date;
		const startTime = booking?.startTime || '';
		const endTime = booking?.endTime || '';
		await this.sendMail({
			to: userEmail,
			subject: 'Hủy đặt sân',
			html: `
				<div>
					<p>Đặt sân của bạn đã bị hủy.</p>
					<p><strong>Sân:</strong> ${fieldName}</p>
					<p><strong>Thời gian:</strong> ${dateStr} ${startTime} - ${endTime}</p>
					<p><strong>Lý do:</strong> ${reason || 'Không xác định'}</p>
				</div>
			`,
		});
	}

	/**
	 * Send email when field owner registration is submitted
	 */
	async sendFieldOwnerRegistrationSubmitted(email: string, fullName: string) {
		const frontendUrl = this.configService.get<string>('FRONTEND_URL');
		await this.sendMail({
			to: email,
			subject: 'Đăng ký làm chủ sân đã được gửi - SportZone',
			template: 'field-owner-registration-submitted.hbs',
			context: {
				fullName,
				frontendUrl: frontendUrl || 'https://sportzone.vn',
			},
		});
	}

	/**
	 * Send email when field owner registration is approved
	 */
	async sendFieldOwnerRegistrationApproved(email: string, fullName: string) {
		const frontendUrl = this.configService.get<string>('FRONTEND_URL');
		await this.sendMail({
			to: email,
			subject: 'Đăng ký làm chủ sân đã được duyệt - SportZone',
			template: 'field-owner-registration-approved.hbs',
			context: {
				fullName,
				frontendUrl: frontendUrl || 'https://sportzone.vn',
			},
		});
	}

	/**
	 * Send email when field owner registration is rejected
	 */
	async sendFieldOwnerRegistrationRejected(email: string, fullName: string, reason: string) {
		const frontendUrl = this.configService.get<string>('FRONTEND_URL');
		await this.sendMail({
			to: email,
			subject: 'Đăng ký làm chủ sân bị từ chối - SportZone',
			template: 'field-owner-registration-rejected.hbs',
			context: {
				fullName,
				reason,
				frontendUrl: frontendUrl || 'https://sportzone.vn',
			},
		});
	}

	/**
	 * Send email when bank account is submitted
	 */
	async sendBankAccountSubmitted(email: string, fullName: string) {
		const frontendUrl = this.configService.get<string>('FRONTEND_URL');
		await this.sendMail({
			to: email,
			subject: 'Khai báo tài khoản ngân hàng đã được gửi - SportZone',
			html: `
				<div>
					<p>Xin chào ${fullName},</p>
					<p>Yêu cầu khai báo tài khoản ngân hàng của bạn đã được gửi thành công.</p>
					<p>Chúng tôi sẽ xem xét và phản hồi trong vòng 24 giờ.</p>
					<p>Trân trọng,<br>Đội ngũ SportZone</p>
				</div>
			`,
		});
	}

	/**
	 * Send email when bank account is verified
	 */
	async sendBankAccountVerified(email: string, fullName: string) {
		const frontendUrl = this.configService.get<string>('FRONTEND_URL');
		await this.sendMail({
			to: email,
			subject: 'Tài khoản ngân hàng đã được xác minh - SportZone',
			html: `
				<div>
					<p>Xin chào ${fullName},</p>
					<p>Tài khoản ngân hàng của bạn đã được xác minh thành công.</p>
					<p>Bạn có thể bắt đầu nhận thanh toán từ khách đặt sân.</p>
					<p>Trân trọng,<br>Đội ngũ SportZone</p>
				</div>
			`,
		});
	}

	/**
	 * Send email when bank account is rejected
	 */
	async sendBankAccountRejected(email: string, fullName: string, reason: string) {
		const frontendUrl = this.configService.get<string>('FRONTEND_URL');
		await this.sendMail({
			to: email,
			subject: 'Tài khoản ngân hàng bị từ chối - SportZone',
			html: `
				<div>
					<p>Xin chào ${fullName},</p>
					<p>Tài khoản ngân hàng của bạn đã bị từ chối.</p>
					<p><strong>Lý do:</strong> ${reason}</p>
					<p>Vui lòng kiểm tra lại thông tin và khai báo lại.</p>
					<p>Trân trọng,<br>Đội ngũ SportZone</p>
				</div>
			`,
		});
	}
}
