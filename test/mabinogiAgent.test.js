const test = require('node:test');
const assert = require('node:assert/strict');

const savedEnv = {};
for (const key of ['LLM_BASE_URL', 'LLM_API_KEY', 'LLM_MODEL', 'LLM_TIMEOUT_MS', 'DATABASE_BRIDGE_URL', 'DATABASE_BRIDGE_SECRET']) {
  savedEnv[key] = process.env[key];
}

process.env.LLM_BASE_URL = 'https://llm.example.test/v1';
process.env.LLM_API_KEY = 'test-key';
process.env.LLM_MODEL = 'test-model';
delete process.env.DATABASE_BRIDGE_URL;
delete process.env.DATABASE_BRIDGE_SECRET;

const { executeInput, deterministicFortune, todayExpertDungeon } = require('../services/localCommandService');
const {
  TOOL_DEFINITIONS,
  asBoolean,
  bridgeMessage,
  chatCompletionsUrl,
  clearAgentTestOverrides,
  combineToolResults,
  executeTool,
  isLlmConfigured,
  isSilentReply,
  normalizeOptionSourceKeyword,
  parseToolCalls,
  runMabinogiAgent,
  setAgentTestOverrides
} = require('../services/mabinogiAgent');

function useOverrides(overrides) {
  setAgentTestOverrides(overrides);
}

test.after(() => {
  clearAgentTestOverrides();
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test('洛奇小助手按模型选择的内部功能直接回复', async (t) => {
  await t.test('模型地址补上 chat/completions', () => {
    assert.equal(
      chatCompletionsUrl('https://chat.intern-ai.org.cn/api/v1/'),
      'https://chat.intern-ai.org.cn/api/v1/chat/completions'
    );
    assert.equal(
      chatCompletionsUrl('https://example.test/v1/chat/completions'),
      'https://example.test/v1/chat/completions'
    );
    assert.equal(isLlmConfigured(), true);
    assert.equal(asBoolean('true'), true);
    assert.equal(asBoolean('false'), false);
    assert.equal(asBoolean(false), false);
  });

  await t.test('无关回复标记会被识别', () => {
    assert.equal(isSilentReply(''), true);
    assert.equal(isSilentReply('NO_REPLY'), true);
    assert.equal(isSilentReply('“NO_REPLY。”'), true);
    assert.equal(isSilentReply('今天的走私还在'), false);
  });

  await t.test('工具参数可以是 JSON 字符串或对象', () => {
    const calls = parseToolCalls({
      tool_calls: [
        { function: { name: 'query_smuggler', arguments: '{"superQuery":false}' } },
        { function: { name: 'query_recipe', arguments: { keyword: '工程手套', detailed: true } } },
        { function: { name: 'query_boss', arguments: '{bad' } },
        ...Array.from({ length: 5 }, () => ({ function: { name: 'query_rua', arguments: '{}' } }))
      ]
    });
    assert.equal(calls.length, 4);
    assert.deepEqual(calls[0], { name: 'query_smuggler', args: { superQuery: false } });
    assert.equal(calls[1].args.keyword, '工程手套');
    assert.deepEqual(calls[2].args, {});
  });

  await t.test('多条工具结果合成一条回复', () => {
    const combined = combineToolResults([
      { type: 'image', path: 'mabi_other/smuggler.png', base64: 'abc' },
      { type: 'text', message: '今天的专家地下城是皮卡地下城' }
    ]);
    assert.equal(combined.type, 'image');
    assert.equal(combined.message, '今天的专家地下城是皮卡地下城');
    assert.equal(bridgeMessage('query_smuggler'), '走私数据库桥接服务暂不可用');
    assert.equal(normalizeOptionSourceKeyword('optw 伦达'), '伦达');
    assert.equal(
      TOOL_DEFINITIONS.some((tool) => tool.function.name === 'query_smuggler'),
      true
    );
  });

  await t.test('本地小功能可以直接执行', async () => {
    const fortune = await executeTool('query_daily_fortune', {}, { userId: 'user-7' });
    assert.equal(fortune.message, deterministicFortune('user-7'));
    const dungeon = await executeTool('query_expert_dungeon', {}, {});
    assert.equal(dungeon.message, todayExpertDungeon());
    const missing = await executeTool('query_recipe', {}, {});
    assert.equal(missing.message, '请提供查询内容');
    const unknown = await executeTool('not_a_tool', {}, {});
    assert.equal(unknown.message, '暂不支持这个查询');
    const smuggler = await executeTool('query_smuggler', { superQuery: 'true' }, {});
    assert.match(smuggler.message, /走私数据库桥接服务暂不可用/);
  });

  await t.test('帮我查一下走私时直接返回查询图', async () => {
    useOverrides({
      async complete(messages, tools) {
        assert.equal(messages.at(-1).content, '帮我查一下走私');
        assert.equal(tools.some((tool) => tool.function.name === 'query_smuggler'), true);
        return {
          choices: [{
            message: {
              tool_calls: [{
                function: {
                  name: 'query_smuggler',
                  arguments: '{"superQuery":false}'
                }
              }]
            }
          }]
        };
      },
      async executeTool(name, args) {
        assert.equal(name, 'query_smuggler');
        assert.equal(args.superQuery, false);
        return { type: 'image', path: 'mabi_other/smuggler.png', base64: 'abc' };
      }
    });
    const result = await executeInput('帮我查一下走私', { userId: 'u', groupId: 'g' });
    assert.equal(result.data.type, 'image');
    assert.equal(result.data.base64, 'abc');
    assert.equal(result.data.path, 'mabi_other/smuggler.png');
    clearAgentTestOverrides();
  });

  await t.test('模型认为无关时不回复', async () => {
    useOverrides({
      async complete() {
        return { choices: [{ message: { content: 'NO_REPLY' } }] };
      }
    });
    const result = await executeInput('哈哈', { userId: 'u', groupId: 'g' });
    assert.equal(result.status, 'ok');
    assert.equal(result.data, null);
    clearAgentTestOverrides();
  });

  await t.test('没有工具可调用时回复模型原文', async () => {
    useOverrides({
      async complete() {
        return {
          choices: [{
            message: { content: [{ type: 'text', text: '走私是把货物运到指定地点。' }] }
          }]
        };
      }
    });
    const result = await runMabinogiAgent('走私是什么意思', {});
    assert.equal(result.data.type, 'text');
    assert.equal(result.data.message, '走私是把货物运到指定地点。');
    clearAgentTestOverrides();
  });

  await t.test('精确命令和已静默的功能不会请求模型', async () => {
    useOverrides({
      async complete() {
        throw new Error('不应该请求模型');
      }
    });
    const expert = await executeInput('今日专家', { userId: 'u', groupId: 'g' });
    assert.match(expert.data.message, /专家地下城/);
    const calendar = await executeInput('测试日历', { userId: 'u', groupId: 'g' });
    assert.equal(calendar.data, null);
    const command = await executeInput('mbi', { userId: 'u', groupId: 'g' });
    assert.equal(command.data.message, '请提供查询内容');
    clearAgentTestOverrides();
  });

  await t.test('模型请求失败时保持不回复', async () => {
    useOverrides({
      async complete() {
        const error = new Error('connect ECONNREFUSED');
        error.code = 'ECONNREFUSED';
        throw error;
      }
    });
    const result = await executeInput('帮我查一下走私', { userId: 'u', groupId: 'g' });
    assert.equal(result.data, null);
    clearAgentTestOverrides();
  });

  await t.test('未配置模型时不请求助手', async () => {
    delete process.env.LLM_API_KEY;
    useOverrides({
      async complete() {
        throw new Error('不应该请求模型');
      }
    });
    try {
      assert.equal(isLlmConfigured(), false);
      const result = await executeInput('帮我查一下走私', { userId: 'u', groupId: 'g' });
      assert.equal(result.data, null);
    } finally {
      process.env.LLM_API_KEY = 'test-key';
      clearAgentTestOverrides();
    }
  });
});
