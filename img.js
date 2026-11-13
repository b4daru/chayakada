// /api/img?id=123  – serves memes uploaded by visitors (stored in Redis)
const core = require('../lib/core');
module.exports = (req, res) => core.handleImg(req, res);
