const bcrypt = require('bcryptjs');
const { getConfig } = require('./fut.service');

const consultas = require('../repositories/auth.repository');
const { sucesso } = require('./painel-support.service');

function getLogin(entrada) {
    return ({ view: 'login', dados: { erro: null, logoUrl: getConfig('logo_url'), layout: 'layout-auth' }, status: 200 });
}

function getUsuarios(entrada) {
    return ({ view: 'usuarios', dados: {
        usuario: entrada.usuario,
        usuarios: consultas.getUsuariosConsulta1().all(),
        ok: entrada.query.ok,
        erro: null,
    }, status: 200 });
}

function postUsuarios(entrada) {
    const usuarioNovo = (entrada.body.usuario || '').trim();
    const senha = entrada.body.senha || '';
    const confirmarSenha = entrada.body.confirmarSenha || '';

    const listarErro = (erro) => ({ view: 'usuarios', dados: {
        usuario: entrada.usuario,
        usuarios: consultas.postUsuariosConsulta2().all(),
        ok: null,
        erro,
    }, status: 200 });

    if (!usuarioNovo || senha.length < 6) {
        return listarErro('Preencha o usuário e uma senha com pelo menos 6 caracteres.');
    }
    if (senha !== confirmarSenha) {
        return listarErro('As senhas não coincidem.');
    }
    if (consultas.postUsuariosConsulta3().get(usuarioNovo)) {
        return listarErro('Já existe um usuário com esse nome.');
    }

    const hash = bcrypt.hashSync(senha, 10);
    consultas.postUsuariosConsulta4().run(usuarioNovo, hash);

    return sucesso('/usuarios', 'Usuário criado!');
}

function postUsuariosIdExcluir(entrada) {
    const id = Number(entrada.params.id);
    const total = consultas.postUsuariosIdExcluirConsulta5().get().c;

    if (total <= 1) {
        return ({ view: 'usuarios', dados: {
            usuario: entrada.usuario,
            usuarios: consultas.postUsuariosIdExcluirConsulta6().all(),
            ok: null,
            erro: 'Não é possível remover o último usuário — ninguém mais conseguiria entrar no painel.',
        }, status: 200 });
    }

    consultas.postUsuariosIdExcluirConsulta7().run(id);
    return sucesso('/usuarios', 'Usuário removido.');
}

module.exports = { getLogin, getUsuarios, postUsuarios, postUsuariosIdExcluir };
