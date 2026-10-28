const apresentar = require('../../helpers/apresentar');
const service = require('../services/logs.service');

function getLogs(req, res, next) {
    try { return apresentar(res, service.getLogs({ body: req.body, params: req.params, query: req.query, usuario: req.session.usuario })); }
    catch (erro) { return next(erro); }
}

module.exports = { getLogs };
