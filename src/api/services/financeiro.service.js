const { dataCaixaAtual, iniciarCaixa, lancarCaixa, cancelarLancamentoCaixa, definirPagamentoCaixa, getConfig, getConfirmadosDaEnquete } = require('./fut.service');
const { mesReferenciaAtual } = require('../../utils/mensagens-prontas');

const consultas = require('../repositories/financeiro.repository');
const { sucesso } = require('./painel-support.service');

function getPagamentos(entrada) {
    const aba = ['avulsas', 'historico'].includes(entrada.query.aba) ? entrada.query.aba : 'mensalistas';
    if (aba === 'historico') {
        const busca = String(entrada.query.busca || '').trim().slice(0, 100);
        const tipo = ['mensal', 'avulso'].includes(entrada.query.tipo) ? entrada.query.tipo : '';
        const jogoId = /^\d+$/.test(entrada.query.jogo || '') ? entrada.query.jogo : '';
        const pagina = Math.min(1000000, Math.max(1, parseInt(entrada.query.pagina, 10) || 1));
        const { total, historico } = consultas.listarHistoricoPagamentos({ busca, tipo, jogoId, pagina });
        const jogos = consultas.getPagamentosConsulta3().all();
        return ({ view: 'pagamentos', dados: { aba, historico, busca, tipo, jogoId, pagina, total, jogos }, status: 200 });
    }
    if (aba === 'avulsas') {
        const jogos = consultas.getPagamentosConsulta4().all();
        const enquete = entrada.query.jogo ? consultas.getPagamentosConsulta5().get(Number(entrada.query.jogo) || 0)
            : consultas.getPagamentosConsulta6().get();

        let jogadores = [];
        if (enquete) {
            const confirmados = getConfirmadosDaEnquete(enquete.id).filter((j) => j.papel === 'avulso');
            const statusStmt = consultas.getPagamentosConsulta7();
            jogadores = confirmados.map((j) => ({
                id: j.id,
                nome: j.nome,
                pago: !!statusStmt.get(j.id, enquete.id)?.pago,
            }));
        }

        return ({ view: 'pagamentos', dados: { aba, jogadores, enquete, jogos, mes: null, ok: entrada.query.ok }, status: 200 });
    }
    const mes = entrada.query.mes || mesReferenciaAtual(new Date(), Number(getConfig('enquete_dia_semana')));

    const jogadores = consultas.getPagamentosConsulta8()
        .all(mes);

    return ({ view: 'pagamentos', dados: { aba, jogadores, mes, enquete: null, ok: entrada.query.ok }, status: 200 });
}

function getPagamentosAvulsos(entrada) { return ({ destino: '/pagamentos?aba=avulsas' }); }

function postPagamentosAvulsosJogadorIdToggle(entrada) {
    const jogadorId = Number(entrada.params.jogadorId);
    const enqueteId = Number(entrada.body.enqueteId);

    try { definirPagamentoCaixa('avulso', jogadorId, enqueteId); }
    catch (erro) {
        if (erro.code) throw erro;
        return ({ destino: '/caixa?erro=' + encodeURIComponent(erro.message) });
    }

    return sucesso('/pagamentos?aba=avulsas&jogo=' + enqueteId, 'Pagamento atualizado!');
}

function getCaixa(entrada) {
    const mes = /^\d{4}-(0[1-9]|1[0-2])$/.test(entrada.query.mes || '') ? entrada.query.mes : dataCaixaAtual().slice(0, 7);
    const totais = consultas.getCaixaConsulta9().get(mes, mes);
    const lancamentos = consultas.getCaixaConsulta10().all(mes);
    return ({ view: 'caixa', dados: { ativo: getConfig('caixa_ativo') === '1', mes, totais, lancamentos, hoje: dataCaixaAtual(), erro: entrada.query.erro }, status: 200 });
}

function postCaixaOperacao(entrada) {
        try {
            if (entrada.params.operacao === 'iniciar') iniciarCaixa(entrada.body.saldo);
            else if (entrada.params.operacao === 'lancamentos') lancarCaixa(entrada.body);
            else cancelarLancamentoCaixa(Number(entrada.params.id));
            return sucesso('/caixa', 'Caixa atualizado.');
        } catch (erro) {
            if (erro.code) throw erro;
            return ({ destino: '/caixa?erro=' + encodeURIComponent(erro.message) });
        }
    }

module.exports = { getPagamentos, getPagamentosAvulsos, postPagamentosAvulsosJogadorIdToggle, getCaixa, postCaixaOperacao };
