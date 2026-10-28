const apresentar = require('../../helpers/apresentar');
const service = require('../services/jogos.service');

function getConfirmados(req, res, next) {
    try { return apresentar(res, service.getConfirmados({ body: req.body, params: req.params, query: req.query, usuario: req.session.usuario })); }
    catch (erro) { return next(erro); }
}

function getJogoAtual(req, res, next) {
    try { return apresentar(res, service.getJogoAtual({ body: req.body, params: req.params, query: req.query, usuario: req.session.usuario })); }
    catch (erro) { return next(erro); }
}

function postConfirmadosEnviarLista(req, res, next) {
    try { return apresentar(res, service.postConfirmadosEnviarLista({ body: req.body, params: req.params, query: req.query, usuario: req.session.usuario })); }
    catch (erro) { return next(erro); }
}

function getHome(req, res, next) {
    try { return apresentar(res, service.getHome({ body: req.body, params: req.params, query: req.query, usuario: req.session.usuario })); }
    catch (erro) { return next(erro); }
}

function getJogos(req, res, next) {
    try { return apresentar(res, service.getJogos({ body: req.body, params: req.params, query: req.query, usuario: req.session.usuario })); }
    catch (erro) { return next(erro); }
}

function getJogosId(req, res, next) {
    try { return apresentar(res, service.getJogosId({ body: req.body, params: req.params, query: req.query, usuario: req.session.usuario })); }
    catch (erro) { return next(erro); }
}

function postJogosIdExcluir(req, res, next) {
    try { return apresentar(res, service.postJogosIdExcluir({ body: req.body, params: req.params, query: req.query, usuario: req.session.usuario })); }
    catch (erro) { return next(erro); }
}

function postJogosIdConfirmar(req, res, next) {
    try { return apresentar(res, service.postJogosIdConfirmar({ body: req.body, params: req.params, query: req.query, usuario: req.session.usuario })); }
    catch (erro) { return next(erro); }
}

function postJogosIdConfirmarJogadorIdRemover(req, res, next) {
    try { return apresentar(res, service.postJogosIdConfirmarJogadorIdRemover({ body: req.body, params: req.params, query: req.query, usuario: req.session.usuario })); }
    catch (erro) { return next(erro); }
}

function getTimes(req, res, next) {
    try { return apresentar(res, service.getTimes({ body: req.body, params: req.params, query: req.query, usuario: req.session.usuario })); }
    catch (erro) { return next(erro); }
}

function postTimesAusentes(req, res, next) {
    try { return apresentar(res, service.postTimesAusentes({ body: req.body, params: req.params, query: req.query, usuario: req.session.usuario })); }
    catch (erro) { return next(erro); }
}

function postTimesEnviar(req, res, next) {
    try { return apresentar(res, service.postTimesEnviar({ body: req.body, params: req.params, query: req.query, usuario: req.session.usuario })); }
    catch (erro) { return next(erro); }
}

function getVotacao(req, res, next) {
    try { return apresentar(res, service.getVotacao({ body: req.body, params: req.params, query: req.query, usuario: req.session.usuario })); }
    catch (erro) { return next(erro); }
}

function getVotacaoId(req, res, next) {
    try { return apresentar(res, service.getVotacaoId({ body: req.body, params: req.params, query: req.query, usuario: req.session.usuario })); }
    catch (erro) { return next(erro); }
}

function postVotacaoIdAvaliar(req, res, next) {
    try { return apresentar(res, service.postVotacaoIdAvaliar({ body: req.body, params: req.params, query: req.query, usuario: req.session.usuario })); }
    catch (erro) { return next(erro); }
}

module.exports = { getConfirmados, getJogoAtual, postConfirmadosEnviarLista, getHome, getJogos, getJogosId, postJogosIdExcluir, postJogosIdConfirmar, postJogosIdConfirmarJogadorIdRemover, getTimes, postTimesAusentes, postTimesEnviar, getVotacao, getVotacaoId, postVotacaoIdAvaliar };
