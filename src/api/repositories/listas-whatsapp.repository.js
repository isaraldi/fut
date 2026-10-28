const db = require('../../loaders/database');

function contextoConsulta1() {
    return db.prepare('SELECT * FROM enquetes ORDER BY id DESC LIMIT 1');
}

function assinaturaConsulta2() {
    return db.prepare('SELECT * FROM votos WHERE enquete_id = ? ORDER BY jogador_id');
}

function assinaturaConsulta3() {
    return db.prepare('SELECT id, nome, papel, ativo FROM jogadores ORDER BY id');
}

function resolverNomesConsulta4() {
    return db.prepare('SELECT id, nome, papel FROM jogadores');
}

function resolverNomesConsulta5() {
    return db.prepare('SELECT jogador_id, papel FROM votos WHERE enquete_id = ?');
}

function montarPreviaListaConsulta6() {
    return db.prepare('SELECT 1 FROM listas_importacoes WHERE message_id = ?');
}

function montarPreviaListaConsulta7() {
    return db.prepare("UPDATE listas_importacoes SET estado = 'cancelada' WHERE grupo_id = ? AND autor_id = ? AND estado = 'pendente'");
}

function montarPreviaListaConsulta8() {
    return db.prepare("UPDATE listas_importacoes SET estado = 'substituida' WHERE grupo_id = ? AND autor_id = ? AND estado = 'pendente'");
}

function montarPreviaListaConsulta9() {
    return db.prepare('INSERT INTO listas_importacoes (message_id, grupo_id, autor_id, enquete_id, dados, criado_em, expira_em) VALUES (?, ?, ?, ?, ?, ?, ?)');
}

function prepararListaConsulta10() {
    return db.prepare("UPDATE listas_importacoes SET estado = 'cancelada' WHERE grupo_id = ? AND autor_id = ? AND estado = 'pendente'");
}

function confirmarListaConsulta11() {
    return db.prepare("SELECT * FROM listas_importacoes WHERE grupo_id = ? AND autor_id = ? AND estado = 'pendente' ORDER BY criado_em DESC, rowid DESC LIMIT 1");
}

function confirmarListaConsulta12() {
    return db.prepare("INSERT INTO jogadores (nome, papel) VALUES (?, 'avulso')");
}

function confirmarListaConsulta13() {
    return db.prepare('SELECT jogador_id FROM votos WHERE enquete_id = ? AND papel IS NOT NULL');
}

function confirmarListaConsulta14() {
    return db.prepare('DELETE FROM votos WHERE enquete_id = ? AND jogador_id = ?');
}

function confirmarListaConsulta15() {
    return db.prepare(`INSERT INTO votos (enquete_id, jogador_id, opcao, papel, ordem_manual)
                VALUES (?, ?, 'Confirmada por lista no WhatsApp', ?, ?)
                ON CONFLICT(enquete_id, jogador_id) DO UPDATE SET opcao = excluded.opcao, votado_em = CASE WHEN votos.papel IS NULL THEN datetime('now') ELSE votos.votado_em END, papel = excluded.papel, ordem_manual = excluded.ordem_manual`);
}

function confirmarListaConsulta16() {
    return db.prepare("UPDATE listas_importacoes SET estado = 'aplicada' WHERE message_id = ?");
}

function confirmarListaConsulta17() {
    return db.prepare("UPDATE listas_importacoes SET estado = 'substituida' WHERE enquete_id = ? AND estado = 'pendente'");
}

function cancelarListaConsulta18() {
    return db.prepare("UPDATE listas_importacoes SET estado = 'cancelada' WHERE grupo_id = ? AND autor_id = ? AND estado = 'pendente'");
}

module.exports = { contextoConsulta1, assinaturaConsulta2, assinaturaConsulta3, resolverNomesConsulta4, resolverNomesConsulta5, montarPreviaListaConsulta6, montarPreviaListaConsulta7, montarPreviaListaConsulta8, montarPreviaListaConsulta9, prepararListaConsulta10, confirmarListaConsulta11, confirmarListaConsulta12, confirmarListaConsulta13, confirmarListaConsulta14, confirmarListaConsulta15, confirmarListaConsulta16, confirmarListaConsulta17, cancelarListaConsulta18 };
