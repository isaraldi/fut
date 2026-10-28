const apresentar = require('../../helpers/apresentar');
const service = require('../services/auth.service');

function getLogin(req, res, next) {
    try { return apresentar(res, service.getLogin({ body: req.body, params: req.params, query: req.query, usuario: req.session.usuario })); }
    catch (erro) { return next(erro); }
}

function getUsuarios(req, res, next) {
    try { return apresentar(res, service.getUsuarios({ body: req.body, params: req.params, query: req.query, usuario: req.session.usuario })); }
    catch (erro) { return next(erro); }
}

function postUsuarios(req, res, next) {
    try { return apresentar(res, service.postUsuarios({ body: req.body, params: req.params, query: req.query, usuario: req.session.usuario })); }
    catch (erro) { return next(erro); }
}

function postUsuariosIdExcluir(req, res, next) {
    try { return apresentar(res, service.postUsuariosIdExcluir({ body: req.body, params: req.params, query: req.query, usuario: req.session.usuario })); }
    catch (erro) { return next(erro); }
}

module.exports = { getLogin, getUsuarios, postUsuarios, postUsuariosIdExcluir };
