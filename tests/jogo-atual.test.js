// Executar com: node tests/jogo-atual.test.js. Usa banco e painel temporários, sem bot.
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
    const temporario = fs.mkdtempSync(path.join(os.tmpdir(), 'fut-jogo-'));
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
        const html = async rota => {
            const resposta = await fetch(base + rota, { headers: { Cookie: cookie } });
            assert.equal(resposta.status, 200, rota);
            return resposta.text();
        };
        assert.match(await html('/'), /Nenhuma enquete enviada/);
        assert.match(await html('/jogo/atual'), /Nenhum jogo em acompanhamento/);
        const inserir = dados.db.prepare('INSERT INTO jogadores (nome, papel) VALUES (?, ?)');
        const ana = Number(inserir.run('Ana de teste', 'mensalista').lastInsertRowid);
        const bia = Number(inserir.run('Bia de teste', 'avulso').lastInsertRowid);
        const clara = Number(inserir.run('Clara de teste', 'avulso').lastInsertRowid);
        const jogo = Number(dados.db.prepare("INSERT INTO enquetes (message_id, group_id, titulo, vagas_maximo) VALUES ('teste-jogo', 'teste@g.us', 'Jogo de teste', 2)").run().lastInsertRowid);
        const votar = dados.db.prepare("INSERT INTO votos (enquete_id, jogador_id, opcao, papel, votado_em) VALUES (?, ?, 'Vou', ?, ?)");
        votar.run(jogo, ana, 'mensalista', '2026-10-01 10:00:00');
        votar.run(jogo, bia, 'avulso', '2026-10-01 10:00:01');
        votar.run(jogo, clara, 'avulso', '2026-10-01 10:00:02');
        const mes = carregar('./mensagens-prontas').mesReferenciaAtual(new Date(), Number(dados.getConfig('enquete_dia_semana')));
        // Um pagamento mensal de uma avulsa não quita a mensalidade de outra jogadora.
        dados.db.prepare('INSERT INTO pagamentos (jogador_id, mes_referencia, pago) VALUES (?, ?, 1)').run(bia, mes);
        let inicio = await html('/');
        assert.match(inicio, /<strong>2\/2<\/strong> com vaga/);
        assert.match(inicio, /<strong>1<\/strong> na espera/);
        assert.match(inicio, /0 de 1 mensalistas com pagamento registrado/);
        assert.match(await html('/jogo/atual?aba=presenca'), /Jogadoras com vaga/);
        assert.match(await html('/jogo/atual?aba=espera'), /Clara de teste/);
        assert.match(await html('/jogo/atual?aba=times'), /Sorteio dos times/);
        for (const [origem, destino] of [['/confirmados', '/jogo/atual?aba=presenca'], ['/times', '/jogo/atual?aba=times']]) {
            const resposta = await fetch(base + origem, { headers: { Cookie: cookie }, redirect: 'manual' });
            assert.equal(resposta.status, 302);
            assert.equal(resposta.headers.get('location'), destino);
        }
        let resposta = await post(`/jogos/${jogo}/confirmar/${ana}/remover`, { _csrf: csrf, voltarAtual: '1' });
        assert.equal(resposta.status, 302);
        assert(resposta.headers.get('location').startsWith('/jogo/atual'));
        assert.equal(dados.getListaDeEsperaDaEnquete(jogo).length, 0);
        resposta = await post(`/jogos/${jogo}/confirmar`, { _csrf: csrf, voltarAtual: '1', jogador_id: String(ana) });
        assert(resposta.headers.get('location').startsWith('/jogo/atual'));
        resposta = await post(`/jogos/${jogo}/confirmar`, { _csrf: csrf, jogador_id: String(ana) });
        assert(resposta.headers.get('location').startsWith('/jogos/' + jogo));
        dados.setAusentesDaEnquete(jogo, [ana, bia]);
        const semPresentes = await html('/jogo/atual?aba=times');
        assert.match(semPresentes, /menos de 2 presentes/);
        assert(semPresentes.includes(`name="dest_${ana}"`));
        dados.setAusentesDaEnquete(jogo, []);
        const ejs = require('ejs');
        const tresTimes = Array.from({ length: 15 }, (_, i) => ({ id: i + 100, nome: 'Teste ' + i, nivel: 3, posicao: 'meio' }));
        const plano = carregar('./mensagens-prontas').montarPlanoDeTimes(tresTimes, 5);
        const destinos = {};
        plano.times.forEach((time, i) => time.forEach(j => { destinos[j.id] = 'ABC'[i]; }));
        const modelo = fs.readFileSync(path.join(raiz, 'panel/views/_jogo-times.ejs'), 'utf8');
        const escala = ejs.render(modelo, { enquete: { id: jogo }, plano, confirmados: tresTimes, destinos, modoManual: false, csrfToken: 'teste' });
        assert.match(escala, /data-time-card="C"/);
        assert.equal((escala.match(/data-time-jogadora data-nivel/g) || []).length, 15);
        dados.setConfig('enquete_grupo_id', 'teste@g.us');
        const proximo = Number(dados.db.prepare("INSERT INTO enquetes (message_id, group_id, titulo, vagas_maximo) VALUES ('teste-novo', 'teste@g.us', 'Nova enquete', 12)").run().lastInsertRowid);
        resposta = await post('/confirmados/enviar-lista', { _csrf: csrf, enqueteId: String(jogo) });
        assert.equal(resposta.status, 302);
        assert.equal(dados.db.prepare('SELECT fechada_em FROM enquetes WHERE id = ?').get(proximo).fechada_em, null);
        resposta = await post('/times/ausentes', { _csrf: csrf, enqueteId: String(jogo), ['dest_' + ana]: 'ausente' });
        assert.match(decodeURIComponent(resposta.headers.get('location')), /nova enquete/);
        resposta = await post('/times/enviar', { _csrf: csrf, enqueteId: String(jogo) });
        assert.match(decodeURIComponent(resposta.headers.get('location')), /nova enquete/);
        resposta = await post('/confirmados/enviar-lista', { _csrf: 'invalido', enqueteId: String(proximo) });
        assert.equal(resposta.status, 403);
        console.log('OK: início vazio, vagas e espera, pagamentos, abas, atalhos antigos, confirmação manual, proteção contra enquete desatualizada e CSRF.');
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
