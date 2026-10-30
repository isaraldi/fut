// Reações simuladas e banco temporário; não acessa WhatsApp nem dados reais.
process.env.TZ = 'America/Sao_Paulo';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');

async function main() {
    const raiz = path.resolve(__dirname, '..');
    const temporario = fs.mkdtempSync(path.join(os.tmpdir(), 'fut-reacoes-mensal-'));
    let dados;
    try {
        fs.mkdirSync(path.join(temporario, 'data'));
        fs.cpSync(path.join(raiz, 'src'), path.join(temporario, 'src'), { recursive: true });
        fs.symlinkSync(path.join(raiz, 'node_modules'), path.join(temporario, 'node_modules'), 'dir');
        const carregar = createRequire(path.join(temporario, 'teste.js'));
        dados = carregar('./src/api/services/fut.service');
        const { criarSincronizadorWhatsApp } = carregar('./src/api/subscribers/sincronizacao-whatsapp');
        const { db } = dados;
        const tons = ['', '🏻', '🏼', '🏽', '🏾', '🏿'];
        const variantes = tons.map(tom => '👍' + tom).concat(['👍\uFE0F', '👍\uFE0F🏽', '👍🏿\uFE0F']);
        const jogadores = variantes.map((emoji, i) => dados.upsertJogador(`tom-${i}@c.us`, `Teste ${i}`, 'mensalista'));
        const recuperada = dados.upsertJogador('recuperada@c.us', 'Teste recuperação', 'mensalista');
        const fila1 = dados.upsertJogador('fila-1@c.us', 'Teste fila 1', 'avulso');
        const fila2 = dados.upsertJogador('fila-2@c.us', 'Teste fila 2', 'avulso');
        dados.criarCicloMensal('chamada-tons', '2026-10', 1);
        const ciclo = dados.getCicloMensalAtual();
        let relogio = ciclo.criado_em + 60000;
        let snapshot = [];
        const criar = () => criarSincronizadorWhatsApp({
            agora: () => relogio,
            resolverIdCanonico: async id => id,
            client: { getMessageById: async () => ({ getReactions: async () => snapshot }) },
        });
        let sync = criar();
        const reagir = (senderId, emoji, timestamp = ++relogio, msgId = ciclo.message_id) => sync.receberReacao({ senderId, reaction: emoji, timestamp, msgId });
        const convite = id => dados.getConviteFechamentoMensal(ciclo.message_id, id);
        const papel = id => db.prepare('SELECT papel FROM jogadores WHERE id = ?').get(id).papel;
        for (let i = 0; i < variantes.length; i++) {
            await reagir(`tom-${i}@c.us`, variantes[i]);
            assert.equal(convite(jogadores[i]).resposta, 'sim', `Renovação com ${variantes[i]}`);
            assert.equal(convite(jogadores[i]).prioridade, 1);
            assert.equal(papel(jogadores[i]), 'mensalista');
        }
        const renovacao = convite(jogadores[0]);
        for (const emoji of variantes) await reagir('tom-0@c.us', emoji);
        assert.equal(convite(jogadores[0]).resposta, 'sim');
        assert.equal(convite(jogadores[0]).respondido_em, renovacao.respondido_em);
        assert.equal(convite(jogadores[0]).prioridade, 1);
        // Trocar apenas a cor mantém a confirmação, o horário e a posição na fila.
        await reagir('fila-1@c.us', '👍🏽');
        await reagir('fila-2@c.us', '👍🏿');
        const antes = convite(fila1);
        for (const emoji of variantes) await reagir('fila-1@c.us', emoji);
        assert.equal(convite(fila1).respondido_em, antes.respondido_em);
        assert.equal(convite(fila1).ordem, antes.ordem);
        assert.deepEqual(dados.getResumoMensal(relogio).fila.map(j => j.jogador_id), [fila1, fila2]);
        // 👎 aceita os mesmos tons e a apresentação alternativa continua sendo desistência.
        const negativas = tons.map(tom => '👎' + tom).concat(['👎\uFE0F', '👎\uFE0F🏽', '👎🏿\uFE0F']);
        for (let i = 0; i < negativas.length; i++) {
            await reagir(`tom-${i}@c.us`, negativas[i]);
            assert.equal(convite(jogadores[i]).resposta, 'nao', `Desistência com ${negativas[i]}`);
            assert.equal(papel(jogadores[i]), 'avulso');
        }
        await reagir('fila-1@c.us', '');
        assert.equal(convite(fila1).resposta, 'nao');
        await reagir('fila-1@c.us', '👍🏻');
        assert.deepEqual(dados.getResumoMensal(relogio).fila.map(j => j.jogador_id), [fila2, fila1]);
        // Recupera uma reação colorida enviada no prazo, mesmo se a pendência já expirou.
        relogio = ciclo.prazo_em + 1000;
        dados.expirarRenovacoesMensais(relogio);
        assert.equal(convite(recuperada).expirada, 1);
        snapshot = [{ id: '👍🏾', senders: [{ senderId: 'recuperada@c.us', timestamp: (ciclo.prazo_em - 2000) / 1000 }] }];
        sync = criar();
        await sync.conectar();
        assert.equal(convite(recuperada).resposta, 'sim');
        assert.equal(convite(recuperada).prioridade, 1);
        assert.equal(papel(recuperada), 'mensalista');
        assert(dados.getResumoMensal(relogio).renovadas.some(j => j.jogador_id === recuperada));
        const recuperacao = convite(recuperada);
        sync = criar();
        await sync.conectar();
        assert.equal(convite(recuperada).respondido_em, recuperacao.respondido_em);
        // Uma resposta realmente tardia permanece na fila, mesmo usando o tom de pele.
        await reagir('tom-0@c.us', '👍🏼', ciclo.prazo_em + 500);
        assert.equal(convite(jogadores[0]).prioridade, 0);
        assert.equal(papel(jogadores[0]), 'avulso');
        assert(dados.getResumoMensal(relogio).fila.some(j => j.jogador_id === jogadores[0]));
        dados.criarCicloMensal('chamada-nova', '2026-11', 1);
        await reagir('recuperada@c.us', '👎🏿', ++relogio, ciclo.message_id);
        assert.equal(papel(recuperada), 'mensalista');
        console.log('OK: todos os tons de pele, apresentação, fila, desistência, retirada, recuperação no prazo, repetição e chamada antiga.');
    } finally {
        if (dados?.db.open) dados.db.close();
        fs.rmSync(temporario, { recursive: true, force: true });
    }
}
main().catch(erro => { console.error(erro); process.exitCode = 1; });
