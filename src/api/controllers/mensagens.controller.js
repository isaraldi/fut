const apresentar = require('../../helpers/apresentar');
const service = require('../services/mensagens.service');

function getMensagens(req, res, next) {
    try { return apresentar(res, service.getMensagens({ body: req.body, params: req.params, query: req.query, usuario: req.session.usuario })); }
    catch (erro) { return next(erro); }
}

function postMensagensJogadoras(req, res, next) {
    try { return apresentar(res, service.postMensagensJogadoras({ body: req.body, params: req.params, query: req.query, usuario: req.session.usuario })); }
    catch (erro) { return next(erro); }
}

function getMensagensAutomaticas(req, res, next) {
    try { return apresentar(res, service.getMensagensAutomaticas({ body: req.body, params: req.params, query: req.query, usuario: req.session.usuario })); }
    catch (erro) { return next(erro); }
}

function postMensagensListaConfirmada(req, res, next) {
    try { return apresentar(res, service.postMensagensListaConfirmada({ body: req.body, params: req.params, query: req.query, usuario: req.session.usuario })); }
    catch (erro) { return next(erro); }
}

function postMensagensListaAtual(req, res, next) {
    try { return apresentar(res, service.postMensagensListaAtual({ body: req.body, params: req.params, query: req.query, usuario: req.session.usuario })); }
    catch (erro) { return next(erro); }
}

function postMensagensListaEspera(req, res, next) {
    try { return apresentar(res, service.postMensagensListaEspera({ body: req.body, params: req.params, query: req.query, usuario: req.session.usuario })); }
    catch (erro) { return next(erro); }
}

function postMensagensTimes(req, res, next) {
    try { return apresentar(res, service.postMensagensTimes({ body: req.body, params: req.params, query: req.query, usuario: req.session.usuario })); }
    catch (erro) { return next(erro); }
}

function postMensagens(req, res, next) {
    try { return apresentar(res, service.postMensagens({ body: req.body, params: req.params, query: req.query, usuario: req.session.usuario })); }
    catch (erro) { return next(erro); }
}

function postMensagensIdEditar(req, res, next) {
    try { return apresentar(res, service.postMensagensIdEditar({ body: req.body, params: req.params, query: req.query, usuario: req.session.usuario })); }
    catch (erro) { return next(erro); }
}

function postMensagensIdExcluir(req, res, next) {
    try { return apresentar(res, service.postMensagensIdExcluir({ body: req.body, params: req.params, query: req.query, usuario: req.session.usuario })); }
    catch (erro) { return next(erro); }
}

module.exports = { getMensagens, postMensagensJogadoras, getMensagensAutomaticas, postMensagensListaConfirmada, postMensagensListaAtual, postMensagensListaEspera, postMensagensTimes, postMensagens, postMensagensIdEditar, postMensagensIdExcluir };
