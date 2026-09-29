const express = require('express');
const { COMMAND_PREFIXES, executeCommand } = require('../services/localCommandService');

const router = express.Router();
const supportedCommands = new Set([...COMMAND_PREFIXES, 'uni']);

router.get('/', (req, res) => {
  res.json({
    status: 'ok',
    api: 'BaiBai Official Bot Local OpenAPI',
    version: '2.0.0',
    commands: [...supportedCommands]
  });
});

router.get('/:command', async (req, res, next) => {
  try {
    const command = String(req.params.command || '').toLowerCase();
    if (!supportedCommands.has(command)) {
      return res.status(404).json({ status: 'error', message: '不支持的命令' });
    }

    let content = String(req.query.content || '');
    try {
      content = decodeURIComponent(content);
    } catch (_) {
      // Express 已解码时直接使用原值。
    }

    const result = await executeCommand(command, content, {
      userId: req.query.from || '0',
      userName: req.query.name || `OPENAPI-${req.query.from || '0'}`,
      groupId: req.query.group || req.query.groupid || 'global',
      groupName: req.query.groupName || '',
      canManageQa: false
    });
    return res.status(result.status === 'error' ? 400 : 200).json(result);
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
