function requireLogin(req, res, next) {
    if (req.session && req.session.userId) return next();
    return res.redirect('/login');
}

function csrfValido(req) {
    return !!req.body && req.body._csrf === req.session.csrfToken;
}

module.exports = { requireLogin, csrfValido };
