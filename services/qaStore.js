const fs = require('fs/promises');
const path = require('path');

const storeRoot = path.resolve(
  process.env.QA_STORE_PATH || path.join(__dirname, '..', 'data', 'qa', 'groups')
);
const groupQueues = new Map();

function normalizeId(value, fallback = 'global') {
  const normalized = String(value || fallback);
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(normalized)) {
    throw new Error('无效的群组标识');
  }
  return normalized;
}

function fileForGroup(groupId) {
  return path.join(storeRoot, `${normalizeId(groupId)}.json`);
}

function createEmptyStore(groupId, groupName = '') {
  return {
    schemaVersion: 1,
    groupId: normalizeId(groupId),
    groupName: String(groupName || ''),
    updatedAt: new Date().toISOString(),
    entries: {}
  };
}

async function readStore(groupId, groupName = '') {
  const filePath = fileForGroup(groupId);
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
    if (!parsed || parsed.schemaVersion !== 1 || typeof parsed.entries !== 'object') {
      throw new Error('QA 数据格式无效');
    }
    return parsed;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return createEmptyStore(groupId, groupName);
    }
    throw error;
  }
}

async function atomicWrite(groupId, store) {
  await fs.mkdir(storeRoot, { recursive: true });
  const target = fileForGroup(groupId);
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  store.updatedAt = new Date().toISOString();
  await fs.writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx'
  });
  await fs.rename(temporary, target);
}

function withGroupLock(groupId, operation) {
  const id = normalizeId(groupId);
  const previous = groupQueues.get(id) || Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  groupQueues.set(id, current);
  return current.finally(() => {
    if (groupQueues.get(id) === current) {
      groupQueues.delete(id);
    }
  });
}

async function setAnswer({ groupId, groupName, key, answer, authorId, authorName }) {
  const normalizedKey = String(key || '').trim();
  if (!normalizedKey || normalizedKey.length > 100) {
    throw new Error('关键词长度必须为 1 到 100 个字符');
  }
  if (String(answer || '').length > 4000) {
    throw new Error('回答不能超过 4000 个字符');
  }

  return withGroupLock(groupId, async () => {
    const store = await readStore(groupId, groupName);
    if (!answer) {
      const existed = Boolean(store.entries[normalizedKey]);
      delete store.entries[normalizedKey];
      await atomicWrite(groupId, store);
      return existed ? '关键词已删除' : '未找到该关键词';
    }

    const now = new Date().toISOString();
    const existing = store.entries[normalizedKey];
    store.entries[normalizedKey] = {
      answer: String(answer),
      authorId: String(authorId || ''),
      authorName: String(authorName || ''),
      askCount: existing?.askCount || 0,
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };
    store.groupName = String(groupName || store.groupName || '');
    await atomicWrite(groupId, store);
    return existing ? '关键词已更新' : '关键词已添加';
  });
}

async function getAnswer({ groupId, groupName, key }) {
  const normalizedKey = String(key || '').trim();
  if (!normalizedKey) {
    return null;
  }

  return withGroupLock(groupId, async () => {
    const store = await readStore(groupId, groupName);
    const entry = store.entries[normalizedKey];
    if (!entry) {
      return null;
    }
    entry.askCount = (entry.askCount || 0) + 1;
    await atomicWrite(groupId, store);
    return entry.answer;
  });
}

module.exports = {
  getAnswer,
  setAnswer,
  normalizeId,
  createEmptyStore
};
