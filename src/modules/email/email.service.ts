import { MailerService } from '@nestjs-modules/mailer';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentMethod, PaymentMethodLabels } from 'src/common/enums/payment-method.enum';

@Injectable()
export class EmailService {
	constructor(
		private readonly mailerService: MailerService,
		private readonly configService: ConfigService,
	) {}

	async sendEmailVerification(email: string, token: string) {
		const frontendUrl = this.configService.get<string>('FRONTEND_URL');
		// Use VITE_API_URL as backend base as requested
		const backendUrl = this.configService.get<string>('VITE_API_URL') || '';
		await this.mailerService.sendMail({
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

	async sendResetPassword(email: string, token: string) {
		const frontendUrl = this.configService.get<string>('FRONTEND_URL');
		await this.mailerService.sendMail({
			to: email,
			subject: 'Đặt lại mật khẩu SportZone',
			template: 'reset-password.hbs',
			context: {
				link: `${frontendUrl}/reset-password?token=${token}`,
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

		await this.mailerService.sendMail({
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
		await this.mailerService.sendMail({
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
		await this.mailerService.sendMail({
			to: email,
			subject: 'Mời bạn trở thành giáo viên SportZone',
			template: 'invite-teacher-fill-form.hbs',
			context: { formUrl },
		});
	}
}
