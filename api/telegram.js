const { json, allowOptions } = require('./_lib/common');

module.exports = async function handler(req, res) {
  if (allowOptions(req, res)) return;
  return json(res, { success: true, message: 'Mensagem recebida.' });
};
