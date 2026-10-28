const db = require('../../loaders/database');

function expressConsulta1() {
    return db.prepare('SELECT COUNT(*) c FROM jogadores WHERE ativo = 0');
}

module.exports = {
    expressConsulta1
};
