module.exports = async function handler(req, res) {
  res.statusCode = 403;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end('Mídia protegida. Acesse pela galeria VIP após login.');
};
