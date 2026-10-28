// Banco isolado; não inicia bot nem usa dados reais.
process.env.TZ = 'America/Sao_Paulo';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const raiz = path.resolve(__dirname, '..');
const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'fut-caixa-'));
try {
    fs.mkdirSync(path.join(pasta, 'data'));
    for (const arquivo of ['db.js', 'mensagens-prontas.js']) fs.copyFileSync(path.join(raiz, arquivo), path.join(pasta, arquivo));
    fs.symlinkSync(path.join(raiz, 'node_modules'), path.join(pasta, 'node_modules'), 'dir');
    const c = require(path.join(pasta, 'db'));
    const { db } = c;
    const id = db.prepare("INSERT INTO jogadores (nome) VALUES ('Teste')").run().lastInsertRowid;
    c.setConfig('valor_mensal', '60'); c.setConfig('valor_avulso', '15.50');
    c.marcarPagamentoMensalista(id, '2026-09');
    c.iniciarCaixa('100,25');
    assert.throws(() => c.iniciarCaixa('0'));
    assert.equal(db.prepare('SELECT COUNT(*) n FROM caixa_lancamentos').get().n, 1);
    c.marcarPagamentoMensalista(id, '2026-09'); // histórico não gera dinheiro novamente
    c.marcarPagamentoMensalista(id, '2026-10');
    c.marcarPagamentoMensalista(id, '2026-10');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM caixa_lancamentos').get().n, 2);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM pagamentos_historico').get().n, 2);
    assert.equal(db.prepare('SELECT origem FROM pagamentos_historico ORDER BY id DESC LIMIT 1').get().origem, 'comprovante');
    c.definirPagamentoCaixa('mensal', id, '2026-10');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM caixa_lancamentos WHERE cancelado_em IS NOT NULL').get().n, 1);
    assert.equal(db.prepare('SELECT origem, pago FROM pagamentos_historico ORDER BY id DESC LIMIT 1').get().origem, 'manual');
    assert.equal(db.prepare('SELECT pago FROM pagamentos_historico ORDER BY id DESC LIMIT 1').get().pago, 0);
    c.setConfig('valor_mensal', '90');
    c.marcarPagamentoMensalista(id, '2026-10');
    assert.equal(db.prepare("SELECT valor_centavos v FROM caixa_lancamentos WHERE origem IS NOT NULL").get().v, 6000);
    const enquete = db.prepare("INSERT INTO enquetes(message_id,group_id,titulo) VALUES ('teste','teste','Teste')").run().lastInsertRowid;
    c.marcarPagamentoAvulso(id, enquete); c.marcarPagamentoAvulso(id, enquete);
    const gasto = c.lancarCaixa({ tipo:'gasto', valor:'20.25', data:'2026-10-27', descricao:'Quadra', categoria:'Quadra' }).lastInsertRowid;
    const saldo = () => db.prepare("SELECT SUM(CASE WHEN tipo = 'gasto' THEN -valor_centavos ELSE valor_centavos END) v FROM caixa_lancamentos WHERE cancelado_em IS NULL").get().v;
    assert.equal(saldo(), 15550);
    c.cancelarLancamentoCaixa(gasto);
    assert.equal(saldo(), 17575);
    assert.throws(() => c.cancelarLancamentoCaixa(gasto));
    assert.throws(() => c.cancelarLancamentoCaixa(1));
    for (const valor of ['1.999', '-1', 'NaN', '', '1e4']) assert.throws(() => c.dinheiroCentavos(valor));
    assert.throws(() => c.lancarCaixa({ tipo:'gasto', valor:'1', data:'2026-02-30', descricao:'Teste', categoria:'Quadra' }));
    c.setConfig('valor_mensal', '');
    assert.throws(() => c.marcarPagamentoMensalista(id, '2026-11'));
    assert.equal(db.prepare("SELECT COUNT(*) n FROM pagamentos WHERE mes_referencia = '2026-11'").get().n, 0);
    c.setConfig('valor_avulso', '');
    c.definirPagamentoCaixa('avulso', id, enquete, false);
    // Restaurar mantém o valor original, mesmo com preço alterado.
    c.marcarPagamentoAvulso(id, enquete);
    db.prepare('DELETE FROM jogadores WHERE id = ?').run(id);
    assert.equal(saldo(), 17575); // exclusão do cadastro não apaga movimentações
    assert(db.prepare('SELECT COUNT(*) n FROM pagamentos_historico').get().n > 4);
    db.close();
    // Migração recupera registros antigos uma única vez, sem inventar valores/origem.
    const Database = require(path.join(raiz, 'node_modules', 'better-sqlite3'));
    const legado = new Database(path.join(pasta, 'data', 'fut.db'));
    legado.prepare("DELETE FROM configuracoes WHERE chave = 'pagamentos_historico_v1'").run();
    legado.prepare('DELETE FROM pagamentos_historico').run();
    const anterior = legado.prepare("INSERT INTO jogadores(nome) VALUES ('Legado')").run().lastInsertRowid;
    legado.prepare("INSERT INTO pagamentos(jogador_id, mes_referencia, pago, atualizado_em) VALUES (?, '2025-01', 1, '2025-01-05 12:00:00')").run(anterior);
    legado.close();
    const modulo = require.resolve(path.join(pasta, 'db'));
    delete require.cache[modulo];
    let migrado = require(modulo);
    assert.deepEqual(migrado.db.prepare('SELECT origem, valor_centavos, registrado_em FROM pagamentos_historico').get(), { origem:'anterior', valor_centavos:null, registrado_em:'2025-01-05 12:00:00' });
    migrado.db.close(); delete require.cache[modulo];
    migrado = require(modulo);
    assert.equal(migrado.db.prepare('SELECT COUNT(*) n FROM pagamentos_historico').get().n, 1);
    migrado.db.close();
    console.log('Caixa: testes passaram.');
} finally { fs.rmSync(pasta, { recursive:true, force:true }); }
