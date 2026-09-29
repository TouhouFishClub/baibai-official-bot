const test = require('node:test');
const assert = require('node:assert/strict');
const logger = require('../utils/logger');

test('收发消息按通道、事件、会话和用户输出', () => {
  const normalLines = [];
  const originalLog = console.log;
  console.log = (...args) => normalLines.push(args.join(' '));
  const originalLevel = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = 'info';

  try {
    logger.message({
      type: '群',
      eventType: 'GROUP_AT_MESSAGE_CREATE',
      groupId: 'g1',
      userId: 'u1',
      content: '/mbi 释魂'
    });
    logger.reply({
      type: '频道私信',
      groupId: 'guild-1',
      userId: 'u2',
      content: logger.describeReplyPayload({
        type: 'image',
        path: '/tmp/MabiGC.png',
        message: '附言'
      })
    });
  } finally {
    console.log = originalLog;
    if (originalLevel === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = originalLevel;
  }

  assert.equal(normalLines.length, 2);
  assert.match(normalLines[0], /\[群\]\[GROUP_AT_MESSAGE_CREATE\]\[g1\]\[u1\] \/mbi 释魂/);
  assert.match(normalLines[1], /\[频道私信\]\[发送\]\[guild-1\]\[u2\] \[图片\] MabiGC.png 附言/);
});

test('已有群名和成员名时日志带名称和 openid', () => {
  const normalLines = [];
  const originalLog = console.log;
  console.log = (...args) => normalLines.push(args.join(' '));
  const originalLevel = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = 'info';

  try {
    logger.message({
      type: '群',
      eventType: 'GROUP_MESSAGE_CREATE',
      groupId: '7C8467413F22B6981B448E41DC8F1B5D',
      groupName: '群名称',
      userId: '969942F23E62DF96C38CD1FA36566760',
      userName: '成员名',
      content: '暮光继承费用砍半了'
    });
  } finally {
    console.log = originalLog;
    if (originalLevel === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = originalLevel;
  }

  assert.equal(normalLines.length, 1);
  assert.match(
    normalLines[0],
    /\[群\]\[GROUP_MESSAGE_CREATE\]\[群名称\(7C8467413F22B6981B448E41DC8F1B5D\)\]\[成员名\(969942F23E62DF96C38CD1FA36566760\)\] 暮光继承费用砍半了/
  );
});

test('已有频道名和成员名时日志带名称和 id', () => {
  const normalLines = [];
  const originalLog = console.log;
  console.log = (...args) => normalLines.push(args.join(' '));
  const originalLevel = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = 'info';

  try {
    logger.message({
      type: '频道',
      eventType: 'AT_MESSAGE_CREATE',
      groupId: '123456789012345678',
      groupName: '技术交流频道',
      userId: '2823701233424295228',
      userName: '频道昵称',
      content: '/meu 释魂'
    });
  } finally {
    console.log = originalLog;
    if (originalLevel === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = originalLevel;
  }

  assert.equal(normalLines.length, 1);
  assert.match(
    normalLines[0],
    /\[频道\]\[AT_MESSAGE_CREATE\]\[技术交流频道\(123456789012345678\)\]\[频道昵称\(2823701233424295228\)\] \/meu 释魂/
  );
});

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
