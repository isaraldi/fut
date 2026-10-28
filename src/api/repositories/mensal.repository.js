const db = require('../../loaders/database');

function getMensalJogadorasIdHistoricoConsulta1() {
    return db.prepare('SELECT * FROM jogadores WHERE id = ?');
}

function getMensalConsulta2() {
    return db.prepare('SELECT id, nome, papel FROM jogadores WHERE ativo = 1 ORDER BY nome COLLATE NOCASE');
}

module.exports = {
    getMensalJogadorasIdHistoricoConsulta1,
    getMensalConsulta2
};
