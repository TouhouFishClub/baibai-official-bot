function joinPublicUrl(pathname) {
  const host = String(process.env.SERVER_HOST || 'http://localhost:3000').replace(/\/+$/, '');
  const relative = String(pathname || '').replace(/^\/+/, '');
  return `${host}/${relative}`;
}

module.exports = {
  joinPublicUrl
};
