const controller = require('../api/controllers/elenco.controller');
const { requireLogin } = require('../helpers/security');

module.exports = function registrar(router) {
    router.get('/elenco', requireLogin, controller.getElenco);
    router.get('/elenco/inativos', requireLogin, controller.getElencoInativos);
    router.post('/elenco', requireLogin, controller.postElenco);
    router.post('/elenco/:id/atualizar', requireLogin, controller.postElencoIdAtualizar);
    router.post('/elenco/salvar-todas', requireLogin, controller.postElencoSalvarTodas);
    router.post('/elenco/:id/excluir', requireLogin, controller.postElencoIdExcluir);
    router.post('/elenco/:id/reativar', requireLogin, controller.postElencoIdReativar);
    router.get('/elenco/:id/historico', requireLogin, controller.getElencoIdHistorico);
    router.get('/comandos', requireLogin, controller.getComandos);
    router.post('/comandos/grupos-ia', requireLogin, controller.postComandosGruposIa);
    router.post('/comandos/:id/toggle', requireLogin, controller.postComandosIdToggle);
};
