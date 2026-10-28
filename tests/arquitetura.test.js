// Exercita as novas entradas com SQLite, HTTP e WhatsApp simulados, sem dados reais.
process.env.TZ = 'America/Sao_Paulo';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');

async function main() {
    const raiz = path.resolve(__dirname, '..');
    const temporario = fs.mkdtempSync(path.join(os.tmpdir(), 'fut-arquitetura-'));
    let servidor;
    let dados;
    try {
        for (const pasta of ['src', 'public']) fs.cpSync(path.join(raiz, pasta), path.join(temporario, pasta), { recursive: true });
        fs.mkdirSync(path.join(temporario, 'data'));
        fs.symlinkSync(path.join(raiz, 'node_modules'), path.join(temporario, 'node_modules'), 'dir');
        process.env.ADMIN_USER = 'teste-arquitetura';
        process.env.ADMIN_PASSWORD = 'senha-isolada';
        process.env.SESSION_SECRET = 'sessao-isolada';
        process.env.NODE_ENV = 'development';
        const carregar = createRequire(path.join(temporario, 'teste.js'));
        const App = carregar('./src/app');
        dados = carregar('./src/api/services/fut.service');
        const application = new App();
        assert.equal(typeof application.app.listen, 'function');
        servidor = await new Promise(resolve => {
            const http = application.app.listen(0, '127.0.0.1', () => resolve(http));
        });
        const base = `http://127.0.0.1:${servidor.address().port}`;
        const login = await fetch(base + '/login');
        assert.equal(login.status, 200);
        const cookie = login.headers.get('set-cookie').split(';')[0];
        const csrf = (await login.text()).match(/name="_csrf" value="([^"]+)"/)[1];
        const post = (rota, corpo) => fetch(base + rota, { method: 'POST', redirect: 'manual', headers: { Cookie: cookie }, body: new URLSearchParams({ _csrf: csrf, ...corpo }) });
        assert.equal((await post('/login', { usuario: 'teste-arquitetura', senha: 'senha-isolada' })).status, 302);
        for (const rota of ['/', '/usuarios', '/elenco', '/elenco/inativos', '/elenco/config', '/comandos', '/jogo/atual', '/jogo/config', '/enquete/config', '/jogos', '/pagamentos', '/pagamentos?aba=avulsas', '/pagamentos?aba=historico', '/caixa', '/mensal', '/mensagens', '/mensagens/automaticas', '/logs', '/configuracoes/aparencia']) {
            assert.equal((await fetch(base + rota, { headers: { Cookie: cookie } })).status, 200, rota);
            assert.equal((await fetch(base + rota, { redirect: 'manual' })).status, 302, `Autenticação: ${rota}`);
        }
        assert.equal((await fetch(base + '/votacao')).status, 200);
        for (const arquivo of ['/style.css', '/confirm.js', '/jogo-atual.js']) {
            assert.equal((await fetch(base + arquivo)).status, 200, `Arquivo público: ${arquivo}`);
        }
        assert.equal((await post('/usuarios', { usuario: 'novo-admin', senha: '123456', confirmarSenha: '123456' })).status, 302);
        assert.equal((await post('/usuarios', { usuario: 'novo-admin', senha: '123456', confirmarSenha: '123456' })).status, 200);
        const upload = new FormData();
        upload.set('_csrf', csrf);
        upload.set('logo', new Blob(['<svg xmlns="http://www.w3.org/2000/svg"/>'], { type: 'image/svg+xml' }), 'teste.svg');
        assert.equal((await fetch(base + '/configuracoes/aparencia/logo', { method: 'POST', redirect: 'manual', headers: { Cookie: cookie }, body: upload })).status, 302);
        assert.match(dados.getConfig('logo_url'), /^\/uploads\/logo.svg\?v=/);
        const imagem = await fetch(base + dados.getConfig('logo_url'));
        assert.equal(imagem.status, 200);
        assert.equal(await imagem.text(), '<svg xmlns="http://www.w3.org/2000/svg"/>');
        assert(fs.existsSync(path.join(temporario, 'public/uploads/logo.svg')));
        assert.equal((await post('/configuracoes/aparencia/logo/remover', {})).status, 302);
        assert.equal(dados.getConfig('logo_url'), '');
        const invalido = new FormData();
        invalido.set('_csrf', 'invalido');
        assert.equal((await fetch(base + '/configuracoes/aparencia/logo', { method: 'POST', headers: { Cookie: cookie }, body: invalido })).status, 403);
        // Factory de handlers não inicializa client nem dispara rotinas antes de ready.
        const criarHandlers = carregar('./src/api/services/whatsapp.service');
        const eventos = criarHandlers({ initialize() { assert.fail('Não deve conectar ao WhatsApp'); } });
        assert.deepEqual(Object.keys(eventos).sort(), ['change_state', 'disconnected', 'group_join', 'message', 'message_reaction', 'qr', 'ready', 'vote_update']);
        // Simula reinício completo das camadas e mantém o cookie de sessão existente.
        await new Promise(resolve => servidor.close(resolve));
        servidor = null;
        dados.db.close();
        for (const chave of Object.keys(require.cache)) if (chave.startsWith(temporario + path.sep)) delete require.cache[chave];
        const AppReiniciado = carregar('./src/app');
        dados = carregar('./src/api/services/fut.service');
        servidor = await new Promise(resolve => {
            const http = new AppReiniciado().app.listen(0, '127.0.0.1', () => resolve(http));
        });
        const reiniciado = `http://127.0.0.1:${servidor.address().port}`;
        assert.equal((await fetch(reiniciado + '/usuarios', { redirect: 'manual', headers: { Cookie: cookie } })).status, 200);
        console.log('OK: App MVC, páginas, autenticação, usuários, upload, CSRF, sessão após reinício e factory do bot sem conexão.');
    } finally {
        if (servidor) await new Promise(resolve => servidor.close(resolve));
        if (dados?.db.open) dados.db.close();
        fs.rmSync(temporario, { recursive: true, force: true });
    }
}
main().catch(erro => { console.error(erro); process.exitCode = 1; });
