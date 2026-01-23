// Script kiểm tra các fields thiếu dữ liệu ở các trường quan trọng
// Chạy: mongosh "mongodb+srv://nhatnmde180:helloworld@cluster0.zufvinh.mongodb.net/SportZone" --file check_fields_missing_data.js

print('========================================');
print('   KIỂM TRA FIELDS THIẾU DỮ LIỆU');
print('========================================\n');

// Lấy tất cả fields
const allFields = db.fields.find({}).toArray();
const totalFields = allFields.length;

print(`Tổng số fields trong hệ thống: ${totalFields}\n`);

// Mảng lưu các fields có vấn đề
const fieldsWithIssues = [];

allFields.forEach(field => {
    const issues = [];
    
    // 1. Kiểm tra operatingHours
    if (!field.operatingHours || 
        field.operatingHours === null || 
        !Array.isArray(field.operatingHours) || 
        field.operatingHours.length === 0) {
        issues.push('operatingHours');
    }
    
    // 2. Kiểm tra priceRanges
    if (!field.priceRanges || 
        field.priceRanges === null || 
        !Array.isArray(field.priceRanges) || 
        field.priceRanges.length === 0) {
        issues.push('priceRanges');
    }
    
    // 3. Kiểm tra slotDuration
    if (field.slotDuration === undefined || 
        field.slotDuration === null || 
        field.slotDuration === 0) {
        issues.push('slotDuration');
    }
    
    // 4. Kiểm tra minSlots
    if (field.minSlots === undefined || 
        field.minSlots === null || 
        field.minSlots === 0) {
        issues.push('minSlots');
    }
    
    // 5. Kiểm tra maxSlots
    if (field.maxSlots === undefined || 
        field.maxSlots === null || 
        field.maxSlots === 0) {
        issues.push('maxSlots');
    }
    
    // 6. Kiểm tra basePrice
    if (field.basePrice === undefined || 
        field.basePrice === null || 
        field.basePrice === 0) {
        issues.push('basePrice');
    }
    
    // 7. Kiểm tra location
    if (!field.location || 
        field.location === null ||
        !field.location.address || 
        field.location.address === null || 
        field.location.address === '') {
        issues.push('location.address');
    }
    
    // 8. Kiểm tra location.geo
    if (!field.location || 
        field.location === null ||
        !field.location.geo || 
        field.location.geo === null ||
        !field.location.geo.coordinates || 
        field.location.geo.coordinates.length !== 2) {
        issues.push('location.geo');
    }
    
    // 9. Kiểm tra description
    if (!field.description || 
        field.description === null || 
        field.description === '') {
        issues.push('description');
    }
    
    // 10. Kiểm tra images
    if (!field.images || 
        field.images === null || 
        !Array.isArray(field.images) || 
        field.images.length === 0) {
        issues.push('images');
    }
    
    // 11. Kiểm tra sportType
    if (!field.sportType || 
        field.sportType === null || 
        field.sportType === '') {
        issues.push('sportType');
    }
    
    // Nếu có issues, thêm vào danh sách
    if (issues.length > 0) {
        fieldsWithIssues.push({
            _id: field._id,
            name: field.name || 'N/A',
            isActive: field.isActive !== undefined ? field.isActive : 'N/A',
            issues: issues,
            issueCount: issues.length
        });
    }
});

// Hiển thị kết quả
print('========================================');
print('   KẾT QUẢ KIỂM TRA');
print('========================================\n');

if (fieldsWithIssues.length === 0) {
    print('✅ TẤT CẢ FIELDS ĐỀU ĐẦY ĐỦ DỮ LIỆU!\n');
} else {
    print(`⚠️ Tìm thấy ${fieldsWithIssues.length} fields thiếu dữ liệu:\n`);
    
    // Sắp xếp theo số lượng issues giảm dần
    fieldsWithIssues.sort((a, b) => b.issueCount - a.issueCount);
    
    fieldsWithIssues.forEach((field, index) => {
        print(`${index + 1}. Field: ${field.name}`);
        print(`   ID: ${field._id}`);
        print(`   isActive: ${field.isActive}`);
        print(`   Số trường thiếu: ${field.issueCount}`);
        print(`   Các trường thiếu:`);
        field.issues.forEach(issue => {
            print(`      - ${issue}`);
        });
        print('');
    });
}

// Thống kê theo từng loại issue
print('========================================');
print('   THỐNG KÊ THEO TỪNG TRƯỜNG');
print('========================================\n');

const issueStats = {
    'operatingHours': 0,
    'priceRanges': 0,
    'slotDuration': 0,
    'minSlots': 0,
    'maxSlots': 0,
    'basePrice': 0,
    'location.address': 0,
    'location.geo': 0,
    'description': 0,
    'images': 0,
    'sportType': 0
};

fieldsWithIssues.forEach(field => {
    field.issues.forEach(issue => {
        if (issueStats[issue] !== undefined) {
            issueStats[issue]++;
        }
    });
});

Object.keys(issueStats).forEach(key => {
    const count = issueStats[key];
    if (count > 0) {
        print(`   ${key}: ${count} fields`);
    }
});

print('\n========================================');
print('   TỔNG KẾT');
print('========================================');
print(`   Tổng số fields: ${totalFields}`);
print(`   Fields đầy đủ: ${totalFields - fieldsWithIssues.length}`);
print(`   Fields thiếu dữ liệu: ${fieldsWithIssues.length}`);

if (fieldsWithIssues.length > 0) {
    print('\n💡 Chạy script fix_fields.js để tự động sửa các vấn đề này');
}

print('========================================\n');
