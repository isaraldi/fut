require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express = require('express');
const expressLayouts = require('express-ejs-layouts');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const {
    db,
    getConfig,
    setConfig,
    getEnqueteOpcoes,
    registrarMudancaPapel,
    getPapelHistorico,
} = require('../db');

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

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('layout', 'layout');
app.use(expressLayouts);
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: false }));
app.use(
    session({
        secret: process.env.SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        cookie: { maxAge: 1000 * 60 * 60 * 12 },
    }),
);

// disponíveis em toda view/layout sem precisar passar em cada res.render
app.use((req, res, next) => {
    res.locals.usuario = req.session ? req.session.usuario : null;
    res.locals.caminhoAtual = req.path;
    res.locals.logoUrlSidebar = getConfig('logo_url');
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

const mesAtual = () => new Date().toISOString().slice(0, 7); // YYYY-MM

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
            `SELECT v.opcao, v.votado_em, j.nome, j.papel, j.nivel
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

    res.render('confirmados', {
        enquete,
        grupos,
        totalVotos: votos.length,
    });
});

// ---------- HOME (resumo geral) ----------

app.get('/', requireLogin, (req, res) => {
    const mes = mesAtual();

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

    res.render('jogo-detalhe', {
        usuario: req.session.usuario,
        enquete,
        grupos,
        totalVotos: votos.length,
    });
});

// ---------- PAGAMENTOS ----------

app.get('/pagamentos', requireLogin, (req, res) => {
    const mes = req.query.mes || mesAtual();

    const jogadores = db
        .prepare(
            `SELECT j.id, j.nome, j.papel,
                    p.pago AS pago
             FROM jogadores j
             LEFT JOIN pagamentos p
                    ON p.jogador_id = j.id AND p.mes_referencia = ?
             ORDER BY j.papel DESC, j.nome ASC`,
        )
        .all(mes);

    res.render('pagamentos', { usuario: req.session.usuario, jogadores, mes, ok: req.query.ok });
});

app.post('/pagamentos/:jogadorId/toggle', requireLogin, (req, res) => {
    const mes = req.body.mes || mesAtual();
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

    redirectOk(res, '/pagamentos?mes=' + encodeURIComponent(mes), 'Pagamento atualizado!');
});

// ---------- ELENCO ----------

app.get('/elenco', requireLogin, (req, res) => {
    const jogadores = db
        .prepare('SELECT * FROM jogadores ORDER BY papel DESC, nivel DESC, nome ASC')
        .all();
    res.render('elenco', { usuario: req.session.usuario, jogadores, ok: req.query.ok });
});

app.post('/elenco', requireLogin, (req, res) => {
    const { nome, telefone, nivel, papel } = req.body;
    if (!nome || !nome.trim()) return res.redirect('/elenco');

    db.prepare(
        'INSERT INTO jogadores (nome, telefone, nivel, papel) VALUES (?, ?, ?, ?)',
    ).run(
        nome.trim(),
        telefone || null,
        Number(nivel) || 3,
        papel === 'mensalista' ? 'mensalista' : 'avulso',
    );

    redirectOk(res, '/elenco', `${nome.trim()} adicionado!`);
});

// ---------- CONFIGURAÇÃO DO ELENCO (precisa vir antes de /elenco/:id) ----------

app.get('/elenco/config', requireLogin, (req, res) => {
    res.render('elenco-config', {
        usuario: req.session.usuario,
        autoIncluir: getConfig('elenco_auto_incluir_grupo') === '1',
        ok: req.query.ok,
    });
});

app.post('/elenco/config', requireLogin, (req, res) => {
    setConfig('elenco_auto_incluir_grupo', req.body.autoIncluir === 'on' ? '1' : '0');
    redirectOk(res, '/elenco/config', 'Configuração salva!');
});

app.post('/elenco/:id', requireLogin, (req, res) => {
    const { nome, telefone, nivel, papel } = req.body;
    const id = Number(req.params.id);
    const papelNovo = papel === 'mensalista' ? 'mensalista' : 'avulso';

    const atual = db.prepare('SELECT papel FROM jogadores WHERE id = ?').get(id);

    db.prepare(
        'UPDATE jogadores SET nome = ?, telefone = ?, nivel = ?, papel = ? WHERE id = ?',
    ).run(nome.trim(), telefone || null, Number(nivel) || 3, papelNovo, id);

    if (atual && atual.papel !== papelNovo) {
        registrarMudancaPapel(id, atual.papel, papelNovo);
    }

    redirectOk(res, '/elenco', `${nome.trim()} salvo!`);
});

app.post('/elenco/:id/excluir', requireLogin, (req, res) => {
    db.prepare('DELETE FROM jogadores WHERE id = ?').run(
        Number(req.params.id),
    );
    redirectOk(res, '/elenco', 'Jogador removido.');
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

// ---------- CONFIGURAÇÃO DA ENQUETE (título + opções) ----------

app.get('/enquete/config', requireLogin, (req, res) => {
    res.render('enquete-config', {
        usuario: req.session.usuario,
        titulo: getConfig('enquete_titulo_template'),
        diaSemana: Number(getConfig('enquete_dia_semana')),
        hora: getConfig('enquete_hora'),
        opcoes: getEnqueteOpcoes(),
        ok: req.query.ok,
    });
});

app.post('/enquete/config/jogo', requireLogin, (req, res) => {
    const diaSemana = Number(req.body.diaSemana);
    const horaH = String(req.body.horaH || '20').padStart(2, '0');
    const horaM = String(req.body.horaM || '00').padStart(2, '0');

    if (diaSemana >= 0 && diaSemana <= 6) setConfig('enquete_dia_semana', String(diaSemana));
    setConfig('enquete_hora', `${horaH}:${horaM}`);

    redirectOk(res, '/enquete/config', 'Dia e horário salvos!');
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

// ---------- SORTEIO INTELIGENTE DE TIMES ----------

function embaralhar(lista) {
    const copia = [...lista];
    for (let i = copia.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copia[i], copia[j]] = [copia[j], copia[i]];
    }
    return copia;
}

function balancearTimes(jogadores) {
    const embaralhados = embaralhar(jogadores).sort((a, b) => b.nivel - a.nivel);

    const timeA = [];
    const timeB = [];
    let somaA = 0;
    let somaB = 0;

    for (const jogador of embaralhados) {
        if (somaA <= somaB) {
            timeA.push(jogador);
            somaA += jogador.nivel;
        } else {
            timeB.push(jogador);
            somaB += jogador.nivel;
        }
    }

    return { timeA, timeB, somaA, somaB };
}

app.get('/times', requireLogin, (req, res) => {
    const enquete = db
        .prepare('SELECT * FROM enquetes ORDER BY id DESC LIMIT 1')
        .get();

    let confirmados = [];
    if (enquete) {
        confirmados = db
            .prepare(
                `SELECT j.id, j.nome, j.nivel, j.papel
                 FROM votos v
                 JOIN jogadores j ON j.id = v.jogador_id
                 WHERE v.enquete_id = ? AND v.papel IS NOT NULL`,
            )
            .all(enquete.id);
    }

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
