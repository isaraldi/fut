const apresentar = require('../../helpers/apresentar');
const service = require('../services/configuracoes.service');

function postConfiguracoesSalvar(req, res, next) {
    try { return apresentar(res, service.postConfiguracoesSalvar({ body: req.body, params: req.params, query: req.query, usuario: req.session.usuario })); }
    catch (erro) { return next(erro); }
}

function getElencoConfig(req, res, next) {
    try { return apresentar(res, service.getElencoConfig({ body: req.body, params: req.params, query: req.query, usuario: req.session.usuario })); }
    catch (erro) { return next(erro); }
}

function postElencoConfigSincronizar(req, res, next) {
    try { return apresentar(res, service.postElencoConfigSincronizar({ body: req.body, params: req.params, query: req.query, usuario: req.session.usuario })); }
    catch (erro) { return next(erro); }
}

function postElencoConfig(req, res, next) {
    try { return apresentar(res, service.postElencoConfig({ body: req.body, params: req.params, query: req.query, usuario: req.session.usuario })); }
    catch (erro) { return next(erro); }
}

function getJogoConfig(req, res, next) {
    try { return apresentar(res, service.getJogoConfig({ body: req.body, params: req.params, query: req.query, usuario: req.session.usuario })); }
    catch (erro) { return next(erro); }
}

function postJogoConfig(req, res, next) {
    try { return apresentar(res, service.postJogoConfig({ body: req.body, params: req.params, query: req.query, usuario: req.session.usuario })); }
    catch (erro) { return next(erro); }
}

function postJogoConfigTimes(req, res, next) {
    try { return apresentar(res, service.postJogoConfigTimes({ body: req.body, params: req.params, query: req.query, usuario: req.session.usuario })); }
    catch (erro) { return next(erro); }
}

function getEnqueteConfig(req, res, next) {
    try { return apresentar(res, service.getEnqueteConfig({ body: req.body, params: req.params, query: req.query, usuario: req.session.usuario })); }
    catch (erro) { return next(erro); }
}

function postEnqueteConfigAuto(req, res, next) {
    try { return apresentar(res, service.postEnqueteConfigAuto({ body: req.body, params: req.params, query: req.query, usuario: req.session.usuario })); }
    catch (erro) { return next(erro); }
}

function postEnqueteConfigEnviarAgora(req, res, next) {
    try { return apresentar(res, service.postEnqueteConfigEnviarAgora({ body: req.body, params: req.params, query: req.query, usuario: req.session.usuario })); }
    catch (erro) { return next(erro); }
}

function postEnqueteConfigTitulo(req, res, next) {
    try { return apresentar(res, service.postEnqueteConfigTitulo({ body: req.body, params: req.params, query: req.query, usuario: req.session.usuario })); }
    catch (erro) { return next(erro); }
}

function postEnqueteConfigOpcoes(req, res, next) {
    try { return apresentar(res, service.postEnqueteConfigOpcoes({ body: req.body, params: req.params, query: req.query, usuario: req.session.usuario })); }
    catch (erro) { return next(erro); }
}

function postEnqueteConfigOpcoesId(req, res, next) {
    try { return apresentar(res, service.postEnqueteConfigOpcoesId({ body: req.body, params: req.params, query: req.query, usuario: req.session.usuario })); }
    catch (erro) { return next(erro); }
}

function postEnqueteConfigOpcoesIdExcluir(req, res, next) {
    try { return apresentar(res, service.postEnqueteConfigOpcoesIdExcluir({ body: req.body, params: req.params, query: req.query, usuario: req.session.usuario })); }
    catch (erro) { return next(erro); }
}

function getConfiguracoesAparencia(req, res, next) {
    try { return apresentar(res, service.getConfiguracoesAparencia({ body: req.body, params: req.params, query: req.query, usuario: req.session.usuario })); }
    catch (erro) { return next(erro); }
}

function postConfiguracoesAparenciaLogoRemover(req, res, next) {
    try { return apresentar(res, service.postConfiguracoesAparenciaLogoRemover({ body: req.body, params: req.params, query: req.query, usuario: req.session.usuario })); }
    catch (erro) { return next(erro); }
}

module.exports = { postConfiguracoesSalvar, getElencoConfig, postElencoConfigSincronizar, postElencoConfig, getJogoConfig, postJogoConfig, postJogoConfigTimes, getEnqueteConfig, postEnqueteConfigAuto, postEnqueteConfigEnviarAgora, postEnqueteConfigTitulo, postEnqueteConfigOpcoes, postEnqueteConfigOpcoesId, postEnqueteConfigOpcoesIdExcluir, getConfiguracoesAparencia, postConfiguracoesAparenciaLogoRemover };
