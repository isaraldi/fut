// Banco temporário, sem WhatsApp ou chamadas reais à IA.
process.env.TZ = 'America/Sao_Paulo';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');

async function main() {
    const raiz = path.resolve(__dirname, '..');
    const temporario = fs.mkdtempSync(path.join(os.tmpdir(), 'fut-presenca-ia-'));
    let dados;
    try {
        fs.mkdirSync(path.join(temporario, 'data'));
        fs.cpSync(path.join(raiz, 'src'), path.join(temporario, 'src'), { recursive: true });
        fs.symlinkSync(path.join(raiz, 'node_modules'), path.join(temporario, 'node_modules'), 'dir');
        const carregar = createRequire(path.join(temporario, 'teste.js'));
        dados = carregar('./src/api/services/fut.service');
        const { executarPedidoPresenca } = carregar('./src/api/services/presenca-ia.service');
        const { db } = dados;
        const grupo = 'teste@g.us';
        const autor = 'organizadora@c.us';
        dados.setConfig('enquete_grupo_id', grupo);
        const inserir = db.prepare('INSERT INTO jogadores (nome, whatsapp_id, papel, pode_comandar) VALUES (?, ?, ?, ?)');
        const bruna = Number(inserir.run('Bruna Fuchs', autor, 'mensalista', 1).lastInsertRowid);
        inserir.run('Bruna Silva', 'outra@c.us', 'avulso', 0);
        const carol = Number(inserir.run('Carol Lima', 'carol@c.us', 'avulso', 0).lastInsertRowid);
        const bia = Number(inserir.run('Bia Reis', 'bia@c.us', 'avulso', 0).lastInsertRowid);
        const enqueteId = Number(db.prepare('INSERT INTO enquetes (message_id, group_id, titulo, vagas_maximo) VALUES (?, ?, ?, 1)').run('jogo-ia', grupo, 'Jogo atual').lastInsertRowid);
        const contexto = { grupo, autor, enqueteId };
        const pedir = (intencao, nome, extras = {}) => executarPedidoPresenca({ intencao, nomes: nome ? [nome] : [] }, { ...contexto, ...extras });
        assert.match(pedir('confirmarpresenca', 'Bruna'), /mais de uma/);
        assert.equal(db.prepare('SELECT count(*) n FROM votos').get().n, 0);
        assert.match(pedir('confirmarpresenca', 'Nome inexistente'), /Não encontrei/);
        assert.match(pedir('confirmarpresenca', 'Bruna Fuchs', { autor: 'outra@c.us' }), /permissão/);
        assert.match(pedir('confirmarpresenca', 'Bruna Fuchs', { enqueteId: 999 }), /jogo mudou/);
        assert.match(pedir('confirmarpresenca', 'Bruna Fuchs', { grupo: 'outro@g.us' }), /jogo mudou/);
        assert.match(pedir('confirmarpresenca', 'bruna fuchs'), /confirmada/);
        assert.match(pedir('confirmarpresenca', 'Carol'), /lista de espera/);
        assert.match(pedir('vagas'), /0 vaga.*1 confirmada.*1 na espera/);
        assert.match(pedir('pendentes'), /Bruna Silva/);
        assert(!pedir('pendentes').includes('Carol Lima'));
        const antes = db.prepare('SELECT * FROM votos WHERE jogador_id = ?').get(carol);
        assert.match(pedir('confirmarpresenca', 'Carol'), /já está/);
        assert.deepEqual(db.prepare('SELECT * FROM votos WHERE jogador_id = ?').get(carol), antes);
        dados.setAusentesDaEnquete(enqueteId, [bruna]);
        assert.match(pedir('retirarpresenca', 'Bruna Fuchs'), /Entrou na vaga: Carol Lima/);
        assert.deepEqual(dados.getAusentesDaEnquete(enqueteId), []);
        assert.deepEqual(dados.getConfirmadosDaEnquete(enqueteId).map(j => j.id), [carol]);
        assert.match(pedir('retirarpresenca', 'Bruna Fuchs'), /já está fora/);
        // Voto antigo recuperado do WhatsApp não pode desfazer a retirada manual.
        const sync = carregar('./src/api/subscribers/sincronizacao-whatsapp').criarSincronizadorWhatsApp({ client: {}, resolverIdCanonico: async id => id });
        await sync.receberVoto({ parentMsgKey: 'jogo-ia', voter: autor, interractedAtTs: Date.now() - 60000, selectedOptions: [{ name: 'Eu vou' }] });
        assert(!db.prepare('SELECT id FROM votos WHERE jogador_id = ?').get(bruna));
        assert.match(pedir('confirmarpresenca', 'Bruna Fuchs'), /Passou para a espera.*Carol Lima/);
        db.prepare('UPDATE jogadores SET ativo = 0 WHERE id = ?').run(bia);
        assert.match(pedir('confirmarpresenca', 'Bia Reis'), /Não encontrei/);
        db.exec(`CREATE TEMP TRIGGER falhar_presenca BEFORE DELETE ON votos
            BEGIN SELECT RAISE(ABORT, 'Falha simulada'); END`);
        assert.throws(() => pedir('retirarpresenca', 'Bruna Fuchs'), /Falha simulada/);
        assert.deepEqual(dados.getConfirmadosDaEnquete(enqueteId).map(j => j.id), [bruna]);
        db.exec('DROP TRIGGER falhar_presenca');
        // Correções manuais continuam permitidas mesmo após o fechamento, como no painel.
        dados.fecharEnquete(enqueteId);
        assert.match(pedir('retirarpresenca', 'Carol'), /retirada/);
        console.log('Presença por IA: permissões, ambiguidade, vagas, prioridade, repetição e sincronização OK');
    } finally {
        if (dados) dados.db.close();
        fs.rmSync(temporario, { recursive: true, force: true });
    }
}
main().catch(erro => { console.error(erro); process.exitCode = 1; });
