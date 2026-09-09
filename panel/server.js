process.env.TZ = 'America/Sao_Paulo'; // mesmo fuso do bot, pra data/hora bater com o que o admin configura

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

// 💥 erro não tratado (bug real) — mais seguro encerrar e deixar o Docker/Fly reiniciar o
// processo (que reinicia o bot junto, ver docker-entrypoint.sh) do que seguir em estado desconhecido
process.on('unhandledRejection', (motivo) => {
    console.error('🔥 unhandledRejection não tratada — encerrando processo:', motivo);
    process.exit(1);
});

process.on('uncaughtException', (err) => {
    console.error('🔥 uncaughtException não tratada — encerrando processo:', err);
    process.exit(1);
});

const crypto = require('crypto');
const express = require('express');
const expressLayouts = require('express-ejs-layouts');
const session = require('express-session');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const SqliteSessionStore = require('./sqlite-session-store');
const {
    db,
    getConfig,
    setConfig,
    getGrupos,
    getLogs,
    contarLogs,
    getEnqueteOpcoes,
    criarMensagemUnica,
    criarMensagemSemanal,
    atualizarMensagemUnica,
    atualizarMensagemSemanal,
    getMensagensAgendadas,
    excluirMensagemAgendada,
    registrarMudancaPapel,
    getPapelHistorico,
    getConfirmadosDaEnquete,
    getListaDeEsperaDaEnquete,
    getAvaliacoesDaEnquete,
    registrarAvaliacao,
    criarEnvioImediato,
    fecharEnquete,
    getJogadoresParaPermissao,
    definirPermissaoComando,
    reativarJogador,
} = require('../db');
const {
    balancearTimes, montarTextoListaConfirmadas, montarTextoTimes,
    fechamentoMensalDoMes, mesReferenciaAtual,
} = require('../mensagens-prontas');

const PORT = process.env.PORT || 4000;

function bootstrapAdmin() {
    const count = db.prepare('SELECT COUNT(*) AS c FROM admin_users').get().c;
    if (count > 0) return;

    const usuario = process.env.ADMIN_USER || 'admin';
    const senha = process.env.ADMIN_PASSWORD;
    if (!senha) {
        throw new Error(
            'Nenhum admin_users cadastrado e ADMIN_PASSWORD não definido no .env',
        );
    }

    const hash = bcrypt.hashSync(senha, 10);
    db.prepare(
        'INSERT INTO admin_users (usuario, senha_hash) VALUES (?, ?)',
    ).run(usuario, hash);
    console.log(`👤 Usuário admin "${usuario}" criado a partir do .env`);
}

bootstrapAdmin();

// serializa pra embutir num <script> sem risco de fechar a tag com dado de usuário
// (JSON.stringify por si só não escapa </script>, <, > nem &)
function jsonParaScript(valor) {
    return JSON.stringify(valor)
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .replace(/&/g, '\\u0026');
}

// as colunas *_em do banco (criado_em, alterado_em, fechada_em etc.) são gravadas com
// datetime('now') do SQLite, que é sempre UTC — sem isso o painel mostra tudo 3h adiantado
// em relação ao horário de Brasília. Convertemos só na hora de exibir, aqui.
function formatarDataHora(valorUtc) {
    if (!valorUtc) return '';
    const data = new Date(`${valorUtc.replace(' ', 'T')}Z`);
    if (Number.isNaN(data.getTime())) return valorUtc;
    return data.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

const app = express();
app.set('trust proxy', 1); // atrás do proxy TLS do Fly — necessário pro cookie "secure" saber que a conexão é https
app.set('view engine', 'ejs');
app.locals.jsonParaScript = jsonParaScript;
app.locals.formatarDataHora = formatarDataHora;
app.set('views', path.join(__dirname, 'views'));
app.set('layout', 'layout');
// CSP desligado: o painel usa <script> inline em várias views sem nonce, e o padrão do
// helmet bloquearia todas elas. Os outros cabeçalhos de segurança (X-Frame-Options,
// X-Content-Type-Options, HSTS etc) continuam ativos.
app.use(helmet({ contentSecurityPolicy: false }));
app.use(expressLayouts);
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: false }));
app.use(
    session({
        store: new SqliteSessionStore(db),
        secret: process.env.SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        // secure só em produção (Dockerfile seta NODE_ENV=production): local roda em HTTP puro,
        // sem o proxy HTTPS do Fly, e cookie secure nunca seria enviado pelo browser — sessão
        // nunca persistiria e o CSRF sempre falharia ("Sessão expirada")
        cookie: { maxAge: 1000 * 60 * 60 * 12, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' },
    }),
);

// token CSRF por sessão (synchronizer token pattern) — gerado uma vez e reaproveitado
// enquanto a sessão durar. csurf está deprecado, então isso é feito à mão: toda view com
// formulário manda esse token de volta num campo _csrf, e o middleware abaixo confere
app.use((req, res, next) => {
    if (!req.session.csrfToken) {
        req.session.csrfToken = crypto.randomBytes(24).toString('hex');
    }
    res.locals.csrfToken = req.session.csrfToken;
    next();
});

function csrfValido(req) {
    return !!req.body && req.body._csrf === req.session.csrfToken;
}

app.use((req, res, next) => {
    if (req.method !== 'POST') return next();
    // multipart (upload de logo) não passa pelo express.urlencoded — a própria rota confere
    // o token depois que o multer processa o corpo da requisição
    if (req.is('multipart/form-data')) return next();
    if (csrfValido(req)) return next();
    return res.status(403).send('Sessão expirada ou formulário desatualizado. Recarregue a página e tente de novo.');
});

// disponíveis em toda view/layout sem precisar passar em cada res.render
app.use((req, res, next) => {
    res.locals.usuario = req.session ? req.session.usuario : null;
    res.locals.caminhoAtual = req.path;
    res.locals.logoUrlSidebar = getConfig('logo_url');
    res.locals.jogadorasInativasCount = db.prepare('SELECT COUNT(*) c FROM jogadores WHERE ativo = 0').get().c;
    next();
});

function requireLogin(req, res, next) {
    if (req.session && req.session.userId) return next();
    return res.redirect('/login');
}

// redireciona com uma mensagem de sucesso na query, pra dar feedback visual
// mesmo quando a página recarrega rápido demais pra "sentir" que salvou
function redirectOk(res, caminho, mensagem) {
    const separador = caminho.includes('?') ? '&' : '?';
    res.redirect(caminho + separador + 'ok=' + encodeURIComponent(mensagem));
}

const POSICOES_VALIDAS = ['goleira', 'defesa', 'meio', 'ataque', 'indefinida'];
const posicaoValida = (p) => (POSICOES_VALIDAS.includes(p) ? p : 'indefinida');

// ---------- UPLOAD DA LOGO ----------

const uploadsDir = path.join(__dirname, 'public', 'uploads');
const EXTENSOES_PERMITIDAS = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/svg+xml': '.svg', 'image/webp': '.webp' };

const uploadLogo = multer({
    storage: multer.diskStorage({
        destination: uploadsDir,
        filename: (req, file, cb) => cb(null, 'logo' + EXTENSOES_PERMITIDAS[file.mimetype]),
    }),
    limits: { fileSize: 2 * 1024 * 1024 },
    fileFilter: (req, file, cb) => cb(null, !!EXTENSOES_PERMITIDAS[file.mimetype]),
});

// ---------- LOGIN ----------

app.get('/login', (req, res) => {
    res.render('login', { erro: null, logoUrl: getConfig('logo_url'), layout: 'layout-auth' });
});

app.post('/login', (req, res) => {
    const { usuario, senha } = req.body;
    const user = db
        .prepare('SELECT * FROM admin_users WHERE usuario = ?')
        .get(usuario);

    if (!user || !bcrypt.compareSync(senha || '', user.senha_hash)) {
        return res.render('login', {
            erro: 'Usuário ou senha inválidos.',
            logoUrl: getConfig('logo_url'),
            layout: 'layout-auth',
        });
    }

    req.session.userId = user.id;
    req.session.usuario = user.usuario;
    res.redirect('/');
});

app.post('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/login'));
});

// ---------- DASHBOARD (confirmados da última enquete) ----------

function carregarVotosAgrupados(enqueteId) {
    const votos = db
        .prepare(
            `SELECT j.id AS jogador_id, v.opcao, v.votado_em, j.nome, j.papel, j.nivel
             FROM votos v
             JOIN jogadores j ON j.id = v.jogador_id
             WHERE v.enquete_id = ?
             ORDER BY v.votado_em ASC`,
        )
        .all(enqueteId);

    const grupos = {};
    getEnqueteOpcoes().forEach((o) => {
        grupos[o.texto] = [];
    });
    votos.forEach((v) => {
        if (!grupos[v.opcao]) grupos[v.opcao] = [];
        grupos[v.opcao].push(v);
    });

    return { votos, grupos };
}

app.get('/confirmados', requireLogin, (req, res) => {
    const enquete = db
        .prepare('SELECT * FROM enquetes ORDER BY id DESC LIMIT 1')
        .get();

    const { votos, grupos } = enquete
        ? carregarVotosAgrupados(enquete.id)
        : { votos: [], grupos: {} };

    const jogadores = db.prepare('SELECT id, nome, papel FROM jogadores ORDER BY nome ASC').all();
    const listaDeEspera = enquete ? getListaDeEsperaDaEnquete(enquete.id) : [];

    res.render('confirmados', {
        enquete,
        grupos,
        totalVotos: votos.length,
        jogadores,
        listaDeEspera,
        ok: req.query.ok,
    });
});

app.post('/confirmados/enviar-lista', requireLogin, (req, res) => {
    const grupoId = getConfig('enquete_grupo_id');
    if (!grupoId) {
        return redirectOk(res, '/confirmados', 'Configure o grupo de destino em Configurações → Enquete antes de mandar.');
    }

    const enquete = db.prepare('SELECT * FROM enquetes ORDER BY id DESC LIMIT 1').get();
    if (!enquete) return res.redirect('/confirmados');

    const confirmados = getConfirmadosDaEnquete(enquete.id);
    const texto = montarTextoListaConfirmadas(enquete, confirmados);
    criarEnvioImediato(grupoId, texto, 'lista');
    fecharEnquete(enquete.id); // novos votos passam a ser ignorados; o bot desafixa a enquete no próximo minuto

    redirectOk(res, '/confirmados', 'Lista enviada e enquete fechada! Pode levar até 1 minuto pra aparecer no grupo.');
});

// ---------- HOME (resumo geral) ----------

app.get('/', requireLogin, (req, res) => {
    const mes = mesReferenciaAtual();

    const proximoJogo = db
        .prepare('SELECT * FROM enquetes ORDER BY id DESC LIMIT 1')
        .get();

    const confirmadosProximoJogo = proximoJogo
        ? db
              .prepare(
                  'SELECT COUNT(*) AS c FROM votos WHERE enquete_id = ? AND papel IS NOT NULL',
              )
              .get(proximoJogo.id).c
        : 0;

    const totalJogadores = db.prepare('SELECT COUNT(*) AS c FROM jogadores').get().c;
    const totalMensalistas = db
        .prepare("SELECT COUNT(*) AS c FROM jogadores WHERE papel = 'mensalista'")
        .get().c;
    const totalAvulsos = totalJogadores - totalMensalistas;

    const pagamentosMes = db
        .prepare(
            `SELECT
                (SELECT COUNT(*) FROM jogadores WHERE papel = 'mensalista') AS devem,
                (SELECT COUNT(*) FROM pagamentos WHERE mes_referencia = ? AND pago = 1) AS pagos`,
        )
        .get(mes);
    const pendentes = Math.max(0, pagamentosMes.devem - pagamentosMes.pagos);

    const ultimosJogos = db
        .prepare(
            `SELECT e.*,
                    (SELECT COUNT(*) FROM votos v WHERE v.enquete_id = e.id AND v.papel IS NOT NULL) AS confirmados
             FROM enquetes e
             ORDER BY e.id DESC
             LIMIT 5`,
        )
        .all();

    res.render('home', {
        proximoJogo,
        confirmadosProximoJogo,
        totalJogadores,
        totalMensalistas,
        totalAvulsos,
        pagamentosMes,
        pendentes,
        mes,
        ultimosJogos,
    });
});

// ---------- HISTÓRICO DE JOGOS ----------

app.get('/jogos', requireLogin, (req, res) => {
    const jogos = db
        .prepare(
            `SELECT e.*,
                    (SELECT COUNT(*) FROM votos v WHERE v.enquete_id = e.id AND v.papel IS NOT NULL) AS confirmados,
                    (SELECT COUNT(*) FROM votos v WHERE v.enquete_id = e.id) AS total_respostas
             FROM enquetes e
             ORDER BY e.id DESC`,
        )
        .all();

    res.render('jogos', { usuario: req.session.usuario, jogos });
});

app.get('/jogos/:id', requireLogin, (req, res) => {
    const enquete = db
        .prepare('SELECT * FROM enquetes WHERE id = ?')
        .get(Number(req.params.id));
    if (!enquete) return res.redirect('/jogos');

    const { votos, grupos } = carregarVotosAgrupados(enquete.id);
    const jogadores = db.prepare('SELECT id, nome, papel FROM jogadores ORDER BY nome ASC').all();

    res.render('jogo-detalhe', {
        usuario: req.session.usuario,
        enquete,
        grupos,
        totalVotos: votos.length,
        jogadores,
        ok: req.query.ok,
    });
});

app.post('/jogos/:id/excluir', requireLogin, (req, res) => {
    const enqueteId = Number(req.params.id);
    db.prepare('DELETE FROM enquetes WHERE id = ?').run(enqueteId);
    redirectOk(res, '/jogos', 'Jogo excluído.');
});

// confirma manualmente uma jogadora que não respondeu (ou respondeu errado) a enquete no WhatsApp;
// reaproveita o texto da opção configurada pro papel escolhido, pra ficar igual a um voto de verdade
function textoOpcaoParaPapel(papel) {
    const opcao = getEnqueteOpcoes().find((o) => o.papel === papel);
    if (opcao) return opcao.texto;
    return papel === 'mensalista' ? 'Eu vou (MENSALISTAS)' : 'Eu quero (AVULSAS)';
}

app.post('/jogos/:id/confirmar', requireLogin, (req, res) => {
    const enqueteId = Number(req.params.id);
    const jogadorId = Number(req.body.jogador_id);

    const enquete = db.prepare('SELECT id FROM enquetes WHERE id = ?').get(enqueteId);
    const jogador = db.prepare('SELECT id, nome, papel FROM jogadores WHERE id = ?').get(jogadorId);
    if (!enquete || !jogador) return res.redirect('/jogos/' + enqueteId);

    // papel da confirmação segue o papel cadastrado da jogadora (lista de mensalistas em
    // /elenco), não é mais escolhido na hora — mantém coerência com o pagamento dela
    const papel = jogador.papel === 'mensalista' ? 'mensalista' : 'avulso';

    db.prepare(
        `INSERT INTO votos (enquete_id, jogador_id, opcao, papel)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(enquete_id, jogador_id) DO UPDATE SET
             opcao = excluded.opcao,
             papel = excluded.papel,
             votado_em = datetime('now')`,
    ).run(enqueteId, jogadorId, textoOpcaoParaPapel(papel), papel);

    redirectOk(res, '/jogos/' + enqueteId, `${jogador.nome} confirmada manualmente!`);
});

app.post('/jogos/:id/confirmar/:jogadorId/remover', requireLogin, (req, res) => {
    const enqueteId = Number(req.params.id);
    const jogadorId = Number(req.params.jogadorId);

    db.prepare('DELETE FROM votos WHERE enquete_id = ? AND jogador_id = ?').run(enqueteId, jogadorId);

    redirectOk(res, '/jogos/' + enqueteId, 'Confirmação removida.');
});

// ---------- PAGAMENTOS ----------

app.get('/pagamentos', requireLogin, (req, res) => {
    const query = req.query.mes ? '?mes=' + encodeURIComponent(req.query.mes) : '';
    res.redirect('/pagamentos/mensalistas' + query);
});

app.get('/pagamentos/mensalistas', requireLogin, (req, res) => {
    const mes = req.query.mes || mesReferenciaAtual();

    const jogadores = db
        .prepare(
            `SELECT j.id, j.nome,
                    p.pago AS pago
             FROM jogadores j
             LEFT JOIN pagamentos p
                    ON p.jogador_id = j.id AND p.mes_referencia = ?
             WHERE j.papel = 'mensalista'
             ORDER BY j.nome ASC`,
        )
        .all(mes);

    res.render('pagamentos-mensalistas', { usuario: req.session.usuario, jogadores, mes, ok: req.query.ok });
});

app.post('/pagamentos/mensalistas/:jogadorId/toggle', requireLogin, (req, res) => {
    const mes = req.body.mes || mesReferenciaAtual();
    const jogadorId = Number(req.params.jogadorId);

    const atual = db
        .prepare(
            'SELECT * FROM pagamentos WHERE jogador_id = ? AND mes_referencia = ?',
        )
        .get(jogadorId, mes);

    if (atual) {
        db.prepare(
            "UPDATE pagamentos SET pago = ?, atualizado_em = datetime('now') WHERE id = ?",
        ).run(atual.pago ? 0 : 1, atual.id);
    } else {
        db.prepare(
            'INSERT INTO pagamentos (jogador_id, mes_referencia, pago) VALUES (?, ?, 1)',
        ).run(jogadorId, mes);
    }

    redirectOk(res, '/pagamentos/mensalistas?mes=' + encodeURIComponent(mes), 'Pagamento atualizado!');
});

app.get('/pagamentos/avulsos', requireLogin, (req, res) => {
    const enquete = db.prepare('SELECT * FROM enquetes ORDER BY id DESC LIMIT 1').get();

    let jogadores = [];
    if (enquete) {
        const confirmados = getConfirmadosDaEnquete(enquete.id).filter((j) => j.papel === 'avulso');
        const statusStmt = db.prepare(
            'SELECT pago FROM pagamentos_avulsos WHERE jogador_id = ? AND enquete_id = ?',
        );
        jogadores = confirmados.map((j) => ({
            id: j.id,
            nome: j.nome,
            pago: !!statusStmt.get(j.id, enquete.id)?.pago,
        }));
    }

    res.render('pagamentos-avulsos', { usuario: req.session.usuario, enquete, jogadores, ok: req.query.ok });
});

app.post('/pagamentos/avulsos/:jogadorId/toggle', requireLogin, (req, res) => {
    const jogadorId = Number(req.params.jogadorId);
    const enqueteId = Number(req.body.enqueteId);

    const atual = db
        .prepare('SELECT * FROM pagamentos_avulsos WHERE jogador_id = ? AND enquete_id = ?')
        .get(jogadorId, enqueteId);

    if (atual) {
        db.prepare(
            "UPDATE pagamentos_avulsos SET pago = ?, atualizado_em = datetime('now') WHERE id = ?",
        ).run(atual.pago ? 0 : 1, atual.id);
    } else {
        db.prepare(
            'INSERT INTO pagamentos_avulsos (jogador_id, enquete_id, pago) VALUES (?, ?, 1)',
        ).run(jogadorId, enqueteId);
    }

    redirectOk(res, '/pagamentos/avulsos', 'Pagamento atualizado!');
});

// ---------- ELENCO ----------

app.get('/elenco', requireLogin, (req, res) => {
    const jogadores = db
        .prepare('SELECT * FROM jogadores WHERE ativo = 1 ORDER BY nome ASC')
        .all();
    res.render('elenco', { usuario: req.session.usuario, jogadores, ok: req.query.ok });
});

app.get('/elenco/inativos', requireLogin, (req, res) => {
    const jogadores = db
        .prepare('SELECT * FROM jogadores WHERE ativo = 0 ORDER BY nome ASC')
        .all();
    res.render('elenco-inativos', { usuario: req.session.usuario, jogadores, ok: req.query.ok });
});

app.post('/elenco', requireLogin, (req, res) => {
    const { nome, telefone, nivel, papel, posicao } = req.body;
    if (!nome || !nome.trim()) return res.redirect('/elenco');

    db.prepare(
        'INSERT INTO jogadores (nome, telefone, nivel, papel, posicao) VALUES (?, ?, ?, ?, ?)',
    ).run(
        nome.trim(),
        telefone || null,
        Number(nivel) || 3,
        papel === 'mensalista' ? 'mensalista' : 'avulso',
        posicaoValida(posicao),
    );

    redirectOk(res, '/elenco', `${nome.trim()} adicionado!`);
});

// ---------- CONFIGURAÇÃO DO ELENCO (precisa vir antes de /elenco/:id) ----------

app.get('/elenco/config', requireLogin, (req, res) => {
    res.render('elenco-config', {
        usuario: req.session.usuario,
        autoIncluir: getConfig('elenco_auto_incluir_grupo') === '1',
        grupos: getGrupos(),
        ok: req.query.ok,
    });
});

app.post('/elenco/config/sincronizar', requireLogin, (req, res) => {
    const grupoId = req.body.grupoId;
    if (!grupoId) return res.redirect('/elenco/config');

    setConfig('sincronizar_grupo_pendente', grupoId);
    redirectOk(res, '/elenco/config', 'Sincronização solicitada! Pode levar até 1 minuto — confira em Logs.');
});

app.post('/elenco/config', requireLogin, (req, res) => {
    setConfig('elenco_auto_incluir_grupo', req.body.autoIncluir === 'on' ? '1' : '0');
    redirectOk(res, '/elenco/config', 'Configuração salva!');
});

app.post('/elenco/salvar-todas', requireLogin, (req, res) => {
    const arr = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
    const ids = arr(req.body.id);
    const nomes = arr(req.body.nome);
    const telefones = arr(req.body.telefone);
    const niveis = arr(req.body.nivel);
    const papeis = arr(req.body.papel);
    const posicoes = arr(req.body.posicao);

    const salvarTodas = db.transaction(() => {
        ids.forEach((idStr, i) => {
            const nome = (nomes[i] || '').trim();
            if (!nome) return;

            const id = Number(idStr);
            const atual = db.prepare('SELECT papel FROM jogadores WHERE id = ?').get(id);
            if (!atual) return;

            const papelNovo = papeis[i] === 'mensalista' ? 'mensalista' : 'avulso';

            db.prepare(
                'UPDATE jogadores SET nome = ?, telefone = ?, nivel = ?, papel = ?, posicao = ? WHERE id = ?',
            ).run(nome, telefones[i] || null, Number(niveis[i]) || 3, papelNovo, posicaoValida(posicoes[i]), id);

            if (atual.papel !== papelNovo) {
                registrarMudancaPapel(id, atual.papel, papelNovo);
            }
        });
    });

    salvarTodas();

    redirectOk(res, '/elenco', 'Jogadoras salvas!');
});

app.post('/elenco/:id/excluir', requireLogin, (req, res) => {
    db.prepare('DELETE FROM jogadores WHERE id = ?').run(
        Number(req.params.id),
    );
    redirectOk(res, '/elenco', 'Jogador removido.');
});

app.post('/elenco/:id/reativar', requireLogin, (req, res) => {
    reativarJogador(Number(req.params.id));
    redirectOk(res, '/elenco', 'Jogadora reativada!');
});

app.get('/elenco/:id/historico', requireLogin, (req, res) => {
    const id = Number(req.params.id);
    const jogador = db.prepare('SELECT * FROM jogadores WHERE id = ?').get(id);
    if (!jogador) return res.redirect('/elenco');

    res.render('jogador-historico', {
        usuario: req.session.usuario,
        jogador,
        historico: getPapelHistorico(id),
    });
});

// ---------- COMANDOS DO BOT (referência + whitelist de quem pode usar) ----------

const COMANDOS_DO_BOT = [
    { comando: '!enquete', onde: 'Grupo', descricao: 'Abre uma nova enquete de confirmação pro jogo.' },
    { comando: '!sincronizar', onde: 'Grupo', descricao: 'Sincroniza o elenco com os membros atuais do grupo do WhatsApp.' },
    { comando: '!fechar', onde: 'Grupo ou DM', descricao: 'Fecha a enquete: manda quem realmente vai jogar (respeitando o limite de vagas) e trava novos votos.' },
    { comando: '!lista', onde: 'Grupo ou DM', descricao: 'Mostra a lista atual — confirmadas e lista de espera — sem fechar a enquete. Pode repetir quantas vezes quiser.' },
    { comando: '!espera', onde: 'Grupo ou DM', descricao: 'Mostra só quem está na lista de espera agora.' },
    { comando: '!times', onde: 'Grupo ou DM', descricao: 'Sorteia e manda os times balanceados por nível.' },
];

// tokens {chave} usados nos templates de mensagem do painel — cada um só funciona no
// template indicado em "onde", não em qualquer mensagem
const TOKENS_DISPONIVEIS = [
    { token: '{data}', onde: 'Título da enquete (Enquete > Configuração)', descricao: 'Data do próximo jogo, no formato DD/MM.' },
    { token: '{dia}', onde: 'Título da enquete (Enquete > Configuração)', descricao: 'Dia da semana do jogo por extenso (ex: quarta-feira).' },
    { token: '{hora}', onde: 'Título da enquete (Enquete > Configuração)', descricao: 'Horário do jogo configurado em Jogo.' },
    { token: '{mes_anterior}', onde: 'Fechamento do mensal (Mensagens)', descricao: 'Mês que acabou de fechar, formato AAAA-MM (ex: 2026-08).' },
    { token: '{mes_atual}', onde: 'Fechamento do mensal (Mensagens)', descricao: 'Mês que está começando, formato AAAA-MM (ex: 2026-09).' },
    { token: '{mensalistas_mes_anterior}', onde: 'Fechamento do mensal (Mensagens)', descricao: 'Lista numerada de quem pagou o mês anterior — as convidadas a renovar.' },
    { token: '{valor_mensal}', onde: 'Fechamento do mensal (Mensagens)', descricao: 'Valor da mensalidade configurado em Jogo > Valores, formatado em R$.' },
    { token: '{data_limite_pagamento}', onde: 'Fechamento do mensal (Mensagens)', descricao: 'Dia limite de pagamento configurado ali mesmo, formato DD/MM do mês que está começando (ex: 07/09).' },
];

app.get('/comandos', requireLogin, (req, res) => {
    res.render('comandos', {
        usuario: req.session.usuario,
        comandos: COMANDOS_DO_BOT,
        tokens: TOKENS_DISPONIVEIS,
        jogadores: getJogadoresParaPermissao(),
        ok: req.query.ok,
    });
});

app.post('/comandos/:id/toggle', requireLogin, (req, res) => {
    const id = Number(req.params.id);
    const jogador = db.prepare('SELECT pode_comandar FROM jogadores WHERE id = ?').get(id);
    if (!jogador) return res.redirect('/comandos');

    definirPermissaoComando(id, !jogador.pode_comandar);
    redirectOk(res, '/comandos', 'Permissão atualizada!');
});

// ---------- USUÁRIOS DO PAINEL (login/senha de quem acessa) ----------

app.get('/usuarios', requireLogin, (req, res) => {
    res.render('usuarios', {
        usuario: req.session.usuario,
        usuarios: db.prepare('SELECT id, usuario FROM admin_users ORDER BY usuario ASC').all(),
        ok: req.query.ok,
        erro: null,
    });
});

app.post('/usuarios', requireLogin, (req, res) => {
    const usuarioNovo = (req.body.usuario || '').trim();
    const senha = req.body.senha || '';
    const confirmarSenha = req.body.confirmarSenha || '';

    const listarErro = (erro) => res.render('usuarios', {
        usuario: req.session.usuario,
        usuarios: db.prepare('SELECT id, usuario FROM admin_users ORDER BY usuario ASC').all(),
        ok: null,
        erro,
    });

    if (!usuarioNovo || senha.length < 6) {
        return listarErro('Preencha o usuário e uma senha com pelo menos 6 caracteres.');
    }
    if (senha !== confirmarSenha) {
        return listarErro('As senhas não coincidem.');
    }
    if (db.prepare('SELECT id FROM admin_users WHERE usuario = ?').get(usuarioNovo)) {
        return listarErro('Já existe um usuário com esse nome.');
    }

    const hash = bcrypt.hashSync(senha, 10);
    db.prepare('INSERT INTO admin_users (usuario, senha_hash) VALUES (?, ?)').run(usuarioNovo, hash);

    redirectOk(res, '/usuarios', 'Usuário criado!');
});

app.post('/usuarios/:id/excluir', requireLogin, (req, res) => {
    const id = Number(req.params.id);
    const total = db.prepare('SELECT COUNT(*) AS c FROM admin_users').get().c;

    if (total <= 1) {
        return res.render('usuarios', {
            usuario: req.session.usuario,
            usuarios: db.prepare('SELECT id, usuario FROM admin_users ORDER BY usuario ASC').all(),
            ok: null,
            erro: 'Não é possível remover o último usuário — ninguém mais conseguiria entrar no painel.',
        });
    }

    db.prepare('DELETE FROM admin_users WHERE id = ?').run(id);
    redirectOk(res, '/usuarios', 'Usuário removido.');
});

// ---------- CONFIGURAÇÃO DO JOGO (dia/horário) ----------

app.get('/jogo/config', requireLogin, (req, res) => {
    res.render('jogo-config', {
        usuario: req.session.usuario,
        diaSemana: Number(getConfig('enquete_dia_semana')),
        hora: getConfig('enquete_hora'),
        valorMensal: getConfig('valor_mensal'),
        valorAvulso: getConfig('valor_avulso'),
        vagasMaximo: getConfig('jogo_vagas_maximo'),
        ok: req.query.ok,
    });
});

app.post('/jogo/config', requireLogin, (req, res) => {
    const diaSemana = Number(req.body.diaSemana);
    const horaH = String(req.body.horaH || '20').padStart(2, '0');
    const horaM = String(req.body.horaM || '00').padStart(2, '0');

    if (diaSemana >= 0 && diaSemana <= 6) setConfig('enquete_dia_semana', String(diaSemana));
    setConfig('enquete_hora', `${horaH}:${horaM}`);

    const valorMensal = parseFloat(String(req.body.valorMensal).replace(',', '.'));
    setConfig('valor_mensal', Number.isFinite(valorMensal) && valorMensal > 0 ? valorMensal.toFixed(2) : '');

    const valorAvulso = parseFloat(String(req.body.valorAvulso).replace(',', '.'));
    setConfig('valor_avulso', Number.isFinite(valorAvulso) && valorAvulso > 0 ? valorAvulso.toFixed(2) : '');

    const vagasMaximo = parseInt(req.body.vagasMaximo, 10);
    setConfig('jogo_vagas_maximo', Number.isFinite(vagasMaximo) && vagasMaximo > 0 ? String(vagasMaximo) : '');

    redirectOk(res, '/jogo/config', 'Configurações salvas!');
});

// ---------- CONFIGURAÇÃO DA ENQUETE (envio automático + título + opções) ----------

app.get('/enquete/config', requireLogin, (req, res) => {
    res.render('enquete-config', {
        usuario: req.session.usuario,
        titulo: getConfig('enquete_titulo_template'),
        opcoes: getEnqueteOpcoes(),
        autoEnviar: getConfig('enquete_auto_enviar') === '1',
        envioDiaSemana: Number(getConfig('enquete_envio_dia_semana')),
        envioHora: getConfig('enquete_envio_hora'),
        grupos: getGrupos(),
        grupoSelecionado: getConfig('enquete_grupo_id'),
        ok: req.query.ok,
    });
});

app.post('/enquete/config/auto', requireLogin, (req, res) => {
    const envioDiaSemana = Number(req.body.envioDiaSemana);
    const envioHoraH = String(req.body.envioHoraH || '09').padStart(2, '0');
    const envioHoraM = String(req.body.envioHoraM || '00').padStart(2, '0');

    if (envioDiaSemana >= 0 && envioDiaSemana <= 6) {
        setConfig('enquete_envio_dia_semana', String(envioDiaSemana));
    }
    setConfig('enquete_envio_hora', `${envioHoraH}:${envioHoraM}`);
    if (req.body.grupoId) setConfig('enquete_grupo_id', req.body.grupoId);
    setConfig('enquete_auto_enviar', req.body.autoEnviar === 'on' ? '1' : '0');

    redirectOk(res, '/enquete/config', 'Envio automático atualizado!');
});

app.post('/enquete/config/enviar-agora', requireLogin, (req, res) => {
    const grupoId = getConfig('enquete_grupo_id');
    if (!grupoId) {
        return redirectOk(res, '/enquete/config', 'Configure o grupo de destino antes de enviar.');
    }
    setConfig('enquete_solicitar_envio', '1');
    redirectOk(res, '/enquete/config', 'Enquete será enviada em até 1 minuto.');
});

app.post('/enquete/config/titulo', requireLogin, (req, res) => {
    const titulo = (req.body.titulo || '').trim();
    if (titulo) setConfig('enquete_titulo_template', titulo);
    redirectOk(res, '/enquete/config', 'Título salvo!');
});

app.post('/enquete/config/opcoes', requireLogin, (req, res) => {
    const { texto, papel } = req.body;
    if (!texto || !texto.trim()) return res.redirect('/enquete/config');

    const proximaOrdem = db
        .prepare('SELECT COALESCE(MAX(ordem), -1) + 1 AS n FROM enquete_opcoes')
        .get().n;

    db.prepare(
        'INSERT INTO enquete_opcoes (texto, papel, ordem) VALUES (?, ?, ?)',
    ).run(
        texto.trim(),
        papel === 'mensalista' || papel === 'avulso' ? papel : null,
        proximaOrdem,
    );

    redirectOk(res, '/enquete/config', 'Opção adicionada!');
});

app.post('/enquete/config/opcoes/:id', requireLogin, (req, res) => {
    const { texto, papel } = req.body;
    const id = Number(req.params.id);
    if (!texto || !texto.trim()) return res.redirect('/enquete/config');

    db.prepare(
        'UPDATE enquete_opcoes SET texto = ?, papel = ? WHERE id = ?',
    ).run(
        texto.trim(),
        papel === 'mensalista' || papel === 'avulso' ? papel : null,
        id,
    );

    redirectOk(res, '/enquete/config', 'Opção salva!');
});

app.post('/enquete/config/opcoes/:id/excluir', requireLogin, (req, res) => {
    db.prepare('DELETE FROM enquete_opcoes WHERE id = ?').run(
        Number(req.params.id),
    );
    redirectOk(res, '/enquete/config', 'Opção removida.');
});

// ---------- MENSAGENS AGENDADAS ----------

// a próxima quinta de fechamento do mensal: a calculada pro mês corrente, ou (se já passou)
// a do mês seguinte — só pra mostrar no painel, não é usada em nenhuma decisão de negócio
function proximoFechamentoMensal() {
    const agora = new Date();
    const hoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
    const candidato = fechamentoMensalDoMes(agora.getFullYear(), agora.getMonth());
    if (candidato >= hoje) return candidato;

    const proxMesIndex = agora.getMonth() === 11 ? 0 : agora.getMonth() + 1;
    const anoDoProxMes = agora.getMonth() === 11 ? agora.getFullYear() + 1 : agora.getFullYear();
    return fechamentoMensalDoMes(anoDoProxMes, proxMesIndex);
}

app.get('/mensagens', requireLogin, (req, res) => {
    const proximoFechamento = proximoFechamentoMensal();
    res.render('mensagens', {
        usuario: req.session.usuario,
        mensagens: getMensagensAgendadas(),
        grupos: getGrupos(),
        fechamentoMensalAtivo: getConfig('fechamento_mensal_ativo') === '1',
        fechamentoMensalMensagem: getConfig('fechamento_mensal_mensagem'),
        pagamentoDiaLimite: getConfig('pagamento_dia_limite'),
        proximoFechamentoMensalTexto: `${String(proximoFechamento.getDate()).padStart(2, '0')}/${String(proximoFechamento.getMonth() + 1).padStart(2, '0')}/${proximoFechamento.getFullYear()}`,
        ok: req.query.ok,
    });
});

app.post('/mensagens/fechamento-mensal', requireLogin, (req, res) => {
    setConfig('fechamento_mensal_ativo', req.body.fechamentoMensalAtivo === 'on' ? '1' : '0');

    const mensagem = String(req.body.fechamentoMensalMensagem || '').trim();
    if (mensagem) setConfig('fechamento_mensal_mensagem', mensagem);

    const diaLimite = parseInt(req.body.pagamentoDiaLimite, 10);
    setConfig('pagamento_dia_limite', Number.isFinite(diaLimite) && diaLimite >= 1 && diaLimite <= 31 ? String(diaLimite) : '7');

    redirectOk(res, '/mensagens', 'Configurações salvas!');
});

app.post('/mensagens', requireLogin, (req, res) => {
    const { grupoId, texto, tipo, data, diaSemana, horaH, horaM } = req.body;
    if (!grupoId || !texto || !texto.trim()) {
        return res.redirect('/mensagens');
    }

    const hh = String(horaH || '00').padStart(2, '0');
    const mm = String(horaM || '00').padStart(2, '0');

    if (tipo === 'semanal') {
        const diaSemanaNum = Number(diaSemana);
        if (diaSemanaNum < 0 || diaSemanaNum > 6) return res.redirect('/mensagens');
        criarMensagemSemanal(grupoId, texto.trim(), diaSemanaNum, `${hh}:${mm}`);
    } else {
        if (!data) return res.redirect('/mensagens');
        criarMensagemUnica(grupoId, texto.trim(), `${data} ${hh}:${mm}`);
    }

    redirectOk(res, '/mensagens', 'Mensagem agendada!');
});

app.post('/mensagens/:id/editar', requireLogin, (req, res) => {
    const id = Number(req.params.id);
    const { grupoId, texto, tipo, data, diaSemana, horaH, horaM } = req.body;
    if (!grupoId || !texto || !texto.trim()) {
        return res.redirect('/mensagens');
    }

    const hh = String(horaH || '00').padStart(2, '0');
    const mm = String(horaM || '00').padStart(2, '0');

    if (tipo === 'semanal') {
        const diaSemanaNum = Number(diaSemana);
        if (diaSemanaNum < 0 || diaSemanaNum > 6) return res.redirect('/mensagens');
        atualizarMensagemSemanal(id, grupoId, texto.trim(), diaSemanaNum, `${hh}:${mm}`);
    } else {
        if (!data) return res.redirect('/mensagens');
        atualizarMensagemUnica(id, grupoId, texto.trim(), `${data} ${hh}:${mm}`);
    }

    redirectOk(res, '/mensagens', 'Mensagem atualizada!');
});

app.post('/mensagens/:id/excluir', requireLogin, (req, res) => {
    excluirMensagemAgendada(Number(req.params.id));
    redirectOk(res, '/mensagens', 'Agendamento removido.');
});

// ---------- LOGS (enquete/mensagem/comprovante) ----------

app.get('/logs', requireLogin, (req, res) => {
    const tipo = ['enquete', 'mensagem', 'comprovante', 'lista', 'times', 'elenco'].includes(req.query.tipo) ? req.query.tipo : null;
    const LOGS_POR_PAGINA = 50;
    const totalLogs = contarLogs(tipo);
    const totalPaginas = Math.max(1, Math.ceil(totalLogs / LOGS_POR_PAGINA));
    const pagina = Math.min(Math.max(1, Number(req.query.pagina) || 1), totalPaginas);

    res.render('logs', {
        usuario: req.session.usuario,
        logs: getLogs(tipo, LOGS_POR_PAGINA, (pagina - 1) * LOGS_POR_PAGINA),
        tipo,
        pagina,
        totalPaginas,
    });
});

// ---------- SORTEIO INTELIGENTE DE TIMES ----------

app.get('/times', requireLogin, (req, res) => {
    const enquete = db
        .prepare('SELECT * FROM enquetes ORDER BY id DESC LIMIT 1')
        .get();

    const confirmados = enquete ? getConfirmadosDaEnquete(enquete.id) : [];

    let times = null;
    if (confirmados.length >= 2) {
        times = balancearTimes(confirmados);
    }

    res.render('times', {
        usuario: req.session.usuario,
        enquete,
        confirmados,
        times,
    });
});

app.post('/times/enviar', requireLogin, (req, res) => {
    const grupoId = getConfig('enquete_grupo_id');
    if (!grupoId) {
        return redirectOk(res, '/times', 'Configure o grupo de destino em Configurações → Enquete antes de mandar.');
    }

    const tituloJogo = req.body.tituloJogo || 'Times';
    const nomesTimeA = [].concat(req.body.timeA || []);
    const nomesTimeB = [].concat(req.body.timeB || []);
    if (nomesTimeA.length === 0 && nomesTimeB.length === 0) return res.redirect('/times');

    const texto = montarTextoTimes(tituloJogo, nomesTimeA, nomesTimeB);
    criarEnvioImediato(grupoId, texto, 'times');

    redirectOk(res, '/times', 'Times enviados! Pode levar até 1 minuto pra aparecer no grupo.');
});

// ---------- VOTAÇÃO PÚBLICA (avaliação pós-jogo, sem login administrativo) ----------
// link pra compartilhar no grupo do WhatsApp depois de cada jogo, pra galera se avaliar

app.get('/votacao', (req, res) => {
    const enquete = db.prepare('SELECT * FROM enquetes ORDER BY id DESC LIMIT 1').get();
    if (!enquete) {
        return res.render('votacao', {
            layout: 'layout-auth',
            tituloPagina: 'Avaliar jogo',
            enquete: null,
            confirmados: [],
            avaliacoes: [],
            ok: null,
        });
    }
    res.redirect('/votacao/' + enquete.id);
});

app.get('/votacao/:id', (req, res) => {
    const enqueteId = Number(req.params.id);
    const enquete = db.prepare('SELECT * FROM enquetes WHERE id = ?').get(enqueteId);

    const confirmados = enquete ? getConfirmadosDaEnquete(enqueteId) : [];
    const avaliacoes = enquete ? getAvaliacoesDaEnquete(enqueteId) : [];

    res.render('votacao', {
        layout: 'layout-auth',
        tituloPagina: 'Avaliar jogo',
        enquete,
        confirmados,
        avaliacoes,
        ok: req.query.ok,
    });
});

app.post('/votacao/:id/avaliar', (req, res) => {
    const enqueteId = Number(req.params.id);
    const avaliadorId = Number(req.body.avaliador_id);

    const confirmados = getConfirmadosDaEnquete(enqueteId);
    const idsValidos = new Set(confirmados.map((j) => j.id));

    if (!avaliadorId || !idsValidos.has(avaliadorId)) {
        return res.redirect('/votacao/' + enqueteId);
    }

    for (const [chave, valor] of Object.entries(req.body)) {
        const match = chave.match(/^nota_(\d+)$/);
        if (!match) continue;

        const jogadorId = Number(match[1]);
        if (jogadorId === avaliadorId) continue; // ninguém avalia a si mesma
        if (!idsValidos.has(jogadorId)) continue;

        const nota = Number(valor);
        if (!Number.isInteger(nota) || nota < 1 || nota > 5) continue;

        registrarAvaliacao(enqueteId, jogadorId, avaliadorId, nota);
    }

    redirectOk(res, `/votacao/${enqueteId}?eu=${avaliadorId}`, 'Avaliação registrada!');
});

// ---------- APARÊNCIA (logo) ----------

app.get('/configuracoes/aparencia', requireLogin, (req, res) => {
    res.render('aparencia', {
        usuario: req.session.usuario,
        logoUrl: getConfig('logo_url'),
        ok: req.query.ok,
    });
});

app.post('/configuracoes/aparencia/logo', requireLogin, (req, res) => {
    uploadLogo.single('logo')(req, res, (err) => {
        // multipart não passa pelo middleware global de CSRF (o multer só processa o campo
        // _csrf aqui, depois de ler o corpo) — confere manualmente antes de aceitar o upload
        if (!csrfValido(req)) {
            return res.status(403).send('Sessão expirada ou formulário desatualizado. Recarregue a página e tente de novo.');
        }

        if (err || !req.file) {
            return res.render('aparencia', {
                usuario: req.session.usuario,
                logoUrl: getConfig('logo_url'),
                erro: 'Não foi possível enviar a imagem. Use PNG, JPG, WEBP ou SVG, até 2MB.',
            });
        }

        // remove logo antiga se tinha extensão diferente da nova, pra não acumular lixo
        const antiga = getConfig('logo_url');
        if (antiga) {
            const caminhoAntigo = path.join(__dirname, 'public', antiga.replace(/^\//, ''));
            if (caminhoAntigo !== req.file.path && fs.existsSync(caminhoAntigo)) {
                fs.unlinkSync(caminhoAntigo);
            }
        }

        setConfig('logo_url', '/uploads/' + req.file.filename + '?v=' + Date.now());
        redirectOk(res, '/configuracoes/aparencia', 'Logo atualizada!');
    });
});

app.post('/configuracoes/aparencia/logo/remover', requireLogin, (req, res) => {
    const atual = getConfig('logo_url');
    if (atual) {
        const caminho = path.join(__dirname, 'public', atual.split('?')[0].replace(/^\//, ''));
        if (fs.existsSync(caminho)) fs.unlinkSync(caminho);
    }
    setConfig('logo_url', '');
    redirectOk(res, '/configuracoes/aparencia', 'Logo removida.');
});

app.listen(PORT, () => {
    console.log(`🖥️  Painel administrativo em http://localhost:${PORT}`);
});
