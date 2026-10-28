const db = require('../../loaders/database');

function bootstrapAdminConsulta1() {
    return db.prepare('SELECT COUNT(*) AS c FROM admin_users');
}

function bootstrapAdminConsulta2() {
    return db.prepare('INSERT INTO admin_users (usuario, senha_hash) VALUES (?, ?)');
}

function autenticarConsulta3() {
    return db.prepare('SELECT * FROM admin_users WHERE usuario = ?');
}

module.exports = {
    bootstrapAdminConsulta1,
    bootstrapAdminConsulta2,
    autenticarConsulta3
};
