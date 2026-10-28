const db = require('../../loaders/database');

function getPagamentosConsulta1(where) {
    return db.prepare('SELECT COUNT(*) n FROM pagamentos_historico' + where);
}

function getPagamentosConsulta2(where) {
    return db.prepare('SELECT * FROM pagamentos_historico' + where + ' ORDER BY registrado_em DESC, id DESC LIMIT 50 OFFSET ?');
}

function getPagamentosConsulta3() {
    return db.prepare("SELECT referencia AS id, MAX(jogo) titulo FROM pagamentos_historico WHERE tipo = 'avulso' GROUP BY referencia ORDER BY CAST(referencia AS INTEGER) DESC");
}

function getPagamentosConsulta4() {
    return db.prepare('SELECT id, titulo FROM enquetes ORDER BY id DESC');
}

function getPagamentosConsulta5() {
    return db.prepare('SELECT * FROM enquetes WHERE id = ?');
}

function getPagamentosConsulta6() {
    return db.prepare('SELECT * FROM enquetes ORDER BY id DESC LIMIT 1');
}

function getPagamentosConsulta7() {
    return db.prepare('SELECT pago FROM pagamentos_avulsos WHERE jogador_id = ? AND enquete_id = ?');
}

function getPagamentosConsulta8() {
    return db.prepare(`SELECT j.id, j.nome,
                    p.pago AS pago
             FROM jogadores j
             LEFT JOIN pagamentos p
                    ON p.jogador_id = j.id AND p.mes_referencia = ?
             WHERE j.papel = 'mensalista'
             ORDER BY j.nome ASC`);
}

function getCaixaConsulta9() {
    return db.prepare(`SELECT
        COALESCE(SUM(CASE WHEN tipo = 'gasto' THEN -valor_centavos ELSE valor_centavos END), 0) saldo,
        COALESCE(SUM(CASE WHEN tipo = 'entrada' AND substr(data,1,7) = ? THEN valor_centavos ELSE 0 END), 0) entradas,
        COALESCE(SUM(CASE WHEN tipo = 'gasto' AND substr(data,1,7) = ? THEN valor_centavos ELSE 0 END), 0) gastos
        FROM caixa_lancamentos WHERE cancelado_em IS NULL`);
}

function getCaixaConsulta10() {
    return db.prepare('SELECT * FROM caixa_lancamentos WHERE substr(data,1,7) = ? ORDER BY data DESC, id DESC');
}

module.exports = {
    getPagamentosConsulta1,
    getPagamentosConsulta2,
    getPagamentosConsulta3,
    getPagamentosConsulta4,
    getPagamentosConsulta5,
    getPagamentosConsulta6,
    getPagamentosConsulta7,
    getPagamentosConsulta8,
    getCaixaConsulta9,
    getCaixaConsulta10
};

function listarHistoricoPagamentos({ busca, tipo, jogoId, pagina }) {
    const condicoes = [], valores = [];
    if (busca) { condicoes.push('instr(lower(nome), lower(?)) > 0'); valores.push(busca); }
    if (tipo) { condicoes.push('tipo = ?'); valores.push(tipo); }
    if (jogoId) { condicoes.push("tipo = 'avulso' AND referencia = ?"); valores.push(jogoId); }
    const where = condicoes.length ? ' WHERE ' + condicoes.join(' AND ') : '';
    return {
        total: getPagamentosConsulta1(where).get(...valores).n,
        historico: getPagamentosConsulta2(where).all(...valores, (pagina - 1) * 50),
    };
}
module.exports.listarHistoricoPagamentos = listarHistoricoPagamentos;
