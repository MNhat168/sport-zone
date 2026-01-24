// Script sửa priceRanges từ weekday/weekend sang các ngày cụ thể
// Chạy: mongosh "mongodb+srv://nhatnmde180:helloworld@cluster0.zufvinh.mongodb.net/SportZone" --file fix_price_ranges_weekday_weekend.js

print('========================================');
print('   SỬA PRICERANGES TỪ WEEKDAY/WEEKEND SANG CÁC NGÀY CỤ THỂ');
print('========================================\n');

// Tìm các fields có priceRanges dùng weekday/weekend
const fieldsWithWeekdayWeekend = db.fields.find({
    'priceRanges.day': { $in: ['weekday', 'weekend'] }
}).toArray();

print(`Tìm thấy ${fieldsWithWeekdayWeekend.length} fields cần sửa:\n`);

if (fieldsWithWeekdayWeekend.length === 0) {
    print('✅ Không có field nào cần sửa. Tất cả đã dùng các ngày cụ thể!');
    print('\n========================================');
    print('   HOÀN TẤT - KHÔNG CẦN XỬ LÝ');
    print('========================================');
    quit();
}

// Hiển thị danh sách
fieldsWithWeekdayWeekend.forEach((field, index) => {
    print(`${index + 1}. Field: ${field.name}`);
    print(`   ID: ${field._id}`);
    print(`   BasePrice: ${field.basePrice}`);
    print(`   PriceRanges hiện tại:`);
    field.priceRanges.forEach(pr => {
        print(`      - ${pr.day}: ${pr.start}-${pr.end}, multiplier: ${pr.multiplier}`);
    });
    print('');
});

// Sửa từng field
print('========================================');
print('📋 Đang sửa các fields...\n');

let fixedCount = 0;

fieldsWithWeekdayWeekend.forEach((field, index) => {
    print(`${index + 1}. Xử lý field: ${field.name}`);
    
    const newPriceRanges = [];
    
    // Chuyển đổi từng priceRange
    field.priceRanges.forEach(pr => {
        if (pr.day === 'weekday') {
            // weekday -> tạo cho monday, tuesday, wednesday, thursday, friday
            ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'].forEach(day => {
                newPriceRanges.push({
                    day: day,
                    start: pr.start,
                    end: pr.end,
                    multiplier: pr.multiplier
                });
            });
        } else if (pr.day === 'weekend') {
            // weekend -> tạo cho saturday, sunday
            ['saturday', 'sunday'].forEach(day => {
                newPriceRanges.push({
                    day: day,
                    start: pr.start,
                    end: pr.end,
                    multiplier: pr.multiplier
                });
            });
        } else {
            // Giữ nguyên các ngày cụ thể
            newPriceRanges.push(pr);
        }
    });
    
    // Loại bỏ duplicate (nếu có)
    const uniquePriceRanges = [];
    const seen = new Set();
    newPriceRanges.forEach(pr => {
        const key = `${pr.day}-${pr.start}-${pr.end}`;
        if (!seen.has(key)) {
            seen.add(key);
            uniquePriceRanges.push(pr);
        }
    });
    
    print(`   ✓ Chuyển đổi ${field.priceRanges.length} ranges thành ${uniquePriceRanges.length} ranges`);
    print(`   Ranges mới:`);
    uniquePriceRanges.forEach(pr => {
        print(`      - ${pr.day}: ${pr.start}-${pr.end}, multiplier: ${pr.multiplier}`);
    });
    
    // Update database
    try {
        const result = db.fields.updateOne(
            { _id: field._id },
            { $set: { priceRanges: uniquePriceRanges } }
        );
        
        if (result.modifiedCount > 0) {
            print(`   ✅ Đã cập nhật thành công\n`);
            fixedCount++;
        } else {
            print(`   ⚠️ Không có thay đổi nào\n`);
        }
    } catch (error) {
        print(`   ❌ Lỗi khi update: ${error}\n`);
    }
});

// Verify
print('========================================');
print('📋 Đang kiểm tra lại kết quả...\n');

const verifyFields = db.fields.find({
    _id: { $in: fieldsWithWeekdayWeekend.map(f => f._id) }
}).toArray();

let stillHasWeekdayWeekend = 0;

verifyFields.forEach(field => {
    const hasWeekdayWeekend = field.priceRanges.some(pr => 
        pr.day === 'weekday' || pr.day === 'weekend'
    );
    
    if (hasWeekdayWeekend) {
        stillHasWeekdayWeekend++;
        print(`   ⚠️ ${field.name} vẫn còn weekday/weekend`);
    }
});

print('\n📊 KẾT QUẢ:');
print(`   Tổng số fields đã xử lý: ${fieldsWithWeekdayWeekend.length}`);
print(`   Fields đã được sửa thành công: ${fixedCount}`);
print(`   Fields vẫn còn weekday/weekend: ${stillHasWeekdayWeekend}`);

print('\n========================================');
if (stillHasWeekdayWeekend === 0) {
    print('   ✅ HOÀN TẤT - TẤT CẢ ĐÃ ĐƯỢC SỬA');
    print('   Tất cả priceRanges đã dùng các ngày cụ thể!');
} else {
    print('   ⚠️ HOÀN TẤT - VẪN CÒN MỘT SỐ VẤN ĐỀ');
    print(`   Còn ${stillHasWeekdayWeekend} fields cần kiểm tra thủ công`);
}
print('========================================\n');
