// Banco e painel temporários; sem WhatsApp, Ollama ou grupos reais.
process.env.TZ = 'America/Sao_Paulo';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');

async function main() {
    const raiz = path.resolve(__dirname, '..');
    const temporario = fs.mkdtempSync(path.join(os.tmpdir(), 'fut-grupos-ia-'));
    let servidor;
    let dados;
    try {
        for (const pasta of ['src', 'public']) fs.cpSync(path.join(raiz, pasta), path.join(temporario, pasta), { recursive: true });
        fs.mkdirSync(path.join(temporario, 'data'));
        fs.symlinkSync(path.join(raiz, 'node_modules'), path.join(temporario, 'node_modules'), 'dir');
        process.env.ADMIN_USER = 'teste-grupos';
        process.env.ADMIN_PASSWORD = 'senha-isolada';
        process.env.SESSION_SECRET = 'sessao-isolada';
        process.env.NODE_ENV = 'development';
        const carregar = createRequire(path.join(temporario, 'teste.js'));
        const App = carregar('./src/app');
        dados = carregar('./src/api/services/fut.service');
        const { grupoPermitidoIa, criarExecutorComandosIa } = carregar('./src/api/services/comandos-ia');
        const { obterGruposIa, salvarGruposIa } = carregar('./src/api/services/grupos-ia.service');
        const principal = '120363111111111@g.us';
        const outro = '120363222222222@g.us';
        const bloqueado = '120363333333333@g.us';
        const legado = '123456789-123456789@g.us';
        dados.upsertGrupo(principal, 'Fut principal');
        dados.upsertGrupo(outro, 'Outro grupo <Teste>');
        dados.upsertGrupo(bloqueado, 'Grupo bloqueado');
        dados.setConfig('enquete_grupo_id', principal);
        dados.setConfig('llm_mensagens_ativa', '1');
        dados.setConfig('llm_comprovantes_ativa', '0');
        const jogador = dados.upsertJogador('5000@c.us', 'Teste', 'avulso', null);
        dados.definirPermissaoComando(jogador, true);
        servidor = await new Promise(resolve => {
            const http = new App().app.listen(0, '127.0.0.1', () => resolve(http));
        });
        const base = `http://127.0.0.1:${servidor.address().port}`;
        const rota = '/comandos?aba=grupos';
        assert.equal((await fetch(base + rota, { redirect: 'manual' })).status, 302);
        const login = await fetch(base + '/login');
        const cookie = login.headers.get('set-cookie').split(';')[0];
        const csrf = (await login.text()).match(/name="_csrf" value="([^"]+)"/)[1];
        const enviar = (destino, campos, token = csrf) => {
            const body = new URLSearchParams({ _csrf: token });
            for (const [campo, valor] of Object.entries(campos)) {
                for (const item of Array.isArray(valor) ? valor : [valor]) body.append(campo, item);
            }
            return fetch(base + destino, { method: 'POST', redirect: 'manual', headers: { Cookie: cookie }, body });
        };
        const salvar = (campos, token) => enviar('/comandos/grupos-ia', campos, token);
        assert.equal((await salvar({ modo: 'selecionados', grupos: [principal, outro] })).status, 302);
        assert.equal(dados.getConfig('llm_grupos_autorizados'), null, 'Não deve escrever antes do login');
        await enviar('/login', { usuario: 'teste-grupos', senha: 'senha-isolada' });
        const pagina = async () => {
            const resposta = await fetch(base + rota, { headers: { Cookie: cookie } });
            assert.equal(resposta.status, 200);
            return resposta.text();
        };
        let html = await pagina();
        assert(html.includes('Grupos da IA'));
        assert(html.includes('Outro grupo &lt;Teste&gt;'));
        assert.equal(obterGruposIa().modo, 'padrao');
        assert.equal(grupoPermitidoIa(dados.getConfig, principal), true);
        assert.equal(grupoPermitidoIa(dados.getConfig, outro), false);
        assert.equal((await salvar({ modo: 'selecionados', grupos: [principal, outro] }, 'invalido')).status, 403);
        assert.equal(dados.getConfig('llm_grupos_autorizados'), null);
        assert.equal((await salvar({ modo: 'selecionados', grupos: [principal, outro, outro] })).status, 302);
        assert.deepEqual(JSON.parse(dados.getConfig('llm_grupos_autorizados')), [principal, outro]);
        for (const id of [principal, outro]) assert.equal(grupoPermitidoIa(dados.getConfig, id), true);
        assert.equal(grupoPermitidoIa(dados.getConfig, bloqueado), false);
        assert.equal(dados.getConfig('enquete_grupo_id'), principal);
        assert.equal(dados.getConfig('llm_mensagens_ativa'), '1');
        assert.equal(dados.getConfig('llm_comprovantes_ativa'), '0');
        assert.equal(dados.podeUsarComandos('5000@c.us'), true);
        const salva = dados.getConfig('llm_grupos_autorizados');
        for (const campos of [
            { modo: 'todos' },
            { modo: 'selecionados', grupos: '5000@c.us' },
            { modo: 'selecionados', grupos: '999999@g.us' },
            { modo: 'selecionados', grupos: [principal, 'grupo-invalido'] },
        ]) {
            assert.equal((await salvar(campos)).status, 400);
            assert.equal(dados.getConfig('llm_grupos_autorizados'), salva);
        }
        // O executor real consulta a mesma configuração salva pela tela.
        const executados = [];
        let consultas = 0;
        let pessoaAutorizada = true;
        let revogarDuranteConsulta = false;
        const executor = criarExecutorComandosIa({
            llm: { habilitada: () => true, interpretarPedido: async () => {
                consultas++;
                if (revogarDuranteConsulta) salvarGruposIa({ modo: 'selecionados', grupos: outro });
                return { intencao: 'lista', nomes: [] };
            } },
            grupoAutorizado: id => grupoPermitidoIa(dados.getConfig, id),
            botMencionado: async msg => msg.mentionedIds.includes('bot@c.us'),
            autorizado: async () => pessoaAutorizada,
            obterContexto: async () => ({ grupo: principal, enqueteId: 1 }),
            sincronizar: async () => {}, registrarErro: () => assert.fail('Erro inesperado'),
            acoes: { lista: async msg => executados.push(msg.from) },
        });
        const mensagem = from => ({ from, body: 'me manda a lista', mentionedIds: ['bot@c.us'], reply: async () => {} });
        for (const id of [principal, outro, bloqueado]) await executor.tratar(mensagem(id));
        assert.deepEqual(executados, [principal, outro]);
        assert.equal(consultas, 2);
        await executor.tratar({ ...mensagem(outro), mentionedIds: [] });
        pessoaAutorizada = false;
        await executor.tratar(mensagem(outro));
        assert.equal(consultas, 2);
        pessoaAutorizada = true;
        revogarDuranteConsulta = true;
        await executor.tratar(mensagem(principal));
        assert.equal(consultas, 3);
        assert.deepEqual(executados, [principal, outro], 'Revogação durante a consulta impede a ação');
        // Configurações por CLI não desaparecem quando o grupo não está sincronizado.
        dados.setConfig('llm_grupos_autorizados', JSON.stringify([legado]));
        assert((await pagina()).includes(legado));
        assert.equal((await salvar({ modo: 'selecionados', grupos: [legado, outro] })).status, 302);
        assert.equal((await salvar({ modo: 'selecionados' })).status, 302);
        assert.equal(dados.getConfig('llm_grupos_autorizados'), '[]');
        assert.equal(grupoPermitidoIa(dados.getConfig, principal), false);
        assert.equal((await salvar({ modo: 'padrao' })).status, 302);
        assert.equal(grupoPermitidoIa(dados.getConfig, principal), true);
        assert.equal(grupoPermitidoIa(dados.getConfig, outro), false);
        dados.setConfig('llm_grupos_autorizados', 'invalida');
        assert((await pagina()).includes('nenhum grupo está liberado'));
        assert.equal(grupoPermitidoIa(dados.getConfig, principal), false);
        assert.equal((await salvar({ modo: 'selecionados', grupos: [principal, outro] })).status, 302);
        // Verifica as seleções e o formulário real em desktop e celular.
        const browser = await require('puppeteer').launch({ headless: true, executablePath: '/usr/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
        try {
            const page = await browser.newPage();
            await page.setCookie({ name: cookie.split('=')[0], value: decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1)), url: base });
            for (const width of [1280, 390]) {
                await page.setViewport({ width, height: 900 });
                await page.goto(base + rota);
                assert.equal(await page.$$eval('input[name="grupos"]:checked', els => els.length), 2);
                assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'A aba de grupos deve caber na tela');
            }
            await page.click(`input[name="grupos"][value="${outro}"]`);
            await Promise.all([page.waitForNavigation(), page.click('input[value="Salvar grupos da IA"]')]);
            assert.deepEqual(JSON.parse(dados.getConfig('llm_grupos_autorizados')), [principal]);
        } finally { await browser.close(); }
        console.log('OK: seleção de vários grupos, painel, persistência, autenticação, CSRF, menção, whitelist, revogação e layout desktop/celular.');
    } finally {
        if (servidor) await new Promise(resolve => servidor.close(resolve));
        if (dados?.db.open) dados.db.close();
        fs.rmSync(temporario, { recursive: true, force: true });
    }
}
main().catch(erro => { console.error(erro); process.exitCode = 1; });
