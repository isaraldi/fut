const controller = require('../api/controllers/jogos.controller');
const { requireLogin } = require('../helpers/security');

module.exports = function registrar(router) {
    router.get('/confirmados', requireLogin, controller.getConfirmados);
    router.get('/jogo/atual', requireLogin, controller.getJogoAtual);
    router.post('/confirmados/enviar-lista', requireLogin, controller.postConfirmadosEnviarLista);
    router.get('/', requireLogin, controller.getHome);
    router.get('/jogos', requireLogin, controller.getJogos);
    router.get('/jogos/:id', requireLogin, controller.getJogosId);
    router.post('/jogos/:id/excluir', requireLogin, controller.postJogosIdExcluir);
    router.post('/jogos/:id/confirmar', requireLogin, controller.postJogosIdConfirmar);
    router.post('/jogos/:id/confirmar/:jogadorId/remover', requireLogin, controller.postJogosIdConfirmarJogadorIdRemover);
    router.get('/times', requireLogin, controller.getTimes);
    router.post('/times/ausentes', requireLogin, controller.postTimesAusentes);
    router.post('/times/enviar', requireLogin, controller.postTimesEnviar);
    router.get('/votacao', controller.getVotacao);
    router.get('/votacao/:id', controller.getVotacaoId);
    router.post('/votacao/:id/avaliar', controller.postVotacaoIdAvaliar);
};
