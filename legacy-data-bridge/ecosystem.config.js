module.exports = {
  apps: [
    {
      name: 'baibai-legacy-data-bridge',
      script: 'src/index.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      merge_logs: false,
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
