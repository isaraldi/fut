const db = require('../../loaders/database');

function postConfiguracoesSalvarConsulta1() {
    return db.prepare('UPDATE enquete_opcoes SET texto = ?, conta = ? WHERE id = ?');
}

function postEnqueteConfigOpcoesConsulta2() {
    return db.prepare('SELECT COALESCE(MAX(ordem), -1) + 1 AS n FROM enquete_opcoes');
}

function postEnqueteConfigOpcoesConsulta3() {
    return db.prepare('INSERT INTO enquete_opcoes (texto, conta, ordem) VALUES (?, ?, ?)');
}

function postEnqueteConfigOpcoesIdConsulta4() {
    return db.prepare('UPDATE enquete_opcoes SET texto = ?, conta = ? WHERE id = ?');
}

function postEnqueteConfigOpcoesIdExcluirConsulta5() {
    return db.prepare('DELETE FROM enquete_opcoes WHERE id = ?');
}

module.exports = {
    postConfiguracoesSalvarConsulta1,
    postEnqueteConfigOpcoesConsulta2,
    postEnqueteConfigOpcoesConsulta3,
    postEnqueteConfigOpcoesIdConsulta4,
    postEnqueteConfigOpcoesIdExcluirConsulta5
};
