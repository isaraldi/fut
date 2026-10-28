const db = require('../../loaders/database');

function marcarVotoManualConsulta1() {
    return db.prepare('SELECT message_id FROM enquetes WHERE id = ?');
}

function marcarVotoManualConsulta2() {
    return db.prepare(`INSERT INTO whatsapp_interacoes (tipo, message_id, jogador_id, manual_em)
        VALUES ('voto', ?, ?, ?) ON CONFLICT(tipo, message_id, jogador_id)
        DO UPDATE SET manual_em = excluded.manual_em`);
}

function getConfigConsulta3() {
    return db.prepare('SELECT valor FROM configuracoes WHERE chave = ?');
}

function setConfigConsulta4() {
    return db.prepare(`INSERT INTO configuracoes (chave, valor) VALUES (?, ?)
         ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor`);
}

function registrarLogConsulta5() {
    return db.prepare('INSERT INTO logs (tipo, nivel, mensagem, grupo_id) VALUES (?, ?, ?, ?)');
}

function registrarLogConsulta6() {
    return db.prepare('DELETE FROM logs WHERE id NOT IN (SELECT id FROM logs ORDER BY id DESC LIMIT 1000)');
}

function getLogsConsulta7() {
    return db.prepare(`SELECT l.*, g.nome AS grupo_nome FROM logs l
               LEFT JOIN grupos g ON g.whatsapp_id = l.grupo_id
               WHERE l.tipo = ? ORDER BY l.id DESC LIMIT ? OFFSET ?`);
}

function getLogsConsulta8() {
    return db.prepare(`SELECT l.*, g.nome AS grupo_nome FROM logs l
               LEFT JOIN grupos g ON g.whatsapp_id = l.grupo_id
               ORDER BY l.id DESC LIMIT ? OFFSET ?`);
}

function contarLogsConsulta9() {
    return db.prepare('SELECT COUNT(*) AS c FROM logs WHERE tipo = ?');
}

function contarLogsConsulta10() {
    return db.prepare('SELECT COUNT(*) AS c FROM logs');
}

function criarEnvioImediatoConsulta11() {
    return db.prepare('INSERT INTO envios_imediatos (grupo_id, texto, tipo) VALUES (?, ?, ?)');
}

function getDestinatariasPorPublicoConsulta12() {
    return db.prepare(`SELECT j.id, j.nome, j.whatsapp_id, j.telefone FROM fechamento_mensal_convites c
                 JOIN jogadores j ON j.id = c.jogador_id
                 WHERE c.message_id = ? AND c.resposta = 'sim' AND (c.prioridade = 1 OR c.aprovada = 1) AND j.ativo = 1
                 ORDER BY j.nome`);
}

function getDestinatariasPorPublicoConsulta13() {
    return db.prepare(`SELECT id, nome, whatsapp_id, telefone FROM jogadores
                 WHERE papel = 'mensalista' AND ativo = 1 ORDER BY nome`);
}

function getDestinatariasPorPublicoConsulta14() {
    return db.prepare('SELECT id FROM enquetes ORDER BY id DESC LIMIT 1');
}

function getDestinatariasPorPublicoConsulta15(parte0) {
    return db.prepare(`SELECT id, nome, whatsapp_id, telefone FROM jogadores
                 WHERE id IN (${parte0}) ORDER BY nome`);
}

function enfileirarMensagemJogadoraConsulta16() {
    return db.prepare('INSERT INTO mensagens_jogadoras_pendentes (jogador_id, texto) VALUES (?, ?)');
}

function getMensagensJogadorasPendentesConsulta17() {
    return db.prepare(`SELECT m.id, m.texto, j.nome, j.whatsapp_id, j.telefone
             FROM mensagens_jogadoras_pendentes m JOIN jogadores j ON j.id = m.jogador_id
             ORDER BY m.id ASC`);
}

function removerMensagemJogadoraConsulta18() {
    return db.prepare('DELETE FROM mensagens_jogadoras_pendentes WHERE id = ?');
}

function getEnviosImediatosPendentesConsulta19() {
    return db.prepare('SELECT * FROM envios_imediatos ORDER BY id ASC');
}

function removerEnvioImediatoConsulta20() {
    return db.prepare('DELETE FROM envios_imediatos WHERE id = ?');
}

function fecharEnqueteConsulta21() {
    return db.prepare(`UPDATE enquetes SET fechada_em = datetime('now') WHERE id = ? AND fechada_em IS NULL`);
}

function getEnquetesFechadasNaoDesafixadasConsulta22() {
    return db.prepare('SELECT * FROM enquetes WHERE fechada_em IS NOT NULL AND desafixada_em IS NULL');
}

function marcarEnqueteDesafixadaConsulta23() {
    return db.prepare(`UPDATE enquetes SET desafixada_em = datetime('now') WHERE id = ?`);
}

function registrarTentativaDesafixarConsulta24() {
    return db.prepare('UPDATE enquetes SET tentativas_desafixar = tentativas_desafixar + 1 WHERE id = ?');
}

function upsertGrupoConsulta25() {
    return db.prepare(`INSERT INTO grupos (whatsapp_id, nome, atualizado_em) VALUES (?, ?, datetime('now'))
         ON CONFLICT(whatsapp_id) DO UPDATE SET nome = excluded.nome, atualizado_em = datetime('now')`);
}

function getGruposConsulta26() {
    return db.prepare('SELECT * FROM grupos ORDER BY nome ASC');
}

function getEnqueteOpcoesConsulta27() {
    return db.prepare('SELECT * FROM enquete_opcoes ORDER BY ordem ASC, id ASC');
}

function criarMensagemUnicaConsulta28() {
    return db.prepare(`INSERT INTO mensagens_agendadas (grupo_id, texto, tipo, enviar_em) VALUES (?, ?, 'unica', ?)`);
}

function criarMensagemSemanalConsulta29() {
    return db.prepare(`INSERT INTO mensagens_agendadas (grupo_id, texto, tipo, dia_semana, hora) VALUES (?, ?, 'semanal', ?, ?)`);
}

function getMensagemAgendadaConsulta30() {
    return db.prepare('SELECT * FROM mensagens_agendadas WHERE id = ?');
}

function atualizarMensagemUnicaConsulta31() {
    return db.prepare(`UPDATE mensagens_agendadas
         SET grupo_id = ?, texto = ?, tipo = 'unica', enviar_em = ?,
             dia_semana = NULL, hora = NULL, ultimo_envio = NULL, enviada_em = NULL
         WHERE id = ?`);
}

function atualizarMensagemSemanalConsulta32() {
    return db.prepare(`UPDATE mensagens_agendadas
         SET grupo_id = ?, texto = ?, tipo = 'semanal', dia_semana = ?, hora = ?,
             enviar_em = NULL, ultimo_envio = NULL, enviada_em = NULL
         WHERE id = ?`);
}

function getMensagensAgendadasConsulta33() {
    return db.prepare(`SELECT m.*, g.nome AS grupo_nome
             FROM mensagens_agendadas m
             LEFT JOIN grupos g ON g.whatsapp_id = m.grupo_id
             ORDER BY m.tipo ASC, m.enviar_em DESC, m.dia_semana ASC`);
}

function getMensagensUnicasParaEnviarConsulta34() {
    return db.prepare(`SELECT * FROM mensagens_agendadas
             WHERE tipo = 'unica' AND enviada_em IS NULL AND enviar_em <= ?
             ORDER BY enviar_em ASC`);
}

function getMensagensSemanaisConsulta35() {
    return db.prepare(`SELECT * FROM mensagens_agendadas WHERE tipo = 'semanal'`);
}

function marcarMensagemEnviadaConsulta36() {
    return db.prepare(`UPDATE mensagens_agendadas SET enviada_em = datetime('now') WHERE id = ?`);
}

function marcarMensagemSemanalEnviadaConsulta37() {
    return db.prepare('UPDATE mensagens_agendadas SET ultimo_envio = ? WHERE id = ?');
}

function excluirMensagemAgendadaConsulta38() {
    return db.prepare('DELETE FROM mensagens_agendadas WHERE id = ?');
}

function getMensalistasPagosConsulta39() {
    return db.prepare(`SELECT j.id, j.nome FROM jogadores j
             JOIN pagamentos p ON p.jogador_id = j.id
             WHERE j.papel = 'mensalista' AND p.mes_referencia = ? AND p.pago = 1
             ORDER BY j.nome ASC`);
}

function criarConviteFechamentoMensalConsulta40() {
    return db.prepare('INSERT INTO fechamento_mensal_convites (jogador_id, message_id, mes_anterior) VALUES (?, ?, ?)');
}

function getConviteFechamentoMensalConsulta41() {
    return db.prepare('SELECT * FROM fechamento_mensal_convites WHERE message_id = ? AND jogador_id = ?');
}

function registrarRespostaConviteFechamentoMensalConsulta42() {
    return db.prepare(`UPDATE fechamento_mensal_convites SET resposta = ?, respondido_em = datetime('now') WHERE id = ?`);
}

function criarCicloMensalConsulta43() {
    return db.prepare('INSERT INTO fechamento_mensal_ciclos VALUES (?, ?, ?, ?)');
}

function criarCicloMensalConsulta44() {
    return db.prepare("SELECT id FROM jogadores WHERE papel = 'mensalista' AND ativo = 1");
}

function getCicloMensalAtualConsulta45() {
    return db.prepare('SELECT * FROM fechamento_mensal_ciclos ORDER BY criado_em DESC, rowid DESC LIMIT 1');
}

function expirarRenovacoesMensaisConsulta46() {
    return db.prepare(`SELECT id, jogador_id FROM fechamento_mensal_convites
            WHERE message_id = ? AND prioridade = 1 AND resposta IS NULL`);
}

function expirarRenovacoesMensaisConsulta47() {
    return db.prepare('UPDATE fechamento_mensal_convites SET expirada = 1 WHERE id = ?');
}

function responderChamadaMensalConsulta48() {
    return db.prepare('SELECT * FROM jogadores WHERE id = ? AND ativo = 1');
}

function responderChamadaMensalConsulta49() {
    return db.prepare(`INSERT INTO fechamento_mensal_convites (jogador_id, message_id, mes_anterior, prioridade)
                VALUES (?, ?, ?, 0)`);
}

function responderChamadaMensalConsulta50() {
    return db.prepare('UPDATE fechamento_mensal_convites SET expirada = 0, prioridade = 0 WHERE id = ?');
}

function responderChamadaMensalConsulta51() {
    return db.prepare('SELECT COALESCE(MAX(ordem), 0) + 1 AS n FROM fechamento_mensal_convites');
}

function responderChamadaMensalConsulta52() {
    return db.prepare(`UPDATE fechamento_mensal_convites SET resposta = ?, prioridade = ?, ordem = ?,
            aprovada = 0, expirada = 0, respondido_em = ? WHERE id = ?`);
}

function responderChamadaMensalConsulta53() {
    return db.prepare(`SELECT id FROM fechamento_mensal_convites
                WHERE message_id = ? AND prioridade = 0 AND resposta = 'sim'
                ORDER BY julianday(respondido_em), id`);
}

function responderChamadaMensalConsulta54() {
    return db.prepare('UPDATE fechamento_mensal_convites SET ordem = ? WHERE id = ?');
}

function getResumoMensalConsulta55() {
    return db.prepare(`SELECT c.*, j.nome FROM fechamento_mensal_convites c
        JOIN jogadores j ON j.id = c.jogador_id WHERE c.message_id = ? AND j.ativo = 1
        ORDER BY c.ordem, c.id`);
}

function aprovarInteressadaMensalConsulta56() {
    return db.prepare('UPDATE fechamento_mensal_convites SET aprovada = 1 WHERE id = ?');
}

function definirPapelJogadorConsulta57() {
    return db.prepare('SELECT papel FROM jogadores WHERE id = ?');
}

function definirPapelJogadorConsulta58() {
    return db.prepare('UPDATE jogadores SET papel = ? WHERE id = ?');
}

function getJogadorPorWhatsappIdConsulta59() {
    return db.prepare('SELECT * FROM jogadores WHERE whatsapp_id = ?');
}

function podeUsarComandosConsulta60() {
    return db.prepare('SELECT pode_comandar FROM jogadores WHERE whatsapp_id = ?');
}

function getJogadoresParaPermissaoConsulta61() {
    return db.prepare('SELECT id, nome, telefone, pode_comandar FROM jogadores ORDER BY nome ASC');
}

function definirPermissaoComandoConsulta62() {
    return db.prepare('UPDATE jogadores SET pode_comandar = ? WHERE id = ?');
}

function reativarJogadorConsulta63() {
    return db.prepare('UPDATE jogadores SET ativo = 1 WHERE id = ?');
}

function registrarMudancaPapelConsulta64() {
    return db.prepare('INSERT INTO papel_historico (jogador_id, papel_anterior, papel_novo) VALUES (?, ?, ?)');
}

function getPapelHistoricoConsulta65() {
    return db.prepare('SELECT * FROM papel_historico WHERE jogador_id = ? ORDER BY alterado_em DESC, id DESC');
}

function separarConfirmadosPorVagasConsulta66() {
    return db.prepare(`SELECT j.id, j.nome, j.nivel, j.posicao, v.papel, v.votado_em, v.ordem_manual
             FROM votos v
             JOIN jogadores j ON j.id = v.jogador_id
             WHERE v.enquete_id = ? AND v.papel IS NOT NULL`);
}

function separarConfirmadosPorVagasConsulta67() {
    return db.prepare('SELECT vagas_maximo FROM enquetes WHERE id = ?');
}

function getAvaliacoesDaEnqueteConsulta68() {
    return db.prepare('SELECT jogador_id, avaliador_id, nota FROM avaliacoes WHERE enquete_id = ?');
}

function recalcularNivelConsulta69() {
    return db.prepare('SELECT AVG(nota) AS media FROM avaliacoes WHERE jogador_id = ?');
}

function recalcularNivelConsulta70() {
    return db.prepare('UPDATE jogadores SET nivel = ? WHERE id = ?');
}

function registrarAvaliacaoConsulta71() {
    return db.prepare(`INSERT INTO avaliacoes (enquete_id, jogador_id, avaliador_id, nota)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(enquete_id, jogador_id, avaliador_id) DO UPDATE SET
             nota = excluded.nota,
             criado_em = datetime('now')`);
}

function upsertJogadorConsulta72() {
    return db.prepare('SELECT id, telefone FROM jogadores WHERE whatsapp_id = ?');
}

function upsertJogadorConsulta73() {
    return db.prepare('UPDATE jogadores SET telefone = ? WHERE id = ?');
}

function upsertJogadorConsulta74() {
    return db.prepare('INSERT INTO jogadores (nome, whatsapp_id, telefone, papel) VALUES (?, ?, ?, ?)');
}

function iniciarCaixaConsulta75() {
    return db.prepare(`INSERT INTO caixa_lancamentos (data, tipo, valor_centavos, descricao, categoria)
            VALUES (?, 'inicial', ?, 'Saldo inicial', 'Saldo inicial')`);
}

function lancarCaixaConsulta76() {
    return db.prepare(`INSERT INTO caixa_lancamentos (data, tipo, valor_centavos, descricao, categoria)
        VALUES (?, ?, ?, ?, ?)`);
}

function cancelarLancamentoCaixaConsulta77() {
    return db.prepare(`UPDATE caixa_lancamentos SET cancelado_em = datetime('now')
        WHERE id = ? AND origem IS NULL AND tipo != 'inicial' AND cancelado_em IS NULL`);
}

function definirPagamentoCaixaConsulta78(parte0, parte1) {
    return db.prepare(`SELECT * FROM ${parte0} WHERE jogador_id = ? AND ${parte1} = ?`);
}

function definirPagamentoCaixaConsulta79(parte0) {
    return db.prepare(`UPDATE ${parte0} SET pago = ?, atualizado_em = datetime('now') WHERE id = ?`);
}

function definirPagamentoCaixaConsulta80(parte0, parte1) {
    return db.prepare(`INSERT INTO ${parte0} (jogador_id, ${parte1}, pago) VALUES (?, ?, ?)`);
}

function definirPagamentoCaixaConsulta81() {
    return db.prepare("UPDATE caixa_lancamentos SET cancelado_em = datetime('now') WHERE origem = ? AND cancelado_em IS NULL");
}

function definirPagamentoCaixaConsulta82() {
    return db.prepare('SELECT id FROM caixa_lancamentos WHERE origem = ?');
}

function definirPagamentoCaixaConsulta83() {
    return db.prepare('UPDATE caixa_lancamentos SET cancelado_em = NULL WHERE id = ?');
}

function definirPagamentoCaixaConsulta84() {
    return db.prepare('SELECT nome FROM jogadores WHERE id = ?');
}

function definirPagamentoCaixaConsulta85() {
    return db.prepare(`INSERT INTO caixa_lancamentos (data, tipo, valor_centavos, descricao, categoria, origem)
                    VALUES (?, 'entrada', ?, ?, ?, ?)`);
}

function definirPagamentoCaixaConsulta86() {
    return db.prepare('SELECT nome FROM jogadores WHERE id = ?');
}

function definirPagamentoCaixaConsulta87() {
    return db.prepare('SELECT titulo FROM enquetes WHERE id = ?');
}

function definirPagamentoCaixaConsulta88() {
    return db.prepare('SELECT valor_centavos FROM caixa_lancamentos WHERE origem = ?');
}

function definirPagamentoCaixaConsulta89() {
    return db.prepare(`INSERT INTO pagamentos_historico
            (jogador_id, nome, tipo, referencia, jogo, pago, origem, valor_centavos)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
}

module.exports = {
    marcarVotoManualConsulta1,
    marcarVotoManualConsulta2,
    getConfigConsulta3,
    setConfigConsulta4,
    registrarLogConsulta5,
    registrarLogConsulta6,
    getLogsConsulta7,
    getLogsConsulta8,
    contarLogsConsulta9,
    contarLogsConsulta10,
    criarEnvioImediatoConsulta11,
    getDestinatariasPorPublicoConsulta12,
    getDestinatariasPorPublicoConsulta13,
    getDestinatariasPorPublicoConsulta14,
    getDestinatariasPorPublicoConsulta15,
    enfileirarMensagemJogadoraConsulta16,
    getMensagensJogadorasPendentesConsulta17,
    removerMensagemJogadoraConsulta18,
    getEnviosImediatosPendentesConsulta19,
    removerEnvioImediatoConsulta20,
    fecharEnqueteConsulta21,
    getEnquetesFechadasNaoDesafixadasConsulta22,
    marcarEnqueteDesafixadaConsulta23,
    registrarTentativaDesafixarConsulta24,
    upsertGrupoConsulta25,
    getGruposConsulta26,
    getEnqueteOpcoesConsulta27,
    criarMensagemUnicaConsulta28,
    criarMensagemSemanalConsulta29,
    getMensagemAgendadaConsulta30,
    atualizarMensagemUnicaConsulta31,
    atualizarMensagemSemanalConsulta32,
    getMensagensAgendadasConsulta33,
    getMensagensUnicasParaEnviarConsulta34,
    getMensagensSemanaisConsulta35,
    marcarMensagemEnviadaConsulta36,
    marcarMensagemSemanalEnviadaConsulta37,
    excluirMensagemAgendadaConsulta38,
    getMensalistasPagosConsulta39,
    criarConviteFechamentoMensalConsulta40,
    getConviteFechamentoMensalConsulta41,
    registrarRespostaConviteFechamentoMensalConsulta42,
    criarCicloMensalConsulta43,
    criarCicloMensalConsulta44,
    getCicloMensalAtualConsulta45,
    expirarRenovacoesMensaisConsulta46,
    expirarRenovacoesMensaisConsulta47,
    responderChamadaMensalConsulta48,
    responderChamadaMensalConsulta49,
    responderChamadaMensalConsulta50,
    responderChamadaMensalConsulta51,
    responderChamadaMensalConsulta52,
    responderChamadaMensalConsulta53,
    responderChamadaMensalConsulta54,
    getResumoMensalConsulta55,
    aprovarInteressadaMensalConsulta56,
    definirPapelJogadorConsulta57,
    definirPapelJogadorConsulta58,
    getJogadorPorWhatsappIdConsulta59,
    podeUsarComandosConsulta60,
    getJogadoresParaPermissaoConsulta61,
    definirPermissaoComandoConsulta62,
    reativarJogadorConsulta63,
    registrarMudancaPapelConsulta64,
    getPapelHistoricoConsulta65,
    separarConfirmadosPorVagasConsulta66,
    separarConfirmadosPorVagasConsulta67,
    getAvaliacoesDaEnqueteConsulta68,
    recalcularNivelConsulta69,
    recalcularNivelConsulta70,
    registrarAvaliacaoConsulta71,
    upsertJogadorConsulta72,
    upsertJogadorConsulta73,
    upsertJogadorConsulta74,
    iniciarCaixaConsulta75,
    lancarCaixaConsulta76,
    cancelarLancamentoCaixaConsulta77,
    definirPagamentoCaixaConsulta78,
    definirPagamentoCaixaConsulta79,
    definirPagamentoCaixaConsulta80,
    definirPagamentoCaixaConsulta81,
    definirPagamentoCaixaConsulta82,
    definirPagamentoCaixaConsulta83,
    definirPagamentoCaixaConsulta84,
    definirPagamentoCaixaConsulta85,
    definirPagamentoCaixaConsulta86,
    definirPagamentoCaixaConsulta87,
    definirPagamentoCaixaConsulta88,
    definirPagamentoCaixaConsulta89
};
