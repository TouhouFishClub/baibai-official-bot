/**
 * 图片处理工具
 * 提供图片压缩、格式转换等功能
 */

const fs = require('fs');
const path = require('path');
const logger = require('./logger');

// 尝试加载sharp，如果失败则使用降级模式
let sharp = null;
let sharpAvailable = false;

try {
  sharp = require('sharp');
  sharpAvailable = true;
  logger.service('Sharp图片处理库已加载，支持图片压缩功能');
} catch (error) {
  logger.warn('Sharp图片处理库未安装，图片压缩功能将被禁用');
  logger.info('如需启用图片压缩，请运行: npm install sharp');
}

/**
 * 图片压缩配置 - 优化为高质量保真压缩
 */
const COMPRESSION_CONFIG = {
  // 目标文件大小 - 1.6MB以下，最佳平衡点
  TARGET_FILE_SIZE: 1.4 * 1024 * 1024,  // 1.4MB目标
  MAX_FILE_SIZE: 1.6 * 1024 * 1024,     // 1.6MB硬限制
  // 最大宽度 - 2560px (更宽松，支持2K+)
  MAX_WIDTH: 2560,
  // 最大高度 - 16000px (支持更长截图)
  MAX_HEIGHT: 16000,
  // 最大总像素数 - 1500万像素 (平衡质量和性能)
  MAX_TOTAL_PIXELS: 15 * 1024 * 1024,
  // 长宽比限制 - 最大20:1 (更宽松)
  MAX_ASPECT_RATIO: 20,
  // JPEG质量 - 提高质量等级
  JPEG_QUALITY_HIGH: 90,      // 高质量
  JPEG_QUALITY_MEDIUM: 80,    // 中等质量  
  JPEG_QUALITY_LOW: 70,       // 低质量（保底）
  // PNG压缩级别
  PNG_COMPRESSION: 7,         // 平衡压缩
  // WebP质量
  WEBP_QUALITY: 85,
  // 启用渐进式JPEG
  PROGRESSIVE_JPEG: true,
  // PNG优化选项
  PNG_OPTIMIZE: true,
  // 是否保留元数据
  KEEP_METADATA: false
};

/**
 * 检查文件是否需要压缩
 * @param {string} filePath - 文件路径
 * @returns {Promise<boolean>} 是否需要压缩
 */
async function needsCompression(filePath) {
  try {
    const stats = fs.statSync(filePath);
    const fileSizeBytes = stats.size;
    const fileSizeMB = fileSizeBytes / 1024 / 1024;
    
    logger.debug(`图片文件大小: ${fileSizeMB.toFixed(2)}MB`);
    
    // 文件大小检查 - 目标1.6MB以下
    if (fileSizeBytes > COMPRESSION_CONFIG.MAX_FILE_SIZE) {
      logger.info(`图片超过1.6MB限制，需要压缩 (${fileSizeMB.toFixed(2)}MB)`);
      return true;
    }
    
    // 对于接近1.6MB的文件也进行预防性优化
    if (fileSizeMB > 1.2) {
      logger.debug(`图片接近1.6MB，预防性压缩 (${fileSizeMB.toFixed(2)}MB)`);
      return true;
    }
    
    // 对于中等大小文件检查像素数优化潜力
    if (fileSizeMB > 0.8) {
      logger.debug(`图片较大，检查优化潜力 (${fileSizeMB.toFixed(2)}MB)`);
      return true;
    }
    
    // 如果sharp可用，检查图片尺寸和像素数
    if (sharpAvailable) {
      try {
        const metadata = await sharp(filePath).metadata();
        const totalPixels = metadata.width * metadata.height;
        const aspectRatio = Math.max(metadata.width / metadata.height, metadata.height / metadata.width);
        
        logger.debug(`图片尺寸: ${metadata.width}x${metadata.height}, 像素: ${(totalPixels / 1024 / 1024).toFixed(1)}M`);
        
        // 检查总像素数（主要限制因素）
        if (totalPixels > COMPRESSION_CONFIG.MAX_TOTAL_PIXELS) {
          logger.debug(`图片像素过多，需要优化 (${(totalPixels / 1024 / 1024).toFixed(1)}M像素)`);
          return true;
        }
        
        // 检查单边尺寸（防止极端情况）
        if (metadata.width > COMPRESSION_CONFIG.MAX_WIDTH) {
          logger.debug(`图片宽度过大，需要优化 (${metadata.width}px)`);
          return true;
        }
        
        if (metadata.height > COMPRESSION_CONFIG.MAX_HEIGHT) {
          logger.debug(`图片高度过大，需要优化 (${metadata.height}px)`);
          return true;
        }
        
        // 检查长宽比（防止过于极端的长条图）
        if (aspectRatio > COMPRESSION_CONFIG.MAX_ASPECT_RATIO) {
          logger.debug(`图片长宽比过大，需要优化 (${aspectRatio.toFixed(1)}:1)`);
          return true;
        }
        
        // 针对长条图的特殊检查 - 适度优化以确保上传成功
        if (metadata.height > 12000 && totalPixels > 12 * 1024 * 1024) {
          logger.debug(`长条图检测，建议适度压缩 (${metadata.height}px高)`);
          return true;
        }
        
      } catch (sharpError) {
        logger.warn('无法获取图片尺寸信息', sharpError.message);
      }
    }
    
    return false;
  } catch (error) {
    logger.error('检查图片是否需要压缩失败', error.message);
    return false;
  }
}

/**
 * 根据原始文件大小和目标大小动态调整压缩质量
 * @param {number} originalSizeMB - 原始文件大小(MB)
 * @param {string} format - 图片格式
 * @param {number} targetPixels - 目标像素数
 * @returns {object} 动态压缩配置
 */
function getDynamicCompressionConfig(originalSizeMB, format, targetPixels) {
  let quality, compressionLevel;
  
  // 根据原始大小和压缩需求动态调整
  const compressionRatio = originalSizeMB / 1.4; // 目标1.4MB
  
  if (compressionRatio <= 1.5) {
    // 轻度压缩：保持高质量
    quality = COMPRESSION_CONFIG.JPEG_QUALITY_HIGH;
    compressionLevel = 6;
  } else if (compressionRatio <= 3) {
    // 中度压缩：平衡质量和大小
    quality = COMPRESSION_CONFIG.JPEG_QUALITY_MEDIUM;
    compressionLevel = 8;
  } else if (compressionRatio <= 6) {
    // 重度压缩：优先大小
    quality = COMPRESSION_CONFIG.JPEG_QUALITY_LOW;
    compressionLevel = 9;
  } else {
    // 极重压缩：保底设置
    quality = 55;
    compressionLevel = 9;
  }
  
  // 对于长条图，适当提高质量以保持可读性
  if (targetPixels && targetPixels > 5 * 1024 * 1024) {
    quality = Math.min(quality + 10, 90);
    logger.debug(`长条图质量补偿: 质量提升到${quality}`);
  }
  
  logger.debug(`智能质量设置: ${originalSizeMB.toFixed(1)}MB (压缩比${compressionRatio.toFixed(1)}x) -> ${format}质量${quality}`);
  
  return { quality, compressionLevel };
}

/**
 * 压缩图片
 * @param {string} inputPath - 输入文件路径
 * @param {string} outputPath - 输出文件路径
 * @returns {Promise<boolean>} 压缩是否成功
 */
async function compressImage(inputPath, outputPath) {
  if (!sharpAvailable) {
    logger.warn('Sharp未安装，无法压缩图片，直接复制原文件');
    if (inputPath !== outputPath) {
      fs.copyFileSync(inputPath, outputPath);
    }
    return true;
  }
  
  try {
    logger.debug(`开始高质量压缩图片: ${inputPath} -> ${outputPath}`);
    
    const image = sharp(inputPath);
    const metadata = await image.metadata();
    const originalSizeMB = fs.statSync(inputPath).size / 1024 / 1024;
    
    logger.debug(`原始图片信息: ${metadata.width}x${metadata.height}, 格式: ${metadata.format}, 大小: ${originalSizeMB.toFixed(2)}MB`);
    
    // 获取动态压缩配置
    const targetPixels = metadata.width * metadata.height;
    const dynamicConfig = getDynamicCompressionConfig(originalSizeMB, metadata.format, targetPixels);
    
    let pipeline = image;
    
    // 智能尺寸调整策略
    let needResize = false;
    let newWidth = metadata.width;
    let newHeight = metadata.height;
    const totalPixels = metadata.width * metadata.height;
    const aspectRatio = Math.max(metadata.width / metadata.height, metadata.height / metadata.width);
    
    logger.debug(`分析图片: ${metadata.width}x${metadata.height}, 像素${(totalPixels/1024/1024).toFixed(1)}M, 长宽比${aspectRatio.toFixed(1)}:1`);
    
    // 策略1: 基于总像素数的智能缩放
    if (totalPixels > COMPRESSION_CONFIG.MAX_TOTAL_PIXELS) {
      needResize = true;
      const pixelRatio = Math.sqrt(COMPRESSION_CONFIG.MAX_TOTAL_PIXELS / totalPixels);
      newWidth = Math.round(metadata.width * pixelRatio);
      newHeight = Math.round(metadata.height * pixelRatio);
      logger.debug(`基于像素数缩放: 比例${(pixelRatio*100).toFixed(1)}% -> ${newWidth}x${newHeight}`);
    }
    // 策略2: 单边尺寸限制（但保持长宽比）
    else if (metadata.width > COMPRESSION_CONFIG.MAX_WIDTH || metadata.height > COMPRESSION_CONFIG.MAX_HEIGHT) {
      needResize = true;
      const widthRatio = COMPRESSION_CONFIG.MAX_WIDTH / metadata.width;
      const heightRatio = COMPRESSION_CONFIG.MAX_HEIGHT / metadata.height;
      const ratio = Math.min(widthRatio, heightRatio);
      
      newWidth = Math.round(metadata.width * ratio);
      newHeight = Math.round(metadata.height * ratio);
      logger.debug(`基于尺寸限制缩放: 比例${(ratio*100).toFixed(1)}% -> ${newWidth}x${newHeight}`);
    }
    // 策略2.5: 长条图特殊处理 - 压缩到1.6MB以下
    else if (metadata.height > 10000 && originalSizeMB > 1.4) {
      needResize = true;
      // 对于长条图，适度缩小以确保1.6MB以下
      const targetPixels = Math.min(9 * 1024 * 1024, COMPRESSION_CONFIG.MAX_TOTAL_PIXELS); // 目标900万像素
      const pixelRatio = Math.sqrt(targetPixels / totalPixels);
      newWidth = Math.round(metadata.width * pixelRatio);
      newHeight = Math.round(metadata.height * pixelRatio);
      logger.debug(`长条图优化: 比例${(pixelRatio*100).toFixed(1)}% -> ${newWidth}x${newHeight} (目标1.6MB以下)`);
    }
    // 策略2.6: 对于需要压缩到1.6MB以下的图片
    else if (originalSizeMB > 1.6) {
      needResize = true;
      // 根据文件大小估算需要的像素减少比例
      const sizeRatio = 1.4 / originalSizeMB; // 目标1.4MB
      const estimatedPixelRatio = Math.sqrt(sizeRatio * 0.8); // 适度估计
      const targetPixels = Math.round(totalPixels * estimatedPixelRatio);
      const pixelRatio = Math.sqrt(targetPixels / totalPixels);
      
      newWidth = Math.round(metadata.width * pixelRatio);
      newHeight = Math.round(metadata.height * pixelRatio);
      logger.debug(`压缩优化: 目标${(targetPixels/1024/1024).toFixed(1)}M像素, 比例${(pixelRatio*100).toFixed(1)}% -> ${newWidth}x${newHeight}`);
    }
    // 策略3: 极端长宽比处理
    else if (aspectRatio > COMPRESSION_CONFIG.MAX_ASPECT_RATIO) {
      needResize = true;
      // 对于长条图，适度缩小较长的一边
      if (metadata.height > metadata.width) {
        // 竖长图：限制高度，保持宽度
        const maxAllowedHeight = metadata.width * COMPRESSION_CONFIG.MAX_ASPECT_RATIO;
        if (metadata.height > maxAllowedHeight) {
          const ratio = maxAllowedHeight / metadata.height;
          newWidth = Math.round(metadata.width * ratio);
          newHeight = Math.round(metadata.height * ratio);
          logger.debug(`长条图优化: 限制高度比例${(ratio*100).toFixed(1)}% -> ${newWidth}x${newHeight}`);
        }
      } else {
        // 横长图：限制宽度，保持高度
        const maxAllowedWidth = metadata.height * COMPRESSION_CONFIG.MAX_ASPECT_RATIO;
        if (metadata.width > maxAllowedWidth) {
          const ratio = maxAllowedWidth / metadata.width;
          newWidth = Math.round(metadata.width * ratio);
          newHeight = Math.round(metadata.height * ratio);
          logger.debug(`宽条图优化: 限制宽度比例${(ratio*100).toFixed(1)}% -> ${newWidth}x${newHeight}`);
        }
      }
    }
    
    // 执行尺寸调整
    if (needResize) {
      pipeline = pipeline.resize({
        width: newWidth,
        height: newHeight,
        fit: 'inside',
        withoutEnlargement: true,
        // 使用高质量的重采样算法
        kernel: sharp.kernel.lanczos3
      });
      
      const finalPixels = newWidth * newHeight;
      const reductionRatio = ((totalPixels - finalPixels) / totalPixels * 100).toFixed(1);
      logger.debug(`尺寸调整完成: ${metadata.width}x${metadata.height} -> ${newWidth}x${newHeight} (像素减少${reductionRatio}%)`);
    } else {
      logger.debug(`图片尺寸合适，无需调整: ${metadata.width}x${metadata.height}`);
    }
    
    // 根据原始格式和文件大小选择最佳压缩方式
    switch (metadata.format) {
      case 'jpeg':
      case 'jpg':
        pipeline = pipeline.jpeg({
          quality: dynamicConfig.quality,
          progressive: COMPRESSION_CONFIG.PROGRESSIVE_JPEG,
          mozjpeg: true,
          // 高质量色度子采样
          chromaSubsampling: '4:4:4',
          // 优化霍夫曼表
          optimiseScans: true,
          // 保留更多细节
          trellisQuantisation: true,
          overshootDeringing: true,
          // 保持更多色彩信息
          optimiseCoding: true
        });
        logger.debug(`JPEG压缩设置: 质量${dynamicConfig.quality}, 4:4:4子采样`);
        break;
        
      case 'png':
        // PNG特殊处理：小文件尝试无损，大文件适度压缩
        const pngOptions = {
          compressionLevel: dynamicConfig.compressionLevel,
          progressive: true,
          palette: COMPRESSION_CONFIG.PNG_OPTIMIZE,
          effort: 10
        };
        
        // 小文件尝试保持完全无损
        if (originalSizeMB <= 3) {
          pngOptions.quality = 100;
          pngOptions.compressionLevel = Math.min(dynamicConfig.compressionLevel, 4);
          logger.debug(`PNG无损压缩: 级别${pngOptions.compressionLevel}`);
        } else {
          pngOptions.quality = 95;
          logger.debug(`PNG高质量压缩: 级别${dynamicConfig.compressionLevel}, 质量95`);
        }
        
        pipeline = pipeline.png(pngOptions);
        break;
        
      case 'webp':
        // WebP：小文件接近无损，大文件高质量
        const webpQuality = originalSizeMB <= 3 ? 98 : dynamicConfig.quality;
        pipeline = pipeline.webp({
          quality: webpQuality,
          lossless: originalSizeMB <= 1, // 1MB以下尝试无损
          effort: 6,
          alphaQuality: 100,
          // 保持更多细节
          smartSubsample: false
        });
        logger.debug(`WebP压缩设置: 质量${webpQuality}, 无损${originalSizeMB <= 1}`);
        break;
        
      default:
        // 对于其他格式，使用动态质量JPEG
        pipeline = pipeline.jpeg({
          quality: dynamicConfig.quality,
          progressive: COMPRESSION_CONFIG.PROGRESSIVE_JPEG,
          mozjpeg: true,
          chromaSubsampling: '4:4:4',
          optimiseScans: true,
          trellisQuantisation: true,
          overshootDeringing: true,
          optimiseCoding: true
        });
        logger.debug(`未知格式 ${metadata.format}，转换为高质量JPEG (质量${dynamicConfig.quality})`);
        break;
    }
    
    // 保存压缩后的图片
    await pipeline.toFile(outputPath);
    
    const compressedSize = fs.statSync(outputPath).size;
    const originalSize = fs.statSync(inputPath).size;
    const compressionRatio = ((originalSize - compressedSize) / originalSize * 100).toFixed(1);
    const compressedSizeMB = compressedSize / 1024 / 1024;
    
    logger.debug(`图片压缩完成: ${compressedSizeMB.toFixed(2)}MB (压缩率: ${compressionRatio}%)`);
    
    // 文件大小检查 - 目标1.6MB以下
    if (compressedSizeMB > 1.6) {
      logger.debug(`文件仍超过1.6MB (${compressedSizeMB.toFixed(2)}MB)，启动二次压缩...`);
      
      let attempts = 0;
      let currentSize = compressedSizeMB;
      
      while (currentSize > 1.6 && attempts < 2) {
        attempts++;
        logger.debug(`第${attempts}次二次压缩 (当前${currentSize.toFixed(2)}MB)...`);
        
        try {
          const secondaryImage = sharp(outputPath);
          const secondaryMeta = await secondaryImage.metadata();
          
          // 计算需要的压缩比例
          const targetSizeMB = 1.3; // 目标1.3MB，留有余量
          const sizeReductionRatio = targetSizeMB / currentSize;
          const pixelReductionRatio = Math.sqrt(sizeReductionRatio * 0.8); // 适度估计
          
          const finalWidth = Math.max(300, Math.round(secondaryMeta.width * pixelReductionRatio));
          const finalHeight = Math.max(300, Math.round(secondaryMeta.height * pixelReductionRatio));
          
          // 动态调整质量
          let quality = 78 - (attempts - 1) * 8; // 78, 70
          quality = Math.max(quality, 65); // 最低65质量
          
          await secondaryImage
            .resize(finalWidth, finalHeight, {
              fit: 'inside',
              withoutEnlargement: true,
              kernel: sharp.kernel.lanczos3
            })
            .jpeg({ 
              quality: quality, 
              progressive: true, 
              mozjpeg: true,
              chromaSubsampling: '4:4:4' // 保持高质量子采样
            })
            .toFile(outputPath + '.temp');
            
          // 替换原文件
          fs.renameSync(outputPath + '.temp', outputPath);
          
          currentSize = fs.statSync(outputPath).size / 1024 / 1024;
          logger.debug(`第${attempts}次压缩完成: ${finalWidth}x${finalHeight}, 质量${quality}, 大小${currentSize.toFixed(2)}MB`);
          
        } catch (secondaryError) {
          logger.error(`第${attempts}次压缩失败`, secondaryError.message);
          break;
        }
      }
      
      if (currentSize > 1.6) {
        logger.warn(`警告: 经过${attempts}次压缩，文件仍为${currentSize.toFixed(2)}MB，可能影响上传`);
      } else {
        logger.debug(`✅ 成功压缩到1.6MB以下: ${currentSize.toFixed(2)}MB`);
      }
    } else {
      logger.debug(`✅ 压缩成功，文件大小: ${compressedSizeMB.toFixed(2)}MB (< 1.6MB)`);
    }
    
    return true;
  } catch (error) {
    logger.error('图片压缩失败', error.message);
    return false;
  }
}

/**
 * 处理图片 - 如果需要则压缩，否则直接复制
 * @param {string} inputPath - 输入文件路径
 * @param {string} outputPath - 输出文件路径
 * @returns {Promise<boolean>} 处理是否成功
 */
async function processImage(inputPath, outputPath) {
  try {
    // 检查是否需要压缩
    const needsComp = await needsCompression(inputPath);
    
    if (needsComp) {
      // 需要压缩
      return await compressImage(inputPath, outputPath);
    } else {
      // 不需要压缩，直接复制
      if (inputPath !== outputPath) {
        fs.copyFileSync(inputPath, outputPath);
        logger.debug(`图片无需压缩，直接复制`);
      }
      return true;
    }
  } catch (error) {
    logger.error('图片处理失败', error.message);
    return false;
  }
}

/**
 * 从base64数据创建并处理图片
 * @param {string} base64Data - base64图片数据
 * @param {string} outputPath - 输出文件路径
 * @returns {Promise<boolean>} 处理是否成功
 */
async function processBase64Image(base64Data, outputPath) {
  try {
    // 创建临时文件
    const tempPath = outputPath + '.temp';
    
    // 解码base64并保存到临时文件
    const imageBuffer = Buffer.from(base64Data, 'base64');
    fs.writeFileSync(tempPath, imageBuffer);
    
    logger.debug(`从base64创建临时图片: ${tempPath}`);
    
    // 处理图片
    const success = await processImage(tempPath, outputPath);
    
    // 清理临时文件
    if (fs.existsSync(tempPath) && tempPath !== outputPath) {
      fs.unlinkSync(tempPath);
      logger.debug(`清理临时文件: ${tempPath}`);
    }
    
    return success;
  } catch (error) {
    logger.error('处理base64图片失败', error.message);
    return false;
  }
}

/**
 * 获取图片信息
 * @param {string} filePath - 文件路径
 * @returns {Promise<object>} 图片信息
 */
async function getImageInfo(filePath) {
  try {
    const stats = fs.statSync(filePath);
    const result = {
      size: stats.size,
      sizeKB: Math.round(stats.size / 1024),
      sizeMB: Math.round(stats.size / 1024 / 1024 * 100) / 100
    };
    
    if (sharpAvailable) {
      try {
        const metadata = await sharp(filePath).metadata();
        result.width = metadata.width;
        result.height = metadata.height;
        result.format = metadata.format;
      } catch (sharpError) {
        logger.warn('无法获取图片尺寸信息', sharpError.message);
        result.width = '未知';
        result.height = '未知';
        result.format = '未知';
      }
    } else {
      result.width = '未知';
      result.height = '未知';
      result.format = '未知';
    }
    
    return result;
  } catch (error) {
    logger.error('获取图片信息失败', error.message);
    return null;
  }
}

module.exports = {
  needsCompression,
  compressImage,
  processImage,
  processBase64Image,
  getImageInfo,
  COMPRESSION_CONFIG
};

