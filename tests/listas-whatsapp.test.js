// Executar com: node tests/listas-whatsapp.test.js. Banco temporário, sem bot ou mensagens reais.
process.env.TZ = 'America/Sao_Paulo';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { createRequire } = require('node:module');

async function main() {
    const raiz = path.resolve(__dirname, '..');
    const temporario = fs.mkdtempSync(path.join(os.tmpdir(), 'fut-listas-'));
    let dados;
    try {
        fs.mkdirSync(path.join(temporario, 'data'));
        fs.cpSync(path.join(raiz, 'src'), path.join(temporario, 'src'), { recursive: true });
        fs.symlinkSync(path.join(raiz, 'node_modules'), path.join(temporario, 'node_modules'), 'dir');
        const carregar = createRequire(path.join(temporario, 'teste.js'));
        dados = carregar('./src/api/services/fut.service');
        const listas = carregar('./src/api/services/listas-whatsapp');
        const { db } = dados;
        const grupo = 'teste@g.us';
        const autor = 'organizadora@c.us';
        dados.setConfig('enquete_grupo_id', grupo);
        const inserir = db.prepare('INSERT INTO jogadores (nome, whatsapp_id, papel, pode_comandar) VALUES (?, ?, ?, ?)');
        const ana = Number(inserir.run('Ana Silva', autor, 'mensalista', 1).lastInsertRowid);
        const bia = Number(inserir.run('Bia Lima', 'organizadora2@c.us', 'mensalista', 1).lastInsertRowid);
        const clara = Number(inserir.run('Clara Souza', 'clara@c.us', 'avulso', 0).lastInsertRowid);
        const dora = Number(inserir.run('Dora Reis', 'dora@c.us', 'avulso', 0).lastInsertRowid);
        const titulo = 'Jogo de quinta-feira - 29/10 às 20:30';
        const enquete = Number(db.prepare('INSERT INTO enquetes (message_id, group_id, titulo, vagas_maximo) VALUES (?, ?, ?, 3)').run('enquete-lista', grupo, titulo).lastInsertRowid);
        const votar = db.prepare("INSERT INTO votos (enquete_id, jogador_id, opcao, papel, votado_em) VALUES (?, ?, 'Eu vou', ?, ?)");
        for (const [id, papel, segundo] of [[ana, 'mensalista', 1], [bia, 'mensalista', 2], [clara, 'avulso', 3], [dora, 'avulso', 4]]) {
            votar.run(enquete, id, papel, `2026-10-20 10:00:0${segundo}`);
        }
        db.prepare("INSERT INTO pagamentos (jogador_id, mes_referencia, pago) VALUES (?, '2026-10', 1)").run(ana);
        dados.setAusentesDaEnquete(enquete, [ana, clara]);
        const texto = `📋 Lista atual — ${titulo}\n\nMensalistas (2):\n1. Ana Silva\n2. Bia Lima\n\nAvulsas (1):\n1. Emilia Costa\n\nTotal: 3 confirmadas\n\n⏳ Lista de espera (1):\n1. Dora Reis\nSó entra se algum dos confirmados sair da lista.`;
        let relogio = Date.now() + 100;
        let numero = 0;
        const preparar = (body = texto, extras = {}) => listas.prepararLista({ texto: body, messageId: 'lista-' + (++numero), grupo, autor, agora: ++relogio, ...extras });
        const confirmar = (extras = {}) => listas.confirmarLista({ grupo, autor, agora: ++relogio, ...extras });
        assert(listas.pareceLista('\n' + texto));
        assert(!listas.pareceLista('Podemos trocar uma jogadora?'));
        assert.equal(listas.interpretarLista(texto).confirmadas.length, 3);
        const padrao = carregar('./src/utils/mensagens-prontas').montarTextoListaAtual({ titulo }, dados.getConfirmadosDaEnquete(enquete), dados.getListaDeEsperaDaEnquete(enquete));
        assert.equal(listas.interpretarLista(padrao).espera.length, 1);
        assert.throws(() => preparar(texto.replace('Total: 3', 'Total: 2')), /total/i);
        assert.equal(listas.interpretarLista(texto.replace('Avulsas (1)', 'Avulsas (2)')).avisos.length, 1);
        assert.throws(() => preparar(texto.replace('2. Bia Lima', '1. Bia Lima')), /numeração/);
        assert.throws(() => preparar(texto.replace('2. Bia Lima', '2. Ana Silva')), /repetidos/);
        assert.match(preparar(texto.replace('1. Ana Silva', '1. Nome Não Cadastrado')), /convidadas novas entram como avulsas/);
        assert.throws(() => preparar(texto.replace('1. Ana Silva', '1. Ana')), /abreviado/);
        assert.throws(() => preparar(texto.replace('29/10', '22/10')), /outro jogo/);
        assert.throws(() => preparar(texto, { grupo: 'outro@g.us' }), /autorizada/);
        assert.throws(() => preparar(texto, { autor: 'clara@c.us' }), /autorizada/);
        const antes = JSON.stringify(db.prepare('SELECT * FROM votos ORDER BY id').all());
        const previa = preparar(texto, { messageId: 'lista-principal' });
        assert.match(previa, /Emilia Costa/);
        assert.match(previa, /Clara Souza/);
        assert.match(previa, /!confirmarlista/);
        assert.equal(JSON.stringify(db.prepare('SELECT * FROM votos ORDER BY id').all()), antes);
        assert(!db.prepare("SELECT id FROM jogadores WHERE nome = 'Emilia Costa'").get());
        assert.throws(() => confirmar({ autor: 'organizadora2@c.us' }), /pendente/);
        db.exec(`CREATE TEMP TRIGGER simular_falha_lista BEFORE INSERT ON votos
            WHEN NEW.opcao = 'Confirmada por lista no WhatsApp'
            BEGIN SELECT RAISE(ABORT, 'Falha simulada na importação'); END`);
        assert.throws(() => confirmar(), /Falha simulada/);
        assert(!db.prepare("SELECT id FROM jogadores WHERE nome = 'Emilia Costa'").get());
        assert.equal(JSON.stringify(db.prepare('SELECT * FROM votos ORDER BY id').all()), antes);
        db.exec('DROP TRIGGER simular_falha_lista');
        confirmar();
        const convidada = db.prepare("SELECT * FROM jogadores WHERE nome = 'Emilia Costa'").get();
        assert(convidada);
        assert.equal(convidada.papel, 'avulso');
        assert.equal(convidada.whatsapp_id, null);
        assert.equal(convidada.telefone, null);
        assert.equal(convidada.pode_comandar, 0);
        assert.deepEqual(dados.getConfirmadosDaEnquete(enquete).map(j => j.nome), ['Ana Silva', 'Bia Lima', 'Emilia Costa']);
        assert.deepEqual(dados.getListaDeEsperaDaEnquete(enquete).map(j => j.id), [dora]);
        assert.equal(db.prepare('SELECT papel FROM jogadores WHERE id = ?').get(clara).papel, 'avulso');
        assert.equal(db.prepare('SELECT papel FROM jogadores WHERE id = ?').get(ana).papel, 'mensalista');
        assert.equal(db.prepare('SELECT pago FROM pagamentos WHERE jogador_id = ?').get(ana).pago, 1);
        assert.deepEqual(dados.getAusentesDaEnquete(enquete), [ana]);
        assert.equal(preparar(texto, { messageId: 'lista-principal' }), null);
        assert.throws(() => confirmar(), /pendente/);
        assert.equal(preparar(), null); // mesma lista não gera prévia nem novas convidadas
        assert.equal(db.prepare("SELECT COUNT(*) n FROM jogadores WHERE nome = 'Emilia Costa'").get().n, 1);
        // A recuperação antiga do WhatsApp não desfaz a substituição confirmada.
        const sync = carregar('./src/api/subscribers/sincronizacao-whatsapp').criarSincronizadorWhatsApp({ client: {}, resolverIdCanonico: async id => id, agora: () => relogio + 100 });
        await sync.receberVoto({ parentMsgKey: 'enquete-lista', voter: 'clara@c.us', interractedAtTs: relogio - 100, selectedOptions: [{ name: 'Eu vou' }] });
        assert(!db.prepare('SELECT id FROM votos WHERE enquete_id = ? AND jogador_id = ?').get(enquete, clara));
        // Retornar uma avulsa depois do ajuste deixa-a atrás da distribuição manual.
        await sync.receberVoto({ parentMsgKey: 'enquete-lista', voter: 'clara@c.us', interractedAtTs: relogio + 50, selectedOptions: [{ name: 'Eu vou' }] });
        assert.deepEqual(dados.getConfirmadosDaEnquete(enquete).map(j => j.nome), ['Ana Silva', 'Bia Lima', 'Emilia Costa']);
        assert.deepEqual(dados.getListaDeEsperaDaEnquete(enquete).map(j => j.id), [dora, clara]);
        const outra = texto.replace('Emilia Costa', 'Fernanda Melo');
        preparar(outra);
        db.prepare("UPDATE votos SET opcao = 'Alteração concorrente' WHERE enquete_id = ? AND jogador_id = ?").run(enquete, bia);
        assert.throws(() => confirmar(), /mudaram/);
        assert(!db.prepare("SELECT id FROM jogadores WHERE nome = 'Fernanda Melo'").get());
        preparar(outra);
        assert.throws(() => preparar(outra.replace('Total: 3', 'Total: 9')), /total/);
        assert.throws(() => confirmar(), /pendente/); // não confirma a prévia anterior ao erro
        preparar(outra);
        listas.cancelarLista({ grupo, autor });
        assert.throws(() => confirmar(), /pendente/);
        preparar(outra);
        assert.throws(() => confirmar({ agora: relogio + 11 * 60000 }), /expirou/);
        dados.fecharEnquete(enquete);
        preparar(outra);
        confirmar(); // substituições de última hora também funcionam com lista fechada
        assert(db.prepare('SELECT fechada_em FROM enquetes WHERE id = ?').get(enquete).fechada_em);
        const atual = Number(db.prepare('INSERT INTO enquetes (message_id, group_id, titulo, vagas_maximo) VALUES (?, ?, ?, 3)').run('nova-enquete', grupo, 'Jogo novo de teste').lastInsertRowid);
        // Exercita o handler real, com respostas capturadas em vez de enviadas ao WhatsApp.
        const fonte = fs.readFileSync(path.join(raiz, 'src/api/services/whatsapp.service.js'), 'utf8');
        const trecho = fonte.slice(fonte.indexOf('async function tratarListaEditada('), fonte.indexOf('async function obterContextoIa('));
        const sandbox = { ...listas, getConfig: dados.getConfig,
            mensagemPrivadaRecebida: require('../src/api/services/llm-local').mensagemPrivadaRecebida,
            llmLocal: { habilitada: () => true },
            sincronizadorWhatsApp: { sincronizar: async () => {} },
            remetenteAutorizado: async msg => dados.podeUsarComandos(msg.author),
            resolverIdCanonico: async id => id, getUserId: msg => msg.author,
            getIdSerialized: id => id, registrarLog: () => {}, negarComando: async msg => msg.reply('Não autorizado') };
        vm.createContext(sandbox);
        vm.runInContext(trecho, sandbox);
        const respostas = [];
        const mensagem = { id: 'lista-handler', from: grupo, author: autor,
            body: '📋 Lista atual — Jogo novo de teste\nAvulsas (1):\n1. Gabriela Rocha\nTotal: 1 confirmada',
            reply: async texto => { respostas.push(texto); } };
        await sandbox.tratarListaEditada({ ...mensagem, author: 'clara@c.us' }, mensagem.body.toLowerCase());
        assert.equal(respostas.length, 0);
        await sandbox.tratarListaEditada({ ...mensagem, from: 'outro@g.us' }, mensagem.body.toLowerCase());
        assert.equal(respostas.length, 0);
        await sandbox.tratarListaEditada(mensagem, mensagem.body.toLowerCase());
        assert.equal(respostas.length, 1);
        assert(!db.prepare("SELECT id FROM jogadores WHERE nome = 'Gabriela Rocha'").get());
        await sandbox.tratarListaEditada({ ...mensagem, body: '!confirmarlista' }, '!confirmarlista');
        assert.equal(dados.getConfirmadosDaEnquete(atual)[0].nome, 'Gabriela Rocha');
        assert.match(respostas[1], /corrigida/);
        const privada = { ...mensagem, id: 'lista-privada', from: 'teste@c.us', body: mensagem.body.replace('Gabriela Rocha', 'Helena Costa') };
        await sandbox.tratarListaEditada(privada, privada.body.toLowerCase());
        assert.match(respostas.at(-1), /confirmar a correção da lista/);
        assert.equal(dados.getConfirmadosDaEnquete(atual)[0].nome, 'Gabriela Rocha');
        await sandbox.tratarListaEditada({ ...privada, body: '!confirmarlista' }, '!confirmarlista');
        assert.equal(dados.getConfirmadosDaEnquete(atual)[0].nome, 'Helena Costa');
        console.log('OK: formato, prévia sem alterar escalação, convidadas, confirmação autorizada, fila manual, pagamentos, faltas, expiração, concorrência, deduplicação e integração do handler.');
    } finally {
        if (dados?.db.open) dados.db.close();
        fs.rmSync(temporario, { recursive: true, force: true });
    }
}
main().catch(erro => { console.error(erro); process.exitCode = 1; });
