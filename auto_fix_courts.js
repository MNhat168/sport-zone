// Script tự động check và insert courts cho các fields thiếu
// Chạy: mongosh "mongodb+srv://nhatnmde180:helloworld@cluster0.zufvinh.mongodb.net/SportZone" --file auto_fix_courts.js

print('========================================');
print('   SCRIPT TỰ ĐỘNG CHECK VÀ INSERT COURTS');
print('========================================\n');

// BƯỚC 1: CHECK CÁC FIELDS BỊ LỖI
print('📋 BƯỚC 1: Đang kiểm tra các fields thiếu courts...\n');

const fieldsWithIssues = db.fields.aggregate([
    {
        $lookup: {
            from: 'courts',
            localField: '_id',
            foreignField: 'field',
            as: 'courts'
        }
    },
    {
        $addFields: {
            activeCourtsCount: {
                $size: {
                    $filter: {
                        input: '$courts',
                        as: 'court',
                        cond: { $eq: ['$$court.isActive', true] }
                    }
                }
            },
            totalCourtsCount: { $size: '$courts' }
        }
    },
    {
        $match: {
            $or: [
                { totalCourtsCount: 0 },
                { activeCourtsCount: 0 }
            ],
            isActive: true  // Chỉ xử lý các fields đang active
        }
    },
    {
        $project: {
            _id: 1,
            name: 1,
            isActive: 1,
            totalCourtsCount: 1,
            activeCourtsCount: 1
        }
    },
    {
        $sort: { name: 1 }
    }
]).toArray();

print(`Tìm thấy ${fieldsWithIssues.length} fields cần tạo courts:\n`);

if (fieldsWithIssues.length === 0) {
    print('✅ Không có field nào cần sửa. Tất cả fields đã có courts!');
    print('\n========================================');
    print('   HOÀN TẤT - KHÔNG CẦN XỬ LÝ');
    print('========================================');
    quit();
}

// Hiển thị danh sách fields bị lỗi
fieldsWithIssues.forEach((field, index) => {
    print(`${index + 1}. ${field.name}`);
    print(`   ID: ${field._id}`);
    print(`   Total courts: ${field.totalCourtsCount}`);
    print(`   Active courts: ${field.activeCourtsCount}`);
    print('');
});

// BƯỚC 2: TỰ ĐỘNG INSERT COURTS
print('========================================');
print('📋 BƯỚC 2: Đang tự động tạo courts...\n');

let totalInserted = 0;
const courtsToInsert = [];
const fieldsProcessed = [];

fieldsWithIssues.forEach((field, index) => {
    print(`${index + 1}. Xử lý field: ${field.name}`);
    
    // Kiểm tra xem field đã có courts chưa (có thể có nhưng đều inactive)
    const existingCourts = db.courts.find({ field: field._id }).toArray();
    const maxCourtNumber = existingCourts.length > 0 
        ? Math.max(...existingCourts.map(c => c.courtNumber || 0))
        : 0;
    
    // Tạo 2 courts mới cho mỗi field
    const courtsForThisField = [];
    for (let i = 1; i <= 2; i++) {
        const courtNumber = maxCourtNumber + i;
        const court = {
            field: field._id,
            name: `Court ${courtNumber}`,
            courtNumber: courtNumber,
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date()
        };
        
        courtsToInsert.push(court);
        courtsForThisField.push(court);
        totalInserted++;
    }
    
    print(`   ✓ Tạo ${courtsForThisField.length} courts (Court ${maxCourtNumber + 1} - Court ${maxCourtNumber + 2})`);
    fieldsProcessed.push({
        name: field.name,
        courtsCount: courtsForThisField.length
    });
    print('');
});

print(`📊 Tổng số courts sẽ được tạo: ${totalInserted}`);
print('\n⏳ Đang insert vào database...\n');

// Insert tất cả courts
try {
    if (courtsToInsert.length > 0) {
        const result = db.courts.insertMany(courtsToInsert);
        print('✅ THÀNH CÔNG!');
        print(`Đã tạo ${result.insertedIds.length} courts mới\n`);
        
        print('=== CHI TIẾT CÁC FIELDS ĐÃ ĐƯỢC XỬ LÝ ===');
        fieldsProcessed.forEach((item, index) => {
            print(`${index + 1}. ${item.name}: +${item.courtsCount} courts`);
        });
    } else {
        print('⚠️ Không có courts nào cần tạo');
    }
} catch (error) {
    print('\n❌ LỖI KHI INSERT:');
    print(error);
    print('\n========================================');
    print('   LỖI - VUI LÒNG KIỂM TRA LẠI');
    print('========================================');
    quit();
}

// BƯỚC 3: VERIFY KẾT QUẢ
print('\n========================================');
print('📋 BƯỚC 3: Đang kiểm tra lại kết quả...\n');

const verifyResult = db.fields.aggregate([
    {
        $lookup: {
            from: 'courts',
            localField: '_id',
            foreignField: 'field',
            as: 'courts'
        }
    },
    {
        $addFields: {
            activeCourtsCount: {
                $size: {
                    $filter: {
                        input: '$courts',
                        as: 'court',
                        cond: { $eq: ['$$court.isActive', true] }
                    }
                }
            },
            totalCourtsCount: { $size: '$courts' }
        }
    },
    {
        $match: {
            isActive: true
        }
    },
    {
        $project: {
            _id: 1,
            name: 1,
            activeCourtsCount: 1,
            totalCourtsCount: 1,
            hasIssue: {
                $eq: ['$activeCourtsCount', 0]
            }
        }
    }
]).toArray();

const activeFields = verifyResult.filter(f => f.isActive);
const fieldsStillWithIssues = activeFields.filter(f => f.hasIssue);
const fieldsOK = activeFields.filter(f => !f.hasIssue);

print('📊 TỔNG QUAN SAU KHI XỬ LÝ:');
print(`   Tổng số fields active: ${activeFields.length}`);
print(`   Fields OK (có courts): ${fieldsOK.length}`);
print(`   Fields còn lỗi: ${fieldsStillWithIssues.length}\n`);

if (fieldsStillWithIssues.length > 0) {
    print('⚠️ VẪN CÒN FIELDS BỊ LỖI:');
    fieldsStillWithIssues.forEach((field, index) => {
        print(`   ${index + 1}. ${field.name} (ID: ${field._id})`);
        print(`      Active courts: ${field.activeCourtsCount}`);
    });
    print('');
} else {
    print('✅ TẤT CẢ FIELDS ĐÃ CÓ COURTS!\n');
}

// Thống kê tổng số courts
const totalCourts = db.courts.countDocuments({});
const activeCourts = db.courts.countDocuments({ isActive: true });

print('📊 THỐNG KÊ COURTS TRONG HỆ THỐNG:');
print(`   Total courts: ${totalCourts}`);
print(`   Active courts: ${activeCourts}`);
print(`   Inactive courts: ${totalCourts - activeCourts}`);

print('\n========================================');
if (fieldsStillWithIssues.length === 0) {
    print('   ✅ HOÀN TẤT - TẤT CẢ ĐÃ ĐƯỢC SỬA');
    print('   Hệ thống đã sẵn sàng! Không còn lỗi "Court not found"');
} else {
    print('   ⚠️ HOÀN TẤT - VẪN CÒN MỘT SỐ LỖI');
    print(`   Còn ${fieldsStillWithIssues.length} fields cần xử lý thủ công`);
}
print('========================================');
