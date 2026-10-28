const bcrypt = require('bcryptjs');
const consultas = require('../repositories/autenticacao.repository');

function bootstrapAdmin() {
    const count = consultas.bootstrapAdminConsulta1().get().c;
    if (count > 0) return;

    const usuario = process.env.ADMIN_USER || 'admin';
    const senha = process.env.ADMIN_PASSWORD;
    if (!senha) {
        throw new Error(
            'Nenhum admin_users cadastrado e ADMIN_PASSWORD não definido no .env',
        );
    }

    const hash = bcrypt.hashSync(senha, 10);
    consultas.bootstrapAdminConsulta2().run(usuario, hash);
    console.log(`👤 Usuário admin "${usuario}" criado a partir do .env`);
}

function autenticar(usuario, senha) {
 const user = consultas.autenticarConsulta3().get(usuario);
 return user && bcrypt.compareSync(senha || '', user.senha_hash) ? { id: user.id, usuario: user.usuario } : null;
}

module.exports = { bootstrapAdmin, autenticar };
