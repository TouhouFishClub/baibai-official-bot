require('dotenv').config();

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} 未配置`);
  return value;
}

function getConfig() {
  return {
    host: process.env.BRIDGE_HOST || '127.0.0.1',
    port: Number(process.env.BRIDGE_PORT || 3100),
    mongoUri: required('MONGODB_URI'),
    mongoDatabase: process.env.MONGODB_DATABASE || 'db_bot',
    secret: required('DATABASE_BRIDGE_SECRET'),
    requestLimit: process.env.BRIDGE_REQUEST_LIMIT || '256kb',
    maxClockSkewMs: Number(process.env.BRIDGE_MAX_CLOCK_SKEW_MS || 60_000)
  };
}

module.exports = { getConfig };
