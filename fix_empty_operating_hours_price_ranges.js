// Script tự động fix các fields có operatingHours và priceRanges chỉ chứa ObjectId rỗng
// Chạy: mongosh "mongodb+srv://nhatnmde180:helloworld@cluster0.zufvinh.mongodb.net/SportZone" --file fix_empty_operating_hours_price_ranges.js

print('========================================');
print('   FIX FIELDS VỚI OPERATINGHOURS/PRICERANGES RỖNG');
print('========================================\n');

// Dữ liệu mặc định cho operatingHours
const defaultOperatingHours = [
    { day: "monday", start: "06:00", end: "22:00", duration: 60 },
    { day: "tuesday", start: "06:00", end: "22:00", duration: 60 },
    { day: "wednesday", start: "06:00", end: "22:00", duration: 60 },
    { day: "thursday", start: "06:00", end: "22:00", duration: 60 },
    { day: "friday", start: "06:00", end: "22:00", duration: 60 },
    { day: "saturday", start: "06:00", end: "23:00", duration: 60 },
    { day: "sunday", start: "06:00", end: "23:00", duration: 60 }
];

// Dữ liệu mặc định cho priceRanges
const defaultPriceRanges = [
    { day: "weekday", start: "06:00", end: "17:00", multiplier: 1.0 },
    { day: "weekday", start: "17:00", end: "22:00", multiplier: 1.5 },
    { day: "weekend", start: "06:00", end: "23:00", multiplier: 2.0 }
];

// BƯỚC 1: TÌM CÁC FIELDS CÓ VẤN ĐỀ
print('📋 BƯỚC 1: Đang tìm các fields có operatingHours/priceRanges rỗng...\n');

// Lấy tất cả fields
const allFields = db.fields.find({}).toArray();
const fieldsWithIssues = [];

allFields.forEach(field => {
    const issues = [];
    
    // Kiểm tra operatingHours
    if (field.operatingHours && 
        Array.isArray(field.operatingHours) && 
        field.operatingHours.length > 0) {
        // Kiểm tra xem có phần tử nào thiếu field bắt buộc không
        const hasEmptyOperatingHours = field.operatingHours.some(item => {
            // Nếu chỉ có _id hoặc thiếu bất kỳ field nào trong: day, start, end, duration
            return !item.day || !item.start || !item.end || item.duration === undefined || item.duration === null;
        });
        
        if (hasEmptyOperatingHours) {
            issues.push('operatingHours');
        }
    }
    
    // Kiểm tra priceRanges
    if (field.priceRanges && 
        Array.isArray(field.priceRanges) && 
        field.priceRanges.length > 0) {
        // Kiểm tra xem có phần tử nào thiếu field bắt buộc không
        const hasEmptyPriceRanges = field.priceRanges.some(item => {
            // Nếu chỉ có _id hoặc thiếu bất kỳ field nào trong: day, start, end, multiplier
            return !item.day || !item.start || !item.end || item.multiplier === undefined || item.multiplier === null;
        });
        
        if (hasEmptyPriceRanges) {
            issues.push('priceRanges');
        }
    }
    
    if (issues.length > 0) {
        fieldsWithIssues.push({
            _id: field._id,
            name: field.name || 'N/A',
            issues: issues
        });
    }
});

print(`Tìm thấy ${fieldsWithIssues.length} fields cần sửa:\n`);

if (fieldsWithIssues.length === 0) {
    print('✅ Không có field nào cần sửa. Tất cả fields đều có dữ liệu đầy đủ!');
    print('\n========================================');
    print('   HOÀN TẤT - KHÔNG CẦN XỬ LÝ');
    print('========================================');
    quit();
}

// Hiển thị danh sách fields có vấn đề
fieldsWithIssues.forEach((field, index) => {
    print(`${index + 1}. Field: ${field.name}`);
    print(`   ID: ${field._id}`);
    print(`   Vấn đề: ${field.issues.join(', ')}`);
    print('');
});

// BƯỚC 2: TỰ ĐỘNG FIX
print('========================================');
print('📋 BƯỚC 2: Đang tự động sửa các fields...\n');

let fixedOperatingHours = 0;
let fixedPriceRanges = 0;

fieldsWithIssues.forEach((fieldInfo, index) => {
    print(`${index + 1}. Xử lý field: ${fieldInfo.name}`);
    
    const updateData = {};
    
    // Fix operatingHours nếu cần
    if (fieldInfo.issues.includes('operatingHours')) {
        updateData.operatingHours = defaultOperatingHours;
        fixedOperatingHours++;
        print(`   ✓ Sửa operatingHours`);
    }
    
    // Fix priceRanges nếu cần
    if (fieldInfo.issues.includes('priceRanges')) {
        updateData.priceRanges = defaultPriceRanges;
        fixedPriceRanges++;
        print(`   ✓ Sửa priceRanges`);
    }
    
    // Update field
    try {
        const result = db.fields.updateOne(
            { _id: fieldInfo._id },
            { $set: updateData }
        );
        
        if (result.modifiedCount > 0) {
            print(`   ✅ Đã cập nhật thành công\n`);
        } else {
            print(`   ⚠️ Không có thay đổi nào\n`);
        }
    } catch (error) {
        print(`   ❌ Lỗi khi update: ${error}\n`);
    }
});

// BƯỚC 3: VERIFY KẾT QUẢ
print('========================================');
print('📋 BƯỚC 3: Đang kiểm tra lại kết quả...\n');

// Kiểm tra lại các fields đã fix
const verifyFields = db.fields.find({
    _id: { $in: fieldsWithIssues.map(f => f._id) }
}).toArray();

let stillHasIssues = 0;
const fixedFields = [];

verifyFields.forEach(field => {
    let hasIssue = false;
    
    // Kiểm tra operatingHours
    if (field.operatingHours && Array.isArray(field.operatingHours) && field.operatingHours.length > 0) {
        const hasEmpty = field.operatingHours.some(item => {
            return !item.day || !item.start || !item.end || item.duration === undefined || item.duration === null;
        });
        if (hasEmpty) {
            hasIssue = true;
        }
    }
    
    // Kiểm tra priceRanges
    if (field.priceRanges && Array.isArray(field.priceRanges) && field.priceRanges.length > 0) {
        const hasEmpty = field.priceRanges.some(item => {
            return !item.day || !item.start || !item.end || item.multiplier === undefined || item.multiplier === null;
        });
        if (hasEmpty) {
            hasIssue = true;
        }
    }
    
    if (hasIssue) {
        stillHasIssues++;
    } else {
        fixedFields.push(field.name);
    }
});

print('📊 KẾT QUẢ SAU KHI SỬA:');
print(`   Tổng số fields đã xử lý: ${fieldsWithIssues.length}`);
print(`   Fields đã được sửa thành công: ${fixedFields.length}`);
print(`   Fields vẫn còn vấn đề: ${stillHasIssues}\n`);

if (fixedFields.length > 0) {
    print('✅ CÁC FIELDS ĐÃ ĐƯỢC SỬA:');
    fixedFields.forEach((name, index) => {
        print(`   ${index + 1}. ${name}`);
    });
    print('');
}

// Thống kê chi tiết
print('📊 THỐNG KÊ:');
print(`   Fields đã sửa operatingHours: ${fixedOperatingHours}`);
print(`   Fields đã sửa priceRanges: ${fixedPriceRanges}`);

print('\n========================================');
if (stillHasIssues === 0) {
    print('   ✅ HOÀN TẤT - TẤT CẢ ĐÃ ĐƯỢC SỬA');
    print('   Tất cả fields đã có operatingHours và priceRanges đầy đủ!');
} else {
    print('   ⚠️ HOÀN TẤT - VẪN CÒN MỘT SỐ VẤN ĐỀ');
    print(`   Còn ${stillHasIssues} fields cần kiểm tra thủ công`);
}
print('========================================\n');
