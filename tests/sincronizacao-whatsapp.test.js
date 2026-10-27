// Executar com: node tests/sincronizacao-whatsapp.test.js. Sem bot, rede ou dados reais.
process.env.TZ = 'America/Sao_Paulo';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createRequire } = require('node:module');

async function main() {
    const raiz = path.resolve(__dirname, '..');
    const temporario = fs.mkdtempSync(path.join(os.tmpdir(), 'fut-sincronizacao-'));
    let dados;
    try {
        fs.mkdirSync(path.join(temporario, 'data'));
        for (const nome of ['db.js', 'mensagens-prontas.js', 'sincronizacao-whatsapp.js']) {
            fs.copyFileSync(path.join(raiz, nome), path.join(temporario, nome));
        }
        fs.symlinkSync(path.join(raiz, 'node_modules'), path.join(temporario, 'node_modules'), 'dir');
        const carregar = createRequire(path.join(temporario, 'teste.js'));
        dados = carregar('./db');
        const { db } = dados;
        const { criarSincronizadorWhatsApp } = carregar('./sincronizacao-whatsapp');
        db.prepare('DELETE FROM enquete_opcoes').run();
        db.prepare("INSERT INTO enquete_opcoes (texto, conta) VALUES ('Vou', 1), ('Não vou', 0)").run();
        const inserir = db.prepare('INSERT INTO jogadores (nome, whatsapp_id, papel) VALUES (?, ?, ?)');
        const ana = Number(inserir.run('Ana', 'ana@c.us', 'mensalista').lastInsertRowid);
        const bia = Number(inserir.run('Bia', 'bia@c.us', 'avulso').lastInsertRowid);
        const clara = Number(inserir.run('Clara', 'clara@c.us', 'avulso').lastInsertRowid);
        const enquete = Number(db.prepare("INSERT INTO enquetes (message_id, group_id, titulo) VALUES ('enquete-atual', 'teste@g.us', 'Teste')").run().lastInsertRowid);
        dados.criarCicloMensal('chamada-atual', '2026-10', 1);
        const ciclo = dados.getCicloMensalAtual();
        const base = ciclo.criado_em;
        let relogio = base + 10000;
        let leituras = 0;
        let indisponivel = false;
        let votos = [];
        let reacoes = [];
        let portao = null;
        const client = {
            getMessageById: async id => {
                leituras++;
                if (indisponivel) throw new Error('Falha de leitura simulada');
                if (id === 'enquete-atual') return { type: 'poll_creation', getPollVotes: async () => votos.map(v => ({ ...v })) };
                return { getReactions: async () => [{ id: '👍', senders: reacoes.map(r => ({ ...r })) }] };
            },
            getContactById: async () => { throw new Error('Não deveria consultar contatos já cadastrados'); },
        };
        const criar = () => criarSincronizadorWhatsApp({ client, agora: () => relogio,
            resolverIdCanonico: async id => { if (portao) await portao; return id === 'ana@lid' ? 'ana@c.us' : id; } });
        const voto = (voter, tempo, opcoes = ['Vou']) => ({ voter, interractedAtTs: tempo,
            parentMsgKey: { $1: 'enquete-atual' }, selectedOptions: opcoes.map(name => ({ name })) });
        const reacao = (senderId, tempo, reaction = '👍', msgId = 'chamada-atual') => ({ senderId, timestamp: tempo / 1000, reaction, msgId });
        let sync = criar();
        // Bia foi vista ao vivo; a recuperação de Clara deve inseri-la antes de Bia.
        await sync.receberReacao(reacao('bia@c.us', base + 4000));
        reacoes = [reacao('bia@c.us', base + 4000), reacao('clara@c.us', base + 3500)];
        votos = [voto('ana@lid', base + 2000), voto('bia@c.us', base + 1000)];
        await sync.conectar();
        assert.equal(db.prepare('SELECT COUNT(*) n FROM votos').get().n, 2);
        assert.deepEqual(dados.getResumoMensal().fila.map(j => j.nome), ['Clara', 'Bia']);
        const b = db.prepare('SELECT * FROM votos WHERE jogador_id = ?').get(bia);
        assert.equal(Date.parse(b.votado_em.replace(' ', 'T') + 'Z'), base + 1000);
        const antes = JSON.stringify(db.prepare('SELECT * FROM votos ORDER BY id').all());
        dados.definirPapelJogador(ana, 'avulso');
        await sync.sincronizar(true);
        assert.equal(JSON.stringify(db.prepare('SELECT * FROM votos ORDER BY id').all()), antes);
        assert.equal(db.prepare('SELECT papel FROM votos WHERE jogador_id = ?').get(ana).papel, 'mensalista');
        // Recriar o sincronizador simula reinício: a deduplicação está persistida no banco.
        sync = criar();
        await sync.conectar();
        assert.equal(JSON.stringify(db.prepare('SELECT * FROM votos ORDER BY id').all()), antes);
        assert.deepEqual(dados.getResumoMensal().fila.map(j => j.nome), ['Clara', 'Bia']);
        await sync.receberVoto(voto('bia@c.us', base + 5000, []));
        await sync.sincronizar(true); // snapshot anterior não recria o voto removido
        assert(!db.prepare('SELECT 1 FROM votos WHERE jogador_id = ?').get(bia));
        await sync.receberVoto(voto('bia@c.us', base + 6000));
        dados.marcarVotoManual(enquete, bia, base + 6500);
        db.prepare('DELETE FROM votos WHERE jogador_id = ?').run(bia);
        votos = [voto('bia@c.us', base + 6000)];
        await sync.sincronizar(true);
        assert(!db.prepare('SELECT 1 FROM votos WHERE jogador_id = ?').get(bia));
        await sync.receberVoto(voto('bia@c.us', base + 7000));
        assert(db.prepare('SELECT 1 FROM votos WHERE jogador_id = ?').get(bia));
        // Uma confirmação manual também é protegida de votos remotos antigos diferentes.
        dados.marcarVotoManual(enquete, bia, base + 7500);
        votos = [voto('bia@c.us', base + 7200, ['Não vou'])];
        await sync.sincronizar(true);
        assert.equal(db.prepare('SELECT opcao FROM votos WHERE jogador_id = ?').get(bia).opcao, 'Vou');
        // Fechamento durante um await impede a escrita, não apenas no início do handler.
        let liberar;
        portao = new Promise(resolve => { liberar = resolve; });
        const pendente = sync.receberVoto(voto('bia@c.us', base + 8000, ['Não vou']));
        await new Promise(resolve => setImmediate(resolve));
        dados.fecharEnquete(enquete);
        liberar();
        await pendente;
        portao = null;
        assert.equal(db.prepare('SELECT opcao FROM votos WHERE jogador_id = ?').get(bia).opcao, 'Vou');
        // A renovação chegou no prazo, mas o painel expirou a pendência antes da recuperação.
        dados.expirarRenovacoesMensais(ciclo.prazo_em + 1);
        assert.equal(dados.getConviteFechamentoMensal('chamada-atual', ana).expirada, 1);
        relogio = ciclo.prazo_em + 10000;
        reacoes = [reacao('ana@lid', ciclo.prazo_em - 2000), ...reacoes];
        await sync.sincronizar(true);
        assert.equal(db.prepare('SELECT papel FROM jogadores WHERE id = ?').get(ana).papel, 'mensalista');
        assert.equal(dados.getResumoMensal().renovadas[0].jogador_id, ana);
        await sync.receberReacao(reacao('ana@c.us', ciclo.prazo_em + 3000, '👎'));
        await sync.sincronizar(true); // reação antiga não desfaz uma desistência nova
        assert.equal(db.prepare('SELECT papel FROM jogadores WHERE id = ?').get(ana).papel, 'avulso');
        await sync.receberReacao(reacao('ana@c.us', ciclo.prazo_em + 4000));
        assert.deepEqual(dados.getResumoMensal().fila.map(j => j.nome), ['Clara', 'Bia', 'Ana']);
        const primeira = dados.getResumoMensal().fila[0].id;
        assert.equal(dados.aprovarInteressadaMensal(primeira), true);
        await sync.sincronizar(true);
        assert.equal(dados.getResumoMensal().aprovadas[0].jogador_id, clara);
        await sync.receberReacao(reacao('bia@c.us', ciclo.prazo_em + 5000, ''));
        await sync.sincronizar(true);
        assert(!dados.getResumoMensal().fila.some(j => j.jogador_id === bia));
        // Falha, cache vazio e timestamp ausente não apagam confirmações nem aprovações.
        reacoes = [];
        await sync.sincronizar(true);
        assert.equal(dados.getResumoMensal().aprovadas.length, 1);
        indisponivel = true;
        await sync.sincronizar(true);
        assert.equal(dados.getResumoMensal().aprovadas.length, 1);
        indisponivel = false;
        reacoes = [{ senderId: 'bia@c.us', reaction: '👍' }];
        await sync.sincronizar(true);
        assert(!dados.getResumoMensal().fila.some(j => j.jogador_id === bia));
        // Um segundo ready enquanto a primeira consulta aguarda força outra leitura.
        const obter = client.getMessageById;
        let liberarConsulta;
        let primeiraConsulta = true;
        const bloqueio = new Promise(resolve => { liberarConsulta = resolve; });
        client.getMessageById = async id => {
            if (primeiraConsulta) { primeiraConsulta = false; await bloqueio; }
            return obter(id);
        };
        reacoes = [];
        const totalAntes = leituras;
        const primeiraConexao = sync.conectar();
        await new Promise(resolve => setImmediate(resolve));
        const segundaConexao = sync.conectar();
        liberarConsulta();
        await Promise.all([primeiraConexao, segundaConexao]);
        assert.equal(leituras - totalAntes, 2);
        client.getMessageById = obter;
        const contagem = leituras;
        await Promise.all([sync.sincronizar(), sync.sincronizar()]);
        assert.equal(leituras, contagem); // frequência limitada
        relogio += 29 * 60 * 1000;
        await sync.sincronizar();
        assert.equal(leituras, contagem);
        relogio += 60 * 1000;
        await sync.sincronizar();
        assert(leituras > contagem); // nova consulta aos 30 minutos
        const aposConsulta = leituras;
        sync.desconectar();
        relogio += 200000;
        await sync.sincronizar(true);
        assert.equal(leituras, aposConsulta);
        dados.criarCicloMensal('chamada-nova', '2026-11', 36);
        await sync.receberReacao(reacao('clara@c.us', relogio, '👎', 'chamada-atual'));
        assert.equal(db.prepare('SELECT papel FROM jogadores WHERE id = ?').get(clara).papel, 'mensalista');
        // Migração diferencia uma expiração antiga de uma desistência explícita.
        const antigo = base - 86400000;
        const insCiclo = db.prepare('INSERT INTO fechamento_mensal_ciclos VALUES (?, ?, ?, ?)');
        insCiclo.run('migracao-expirou', '2026-08', antigo, antigo + 3600000);
        insCiclo.run('migracao-desistiu', '2026-09', antigo + 1, antigo + 3600000);
        const insConvite = db.prepare(`INSERT INTO fechamento_mensal_convites
            (jogador_id, message_id, mes_anterior, resposta, prioridade, respondido_em) VALUES (?, ?, ?, 'nao', 1, ?)`);
        insConvite.run(ana, 'migracao-expirou', '2026-08', new Date(antigo + 3605000).toISOString());
        insConvite.run(ana, 'migracao-desistiu', '2026-09', new Date(antigo + 10000).toISOString());
        db.prepare("DELETE FROM configuracoes WHERE chave = 'whatsapp_interacoes_v1'").run();
        db.close();
        delete require.cache[carregar.resolve('./db')];
        dados = carregar('./db');
        assert.equal(dados.getConviteFechamentoMensal('migracao-expirou', ana).expirada, 1);
        assert.equal(dados.getConviteFechamentoMensal('migracao-desistiu', ana).expirada, 0);
        console.log('OK: recuperação após reinício, timestamps, deduplicação, fila, prazo expirado, ações manuais, enquete fechada, falhas e ciclos antigos.');
    } finally {
        if (dados?.db.open) dados.db.close();
        fs.rmSync(temporario, { recursive: true, force: true });
    }
}
main().catch(err => { console.error(err); process.exitCode = 1; });
