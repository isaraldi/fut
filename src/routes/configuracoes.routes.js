const controller = require('../api/controllers/configuracoes.controller');
const { requireLogin } = require('../helpers/security');

module.exports = function registrar(router) {
    router.post('/configuracoes/salvar', requireLogin, controller.postConfiguracoesSalvar);
    router.get('/elenco/config', requireLogin, controller.getElencoConfig);
    router.post('/elenco/config/sincronizar', requireLogin, controller.postElencoConfigSincronizar);
    router.post('/elenco/config', requireLogin, controller.postElencoConfig);
    router.get('/jogo/config', requireLogin, controller.getJogoConfig);
    router.post('/jogo/config', requireLogin, controller.postJogoConfig);
    router.post('/jogo/config/times', requireLogin, controller.postJogoConfigTimes);
    router.get('/enquete/config', requireLogin, controller.getEnqueteConfig);
    router.post('/enquete/config/auto', requireLogin, controller.postEnqueteConfigAuto);
    router.post('/enquete/config/enviar-agora', requireLogin, controller.postEnqueteConfigEnviarAgora);
    router.post('/enquete/config/titulo', requireLogin, controller.postEnqueteConfigTitulo);
    router.post('/enquete/config/opcoes', requireLogin, controller.postEnqueteConfigOpcoes);
    router.post('/enquete/config/opcoes/:id', requireLogin, controller.postEnqueteConfigOpcoesId);
    router.post('/enquete/config/opcoes/:id/excluir', requireLogin, controller.postEnqueteConfigOpcoesIdExcluir);
    router.get('/configuracoes/aparencia', requireLogin, controller.getConfiguracoesAparencia);
    router.post('/configuracoes/aparencia/logo/remover', requireLogin, controller.postConfiguracoesAparenciaLogoRemover);
};
