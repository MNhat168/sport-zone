#!/usr/bin/env node

/**
 * Script để cập nhật tất cả entities sử dụng BaseEntity với Vietnam timezone
 */

const fs = require('fs');
const path = require('path');
const glob = require('glob');

const projectRoot = path.resolve(__dirname, '..');

// Tìm tất cả entity files
const entityFiles = glob.sync('src/modules/**/*.entity.ts', { cwd: projectRoot });

console.log(`Found ${entityFiles.length} entity files to update:`);

entityFiles.forEach(filePath => {
    const fullPath = path.join(projectRoot, filePath);
    console.log(`Processing: ${filePath}`);
    
    try {
        let content = fs.readFileSync(fullPath, 'utf8');
        
        // Skip nếu đã sử dụng BaseEntity
        if (content.includes('extends BaseEntity')) {
            console.log(`  ✅ Already using BaseEntity`);
            return;
        }
        
        // Thêm import BaseEntity nếu chưa có
        if (!content.includes('BaseEntity')) {
            const importMatch = content.match(/import.*from ['"]@nestjs\/mongoose['"];?\s*\n/);
            if (importMatch) {
                const importStatement = `import { BaseEntity } from 'src/common/entities/base.entity';\n`;
                content = content.replace(
                    importMatch[0], 
                    importMatch[0] + importStatement
                );
            }
        }
        
        // Thay thế Document import
        content = content.replace(
            /import { ([^}]*), Document([^}]*) } from 'mongoose';/,
            'import { $1$2 } from \'mongoose\';'
        );
        
        // Thay thế Schema decorator và class definition
        content = content.replace(
            /@Schema\(\s*{\s*timestamps:\s*true\s*}\s*\)\s*\nexport class (\w+) extends Document/g,
            '@Schema()\nexport class $1 extends BaseEntity'
        );
        
        // Thay thế trường hợp không có timestamps
        content = content.replace(
            /@Schema\(\s*\)\s*\nexport class (\w+) extends Document/g,
            '@Schema()\nexport class $1 extends BaseEntity'
        );
        
        fs.writeFileSync(fullPath, content);
        console.log(`  ✅ Updated successfully`);
        
    } catch (error) {
        console.log(`  ❌ Error: ${error.message}`);
    }
});

console.log('✅ All entity files updated!');