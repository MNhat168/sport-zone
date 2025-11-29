/**
 * DTO cho việc tạo eKYC session
 *
 * Hiện tại backend không còn phụ thuộc vào redirect URL do FE gửi lên.
 * Frontend chỉ cần gọi endpoint này để lấy `sessionId` và `redirectUrl`
 * từ didit rồi tự handle redirect/popup + polling trạng thái.
 */
export class CreateEkycSessionDto {}
