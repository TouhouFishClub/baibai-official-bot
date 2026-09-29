/**
 * 管理员认证路由
 * 处理管理员登录、token验证等认证相关功能
 */

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { generateToken, verifyToken } = require('../middlewares/authMiddleware');

// 从环境变量读取管理员账户配置
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ADMIN_DISPLAY_NAME = process.env.ADMIN_DISPLAY_NAME || '系统管理员';
const ADMIN_ROLE = process.env.ADMIN_ROLE || 'admin';

// 动态生成管理员账户配置
let ADMIN_ACCOUNTS = [];

// 初始化管理员账户的函数
async function initializeAdminAccounts() {
    if (ADMIN_ACCOUNTS.length === 0) {
        if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
            throw new Error('未配置ADMIN_USERNAME或ADMIN_PASSWORD');
        }
        try {
            const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, 10);
            
            ADMIN_ACCOUNTS = [{
                username: ADMIN_USERNAME,
                password: hashedPassword,
                role: ADMIN_ROLE,
                displayName: ADMIN_DISPLAY_NAME
            }];
            
            console.log(`✅ 管理员账户初始化完成: ${ADMIN_USERNAME}`);
        } catch (error) {
            console.error('❌ 管理员账户初始化失败:', error.message);
            throw error;
        }
    }
}

/**
 * 管理员登录
 * POST /admin/login
 * Body: { username, password }
 */
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({
                success: false,
                message: '用户名和密码不能为空',
                error: 'MISSING_CREDENTIALS'
            });
        }

        // 确保管理员账户已初始化
        await initializeAdminAccounts();

        // 查找用户
        const user = ADMIN_ACCOUNTS.find(acc => acc.username === username);
        if (!user) {
            return res.status(401).json({
                success: false,
                message: '用户名或密码错误',
                error: 'INVALID_CREDENTIALS'
            });
        }

        // 验证密码
        const isValidPassword = await bcrypt.compare(password, user.password);
        if (!isValidPassword) {
            return res.status(401).json({
                success: false,
                message: '用户名或密码错误',
                error: 'INVALID_CREDENTIALS'
            });
        }

        // 生成JWT token
        const token = generateToken({
            username: user.username,
            role: user.role,
            displayName: user.displayName
        });

        res.json({
            success: true,
            message: '登录成功',
            data: {
                token,
                user: {
                    username: user.username,
                    role: user.role,
                    displayName: user.displayName
                }
            }
        });

    } catch (error) {
        console.error('登录失败:', error.message);
        res.status(500).json({
            success: false,
            message: '登录失败，请稍后重试',
            error: error.message
        });
    }
});

/**
 * 验证token
 * POST /admin/verify-token
 * Headers: Authorization: Bearer TOKEN
 */
router.post('/verify-token', async (req, res) => {
    try {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];

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

        // 确保管理员账户已初始化
        await initializeAdminAccounts();

        res.json({
            success: true,
            message: 'token验证成功',
            data: {
                username: decoded.username,
                role: decoded.role,
                displayName: decoded.displayName
            }
        });

    } catch (error) {
        console.error('token验证失败:', error.message);
        res.status(500).json({
            success: false,
            message: 'token验证失败',
            error: error.message
        });
    }
});

/**
 * 获取当前用户信息
 * GET /admin/profile
 * Headers: Authorization: Bearer TOKEN
 */
router.get('/profile', async (req, res) => {
    try {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];

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

        // 确保管理员账户已初始化
        await initializeAdminAccounts();

        res.json({
            success: true,
            message: '获取用户信息成功',
            data: {
                username: decoded.username,
                role: decoded.role,
                displayName: decoded.displayName
            }
        });

    } catch (error) {
        console.error('获取用户信息失败:', error.message);
        res.status(500).json({
            success: false,
            message: '获取用户信息失败',
            error: error.message
        });
    }
});

/**
 * 退出登录
 * POST /admin/logout
 * Headers: Authorization: Bearer TOKEN
 */
router.post('/logout', (req, res) => {
    // 由于JWT是无状态的，服务端不需要做特殊处理
    // 客户端需要删除本地存储的token
    res.json({
        success: true,
        message: '退出登录成功'
    });
});

module.exports = router;
