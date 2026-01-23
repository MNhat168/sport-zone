// Script kiểm tra sự khác biệt giữa operatingHours có và không có ObjectId
// Chạy: mongosh "mongodb+srv://nhatnmde180:helloworld@cluster0.zufvinh.mongodb.net/SportZone" --file check_operating_hours_id_difference.js

print('========================================');
print('   KIỂM TRA SỰ KHÁC BIỆT OPERATINGHOURS/PRICERANGES');
print('========================================\n');

// Lấy một số fields mẫu để so sánh
const sampleFields = db.fields.find({
    operatingHours: { $exists: true, $ne: null, $not: { $size: 0 } }
}).limit(5).toArray();

print(`Đã lấy ${sampleFields.length} fields mẫu để kiểm tra:\n`);

sampleFields.forEach((field, index) => {
    print(`${index + 1}. Field: ${field.name}`);
    print(`   ID: ${field._id}`);
    print(`   OperatingHours count: ${field.operatingHours ? field.operatingHours.length : 0}`);
    
    if (field.operatingHours && field.operatingHours.length > 0) {
        const firstItem = field.operatingHours[0];
        print(`   OperatingHours[0] structure:`);
        print(`      - Has _id: ${firstItem._id ? 'YES (' + firstItem._id + ')' : 'NO'}`);
        print(`      - Has day: ${firstItem.day ? 'YES (' + firstItem.day + ')' : 'NO'}`);
        print(`      - Has start: ${firstItem.start ? 'YES (' + firstItem.start + ')' : 'NO'}`);
        print(`      - Has end: ${firstItem.end ? 'YES (' + firstItem.end + ')' : 'NO'}`);
        print(`      - Has duration: ${firstItem.duration !== undefined ? 'YES (' + firstItem.duration + ')' : 'NO'}`);
        print(`      - All keys: ${Object.keys(firstItem).join(', ')}`);
    }
    
    print(`   PriceRanges count: ${field.priceRanges ? field.priceRanges.length : 0}`);
    
    if (field.priceRanges && field.priceRanges.length > 0) {
        const firstPriceRange = field.priceRanges[0];
        print(`   PriceRanges[0] structure:`);
        print(`      - Has _id: ${firstPriceRange._id ? 'YES (' + firstPriceRange._id + ')' : 'NO'}`);
        print(`      - Has day: ${firstPriceRange.day ? 'YES (' + firstPriceRange.day + ')' : 'NO'}`);
        print(`      - Has start: ${firstPriceRange.start ? 'YES (' + firstPriceRange.start + ')' : 'NO'}`);
        print(`      - Has end: ${firstPriceRange.end ? 'YES (' + firstPriceRange.end + ')' : 'NO'}`);
        print(`      - Has multiplier: ${firstPriceRange.multiplier !== undefined ? 'YES (' + firstPriceRange.multiplier + ')' : 'NO'}`);
        print(`      - All keys: ${Object.keys(firstPriceRange).join(', ')}`);
    }
    
    print('');
});

// Thống kê tổng quan
print('========================================');
print('   THỐNG KÊ TỔNG QUAN');
print('========================================\n');

const allFields = db.fields.find({
    operatingHours: { $exists: true, $ne: null, $not: { $size: 0 } }
}).toArray();

let fieldsWithId = 0;
let fieldsWithoutId = 0;
let fieldsWithEmptyData = 0;

allFields.forEach(field => {
    if (field.operatingHours && field.operatingHours.length > 0) {
        const firstItem = field.operatingHours[0];
        
        // Kiểm tra có _id không
        const hasId = firstItem._id !== undefined && firstItem._id !== null;
        
        // Kiểm tra có dữ liệu đầy đủ không
        const hasFullData = firstItem.day && firstItem.start && firstItem.end && firstItem.duration !== undefined;
        
        if (hasId && hasFullData) {
            fieldsWithId++;
        } else if (!hasId && hasFullData) {
            fieldsWithoutId++;
        } else if (hasId && !hasFullData) {
            fieldsWithEmptyData++;
        }
    }
});

print(`Tổng số fields có operatingHours: ${allFields.length}`);
print(`   Fields có _id và dữ liệu đầy đủ: ${fieldsWithId}`);
print(`   Fields không có _id và dữ liệu đầy đủ: ${fieldsWithoutId}`);
print(`   Fields có _id nhưng thiếu dữ liệu: ${fieldsWithEmptyData}`);

// Kiểm tra schema trong Mongoose
print('\n========================================');
print('   PHÂN TÍCH SCHEMA');
print('========================================\n');

print('Trong Mongoose schema:');
print('   - operatingHours và priceRanges KHÔNG có _id: false');
print('   - Mặc định MongoDB sẽ tự động tạo _id cho mỗi subdocument trong array');
print('   - Để không có _id, cần thêm _id: false trong schema definition');
print('');
print('Sự khác biệt:');
print('   1. CÓ _id:');
print('      - MongoDB tự động tạo ObjectId cho mỗi phần tử');
print('      - Có thể dùng _id để update/delete phần tử cụ thể');
print('      - Tốn thêm storage space');
print('      - Có thể gây confusion khi chỉ có _id mà không có dữ liệu');
print('');
print('   2. KHÔNG CÓ _id:');
print('      - Nhẹ hơn, không tốn storage cho _id');
print('      - Không thể update/delete phần tử cụ thể bằng _id');
print('      - Phải update toàn bộ mảng hoặc dùng index');
print('      - Phù hợp với dữ liệu không cần track riêng lẻ');

print('\n========================================');
print('   KHUYẾN NGHỊ');
print('========================================\n');

if (fieldsWithEmptyData > 0) {
    print(`⚠️ Có ${fieldsWithEmptyData} fields có _id nhưng thiếu dữ liệu!`);
    print('   Nên chạy script fix_empty_operating_hours_price_ranges.js để sửa');
} else {
    print('✅ Tất cả fields đều có dữ liệu đầy đủ');
}

print('\n💡 Để loại bỏ _id trong tương lai:');
print('   Thêm _id: false vào schema definition:');
print('   operatingHours: {');
print('     type: [{');
print('       _id: false,  // <-- Thêm dòng này');
print('       day: { type: String, ... },');
print('       ...');
print('     }]');
print('   }');

print('\n========================================\n');
