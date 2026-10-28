const crypto = require('crypto');
const express = require('express');
const expressLayouts = require('express-ejs-layouts');
const session = require('express-session');
const helmet = require('helmet');
const paths = require('../config/paths');
const { csrfValido } = require('../helpers/security');
const { jsonParaScript, formatarDataHora } = require('../utils/formatacao');
const SqliteSessionStore = require('../api/repositories/sqlite-session-store');
const { db, getConfig } = require('../api/services/fut.service');
const consultas = require('../api/repositories/express.repository');

module.exports = function configurarExpress(app) {

app.set('trust proxy', 1); // atrás do proxy/túnel que termina o TLS — necessário pro cookie "secure" saber que a conexão é https
app.set('view engine', 'ejs');
app.locals.jsonParaScript = jsonParaScript;
app.locals.formatarDataHora = formatarDataHora;
app.set('views', paths.views);
app.set('layout', 'layout');
// CSP desligado: o painel usa <script> inline em várias views sem nonce, e o padrão do
// helmet bloquearia todas elas. Os outros cabeçalhos de segurança (X-Frame-Options,
// X-Content-Type-Options, HSTS etc) continuam ativos.
app.use(helmet({ contentSecurityPolicy: false }));
app.use(expressLayouts);
app.use(express.static(paths.public));
app.use(express.urlencoded({ extended: false }));
app.use(
    session({
        store: new SqliteSessionStore(db),
        secret: process.env.SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        // secure só em produção (Dockerfile seta NODE_ENV=production): local roda em HTTP puro,
        // sem o proxy HTTPS, e cookie secure nunca seria enviado pelo browser — sessão
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
    res.locals.jogadorasInativasCount = consultas.expressConsulta1().get().c;
    next();
});


};
