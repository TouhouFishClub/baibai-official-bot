/**
 * 认证中间件
 * 用于验证JWT token和保护API路由
 */

const jwt = require('jsonwebtoken');

function getJwtSecret() {
    if (!process.env.JWT_SECRET) {
        throw new Error('未配置JWT_SECRET环境变量');
    }
    return process.env.JWT_SECRET;
}

/**
 * 生成JWT token
 * @param {Object} payload - token载荷
 * @param {string} expiresIn - 过期时间
 * @returns {string} JWT token
 */
function generateToken(payload, expiresIn = '24h') {
    return jwt.sign(payload, getJwtSecret(), { expiresIn });
}

/**
 * 验证JWT token
 * @param {string} token - JWT token
 * @returns {Object|null} 解码后的payload或null
 */
function verifyToken(token) {
    try {
        return jwt.verify(token, getJwtSecret());
    } catch (error) {
        return null;
    }
}

/**
 * 认证中间件
 * 验证请求头中的Authorization token
 */
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
        return res.status(401).json({
            success: false,
            message: '访问令牌缺失',
            error: 'MISSING_TOKEN'
        });
    }

    const decoded = verifyToken(token);
    if (!decoded) {
        return res.status(401).json({
            success: false,
            message: '访问令牌无效或已过期',
            error: 'INVALID_TOKEN'
        });
    }

    // 将用户信息添加到请求对象中
    req.user = decoded;
    next();
}

/**
 * 可选认证中间件
 * 如果提供了token则验证，否则继续执行
 */
function optionalAuth(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token) {
        const decoded = verifyToken(token);
        if (decoded) {
            req.user = decoded;
        }
    }

    next();
}

module.exports = {
    generateToken,
    verifyToken,
    authenticateToken,
    optionalAuth
};

