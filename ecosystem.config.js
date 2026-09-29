const path = require('path');

module.exports = {
  apps: [
    {
      name: 'baibai-official-bot',
      script: 'src/index.js',
      cwd: __dirname,
      exec_mode: 'fork',
      autorestart: true,
      merge_logs: false,
      out_file: path.join(__dirname, 'logs', 'baibai-official-bot-out.log'),
      error_file: path.join(__dirname, 'logs', 'baibai-official-bot-error.log'),
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
