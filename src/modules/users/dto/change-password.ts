import { IsNotEmpty, IsStrongPassword } from 'class-validator';

export class ChangePasswordDTO {
	@IsNotEmpty()
	old_password: string;

	@IsNotEmpty()
	@IsStrongPassword({
		minLength: 6,
		minUppercase: 1,
		minLowercase: 1,
		minNumbers: 1,
		minSymbols: 1,
	})
	new_password: string;

	@IsNotEmpty()
	confirm_password: string;
}
