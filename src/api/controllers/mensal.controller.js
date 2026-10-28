const apresentar = require('../../helpers/apresentar');
const service = require('../services/mensal.service');

function getPagamentosMensalistas(req, res, next) {
    try { return apresentar(res, service.getPagamentosMensalistas({ body: req.body, params: req.params, query: req.query, usuario: req.session.usuario })); }
    catch (erro) { return next(erro); }
}

function postPagamentosMensalistasJogadorIdToggle(req, res, next) {
    try { return apresentar(res, service.postPagamentosMensalistasJogadorIdToggle({ body: req.body, params: req.params, query: req.query, usuario: req.session.usuario })); }
    catch (erro) { return next(erro); }
}

function getMensalJogadorasIdHistorico(req, res, next) {
    try { return apresentar(res, service.getMensalJogadorasIdHistorico({ body: req.body, params: req.params, query: req.query, usuario: req.session.usuario })); }
    catch (erro) { return next(erro); }
}

function getMensal(req, res, next) {
    try { return apresentar(res, service.getMensal({ body: req.body, params: req.params, query: req.query, usuario: req.session.usuario })); }
    catch (erro) { return next(erro); }
}

function postMensalJogadorasIdParticipacao(req, res, next) {
    try { return apresentar(res, service.postMensalJogadorasIdParticipacao({ body: req.body, params: req.params, query: req.query, usuario: req.session.usuario })); }
    catch (erro) { return next(erro); }
}

function postMensalAdicionar(req, res, next) {
    try { return apresentar(res, service.postMensalAdicionar({ body: req.body, params: req.params, query: req.query, usuario: req.session.usuario })); }
    catch (erro) { return next(erro); }
}

function postMensalIdAprovar(req, res, next) {
    try { return apresentar(res, service.postMensalIdAprovar({ body: req.body, params: req.params, query: req.query, usuario: req.session.usuario })); }
    catch (erro) { return next(erro); }
}

function postMensagensFechamentoMensal(req, res, next) {
    try { return apresentar(res, service.postMensagensFechamentoMensal({ body: req.body, params: req.params, query: req.query, usuario: req.session.usuario })); }
    catch (erro) { return next(erro); }
}

module.exports = { getPagamentosMensalistas, postPagamentosMensalistasJogadorIdToggle, getMensalJogadorasIdHistorico, getMensal, postMensalJogadorasIdParticipacao, postMensalAdicionar, postMensalIdAprovar, postMensagensFechamentoMensal };
