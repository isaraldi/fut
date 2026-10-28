const apresentar = require('../../helpers/apresentar');
const service = require('../services/financeiro.service');

function getPagamentos(req, res, next) {
    try { return apresentar(res, service.getPagamentos({ body: req.body, params: req.params, query: req.query, usuario: req.session.usuario })); }
    catch (erro) { return next(erro); }
}

function getPagamentosAvulsos(req, res, next) {
    try { return apresentar(res, service.getPagamentosAvulsos({ body: req.body, params: req.params, query: req.query, usuario: req.session.usuario })); }
    catch (erro) { return next(erro); }
}

function postPagamentosAvulsosJogadorIdToggle(req, res, next) {
    try { return apresentar(res, service.postPagamentosAvulsosJogadorIdToggle({ body: req.body, params: req.params, query: req.query, usuario: req.session.usuario })); }
    catch (erro) { return next(erro); }
}

function getCaixa(req, res, next) {
    try { return apresentar(res, service.getCaixa({ body: req.body, params: req.params, query: req.query, usuario: req.session.usuario })); }
    catch (erro) { return next(erro); }
}

function postCaixaOperacao(req, res, next) {
    try { return apresentar(res, service.postCaixaOperacao({ body: req.body, params: req.params, query: req.query, usuario: req.session.usuario })); }
    catch (erro) { return next(erro); }
}

module.exports = { getPagamentos, getPagamentosAvulsos, postPagamentosAvulsosJogadorIdToggle, getCaixa, postCaixaOperacao };
