/**
 * Sharp图片处理库安装脚本
 * 用于安装图片压缩功能所需的依赖
 */

const { execSync } = require('child_process');
const fs = require('fs');

console.log('🖼️  开始安装Sharp图片处理库...');

try {
  // 检查是否已经安装
  try {
    require('sharp');
    console.log('✅ Sharp已安装，无需重复安装');
    process.exit(0);
  } catch (e) {
    // Sharp未安装，继续安装流程
  }

  console.log('📦 正在安装Sharp...');
  
  // 尝试安装sharp
  execSync('npm install sharp@^0.33.5', { 
    stdio: 'inherit',
    cwd: process.cwd()
  });
  
  console.log('✅ Sharp安装成功！');
  console.log('🎉 图片压缩功能已启用');
  console.log('');
  console.log('现在机器人将自动压缩过大的图片：');
  console.log('  • 最大文件大小: 5MB');
  console.log('  • 最大尺寸: 2048x2048');
  console.log('  • 自动优化JPEG/PNG/WebP格式');
  console.log('');
  
} catch (error) {
  console.error('❌ Sharp安装失败:', error.message);
  console.log('');
  console.log('💡 解决方案：');
  console.log('1. 检查网络连接');
  console.log('2. 尝试使用代理：npm config set proxy http://your-proxy:port');
  console.log('3. 或手动安装：npm install sharp');
  console.log('4. 如果仍有问题，机器人将在降级模式下运行（无压缩功能）');
  console.log('');
  process.exit(1);
}
