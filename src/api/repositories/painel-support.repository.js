const db = require('../../loaders/database');

function carregarVotosAgrupadosConsulta1() {
    return db.prepare(`SELECT j.id AS jogador_id, v.opcao, v.votado_em, j.nome, j.papel, j.nivel
             FROM votos v
             JOIN jogadores j ON j.id = v.jogador_id
             WHERE v.enquete_id = ?
             ORDER BY v.votado_em ASC`);
}

function salvarJogadoraConsulta2() {
    return db.prepare('SELECT id FROM jogadores WHERE id = ? AND ativo = 1');
}

function salvarJogadoraConsulta3() {
    return db.prepare('UPDATE jogadores SET nome = ?, telefone = ?, nivel = ?, posicao = ? WHERE id = ?');
}

function ajustarParticipacaoMensalConsulta4() {
    return db.prepare('SELECT papel FROM jogadores WHERE id = ? AND ativo = 1');
}

module.exports = {
    carregarVotosAgrupadosConsulta1,
    salvarJogadoraConsulta2,
    salvarJogadoraConsulta3,
    ajustarParticipacaoMensalConsulta4
};
