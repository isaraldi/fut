const db = require('../../loaders/database');

function getJogoAtualConsulta1() {
    return db.prepare('SELECT * FROM enquetes ORDER BY id DESC LIMIT 1');
}

function getJogoAtualConsulta2() {
    return db.prepare('SELECT id, nome, papel FROM jogadores WHERE ativo = 1 ORDER BY nome ASC');
}

function postConfirmadosEnviarListaConsulta3() {
    return db.prepare('SELECT * FROM enquetes ORDER BY id DESC LIMIT 1');
}

function getConsulta4() {
    return db.prepare('SELECT * FROM enquetes ORDER BY id DESC LIMIT 1');
}

function getConsulta5() {
    return db.prepare(`SELECT COUNT(j.id) AS devem,
        COALESCE(SUM(CASE WHEN p.pago = 1 THEN 1 ELSE 0 END), 0) AS pagos
        FROM jogadores j LEFT JOIN pagamentos p ON p.jogador_id = j.id AND p.mes_referencia = ?
        WHERE j.papel = 'mensalista'`);
}

function getConsulta6() {
    return db.prepare('SELECT pago FROM pagamentos_avulsos WHERE jogador_id = ? AND enquete_id = ?');
}

function getConsulta7() {
    return db.prepare(`SELECT COUNT(*) AS total,
        COALESCE(SUM(CASE WHEN papel = 'mensalista' THEN 1 ELSE 0 END), 0) AS mensalistas
        FROM jogadores WHERE ativo = 1`);
}

function getConsulta8() {
    return db.prepare('SELECT * FROM enquetes ORDER BY id DESC LIMIT 5');
}

function getJogosConsulta9() {
    return db.prepare(`SELECT e.*,
        (SELECT COUNT(*) FROM votos v WHERE v.enquete_id = e.id AND v.papel IS NOT NULL) AS confirmacoes,
        (SELECT COUNT(*) FROM votos v WHERE v.enquete_id = e.id) AS total_respostas,
        (SELECT COUNT(*) FROM avaliacoes a WHERE a.enquete_id = e.id) AS total_avaliacoes
        FROM enquetes e ORDER BY e.id DESC`);
}

function getJogosIdConsulta10() {
    return db.prepare('SELECT * FROM enquetes WHERE id = ?');
}

function getJogosIdConsulta11() {
    return db.prepare('SELECT id, nome, papel FROM jogadores ORDER BY nome ASC');
}

function getJogosIdConsulta12() {
    return db.prepare(`SELECT j.id, j.nome, COUNT(*) AS quantidade, AVG(a.nota) AS media
        FROM avaliacoes a JOIN jogadores j ON j.id = a.jogador_id
        WHERE a.enquete_id = ? GROUP BY j.id ORDER BY j.nome COLLATE NOCASE`);
}

function getJogosIdConsulta13() {
    return db.prepare(`SELECT COUNT(*) AS notas, COUNT(DISTINCT avaliador_id) AS avaliadoras
        FROM avaliacoes WHERE enquete_id = ?`);
}

function getJogosIdConsulta14() {
    return db.prepare('SELECT id FROM enquetes ORDER BY id DESC LIMIT 1');
}

function postJogosIdExcluirConsulta15() {
    return db.prepare('DELETE FROM enquetes WHERE id = ?');
}

function postJogosIdConfirmarConsulta16() {
    return db.prepare('SELECT id FROM enquetes WHERE id = ?');
}

function postJogosIdConfirmarConsulta17() {
    return db.prepare('SELECT id, nome, papel FROM jogadores WHERE id = ?');
}

function postJogosIdConfirmarConsulta18() {
    return db.prepare(`INSERT INTO votos (enquete_id, jogador_id, opcao, papel)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(enquete_id, jogador_id) DO UPDATE SET
                 opcao = excluded.opcao,
                 papel = excluded.papel,
                 votado_em = datetime('now'), ordem_manual = NULL`);
}

function postJogosIdConfirmarJogadorIdRemoverConsulta19() {
    return db.prepare('DELETE FROM votos WHERE enquete_id = ? AND jogador_id = ?');
}

function postTimesAusentesConsulta20() {
    return db.prepare('SELECT * FROM enquetes ORDER BY id DESC LIMIT 1');
}

function postTimesEnviarConsulta21() {
    return db.prepare('SELECT * FROM enquetes ORDER BY id DESC LIMIT 1');
}

function getVotacaoConsulta22() {
    return db.prepare('SELECT * FROM enquetes ORDER BY id DESC LIMIT 1');
}

function getVotacaoIdConsulta23() {
    return db.prepare('SELECT * FROM enquetes WHERE id = ?');
}

function jogadoresParaPresencaIa() {
    return db.prepare(`SELECT j.id, j.nome, j.papel, j.ativo, v.papel AS papel_voto
        FROM jogadores j LEFT JOIN votos v ON v.jogador_id = j.id AND v.enquete_id = ?
        WHERE j.ativo = 1 OR v.papel IS NOT NULL ORDER BY j.nome`);
}

module.exports = {
    jogadoresParaPresencaIa,
    getJogoAtualConsulta1,
    getJogoAtualConsulta2,
    postConfirmadosEnviarListaConsulta3,
    getConsulta4,
    getConsulta5,
    getConsulta6,
    getConsulta7,
    getConsulta8,
    getJogosConsulta9,
    getJogosIdConsulta10,
    getJogosIdConsulta11,
    getJogosIdConsulta12,
    getJogosIdConsulta13,
    getJogosIdConsulta14,
    postJogosIdExcluirConsulta15,
    postJogosIdConfirmarConsulta16,
    postJogosIdConfirmarConsulta17,
    postJogosIdConfirmarConsulta18,
    postJogosIdConfirmarJogadorIdRemoverConsulta19,
    postTimesAusentesConsulta20,
    postTimesEnviarConsulta21,
    getVotacaoConsulta22,
    getVotacaoIdConsulta23
};
