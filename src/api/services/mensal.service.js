const { definirPagamentoCaixa, getResumoMensal, aprovarInteressadaMensal, getConfig, getPapelHistorico } = require('./fut.service');
const { mesReferenciaAtual } = require('../../utils/mensagens-prontas');

const consultas = require('../repositories/mensal.repository');
const { sucesso, responderAjusteMensal, salvarConfiguracao } = require('./painel-support.service');

function getPagamentosMensalistas(entrada) {
    return ({ destino: '/pagamentos' + (entrada.query.mes ? '?mes=' + encodeURIComponent(entrada.query.mes) : '') });
}

function postPagamentosMensalistasJogadorIdToggle(entrada) {
    const mes = entrada.body.mes || mesReferenciaAtual(new Date(), Number(getConfig('enquete_dia_semana')));
    const jogadorId = Number(entrada.params.jogadorId);

    try { definirPagamentoCaixa('mensal', jogadorId, mes); }
    catch (erro) {
        if (erro.code) throw erro;
        return ({ destino: '/caixa?erro=' + encodeURIComponent(erro.message) });
    }

    return sucesso('/pagamentos?mes=' + encodeURIComponent(mes), 'Pagamento atualizado!');
}

function getMensalJogadorasIdHistorico(entrada) {
    const id = Number(entrada.params.id);
    const jogador = consultas.getMensalJogadorasIdHistoricoConsulta1().get(id);
    if (!jogador) return ({ destino: '/elenco' });

    return ({ view: 'jogador-historico', dados: {
        usuario: entrada.usuario,
        jogador,
        historico: getPapelHistorico(id),
    }, status: 200 });
}

function getMensal(entrada) {
    const resumoMensal = getResumoMensal();
    const jogadoras = consultas.getMensalConsulta2().all();
    return ({ view: 'mensal', dados: {
        resumoMensal, aba: entrada.query.aba === 'renovacao' ? 'renovacao' : 'atuais',
        mensalistas: jogadoras.filter(j => j.papel === 'mensalista'),
        avulsas: jogadoras.filter(j => j.papel === 'avulso'),
        ok: entrada.query.ok,
    }, status: 200 });
}

function postMensalJogadorasIdParticipacao(entrada) {
    return responderAjusteMensal(entrada.body.papel, Number(entrada.params.id));
}

function postMensalAdicionar(entrada) {
    return responderAjusteMensal('mensalista', Number(entrada.body.jogador_id));
}

function postMensalIdAprovar(entrada) {
    const aprovada = aprovarInteressadaMensal(Number(entrada.params.id));
    return sucesso('/mensal?aba=renovacao', aprovada ? 'Entrada no mensal confirmada!' : 'Aguarde as renovações pendentes e confirme a primeira interessada da fila. Confira se há vaga.');
}

function postMensagensFechamentoMensal(entrada) {
    salvarConfiguracao['/mensagens/fechamento-mensal'](entrada.body);
    return sucesso('/mensagens/automaticas', 'Configurações salvas!');
}

module.exports = { getPagamentosMensalistas, postPagamentosMensalistasJogadorIdToggle, getMensalJogadorasIdHistorico, getMensal, postMensalJogadorasIdParticipacao, postMensalAdicionar, postMensalIdAprovar, postMensagensFechamentoMensal };
