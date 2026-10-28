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
        dados.setConfig('valor_mensal', '60');
        dados.setConfig('valor_avulso', '15');
        const get = rota => fetch(base + rota, { headers: { Cookie: cookie } });
        assert.equal((await get('/caixa')).status, 200);
        assert.equal((await post('/caixa/iniciar', { saldo:'100' })).status, 403);
        assert.equal((await post('/caixa/iniciar', { _csrf:csrf, saldo:'100' })).status, 302);
        const jogadora = dados.db.prepare("INSERT INTO jogadores(nome,papel) VALUES ('Teste caixa','mensalista')").run().lastInsertRowid;
        assert.equal((await post('/pagamentos/mensalistas/' + jogadora + '/toggle', { _csrf:csrf, mes:'2026-10' })).status, 302);
        const hoje = dados.dataCaixaAtual();
        assert.equal((await post('/caixa/lancamentos', { _csrf:csrf, tipo:'gasto', valor:'25', data:hoje, descricao:'Teste quadra', categoria:'Quadra' })).status, 302);
        const html = await (await get('/caixa')).text();
        assert(html.includes('Teste quadra'));
        assert(html.includes('Pagamento automático'));
        assert(html.includes('135,00'));
        const gasto = dados.db.prepare("SELECT id FROM caixa_lancamentos WHERE tipo = 'gasto'").get().id;
        assert.equal((await post('/caixa/lancamentos/' + gasto + '/cancelar', { _csrf:'errado' })).status, 403);
        await post('/caixa/lancamentos/' + gasto + '/cancelar', { _csrf:csrf });
        assert((await (await get('/caixa')).text()).includes('Cancelado'));
        const invalido = await post('/caixa/lancamentos', { _csrf:csrf, tipo:'gasto', valor:'-1', data:hoje, descricao:'Inválido', categoria:'Quadra' });
        assert(invalido.headers.get('location').includes('erro='));
        const anterior = await (await get('/caixa?mes=2020-01')).text();
        assert(anterior.includes('Nenhuma movimentação neste mês.'));
        assert(anterior.includes('160,00')); // saldo atual permanece igual ao mudar o filtro
        assert((await fetch(base + '/caixa', { redirect:'manual' })).headers.get('location').includes('/login'));
        const enquete = dados.db.prepare("INSERT INTO enquetes(message_id,group_id,titulo) VALUES ('historico-teste','teste','Jogo de teste antigo')").run().lastInsertRowid;
        dados.marcarPagamentoAvulso(jogadora, enquete);
        const hist = await (await get('/pagamentos?aba=historico')).text();
        assert(hist.includes('Manual · painel'));
        assert(hist.includes('Comprovante · bot'));
        assert(hist.includes('Jogo de teste antigo'));
        assert(hist.includes('Mensalidade · 10/2026'));
        const filtro = await (await get('/pagamentos?aba=historico&tipo=avulso&jogo=' + enquete)).text();
        assert(!filtro.includes('Mensalidade · 10/2026'));
        assert((await (await get('/pagamentos?aba=historico&busca=Inexistente')).text()).includes('Nenhum registro encontrado.'));
        assert.equal((await get('/pagamentos?aba=avulsas&jogo=' + enquete)).status, 200);
        const puppeteer = require('puppeteer');
        const browser = await puppeteer.launch({ headless:true, executablePath:'/usr/bin/chromium', args:['--no-sandbox','--disable-dev-shm-usage'] });
        try {
            const pagina = await browser.newPage();
            await pagina.setCookie({ name:cookie.split('=')[0], value:decodeURIComponent(cookie.slice(cookie.indexOf('=')+1)), url:base });
            for (const width of [1280,390]) {
                await pagina.setViewport({ width, height:900 });
                const resposta = await pagina.goto(base + '/caixa');
                assert([200,304].includes(resposta.status()));
                assert.equal(await pagina.$eval('h1', el => el.textContent), 'Caixa');
                await pagina.goto(base + '/pagamentos?aba=historico');
                assert.equal(await pagina.$eval('h1', el => el.textContent), 'Pagamentos');
                assert(await pagina.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Página não deve transbordar');
            }
        } finally { await browser.close(); }
        console.log('OK: caixa no painel, autenticação, CSRF, pagamento integrado, lançamento, cancelamento, filtro e layouts desktop/celular.');
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
