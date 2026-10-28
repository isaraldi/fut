const controller = require('../api/controllers/auth.controller');
const { requireLogin } = require('../helpers/security');

module.exports = function registrar(router) {
    router.get('/login', controller.getLogin);
    router.get('/usuarios', requireLogin, controller.getUsuarios);
    router.post('/usuarios', requireLogin, controller.postUsuarios);
    router.post('/usuarios/:id/excluir', requireLogin, controller.postUsuariosIdExcluir);
};
