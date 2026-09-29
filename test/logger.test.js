const test = require('node:test');
const assert = require('node:assert/strict');
const logger = require('../utils/logger');

test('错误日志分流并压缩 Axios 错误对象', () => {
  const normalLines = [];
  const errorLines = [];
  const originalLog = console.log;
  const originalError = console.error;

  console.log = (...args) => normalLines.push(args.join(' '));
  console.error = (...args) => errorLines.push(args.join(' '));

  try {
    const axiosError = new Error('Request failed with status code 500');
    axiosError.name = 'AxiosError';
    axiosError.code = 'ERR_BAD_RESPONSE';
    axiosError.config = {
      method: 'post',
      url: 'https://api.example.test/send?access_token=secret',
      headers: { authorization: 'Bearer secret' }
    };
    axiosError.request = { huge: 'x'.repeat(10000) };
    axiosError.response = {
      status: 500,
      data: { message: 'upstream failed', token: 'secret-token' }
    };

    logger.error('发送消息失败', axiosError);
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }

  assert.equal(normalLines.length, 1);
  assert.match(normalLines[0], /发送消息失败.*详情见错误日志/);
  assert.doesNotMatch(normalLines[0], /AxiosError|secret|request/);

  assert.equal(errorLines.length, 1);
  assert.match(errorLines[0], /ERROR_DETAIL.*AxiosError.*"status":500/);
  assert.match(errorLines[0], /"token":"\[REDACTED\]"/);
  assert.doesNotMatch(errorLines[0], /Bearer secret|access_token=secret|xxxxxxxx/);
  assert.doesNotMatch(errorLines[0], /[\r\n]/);
});
