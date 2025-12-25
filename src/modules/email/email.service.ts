import { SportType } from '@common/enums/sport-type.enum';
import { MailerService } from '@nestjs-modules/mailer';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Types } from 'mongoose';
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
	async sendMail(options: SendMailOptions) {
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
				link: `${frontendUrl}/reset-password?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`,
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

	// ==================== Coach Registration Emails ====================

	/**
	 * Send email when coach registration is submitted
	 */
	async sendCoachRegistrationSubmitted(email: string, fullName: string) {
		const template = await this.renderTemplate('coach-registration-submitted.hbs', {
			fullName,
		});

		await this.sendMail({
			to: email,
			subject: 'Đã nhận đơn đăng ký Huấn Luyện Viên - SportZone',
			html: template,
		});
	}

	/**
	 * Send email when coach registration is approved
	 */
	async sendCoachRegistrationApproved(email: string, fullName: string) {
		const template = await this.renderTemplate('coach-registration-approved.hbs', {
			fullName,
		});

		await this.sendMail({
			to: email,
			subject: 'Chúc mừng! Đơn đăng ký Huấn Luyện Viên đã được duyệt - SportZone',
			html: template,
		});
	}

	// ==================== Bank Account Emails ====================

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
	async sendTournamentPaymentRequest(payload: {
		to: string;
		tournament: {
			name: string;
			sportType: string;
			date: string;
			time?: string;
			location: string;
			registrationFee: number;
		};
		customer: { fullName: string };
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

		const amountFormatted = payload.tournament.registrationFee.toLocaleString('vi-VN') + '₫';

		await this.mailerService.sendMail({
			to: payload.to,
			subject: 'Yêu cầu thanh toán đăng ký giải đấu - SportZone',
			template: 'tournament-payment-request.hbs', // You'll need to create this template
			context: {
				title: 'Yêu cầu thanh toán đăng ký giải đấu',
				tournament: payload.tournament,
				customer: payload.customer,
				payment: {
					methodLabel,
					link: payload.paymentLink,
					expiresAt: payload.expiresAt,
					expiresInMinutes: payload.expiresInMinutes,
					amountFormatted,
				},
			},
		});
	}

	/**
	 * Send tournament registration confirmation email
	 */
	async sendTournamentRegistrationConfirmation(payload: {
		to: string;
		tournament: {
			name: string;
			sportType: string;
			date: string;
			time?: string;
			location: string;
			registrationFee: number;
			organizer?: any;
		};
		customer: {
			fullName: string;
		};
		paymentUrl?: string; // ✅ Add this optional parameter
		status?: 'pending' | 'confirmed' | 'failed'; // ✅ Add this optional parameter
	}) {
		const amountFormatted = payload.tournament.registrationFee.toLocaleString('vi-VN') + '₫';
		const organizerName = payload.tournament.organizer?.fullName || 'Ban tổ chức';

		await this.mailerService.sendMail({
			to: payload.to,
			subject: 'Xác nhận đăng ký giải đấu thành công - SportZone',
			template: 'tournament-registration-confirmation.hbs', // Create this template
			context: {
				title: 'Xác nhận đăng ký giải đấu thành công',
				tournament: payload.tournament,
				customer: payload.customer,
				organizerName,
				amountFormatted,
			},
		});
	}

	/**
	 * Send tournament payment failed notification
	 */
	async sendTournamentPaymentFailed(payload: {
		to: string;
		tournament: {
			name: string;
			date: string;
			sportType: string;
			location: string;
		};
		customer: { fullName: string };
		reason: string;
	}) {
		await this.mailerService.sendMail({
			to: payload.to,
			subject: 'Thanh toán đăng ký giải đấu thất bại - SportZone',
			template: 'tournament-payment-failed.hbs', // Create this template
			context: {
				title: 'Thanh toán đăng ký giải đấu thất bại',
				tournament: payload.tournament,
				customer: payload.customer,
				reason: payload.reason,
			},
		});
	}

	/**
	 * Send tournament accepted notification to organizer
	 */
	async sendTournamentAcceptedNotification(payload: {
		to: string;
		tournament: {
			name: string;
			date: string;
			sportType: string;
			location: string;
		};
		organizer: { fullName: string };
	}) {
		await this.mailerService.sendMail({
			to: payload.to,
			subject: 'Yêu cầu tổ chức giải đấu đã được chấp nhận - SportZone',
			template: 'tournament-request-accepted.hbs',
			context: {
				tournament: payload.tournament,
				organizer: payload.organizer,
			},
		});
	}

	/**
	 * Send tournament rejected notification to organizer
	 */
	async sendTournamentRejectedNotification(payload: {
		to: string;
		tournament: {
			name: string;
			date: string;
			location: string;
		};
		organizer: { fullName: string };
	}) {
		await this.mailerService.sendMail({
			to: payload.to,
			subject: 'Thông báo: Yêu cầu đặt sân cho giải đấu bị từ chối - SportZone',
			template: 'tournament-request-rejected.hbs',
			context: {
				tournament: payload.tournament,
				organizer: payload.organizer,
			},
		});
	}

	/**
	 * Send tournament confirmed notification to all participants
	 */
	async sendTournamentConfirmedNotification(payload: {
		to: string;
		tournament: {
			name: string;
			date: string;
			sportType: string;
			location: string;
		};
		participant: { fullName: string };
	}) {
		await this.mailerService.sendMail({
			to: payload.to,
			subject: 'Thông báo: Giải đấu đã chính thức được XÁC NHẬN - SportZone',
			template: 'tournament-auto-confirmed.hbs',
			context: {
				tournament: payload.tournament,
				participant: payload.participant,
			},
		});
	}

	/**
	 * Send monthly subscription invoice
	 */
	async sendInvoiceGenerated(email: string, fullName: string, invoice: { month: number, year: number, amount: number, dueDate: Date }) {
		await this.sendMail({
			to: email,
			subject: `Hóa đơn phí duy trì tài khoản tháng ${invoice.month}/${invoice.year} - SportZone`,
			html: `
                <div>
                     <h3>Xin chào ${fullName},</h3>
                     <p>Hóa đơn phí duy trì tài khoản cho tháng ${invoice.month}/${invoice.year} đã được tạo.</p>
                     <p><strong>Số tiền:</strong> ${invoice.amount.toLocaleString('vi-VN')} VND</p>
                     <p><strong>Hạn thanh toán:</strong> ${invoice.dueDate.toLocaleDateString('vi-VN')}</p>
                     <p>Vui lòng thanh toán trước hạn để tránh gián đoạn dịch vụ.</p>
                     <p>Bạn có thể thanh toán tại trang <a href="${this.configService.get('FRONTEND_URL')}/billing">Quản lý thanh toán</a>.</p>
                </div>
            `
		});
	}

	/**
	 * Send subscription suspended notification
	 */
	async sendSubscriptionSuspended(email: string, fullName: string, reason: string) {
		await this.sendMail({
			to: email,
			subject: 'Tài khoản của bạn đã bị tạm khóa - SportZone',
			html: `
                <div style="color: red;">
                     <h3>Tài khoản bị tạm khóa</h3>
                     <p>Xin chào ${fullName},</p>
                     <p>Tài khoản của bạn đã bị tạm khóa do: ${reason}.</p>
                     <p>Vui lòng thanh toán các hóa đơn quá hạn để mở khóa tài khoản.</p>
                </div>
            `
		});
	}

	/**
	 * Send subscription reactivated notification
	 */
	async sendSubscriptionReactivated(email: string, fullName: string) {
		await this.sendMail({
			to: email,
			subject: 'Tài khoản đã được mở khóa - SportZone',
			html: `
                <div style="color: green;">
                     <h3>Tài khoản đã được mở khóa</h3>
                     <p>Xin chào ${fullName},</p>
                     <p>Chúng tôi đã nhận được thanh toán của bạn. Tài khoản của bạn đã hoạt động trở lại bình thường.</p>
                     <p>Cảm ơn bạn đã sử dụng dịch vụ của SportZone.</p>
                </div>
             `
		});
	}
}

