const controller = require('../api/controllers/mensal.controller');
const { requireLogin } = require('../helpers/security');

module.exports = function registrar(router) {
    router.get('/pagamentos/mensalistas', requireLogin, controller.getPagamentosMensalistas);
    router.post('/pagamentos/mensalistas/:jogadorId/toggle', requireLogin, controller.postPagamentosMensalistasJogadorIdToggle);
    router.get('/mensal/jogadoras/:id/historico', requireLogin, controller.getMensalJogadorasIdHistorico);
    router.get('/mensal', requireLogin, controller.getMensal);
    router.post('/mensal/jogadoras/:id/participacao', requireLogin, controller.postMensalJogadorasIdParticipacao);
    router.post('/mensal/adicionar', requireLogin, controller.postMensalAdicionar);
    router.post(['/mensal/:id/aprovar', '/mensagens/mensal/:id/aprovar'], requireLogin, controller.postMensalIdAprovar);
    router.post('/mensagens/fechamento-mensal', requireLogin, controller.postMensagensFechamentoMensal);
};
