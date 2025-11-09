import { Injectable } from '@nestjs/common';

/**
 * Price Format Service
 * Service để format giá tiền theo chuẩn Việt Nam
 * Có thể dùng ở nhiều nơi: fields, transactions, bookings, etc.
 */
@Injectable()
export class PriceFormatService {
    /**
     * Format price in Vietnamese style (e.g., "200.000đ/giờ")
     * Khuyến nghị: Nên dùng 200.000 VND/giờ (hoặc 200.000đ/giờ)
     * 
     * @param price Price in VND
     * @returns Formatted price string
     */
    formatPrice(price: number | null | undefined): string {
        if (!price || price <= 0) {
            return 'N/A';
        }
        
        // Format với dấu chấm phân cách hàng nghìn và đ/giờ
        // Ví dụ: 200000 -> "200.000đ/giờ"
        const formattedPrice = price.toLocaleString('vi-VN', {
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        });
        
        return `${formattedPrice}đ/giờ`;
    }

    /**
     * Format price without unit (e.g., "200.000")
     * @param price Price in VND
     * @returns Formatted price string without unit
     */
    formatPriceNumber(price: number | null | undefined): string {
        if (!price || price <= 0) {
            return 'N/A';
        }
        
        return price.toLocaleString('vi-VN', {
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        });
    }

    /**
     * Format price with VND unit (e.g., "200.000 VND")
     * @param price Price in VND
     * @returns Formatted price string with VND unit
     */
    formatPriceVND(price: number | null | undefined): string {
        if (!price || price <= 0) {
            return 'N/A';
        }
        
        const formattedPrice = price.toLocaleString('vi-VN', {
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        });
        
        return `${formattedPrice} VND`;
    }
}
