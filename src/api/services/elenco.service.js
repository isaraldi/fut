const { db, getJogadoresParaPermissao, definirPermissaoComando, reativarJogador } = require('./fut.service');

const consultas = require('../repositories/elenco.repository');
const { sucesso, salvarJogadora, posicaoValida, COMANDOS_DO_BOT, TOKENS_DISPONIVEIS } = require('./painel-support.service');
const { obterGruposIa, salvarGruposIa } = require('./grupos-ia.service');

function getElenco(entrada) {
    const jogadores = consultas.getElencoConsulta1()
        .all();
    return ({ view: 'elenco', dados: { usuario: entrada.usuario, jogadores, ok: entrada.query.ok }, status: 200 });
}

function getElencoInativos(entrada) {
    const jogadores = consultas.getElencoInativosConsulta2()
        .all();
    return ({ view: 'elenco-inativos', dados: { usuario: entrada.usuario, jogadores, ok: entrada.query.ok }, status: 200 });
}

function postElenco(entrada) {
    const { nome, telefone, nivel, posicao } = entrada.body;
    if (!nome || !nome.trim()) return ({ destino: '/elenco' });

    consultas.postElencoConsulta3().run(
        nome.trim(),
        telefone || null,
        Number(nivel) || 3,
        'avulso',
        posicaoValida(posicao),
    );

    return sucesso('/elenco', `${nome.trim()} adicionado!`);
}

function postElencoIdAtualizar(entrada) {
    try {
        db.transaction(() => salvarJogadora(Number(entrada.params.id), entrada.body)).immediate();
    } catch {
        return ({ mensagem: 'Confira os dados da jogadora e tente novamente.', status: 400 });
    }
    return sucesso('/elenco', 'Jogadora atualizada!');
}

function postElencoSalvarTodas(entrada) {
    const arr = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
    const ids = arr(entrada.body.id);
    const nomes = arr(entrada.body.nome);
    const telefones = arr(entrada.body.telefone);
    const niveis = arr(entrada.body.nivel);
    const posicoes = arr(entrada.body.posicao);

    const salvarTodas = db.transaction(() => {
        ids.forEach((idStr, i) => {
            const nome = (nomes[i] || '').trim();
            if (!nome) return;

            const id = Number(idStr);
            const atual = consultas.postElencoSalvarTodasConsulta4().get(id);
            if (!atual) return;

            consultas.postElencoSalvarTodasConsulta5().run(nome, telefones[i] || null, Number(niveis[i]) || 3, posicaoValida(posicoes[i]), id);
        });
    });

    salvarTodas();

    return sucesso('/elenco', 'Jogadoras salvas!');
}

function postElencoIdExcluir(entrada) {
    consultas.postElencoIdExcluirConsulta6().run(
        Number(entrada.params.id),
    );
    return sucesso('/elenco', 'Jogador removido.');
}

function postElencoIdReativar(entrada) {
    reativarJogador(Number(entrada.params.id));
    return sucesso('/elenco', 'Jogadora reativada!');
}

function getElencoIdHistorico(entrada) { return ({ destino: '/mensal/jogadoras/' + Number(entrada.params.id) + '/historico' }); }

function getComandos(entrada) {
    return ({ view: 'comandos', dados: {
        aba: ['permissoes', 'grupos'].includes(entrada.query.aba) ? entrada.query.aba : 'comandos',
        usuario: entrada.usuario,
        comandos: COMANDOS_DO_BOT,
        tokens: TOKENS_DISPONIVEIS,
        jogadores: getJogadoresParaPermissao(),
        gruposIa: entrada.query.aba === 'grupos' ? obterGruposIa() : null,
        ok: entrada.query.ok,
        erro: null,
    }, status: 200 });
}

function postComandosGruposIa(entrada) {
    const erro = salvarGruposIa(entrada.body);
    if (erro) {
        const pagina = getComandos({ ...entrada, query: { aba: 'grupos' } });
        pagina.status = 400;
        pagina.dados.erro = erro;
        return pagina;
    }
    return sucesso('/comandos?aba=grupos', 'Grupos da IA atualizados!');
}

function postComandosIdToggle(entrada) {
    const id = Number(entrada.params.id);
    const jogador = consultas.postComandosIdToggleConsulta7().get(id);
    if (!jogador) return ({ destino: '/comandos?aba=permissoes' });

    definirPermissaoComando(id, !jogador.pode_comandar);
    return sucesso('/comandos?aba=permissoes', 'Permissão atualizada!');
}

module.exports = { getElenco, getElencoInativos, postElenco, postElencoIdAtualizar, postElencoSalvarTodas, postElencoIdExcluir, postElencoIdReativar, getElencoIdHistorico, getComandos, postComandosGruposIa, postComandosIdToggle };
