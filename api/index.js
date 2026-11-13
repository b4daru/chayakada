// /api  – all site actions (chat, reactions, memes, scores, admin). Logic lives in ../lib/core.js
const core = require('../lib/core');
module.exports = (req, res) => core.handle(req, res);
