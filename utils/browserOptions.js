const fs = require('fs');

function findBrowserExecutable() {
  const configured = process.env.BROWSER_EXECUTABLE_PATH || process.env.PUPPETEER_EXECUTABLE_PATH;
  if (configured) {
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
        '/usr/bin/chromium-browser'
      ];

  return candidates.find((candidate) => candidate && fs.existsSync(candidate));
}

function getBrowserLaunchOptions(extra = {}) {
  const executablePath = findBrowserExecutable();
  return {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu'
    ],
    ...(executablePath ? { executablePath } : {}),
    ...extra
  };
}

module.exports = {
  findBrowserExecutable,
  getBrowserLaunchOptions
};
