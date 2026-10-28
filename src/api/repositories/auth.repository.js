const db = require('../../loaders/database');

function getUsuariosConsulta1() {
    return db.prepare('SELECT id, usuario FROM admin_users ORDER BY usuario ASC');
}

function postUsuariosConsulta2() {
    return db.prepare('SELECT id, usuario FROM admin_users ORDER BY usuario ASC');
}

function postUsuariosConsulta3() {
    return db.prepare('SELECT id FROM admin_users WHERE usuario = ?');
}

function postUsuariosConsulta4() {
    return db.prepare('INSERT INTO admin_users (usuario, senha_hash) VALUES (?, ?)');
}

function postUsuariosIdExcluirConsulta5() {
    return db.prepare('SELECT COUNT(*) AS c FROM admin_users');
}

function postUsuariosIdExcluirConsulta6() {
    return db.prepare('SELECT id, usuario FROM admin_users ORDER BY usuario ASC');
}

function postUsuariosIdExcluirConsulta7() {
    return db.prepare('DELETE FROM admin_users WHERE id = ?');
}

module.exports = {
    getUsuariosConsulta1,
    postUsuariosConsulta2,
    postUsuariosConsulta3,
    postUsuariosConsulta4,
    postUsuariosIdExcluirConsulta5,
    postUsuariosIdExcluirConsulta6,
    postUsuariosIdExcluirConsulta7
};
