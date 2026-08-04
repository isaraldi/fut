require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const { db } = require('../db');

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

function requireLogin(req, res, next) {
    if (req.session && req.session.userId) return next();
    return res.redirect('/login');
}

const mesAtual = () => new Date().toISOString().slice(0, 7); // YYYY-MM

// ---------- LOGIN ----------

app.get('/login', (req, res) => {
    res.render('login', { erro: null });
});

app.post('/login', (req, res) => {
    const { usuario, senha } = req.body;
    const user = db
        .prepare('SELECT * FROM admin_users WHERE usuario = ?')
        .get(usuario);

    if (!user || !bcrypt.compareSync(senha || '', user.senha_hash)) {
        return res.render('login', { erro: 'Usuário ou senha inválidos.' });
    }

    req.session.userId = user.id;
    req.session.usuario = user.usuario;
    res.redirect('/');
});

app.post('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/login'));
});

// ---------- DASHBOARD (confirmados da última enquete) ----------

app.get('/', requireLogin, (req, res) => {
    const enquete = db
        .prepare('SELECT * FROM enquetes ORDER BY id DESC LIMIT 1')
        .get();

    let votos = [];
    if (enquete) {
        votos = db
            .prepare(
                `SELECT v.opcao, v.votado_em, j.nome, j.papel, j.nivel
                 FROM votos v
                 JOIN jogadores j ON j.id = v.jogador_id
                 WHERE v.enquete_id = ?
                 ORDER BY v.votado_em ASC`,
            )
            .all(enquete.id);
    }

    const grupos = {
        'Eu vou (MENSALISTAS)': [],
        'Não vou (MENSALISTAS)': [],
        'Eu quero (AVULSAS)': [],
    };
    votos.forEach((v) => {
        if (!grupos[v.opcao]) grupos[v.opcao] = [];
        grupos[v.opcao].push(v);
    });

    res.render('dashboard', {
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

    res.render('pagamentos', { usuario: req.session.usuario, jogadores, mes });
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

    res.redirect('/pagamentos?mes=' + encodeURIComponent(mes));
});

// ---------- ELENCO ----------

app.get('/elenco', requireLogin, (req, res) => {
    const jogadores = db
        .prepare('SELECT * FROM jogadores ORDER BY papel DESC, nivel DESC, nome ASC')
        .all();
    res.render('elenco', { usuario: req.session.usuario, jogadores });
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

    res.redirect('/elenco');
});

app.post('/elenco/:id', requireLogin, (req, res) => {
    const { nome, telefone, nivel, papel } = req.body;
    const id = Number(req.params.id);

    db.prepare(
        'UPDATE jogadores SET nome = ?, telefone = ?, nivel = ?, papel = ? WHERE id = ?',
    ).run(
        nome.trim(),
        telefone || null,
        Number(nivel) || 3,
        papel === 'mensalista' ? 'mensalista' : 'avulso',
        id,
    );

    res.redirect('/elenco');
});

app.post('/elenco/:id/excluir', requireLogin, (req, res) => {
    db.prepare('DELETE FROM jogadores WHERE id = ?').run(
        Number(req.params.id),
    );
    res.redirect('/elenco');
});

app.listen(PORT, () => {
    console.log(`🖥️  Painel administrativo em http://localhost:${PORT}`);
});
