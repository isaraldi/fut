const controller = require('../api/controllers/financeiro.controller');
const { requireLogin } = require('../helpers/security');

module.exports = function registrar(router) {
    router.get('/pagamentos', requireLogin, controller.getPagamentos);
    router.get('/pagamentos/avulsos', requireLogin, controller.getPagamentosAvulsos);
    router.post('/pagamentos/avulsos/:jogadorId/toggle', requireLogin, controller.postPagamentosAvulsosJogadorIdToggle);
    router.get('/caixa', requireLogin, controller.getCaixa);
    for (const [rota, operacao] of [['iniciar', 'iniciar'], ['lancamentos', 'lancamentos'], ['lancamentos/:id/cancelar', 'cancelar']]) {
        router.post('/caixa/' + rota, requireLogin, (req, res, next) => { req.params.operacao = operacao; return controller.postCaixaOperacao(req, res, next); });
    }
};
