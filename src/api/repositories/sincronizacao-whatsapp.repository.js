const db = require('../../loaders/database');

function estadoConsulta1() {
    return db.prepare('SELECT * FROM whatsapp_interacoes WHERE tipo = ? AND message_id = ? AND jogador_id = ?');
}

function salvarEstadoConsulta2() {
    return db.prepare(`INSERT INTO whatsapp_interacoes (tipo, message_id, jogador_id, conteudo, evento_em)
            VALUES (?, ?, ?, ?, ?) ON CONFLICT(tipo, message_id, jogador_id)
            DO UPDATE SET conteudo = excluded.conteudo, evento_em = excluded.evento_em`);
}

function jogadorParaConsulta3() {
    return db.prepare('SELECT * FROM jogadores WHERE id = ?');
}

function processarVotoConsulta4() {
    return db.prepare('SELECT * FROM enquetes WHERE message_id = ?');
}

function processarVotoConsulta5() {
    return db.prepare('SELECT fechada_em FROM enquetes WHERE id = ?');
}

function processarVotoConsulta6() {
    return db.prepare('SELECT * FROM votos WHERE enquete_id = ? AND jogador_id = ?');
}

function processarVotoConsulta7() {
    return db.prepare('DELETE FROM votos WHERE enquete_id = ? AND jogador_id = ?');
}

function processarVotoConsulta8() {
    return db.prepare('SELECT papel FROM jogadores WHERE id = ?');
}

function processarVotoConsulta9() {
    return db.prepare(`INSERT INTO votos (enquete_id, jogador_id, opcao, papel, votado_em) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(enquete_id, jogador_id) DO UPDATE SET opcao = excluded.opcao, papel = excluded.papel, votado_em = excluded.votado_em, ordem_manual = NULL`);
}

function consultarConsulta10() {
    return db.prepare('SELECT * FROM enquetes ORDER BY id DESC LIMIT 1');
}

module.exports = { estadoConsulta1, salvarEstadoConsulta2, jogadorParaConsulta3, processarVotoConsulta4, processarVotoConsulta5, processarVotoConsulta6, processarVotoConsulta7, processarVotoConsulta8, processarVotoConsulta9, consultarConsulta10 };
