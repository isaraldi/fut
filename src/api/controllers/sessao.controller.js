const { autenticar } = require('../services/autenticacao.service');
const { getConfig } = require('../services/fut.service');

exports.login = (req, res) => {
    const user = autenticar(req.body.usuario, req.body.senha);
    if (!user) return res.render('login', { erro: 'Usuário ou senha inválidos.', logoUrl: getConfig('logo_url'), layout: 'layout-auth' });
    req.session.userId = user.id;
    req.session.usuario = user.usuario;
    return res.redirect('/');
};
exports.logout = (req, res) => req.session.destroy(() => res.redirect('/login'));
