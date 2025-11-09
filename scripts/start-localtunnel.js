/**
 * Localtunnel Script
 * Tự động tạo tunnel để expose local server ra internet
 * Dùng cho PayOS webhook testing
 * 
 * URL mặc định: https://payoslong.loca.lt
 */

const localtunnel = require('localtunnel');

const PORT = process.env.PORT || 3000;
// Đảm bảo subdomain luôn là 'payoslong' để URL không thay đổi
const SUBDOMAIN = 'payoslong';
const EXPECTED_URL = `https://${SUBDOMAIN}.loca.lt`;

console.log('🔗 Starting Localtunnel...');
console.log(`   Port: ${PORT}`);
console.log(`   Subdomain: ${SUBDOMAIN} (fixed)`);
console.log(`   Expected URL: ${EXPECTED_URL}`);

const tunnel = localtunnel(PORT, {
  subdomain: SUBDOMAIN,
}, (err, tunnel) => {
  if (err) {
    console.error('\n❌ Localtunnel error:', err.message);
    if (err.message.includes('subdomain') || err.message.includes('taken')) {
      console.error('\n⚠️  Subdomain "payoslong" đã được sử dụng!');
      console.error('   Có thể do:');
      console.error('   1. Bạn đang chạy tunnel ở terminal khác');
      console.error('   2. Người khác đang dùng subdomain này');
      console.error('\n   Giải pháp:');
      console.error('   - Đóng tất cả terminal đang chạy tunnel');
      console.error('   - Đợi vài phút rồi thử lại');
      console.error('   - Hoặc dùng subdomain khác (sửa SUBDOMAIN trong script)');
    }
    process.exit(1);
  }

  const url = tunnel.url;
  
  // Kiểm tra URL có đúng như mong đợi không
  if (url !== EXPECTED_URL) {
    console.warn(`\n⚠️  Warning: URL không khớp!`);
    console.warn(`   Expected: ${EXPECTED_URL}`);
    console.warn(`   Got: ${url}`);
    console.warn(`   Sử dụng URL mới này hoặc kiểm tra lại subdomain.\n`);
  }

  console.log('\n✅ Localtunnel is running!');
  console.log(`   Public URL: ${url}`);
  console.log(`   Webhook URL: ${url}/transactions/payos/webhook`);
  console.log(`\n   📋 Copy webhook URL này vào PayOS Dashboard:`);
  console.log(`   ${url}/transactions/payos/webhook`);
  console.log('\n   Press Ctrl+C to stop\n');
});

tunnel.on('close', () => {
  console.log('⚠️  Localtunnel closed');
});

tunnel.on('error', (err) => {
  console.error('❌ Localtunnel error:', err.message);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down Localtunnel...');
  tunnel.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Shutting down Localtunnel...');
  tunnel.close();
  process.exit(0);
});

