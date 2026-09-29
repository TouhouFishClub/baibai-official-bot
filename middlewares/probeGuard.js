/**
 * 拦截常见漏洞扫描 / SSRF / 敏感文件探测，直接 404 且不写访问日志。
 */

const PROBE_PATH = new RegExp(
  [
    // SSRF 常见入口
    '^/(fetch|proxy)(?:/|\\?|$)',
    // 环境变量与密钥文件
    '(?:^|/)(?:\\.env(?:\\.|$|/)|env\\.js$|secrets?(?:\\.|$)|credentials)',
    '\\.(?:env|pem|key|tfstate|tfvars)(?:\\.|$)',
    // 云厂商与 CI 凭证
    '(?:^|/)\\.(?:aws|azure|gcloud|gcp|kube|docker|ssh|git|svn|aws_creds)(?:/|$)',
    '(?:^|/)(?:id_rsa|id_dsa|id_ecdsa|id_ed25519|rootkey\\.csv|service[-_]?account)',
    '(?:^|/)(?:phpinfo|wp-config|wp-json|actuator|telescope|horizon|_profiler|_debugbar|__clockwork|_ignition)',
    '(?:^|/)(?:terraform\\.tfstate|docker-compose|serverless\\.ya?ml|Jenkinsfile|azure-pipelines)',
    '(?:^|/)\\.(?:github|circleci|travis\\.yml|drone\\.yml|netrc|pypirc|bash_history|bashrc|zshrc|profile)(?:/|$)',
    '(?:^|/)(?:debug\\.log|error_log|error\\.log|dump\\.sql|backup\\.sql|database\\.sql)(?:$|\\?)',
    // 调试 / 状态页
    '(?:^|/)(?:server-status|server-info|nginx_status|elmah|trace\\.axd|__debug__)(?:/|\\?|$)'
  ].join('|'),
  'i'
);

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isProbeRequest(req) {
  const raw = `${req.originalUrl || req.url || ''}`;
  const decoded = safeDecode(raw).replace(/\\/g, '/');
  const pathOnly = safeDecode((req.path || decoded.split('?')[0] || '')).replace(/\\/g, '/');

  if (pathOnly.includes('..')) {
    return true;
  }

  // file://、云元数据、内网地址（SSRF）
  if (
    /file:\s*\/\//i.test(decoded) ||
    /169\.254\.(?:169\.254|170\.2)/.test(decoded) ||
    (
      /(?:localhost|127\.0\.0\.1|0\.0\.0\.0|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+)/i.test(decoded) &&
      /[?&]url=/.test(decoded)
    )
  ) {
    return true;
  }

  if (/[?&]cmd=/.test(decoded)) {
    return true;
  }

  return PROBE_PATH.test(pathOnly);
}

function probeGuard(req, res, next) {
  if (!isProbeRequest(req)) {
    return next();
  }

  res.status(404).json({ error: '未找到请求的资源' });
}

module.exports = probeGuard;
module.exports.isProbeRequest = isProbeRequest;
