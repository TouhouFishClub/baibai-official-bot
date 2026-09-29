const fs = require('fs');
const path = require('path');

function normalizePath(filePath) {
  return String(filePath || '').replace(/\\/g, '/');
}

function isSnapChromiumElf(filePath) {
  return /\/snap\/chromium\/.+\/chromium-browser\/(chrome|chromium)$/.test(normalizePath(filePath));
}

function isSnapChromiumLauncher(filePath) {
  const normalized = normalizePath(filePath);
  return normalized === '/snap/bin/chromium' || normalized.endsWith('/snap/bin/chromium');
}

function findPuppeteerCachedChrome() {
  const roots = [
    process.env.PUPPETEER_CACHE_DIR,
    process.env.HOME ? path.join(process.env.HOME, '.cache', 'puppeteer') : '',
    path.join('/root', '.cache', 'puppeteer')
  ].filter(Boolean);

  const relativeCandidates = [
    ['chrome-linux64', 'chrome'],
    ['chrome-headless-shell-linux64', 'chrome-headless-shell'],
    ['chrome-linux', 'chrome']
  ];

  for (const root of [...new Set(roots)]) {
    const chromeRoot = path.join(root, 'chrome');
    if (!fs.existsSync(chromeRoot)) {
      continue;
    }

    let versions = [];
    try {
      versions = fs.readdirSync(chromeRoot);
    } catch (_) {
      continue;
    }

    for (const version of versions.reverse()) {
      for (const parts of relativeCandidates) {
        const candidate = path.join(chromeRoot, version, ...parts);
        if (fs.existsSync(candidate) && !isSnapChromiumElf(candidate)) {
          return candidate;
        }
      }
    }
  }

  return undefined;
}

function findBrowserExecutable() {
  const configured = process.env.BROWSER_EXECUTABLE_PATH || process.env.PUPPETEER_EXECUTABLE_PATH;
  if (configured && fs.existsSync(configured) && !isSnapChromiumElf(configured)) {
    return configured;
  }

  const candidates = process.platform === 'win32'
    ? [
        `${process.env.PROGRAMFILES || ''}\\Google\\Chrome\\Application\\chrome.exe`,
        `${process.env['PROGRAMFILES(X86)'] || ''}\\Google\\Chrome\\Application\\chrome.exe`,
        `${process.env.PROGRAMFILES || ''}\\Microsoft\\Edge\\Application\\msedge.exe`,
        `${process.env['PROGRAMFILES(X86)'] || ''}\\Microsoft\\Edge\\Application\\msedge.exe`,
        `${process.env.LOCALAPPDATA || ''}\\Google\\Chrome\\Application\\chrome.exe`
      ]
    : [
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/snap/bin/chromium',
        findPuppeteerCachedChrome()
      ];

  return candidates.find((candidate) => (
    candidate && fs.existsSync(candidate) && !isSnapChromiumElf(candidate)
  ));
}

function getBrowserLaunchOptions(extra = {}) {
  const executablePath = findBrowserExecutable();
  const { args: extraArgs, ...rest } = extra;
  const snapArgs = isSnapChromiumLauncher(executablePath)
    ? ['--no-first-run', '--no-zygote', '--single-process']
    : [];
  return {
    headless: true,
    args: [...new Set([
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      ...snapArgs,
      ...(extraArgs || [])
    ])],
    ...(executablePath ? { executablePath } : {}),
    ...rest
  };
}

module.exports = {
  findBrowserExecutable,
  getBrowserLaunchOptions,
  isSnapChromiumElf,
  isSnapChromiumLauncher
};
