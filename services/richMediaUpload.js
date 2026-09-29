const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getAccessToken, qqRequest, QQ_API_ROOT } = require('./messageService');
const logger = require('../utils/logger');

const MD5_10M_SIZE = 10002432;

function responseCode(error) {
  return error?.response?.data?.err_code || error?.response?.data?.code;
}

function isRetryableUploadError(error) {
  const code = responseCode(error);
  const message = String(error?.response?.data?.message || error?.message || '');
  return (
    code === 40093007 ||
    code === 850026 ||
    code === 850019 ||
    code === 40034002 ||
    code === 40093001 ||
    /下载失败|不支持/.test(message)
  );
}

function computeFileHashes(buffer) {
  const md5 = crypto.createHash('md5').update(buffer).digest('hex');
  const sha1 = crypto.createHash('sha1').update(buffer).digest('hex');
  const md5_10m = buffer.length > MD5_10M_SIZE
    ? crypto.createHash('md5').update(buffer.subarray(0, MD5_10M_SIZE)).digest('hex')
    : md5;
  return { md5, sha1, md5_10m };
}

function parseUploadTarget(apiPath) {
  const group = String(apiPath || '').match(/^\/v2\/groups\/([^/]+)\/files$/);
  if (group) {
    return {
      scene: 'group',
      targetId: group[1],
      preparePath: `/v2/groups/${group[1]}/upload_prepare`,
      finishPath: `/v2/groups/${group[1]}/upload_part_finish`,
      completePath: apiPath
    };
  }

  const user = String(apiPath || '').match(/^\/v2\/users\/([^/]+)\/files$/);
  if (user) {
    return {
      scene: 'user',
      targetId: user[1],
      preparePath: `/v2/users/${user[1]}/upload_prepare`,
      finishPath: `/v2/users/${user[1]}/upload_part_finish`,
      completePath: apiPath
    };
  }

  throw new Error(`不支持的富媒体上传路径: ${apiPath}`);
}

function resolvePartOffset(partIndex, minIndex, blockSize) {
  return (Number(partIndex) - Number(minIndex)) * Number(blockSize);
}

async function authorizedPost(apiPath, payload) {
  const accessToken = await getAccessToken();
  return qqRequest(
    'POST',
    `${QQ_API_ROOT}${apiPath}`,
    payload,
    {
      'Content-Type': 'application/json',
      'Authorization': `QQBot ${accessToken}`
    }
  );
}

async function postMediaUpload(apiPath, payload) {
  const response = await authorizedPost(apiPath, payload);
  if (!response.data || !response.data.file_info) {
    throw new Error('上传文件失败，未获取到file_info');
  }
  return response.data.file_info;
}

async function putPresignedPart(url, buffer) {
  await qqRequest('PUT', url, buffer, {
    'Content-Type': 'application/octet-stream',
    'Content-Length': String(buffer.length)
  });
}

async function uploadByChunks(apiPath, { fileType, filePath, fileName } = {}) {
  const target = parseUploadTarget(apiPath);
  const buffer = fs.readFileSync(filePath);
  const hashes = computeFileHashes(buffer);
  const resolvedName = fileName || path.basename(filePath);

  logger.debug('开始分片上传', {
    scene: target.scene,
    fileName: resolvedName,
    bytes: buffer.length
  });

  const prepare = await authorizedPost(target.preparePath, {
    file_type: fileType,
    file_size: String(buffer.length),
    file_name: resolvedName,
    md5: hashes.md5,
    sha1: hashes.sha1,
    md5_10m: hashes.md5_10m
  });

  const prepared = prepare.data || {};
  const uploadId = prepared.upload_id;
  if (!uploadId) {
    throw new Error('预上传失败，未返回 upload_id');
  }

  const blockSize = Number(prepared.block_size || buffer.length);
  const parts = Array.isArray(prepared.parts) ? prepared.parts : [];
  const minIndex = parts.length
    ? Math.min(...parts.map((part) => Number(part.index)))
    : 0;

  for (const part of parts) {
    const offset = resolvePartOffset(part.index, minIndex, blockSize);
    const length = Math.min(Number(part.block_size || blockSize), buffer.length - offset);
    if (offset < 0 || length <= 0) {
      throw new Error(`分片偏移无效: index=${part.index}, offset=${offset}`);
    }

    const chunk = buffer.subarray(offset, offset + length);
    const chunkMd5 = crypto.createHash('md5').update(chunk).digest('hex');
    await putPresignedPart(part.presigned_url, chunk);
    await authorizedPost(target.finishPath, {
      upload_id: uploadId,
      part_index: Number(part.index),
      block_size: String(chunk.length),
      md5: chunkMd5
    });
  }

  return postMediaUpload(target.completePath, {
    file_type: fileType,
    file_name: resolvedName,
    upload_id: uploadId,
    srv_send_msg: false
  });
}

async function uploadRichMedia(apiPath, { fileType, filePath, url, fileName } = {}) {
  const resolvedName = fileName || (filePath ? path.basename(filePath) : undefined);
  const attempts = [];

  if (filePath && fs.existsSync(filePath)) {
    attempts.push({ label: 'chunks', run: () => uploadByChunks(apiPath, { fileType, filePath, fileName: resolvedName }) });
  }

  if (url) {
    attempts.push({
      label: 'url',
      run: () => postMediaUpload(apiPath, {
        file_type: fileType,
        url,
        file_name: resolvedName,
        srv_send_msg: false
      })
    });
  }

  if (!attempts.length) {
    throw new Error('上传文件失败，缺少本地文件或公网 URL');
  }

  let lastError;
  for (let index = 0; index < attempts.length; index += 1) {
    const attempt = attempts[index];
    try {
      logger.debug('开始上传富媒体', {
        apiPath,
        method: attempt.label,
        url,
        fileName: resolvedName
      });
      const fileInfo = await attempt.run();
      logger.debug('文件上传成功', { method: attempt.label });
      return fileInfo;
    } catch (error) {
      lastError = error;
      const canRetry = index < attempts.length - 1 && isRetryableUploadError(error);
      logger.warn('富媒体上传失败', {
        method: attempt.label,
        code: responseCode(error),
        message: error?.response?.data?.message || error.message,
        willRetry: canRetry
      });
      if (!canRetry) {
        throw error;
      }
    }
  }

  throw lastError;
}

module.exports = {
  MD5_10M_SIZE,
  computeFileHashes,
  parseUploadTarget,
  resolvePartOffset,
  uploadRichMedia,
  isRetryableUploadError
};
