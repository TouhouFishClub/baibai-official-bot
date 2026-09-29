const fs = require('fs');

function findBrowserExecutable() {
  const configured = process.env.BROWSER_EXECUTABLE_PATH || process.env.PUPPETEER_EXECUTABLE_PATH;
  if (configured && fs.existsSync(configured)) {
    if (configured === '/snap/bin/chromium') {
      const snapChrome = [
        '/snap/chromium/current/usr/lib/chromium-browser/chrome',
        '/snap/chromium/current/usr/lib/chromium-browser/chromium'
      ].find((candidate) => fs.existsSync(candidate));
      if (snapChrome) {
        return snapChrome;
      }
    }
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
        '/snap/chromium/current/usr/lib/chromium-browser/chrome',
        '/snap/chromium/current/usr/lib/chromium-browser/chromium',
        '/snap/bin/chromium'
      ];

  return candidates.find((candidate) => candidate && fs.existsSync(candidate));
}

function getBrowserLaunchOptions(extra = {}) {
  const executablePath = findBrowserExecutable();
  const { args: extraArgs, ...rest } = extra;
  return {
    headless: true,
    args: [...new Set([
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      ...(extraArgs || [])
    ])],
    ...(executablePath ? { executablePath } : {}),
    ...rest
  };
}

module.exports = {
  findBrowserExecutable,
  getBrowserLaunchOptions
};
