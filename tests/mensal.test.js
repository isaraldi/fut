// Executar com: node tests/mensal.test.js (dependências instaladas).
// Todo banco usado aqui é criado num diretório temporário; o bot não é iniciado.
process.env.TZ = 'America/Sao_Paulo';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const raiz = path.resolve(__dirname, '..');
const temporario = fs.mkdtempSync(path.join(os.tmpdir(), 'fut-mensal-'));
let dados;
async function main() {
try {
    fs.mkdirSync(path.join(temporario, 'data'));
    for (const arquivo of ['db.js', 'mensagens-prontas.js']) fs.copyFileSync(path.join(raiz, arquivo), path.join(temporario, arquivo));
    fs.symlinkSync(path.join(raiz, 'node_modules'), path.join(temporario, 'node_modules'), 'dir');
    const carregar = createRequire(path.join(temporario, 'teste.js'));
    const { fechamentoMensalDoMes, mesReferenciaAtual, montarTextoMensal } = carregar('./mensagens-prontas');
    const data = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    // Todos os dias da semana, meses curtos, bissextos e viradas de ano.
    for (const ano of [2024, 2025, 2026, 2027]) {
        for (let mes = 0; mes < 12; mes++) for (let dia = 0; dia < 7; dia++) {
            const fechamento = fechamentoMensalDoMes(ano, mes, dia);
            const jogo = new Date(fechamento); jogo.setDate(jogo.getDate() - 1);
            assert.equal(jogo.getDay(), dia);
            assert.equal(jogo.getMonth(), mes);
            assert.notEqual(new Date(ano, mes, jogo.getDate() + 7).getMonth(), mes);
        }
    }
    assert.equal(data(fechamentoMensalDoMes(2026, 9, 4)), '2026-10-30');
    assert.equal(data(fechamentoMensalDoMes(2026, 11, 4)), '2027-01-01');
    assert.equal(mesReferenciaAtual(new Date(2026, 9, 29, 23, 59), 4), '2026-10');
    assert.equal(mesReferenciaAtual(new Date(2026, 9, 30), 4), '2026-11');
    assert.equal(mesReferenciaAtual(new Date(2027, 0, 1), 4), '2027-01');
    assert.throws(() => fechamentoMensalDoMes(2026, 9, 8), RangeError);

    // Esquema anterior, sem as colunas de fila e sem tabela de ciclos.
    const Database = require('better-sqlite3');
    const legado = new Database(path.join(temporario, 'data/fut.db'));
    legado.exec(`CREATE TABLE fechamento_mensal_convites (
        id INTEGER PRIMARY KEY AUTOINCREMENT, jogador_id INTEGER NOT NULL REFERENCES jogadores(id),
        message_id TEXT NOT NULL, mes_anterior TEXT NOT NULL, resposta TEXT, respondido_em TEXT,
        criado_em TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(jogador_id, message_id))`);
    legado.close();
    dados = carregar('./db');
    const { db, criarCicloMensal, responderChamadaMensal, getResumoMensal, aprovarInteressadaMensal, getConfig, setConfig } = dados;
    assert.equal(getResumoMensal(), null);
    const inserir = db.prepare('INSERT INTO jogadores (nome, papel) VALUES (?, ?)');
    const ana = Number(inserir.run('Ana', 'mensalista').lastInsertRowid);
    const bia = Number(inserir.run('Bia', 'mensalista').lastInsertRowid);
    const clara = Number(inserir.run('Clara', 'avulso').lastInsertRowid);
    const dora = Number(inserir.run('Dora', 'avulso').lastInsertRowid);
    const papel = id => db.prepare('SELECT papel FROM jogadores WHERE id = ?').get(id).papel;
    criarCicloMensal('chamada-1', '2026-10', 36);
    const inicio = dados.getCicloMensalAtual().criado_em;
    const responder = (id, resposta, tempo) => responderChamadaMensal('chamada-1', id, resposta, inicio + tempo);
    responder(clara, 'sim', 10);
    responder(dora, 'sim', 20);
    assert.deepEqual(getResumoMensal().fila.map(j => j.nome), ['Clara', 'Dora']);
    assert.equal(papel(clara), 'avulso');
    const { execFileSync } = require('node:child_process');
    const persistida = execFileSync(process.execPath, ['-e',
        "const d = require(process.argv[1]); console.log(JSON.stringify(d.getResumoMensal().fila.map(j => j.nome))); d.db.close();",
        path.join(temporario, 'db.js')], { encoding: 'utf8' });
    assert.deepEqual(JSON.parse(persistida), ['Clara', 'Dora']);
    const primeira = getResumoMensal().fila[0];
    responder(clara, 'sim', 30);
    assert.equal(getResumoMensal().fila[0].respondido_em, primeira.respondido_em);
    assert.equal(aprovarInteressadaMensal(primeira.id), false); // prioridade ainda pendente
    responder(ana, 'sim', 40);
    responder(bia, 'nao', 50);
    assert.equal(papel(ana), 'mensalista');
    assert.equal(papel(bia), 'avulso');
    responder(clara, 'nao', 60);
    responder(clara, 'sim', 70);
    assert.deepEqual(getResumoMensal().fila.map(j => j.nome), ['Dora', 'Clara']);
    const fila = getResumoMensal().fila;
    assert.equal(aprovarInteressadaMensal(fila[1].id), false); // respeita ordem
    assert.equal(aprovarInteressadaMensal(fila[0].id), true);
    assert.equal(papel(dora), 'mensalista');
    responder(dora, 'sim', 80);
    assert.equal(getResumoMensal().aprovadas.length, 1);
    responder(dora, 'nao', 90);
    assert.equal(papel(dora), 'avulso');
    assert.match(montarTextoMensal(getResumoMensal()), /Fila de interessadas/);
    assert.equal(responderChamadaMensal('outra-mensagem', clara, 'sim'), false);
    const desconhecida = Number(inserir.run('Inativa', 'avulso').lastInsertRowid);
    db.prepare('UPDATE jogadores SET ativo = 0 WHERE id = ?').run(desconhecida);
    assert.equal(responder(desconhecida, 'sim', 100), false);

    criarCicloMensal('chamada-2', '2026-11', 1);
    const ciclo2 = dados.getCicloMensalAtual();
    setConfig('fechamento_mensal_prazo_horas', '999'); // não prolonga ciclo existente
    assert.equal(responderChamadaMensal('chamada-1', ana, 'nao'), false);
    dados.expirarRenovacoesMensais(ciclo2.prazo_em);
    assert.equal(papel(ana), 'avulso');
    responderChamadaMensal('chamada-2', clara, 'sim', ciclo2.prazo_em + 1);
    responderChamadaMensal('chamada-2', ana, 'sim', ciclo2.prazo_em + 2);
    assert.deepEqual(getResumoMensal().fila.map(j => j.nome), ['Clara', 'Ana']);
    assert.equal(papel(ana), 'avulso'); // tardia não recupera prioridade
    // Nova chamada sem nenhuma mensalista ainda permite formar fila.
    criarCicloMensal('chamada-3', '2026-12', 36);
    assert.equal(getResumoMensal().pendentes.length, 0);
    responderChamadaMensal('chamada-3', bia, 'sim');
    assert.equal(getResumoMensal().fila[0].nome, 'Bia');
    assert.equal(getResumoMensal().mesNovo, '2027-01');

    // Executa o handler real com um cliente falso: resolver a primeira identidade
    // mais lentamente não pode inverter a ordem de chegada das reações.
    const vm = require('node:vm');
    const bot = fs.readFileSync(path.join(raiz, 'index.js'), 'utf8');
    const trecho = bot.slice(bot.indexOf('// Processa na ordem de chegada'), bot.indexOf('// 🧾 COMPROVANTE'));
    let handler;
    vm.runInNewContext(trecho, {
        client: { on: (evento, fn) => { assert.equal(evento, 'message_reaction'); handler = fn; } },
        console, getIdSerialized: id => id, getCicloMensalAtual: dados.getCicloMensalAtual,
        resolverIdCanonico: async id => { if (id === clara) await new Promise(resolve => setTimeout(resolve, 15)); return id; },
        getJogadorPorWhatsappId: id => ({ id }), getConviteFechamentoMensal: dados.getConviteFechamentoMensal,
        responderChamadaMensal,
    });
    await Promise.all([
        handler({ msgId: 'chamada-3', senderId: clara, reaction: '👍' }),
        handler({ msgId: 'chamada-3', senderId: dora, reaction: '👍' }),
    ]);
    assert.deepEqual(getResumoMensal().fila.map(j => j.nome), ['Bia', 'Clara', 'Dora']);
    await handler({ msgId: 'chamada-3', senderId: clara, reaction: '' });
    assert.deepEqual(getResumoMensal().fila.map(j => j.nome), ['Bia', 'Dora']);
    await handler({ msgId: 'chamada-3', senderId: clara, reaction: '👍' });
    assert.deepEqual(getResumoMensal().fila.map(j => j.nome), ['Bia', 'Dora', 'Clara']);

    // Renderiza a view com e sem ciclo (também valida o formulário e seus campos).
    const ejs = require('ejs');
    const template = fs.readFileSync(path.join(raiz, 'panel/views/mensal.ejs'), 'utf8');
    const vars = { usuario: 'teste', ok: '', csrfToken: 'teste', resumoMensal: getResumoMensal(), aba: 'renovacao', mensalistas: [], avulsas: [],
        fechamentoMensalAtivo: true, fechamentoMensalMensagem: 'teste', fechamentoMensalHora: '09:00', fechamentoMensalPrazoHoras: '36',
        pagamentoDiaLimite: '7', proximoFechamentoMensalTexto: '30/10/2026', enqueteAutoEnviar: false, enqueteEnvioDiaSemana: 1,
        enqueteEnvioHora: '09:00', enqueteTituloTemplate: 'teste', enqueteOpcoes: [], listaConfirmadaMensagem: '', listaAtualMensagem: '', listaEsperaMensagem: '', timesMensagem: '' };
    assert.match(ejs.render(template, vars), /Confirmar entrada no mensal/);
    assert.match(ejs.render(template, { ...vars, resumoMensal: null }), /após o envio/);
    const modelos = fs.readFileSync(path.join(raiz, 'panel/views/mensagens-automaticas.ejs'), 'utf8');
    assert.match(ejs.render(modelos, vars), /href="\/mensal\?aba=renovacao"/);

    // Simula atualização de instalação antiga e confirma idempotência da migração.
    setConfig('enquete_dia_semana', '3');
    setConfig('enquete_titulo_template', 'JOGO DE QUARTA - {data}');
    db.prepare("DELETE FROM configuracoes WHERE chave = 'mensal_calendario_v2'").run();
    db.close();
    delete require.cache[carregar.resolve('./db')];
    dados = carregar('./db');
    assert.equal(dados.getConfig('enquete_dia_semana'), '4');
    assert.equal(dados.getConfig('enquete_titulo_template'), 'JOGO DE {dia} - {data}');
    dados.setConfig('enquete_dia_semana', '2');
    dados.db.close();
    delete require.cache[carregar.resolve('./db')];
    dados = carregar('./db');
    assert.equal(dados.getConfig('enquete_dia_semana'), '2');
    console.log('OK: calendário, prioridade, fila, desistência, aprovação, prazo, migração e renderização EJS.');
} finally {
    if (dados?.db.open) dados.db.close();
    fs.rmSync(temporario, { recursive: true, force: true });
}

}
main().catch(err => { console.error(err); process.exitCode = 1; });
