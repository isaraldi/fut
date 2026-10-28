const db = require('../../loaders/database');

function abrirEnqueteConsulta1() {
    return db.prepare('INSERT INTO enquetes (message_id, group_id, titulo, vagas_maximo) VALUES (?, ?, ?, ?)');
}

function checarFechamentoMensalConsulta2() {
    return db.prepare('SELECT 1 FROM fechamento_mensal_ciclos WHERE mes_anterior = ?');
}

function checarFechamentoMensalConsulta3() {
    return db.prepare("SELECT id, nome FROM jogadores WHERE papel = 'mensalista' AND ativo = 1 ORDER BY nome");
}

function processarPossivelComprovanteConsulta4() {
    return db.prepare('SELECT * FROM enquetes ORDER BY id DESC LIMIT 1');
}

function enviarListaDeConfirmadasConsulta5() {
    return db.prepare('SELECT * FROM enquetes ORDER BY id DESC LIMIT 1');
}

function enviarListaAtualConsulta6() {
    return db.prepare('SELECT * FROM enquetes ORDER BY id DESC LIMIT 1');
}

function enviarListaDeEsperaConsulta7() {
    return db.prepare('SELECT * FROM enquetes ORDER BY id DESC LIMIT 1');
}

function enviarTimesSorteadosConsulta8() {
    return db.prepare('SELECT * FROM enquetes ORDER BY id DESC LIMIT 1');
}

function registrarFaltasConsulta9() {
    return db.prepare('SELECT * FROM enquetes ORDER BY id DESC LIMIT 1');
}

function obterContextoIaConsulta10() {
    return db.prepare('SELECT id FROM enquetes ORDER BY id DESC LIMIT 1');
}

function obterContextoIaConsulta11() {
    return db.prepare("SELECT message_id FROM listas_importacoes WHERE grupo_id = ? AND autor_id = ? AND estado = 'pendente' AND expira_em >= ? LIMIT 1");
}

function sincronizarElencoDeChatConsulta12() {
    return db.prepare('SELECT id, ativo FROM jogadores WHERE whatsapp_id = ?');
}

function sincronizarElencoDeChatConsulta13() {
    return db.prepare('UPDATE jogadores SET ativo = 1 WHERE id = ?');
}

function sincronizarElencoDeChatConsulta14() {
    return db.prepare('UPDATE jogadores SET ativo = 0 WHERE id = ?');
}

function sincronizarElencoDeChatConsulta15() {
    return db.prepare('SELECT id FROM jogadores WHERE ativo = 1');
}

module.exports = {
    abrirEnqueteConsulta1,
    checarFechamentoMensalConsulta2,
    checarFechamentoMensalConsulta3,
    processarPossivelComprovanteConsulta4,
    enviarListaDeConfirmadasConsulta5,
    enviarListaAtualConsulta6,
    enviarListaDeEsperaConsulta7,
    enviarTimesSorteadosConsulta8,
    registrarFaltasConsulta9,
    obterContextoIaConsulta10,
    obterContextoIaConsulta11,
    sincronizarElencoDeChatConsulta12,
    sincronizarElencoDeChatConsulta13,
    sincronizarElencoDeChatConsulta14,
    sincronizarElencoDeChatConsulta15
};
