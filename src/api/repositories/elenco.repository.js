const db = require('../../loaders/database');

function getElencoConsulta1() {
    return db.prepare('SELECT * FROM jogadores WHERE ativo = 1 ORDER BY nome ASC');
}

function getElencoInativosConsulta2() {
    return db.prepare('SELECT * FROM jogadores WHERE ativo = 0 ORDER BY nome ASC');
}

function postElencoConsulta3() {
    return db.prepare('INSERT INTO jogadores (nome, telefone, nivel, papel, posicao) VALUES (?, ?, ?, ?, ?)');
}

function postElencoSalvarTodasConsulta4() {
    return db.prepare('SELECT id FROM jogadores WHERE id = ?');
}

function postElencoSalvarTodasConsulta5() {
    return db.prepare('UPDATE jogadores SET nome = ?, telefone = ?, nivel = ?, posicao = ? WHERE id = ?');
}

function postElencoIdExcluirConsulta6() {
    return db.prepare('DELETE FROM jogadores WHERE id = ?');
}

function postComandosIdToggleConsulta7() {
    return db.prepare('SELECT pode_comandar FROM jogadores WHERE id = ?');
}

module.exports = {
    getElencoConsulta1,
    getElencoInativosConsulta2,
    postElencoConsulta3,
    postElencoSalvarTodasConsulta4,
    postElencoSalvarTodasConsulta5,
    postElencoIdExcluirConsulta6,
    postComandosIdToggleConsulta7
};
