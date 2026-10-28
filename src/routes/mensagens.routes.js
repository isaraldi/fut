const controller = require('../api/controllers/mensagens.controller');
const { requireLogin } = require('../helpers/security');

module.exports = function registrar(router) {
    router.get('/mensagens', requireLogin, controller.getMensagens);
    router.post('/mensagens/jogadoras', requireLogin, controller.postMensagensJogadoras);
    router.get('/mensagens/automaticas', requireLogin, controller.getMensagensAutomaticas);
    router.post('/mensagens/lista-confirmada', requireLogin, controller.postMensagensListaConfirmada);
    router.post('/mensagens/lista-atual', requireLogin, controller.postMensagensListaAtual);
    router.post('/mensagens/lista-espera', requireLogin, controller.postMensagensListaEspera);
    router.post('/mensagens/times', requireLogin, controller.postMensagensTimes);
    router.post('/mensagens', requireLogin, controller.postMensagens);
    router.post('/mensagens/:id/editar', requireLogin, controller.postMensagensIdEditar);
    router.post('/mensagens/:id/excluir', requireLogin, controller.postMensagensIdExcluir);
};
