const controller = require('../api/controllers/logs.controller');
const { requireLogin } = require('../helpers/security');

module.exports = function registrar(router) {
    router.get('/logs', requireLogin, controller.getLogs);
};
