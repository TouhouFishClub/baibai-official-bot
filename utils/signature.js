const nacl = require('tweetnacl');

/**
 * 生成Ed25519密钥对
 * @param {string} secret - 密钥种子
 * @returns {Object} 包含公钥和私钥的对象
 */
function generateKeyPair(secret) {
  let seed = Buffer.from(String(secret || ''), 'utf8');
  if (!seed.length) {
    throw new Error('签名密钥不能为空');
  }
  while (seed.length < 32) {
    seed = Buffer.concat([seed, seed]);
  }
  seed = seed.subarray(0, 32);
  
  const keyPair = nacl.sign.keyPair.fromSeed(new Uint8Array(seed));
  return {
    publicKey: Buffer.from(keyPair.publicKey),
    privateKey: Buffer.from(keyPair.secretKey)
  };
}

/**
 * 生成签名
 * @param {string} secret - 密钥种子
 * @param {string} message - 要签名的消息
 * @returns {string} 十六进制格式的签名
 */
function generateSignature(secret, message) {
  const keyPair = generateKeyPair(secret);
  const signature = nacl.sign.detached(
    new Uint8Array(Buffer.from(message)),
    new Uint8Array(keyPair.privateKey)
  );
  return Buffer.from(signature).toString('hex');
}

/**
 * 验证签名
 * @param {string} secret - 密钥种子
 * @param {string} message - 原始消息
 * @param {string} signature - 十六进制格式的签名
 * @returns {boolean} 签名是否有效
 */
function verifySignature(secret, message, signature) {
  const keyPair = generateKeyPair(secret);
  const signatureBuffer = Buffer.from(signature, 'hex');
  return nacl.sign.detached.verify(
    new Uint8Array(Buffer.from(message)),
    new Uint8Array(signatureBuffer),
    new Uint8Array(keyPair.publicKey)
  );
}

module.exports = {
  generateKeyPair,
  generateSignature,
  verifySignature
}; 