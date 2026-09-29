const { getConfig } = require('./config');
const { getDatabase, closeMongo } = require('./mongo');
const { createApp } = require('./app');

async function start() {
  const config = getConfig();
  const app = createApp({ config, getDatabase });
  const server = app.listen(config.port, config.host, () => {
    console.log(`legacy-data-bridge listening on ${config.host}:${config.port}`);
  });

  const shutdown = async () => {
    server.close(async () => {
      await closeMongo();
      process.exit(0);
    });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  return server;
}

if (require.main === module) {
  start().catch((error) => {
    console.error(`legacy-data-bridge 启动失败: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { start };
