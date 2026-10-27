// Executar com: node tests/configuracoes.test.js. Usa banco e painel temporários, sem bot.
process.env.TZ = 'America/Sao_Paulo';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');

async function main() {
    const raiz = path.resolve(__dirname, '..');
    const temporario = fs.mkdtempSync(path.join(os.tmpdir(), 'fut-configuracoes-'));
    let servidor;
    let dados;
    try {
        fs.mkdirSync(path.join(temporario, 'data'));
        for (const arquivo of ['db.js', 'mensagens-prontas.js']) {
            fs.copyFileSync(path.join(raiz, arquivo), path.join(temporario, arquivo));
        }
        fs.cpSync(path.join(raiz, 'panel'), path.join(temporario, 'panel'), { recursive: true });
        fs.symlinkSync(path.join(raiz, 'node_modules'), path.join(temporario, 'node_modules'), 'dir');
        const reserva = net.createServer();
        await new Promise(resolve => reserva.listen(0, '127.0.0.1', resolve));
        const porta = reserva.address().port;
        await new Promise(resolve => reserva.close(resolve));
        servidor = spawn(process.execPath, ['panel/server.js'], {
            cwd: temporario,
            env: { ...process.env, NODE_ENV: 'development', PORT: String(porta),
                ADMIN_USER: 'teste-configuracoes', ADMIN_PASSWORD: 'senha-isolada', SESSION_SECRET: 'sessao-isolada' },
            stdio: 'ignore',
        });
        const base = `http://127.0.0.1:${porta}`;
        let login;
        for (let tentativa = 0; tentativa < 100; tentativa++) {
            try { login = await fetch(base + '/login'); break; }
            catch { await new Promise(resolve => setTimeout(resolve, 50)); }
        }
        assert(login, 'Painel temporário não iniciou');
        const cookie = login.headers.get('set-cookie').split(';')[0];
        const csrf = (await login.text()).match(/name="_csrf" value="([^"]+)"/)[1];
        const post = (rota, corpo) => fetch(base + rota, { method: 'POST', redirect: 'manual',
            headers: { Cookie: cookie }, body: new URLSearchParams(corpo) });
        assert.equal((await post('/login', { _csrf: csrf, usuario: 'teste-configuracoes', senha: 'senha-isolada' })).status, 302);
        const carregar = createRequire(path.join(temporario, 'teste.js'));
        dados = carregar('./db');
        const lote = (pagina, alteracoes, token = csrf) => post('/configuracoes/salvar', {
            _csrf: token, pagina, alteracoes: JSON.stringify(alteracoes),
        });
        const alterar = (action, campos) => ({ action, campos });
        let resposta = await lote('/jogo/config', [
            alterar('/jogo/config', { diaSemana: '2', horaH: '21', horaM: '15' }),
            alterar('/jogo/config', { vagasMaximo: '18' }),
            alterar('/jogo/config/times', { porTime: '6', timesModo: 'manual', rodizioMinutos: '12', duracaoMinutos: '72' }),
            alterar('/jogo/config', { valorMensal: '75', valorAvulso: '25' }),
        ]);
        assert.equal(resposta.status, 200);
        assert((await resposta.json()).destino.startsWith('/jogo/config?'));
        for (const [chave, valor] of Object.entries({ enquete_dia_semana: '2', enquete_hora: '21:15',
            jogo_vagas_maximo: '18', jogo_jogadoras_por_time: '6', jogo_times_modo: 'manual',
            jogo_rodizio_minutos: '12', jogo_duracao_minutos: '72', valor_mensal: '75.00', valor_avulso: '25.00' })) {
            assert.equal(dados.getConfig(chave), valor, chave);
        }
        // Salvar apenas um bloco não altera os demais (também sem JavaScript).
        assert.equal((await post('/jogo/config', { _csrf: csrf, vagasMaximo: '20' })).status, 302);
        assert.equal(dados.getConfig('enquete_hora'), '21:15');
        assert.equal(dados.getConfig('valor_mensal'), '75.00');
        assert.equal(dados.getConfig('jogo_vagas_maximo'), '20');
        resposta = await lote('/mensagens/automaticas', [
            alterar('/mensagens/lista-atual', { mensagem: 'Lista de teste' }),
            alterar('/mensagens/lista-espera', { mensagem: 'Espera de teste' }),
        ]);
        assert.equal(resposta.status, 200);
        assert.equal(dados.getConfig('lista_atual_mensagem'), 'Lista de teste');
        assert.equal(dados.getConfig('lista_espera_mensagem'), 'Espera de teste');
        // Uma falha no final do lote desfaz inclusive as escritas anteriores.
        const titulo = dados.getConfig('enquete_titulo_template');
        resposta = await lote('/enquete/config', [
            alterar('/enquete/config/titulo', { titulo: 'Não deve persistir' }),
            alterar('/enquete/config/opcoes/999999', { texto: 'Opção inexistente', conta: '1' }),
        ]);
        assert.equal(resposta.status, 400);
        assert.equal(dados.getConfig('enquete_titulo_template'), titulo);
        assert.equal((await lote('/jogo/config', [alterar('/enquete/config/enviar-agora', {})])).status, 400);
        assert.equal(dados.getConfig('enquete_solicitar_envio'), '0');
        assert.equal((await lote('__proto__', [alterar('/jogo/config', {})])).status, 400);
        assert.equal((await lote('/elenco/config', [alterar('/elenco/config', {})], 'invalido')).status, 403);
        assert.equal((await lote('/elenco/config', [alterar('/elenco/config', { autoIncluir: 'on' })])).status, 200);
        assert.equal(dados.getConfig('elenco_auto_incluir_grupo'), '1');
        assert.equal((await lote('/elenco/config', [alterar('/elenco/config', {})])).status, 200);
        assert.equal(dados.getConfig('elenco_auto_incluir_grupo'), '0');
        const jogadora = Number(dados.db.prepare("INSERT INTO jogadores (nome, papel, whatsapp_id) VALUES ('Jogadora de teste', 'avulso', 'teste@c.us')").run().lastInsertRowid);
        const rotaJogadora = `/elenco/${jogadora}/atualizar`;
        const cadastro = { nome: 'Nome atualizado', telefone: '11900000000', nivel: '4', papel: 'mensalista', posicao: 'defesa' };
        assert.equal((await lote('/elenco', [alterar(rotaJogadora, cadastro)])).status, 200);
        let salva = dados.db.prepare('SELECT * FROM jogadores WHERE id = ?').get(jogadora);
        assert.equal(salva.nome, cadastro.nome);
        assert.equal(salva.telefone, cadastro.telefone);
        assert.equal(salva.nivel, 4);
        assert.equal(salva.papel, 'mensalista');
        assert.equal(salva.posicao, 'defesa');
        assert.equal(salva.whatsapp_id, 'teste@c.us');
        assert.equal(dados.getPapelHistorico(jogadora).length, 1);
        assert.equal((await lote('/elenco', [alterar(rotaJogadora, cadastro)])).status, 200);
        assert.equal(dados.getPapelHistorico(jogadora).length, 1);
        assert.equal((await lote('/elenco', [
            alterar(rotaJogadora, { ...cadastro, papel: 'avulso' }),
            alterar('/elenco/999999/atualizar', cadastro),
        ])).status, 400);
        assert.equal(dados.db.prepare('SELECT papel FROM jogadores WHERE id = ?').get(jogadora).papel, 'mensalista');
        assert.equal(dados.getPapelHistorico(jogadora).length, 1);
        assert.equal((await lote('/elenco', [alterar(rotaJogadora, { ...cadastro, nivel: '9' })])).status, 400);
        assert.equal((await lote('/elenco', [alterar(rotaJogadora, cadastro)], 'invalido')).status, 403);
        assert.equal((await lote('/elenco', [alterar('/elenco/1/excluir', {})])).status, 400);
        console.log('OK: salvamento conjunto, rollback, ações separadas, checkbox, edição de jogadoras, histórico e CSRF.');
    } finally {
        if (dados?.db.open) dados.db.close();
        if (servidor && servidor.exitCode === null) {
            const encerrado = new Promise(resolve => servidor.once('exit', resolve));
            servidor.kill('SIGTERM');
            await encerrado;
        }
        fs.rmSync(temporario, { recursive: true, force: true });
    }
}
main().catch(err => { console.error(err); process.exitCode = 1; });
