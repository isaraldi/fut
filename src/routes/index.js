const express = require('express');
const sessao = require('../api/controllers/sessao.controller');
const upload = require('../api/controllers/upload.controller');
const { requireLogin } = require('../helpers/security');

module.exports = function criarRotas() {
    const router = express.Router();
    router.post('/login', sessao.login);
    router.post('/logout', sessao.logout);
    require('./configuracoes.routes')(router);
    require('./auth.routes')(router);
    require('./jogos.routes')(router);
    require('./financeiro.routes')(router);
    require('./mensal.routes')(router);
    require('./elenco.routes')(router);
    require('./mensagens.routes')(router);
    require('./logs.routes')(router);
    router.post('/configuracoes/aparencia/logo', requireLogin, upload);
    return router;
};
