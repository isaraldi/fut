const apresentar = require('../../helpers/apresentar');
const service = require('../services/elenco.service');

function getElenco(req, res, next) {
    try { return apresentar(res, service.getElenco({ body: req.body, params: req.params, query: req.query, usuario: req.session.usuario })); }
    catch (erro) { return next(erro); }
}

function getElencoInativos(req, res, next) {
    try { return apresentar(res, service.getElencoInativos({ body: req.body, params: req.params, query: req.query, usuario: req.session.usuario })); }
    catch (erro) { return next(erro); }
}

function postElenco(req, res, next) {
    try { return apresentar(res, service.postElenco({ body: req.body, params: req.params, query: req.query, usuario: req.session.usuario })); }
    catch (erro) { return next(erro); }
}

function postElencoIdAtualizar(req, res, next) {
    try { return apresentar(res, service.postElencoIdAtualizar({ body: req.body, params: req.params, query: req.query, usuario: req.session.usuario })); }
    catch (erro) { return next(erro); }
}

function postElencoSalvarTodas(req, res, next) {
    try { return apresentar(res, service.postElencoSalvarTodas({ body: req.body, params: req.params, query: req.query, usuario: req.session.usuario })); }
    catch (erro) { return next(erro); }
}

function postElencoIdExcluir(req, res, next) {
    try { return apresentar(res, service.postElencoIdExcluir({ body: req.body, params: req.params, query: req.query, usuario: req.session.usuario })); }
    catch (erro) { return next(erro); }
}

function postElencoIdReativar(req, res, next) {
    try { return apresentar(res, service.postElencoIdReativar({ body: req.body, params: req.params, query: req.query, usuario: req.session.usuario })); }
    catch (erro) { return next(erro); }
}

function getElencoIdHistorico(req, res, next) {
    try { return apresentar(res, service.getElencoIdHistorico({ body: req.body, params: req.params, query: req.query, usuario: req.session.usuario })); }
    catch (erro) { return next(erro); }
}

function getComandos(req, res, next) {
    try { return apresentar(res, service.getComandos({ body: req.body, params: req.params, query: req.query, usuario: req.session.usuario })); }
    catch (erro) { return next(erro); }
}

function postComandosIdToggle(req, res, next) {
    try { return apresentar(res, service.postComandosIdToggle({ body: req.body, params: req.params, query: req.query, usuario: req.session.usuario })); }
    catch (erro) { return next(erro); }
}

function postComandosGruposIa(req, res, next) {
    try { return apresentar(res, service.postComandosGruposIa({ body: req.body, usuario: req.session.usuario })); }
    catch (erro) { return next(erro); }
}

module.exports = { getElenco, getElencoInativos, postElenco, postElencoIdAtualizar, postElencoSalvarTodas, postElencoIdExcluir, postElencoIdReativar, getElencoIdHistorico, getComandos, postComandosGruposIa, postComandosIdToggle };
