const { db, marcarVotoManual, getResumoMensal, getConfig, setAusentesDaEnquete, getConfirmadosDaEnquete, getListaDeEsperaDaEnquete, getAvaliacoesDaEnquete, registrarAvaliacao, criarEnvioImediato, fecharEnquete } = require('./fut.service');
const { montarRodizio, montarTextoListaConfirmadas, montarTextoTimes, mesReferenciaAtual } = require('../../utils/mensagens-prontas');

const consultas = require('../repositories/jogos.repository');
const { sucesso, carregarVotosAgrupados, textoOpcaoConfirmada, configDeTimes, dadosDosTimes, agruparPorDestino } = require('./painel-support.service');

function getConfirmados(entrada) {
    const query = entrada.query.ok ? '&ok=' + encodeURIComponent(entrada.query.ok) : '';
    return ({ destino: '/jogo/atual?aba=presenca' + query });
}

function getJogoAtual(entrada) {
    const enquete = consultas.getJogoAtualConsulta1().get();
    const aba = ['presenca', 'espera', 'times'].includes(entrada.query.aba) ? entrada.query.aba : 'presenca';
    const confirmados = enquete ? getConfirmadosDaEnquete(enquete.id) : [];
    const listaDeEspera = enquete ? getListaDeEsperaDaEnquete(enquete.id) : [];
    const { votos, grupos } = enquete ? carregarVotosAgrupados(enquete.id) : { votos: [], grupos: {} };
    const jogadores = consultas.getJogoAtualConsulta2().all();
    return ({ view: 'jogo-atual', dados: {
        enquete, aba, confirmados, listaDeEspera, grupos, jogadores, totalVotos: votos.length,
        ...(aba === 'times' ? dadosDosTimes(enquete, confirmados) : {}),
        ok: entrada.query.ok,
    }, status: 200 });
}

function postConfirmadosEnviarLista(entrada) {
    const grupoId = getConfig('enquete_grupo_id');
    if (!grupoId) {
        return sucesso('/jogo/atual', 'Configure o grupo de destino em Configurações → Enquete antes de mandar.');
    }

    const enquete = consultas.postConfirmadosEnviarListaConsulta3().get();
    if (!enquete) return ({ destino: '/jogo/atual' });

    if (entrada.body.enqueteId && Number(entrada.body.enqueteId) !== enquete.id) return sucesso('/jogo/atual', 'Uma nova enquete foi aberta. Confira a lista antes de enviar.');
    const confirmados = getConfirmadosDaEnquete(enquete.id);
    const texto = montarTextoListaConfirmadas(enquete, confirmados, getConfig('lista_confirmada_mensagem'));
    criarEnvioImediato(grupoId, texto, 'lista');
    fecharEnquete(enquete.id); // novos votos passam a ser ignorados; o bot desafixa a enquete no próximo minuto

    return sucesso('/jogo/atual', 'Lista enviada e enquete fechada! Pode levar até 1 minuto pra aparecer no grupo.');
}

function getHome(entrada) {
    const mes = mesReferenciaAtual(new Date(), Number(getConfig('enquete_dia_semana')));
    const jogoAtual = consultas.getConsulta4().get();
    const confirmados = jogoAtual ? getConfirmadosDaEnquete(jogoAtual.id) : [];
    const espera = jogoAtual ? getListaDeEsperaDaEnquete(jogoAtual.id).length : 0;
    const pagamentosMes = consultas.getConsulta5().get(mes);
    const avulsas = confirmados.filter(j => j.papel === 'avulso');
    const pagamentoAvulso = consultas.getConsulta6();
    const avulsasPendentes = jogoAtual ? avulsas.filter(j => !pagamentoAvulso.get(j.id, jogoAtual.id)?.pago).length : 0;
    const resumoMensal = getResumoMensal();
    const jogadoras = consultas.getConsulta7().get();
    const ultimosJogos = consultas.getConsulta8().all()
        .map(jogo => ({ ...jogo, confirmados: getConfirmadosDaEnquete(jogo.id).length }));
    return ({ view: 'home', dados: {
        jogoAtual, confirmados: confirmados.length, espera, pagamentosMes, avulsasPendentes,
        pendentes: pagamentosMes.devem - pagamentosMes.pagos,
        renovacoesPendentes: resumoMensal?.pendentes.length || 0,
        filaMensal: resumoMensal?.fila.length || 0,
        jogadoras, mes, ultimosJogos,
    }, status: 200 });
}

function getJogos(entrada) {
    const jogos = consultas.getJogosConsulta9().all().map(jogo => {
        const confirmados = jogo.vagas_maximo ? Math.min(jogo.confirmacoes, jogo.vagas_maximo) : jogo.confirmacoes;
        return { ...jogo, confirmados, espera: jogo.confirmacoes - confirmados };
    });
    return ({ view: 'jogos', dados: { usuario: entrada.usuario, jogos }, status: 200 });
}

function getJogosId(entrada) {
    const enquete = consultas.getJogosIdConsulta10().get(Number(entrada.params.id));
    if (!enquete) return ({ destino: '/jogos' });
    const { votos, grupos } = carregarVotosAgrupados(enquete.id);
    const jogadores = consultas.getJogosIdConsulta11().all();
    const confirmados = getConfirmadosDaEnquete(enquete.id);
    const listaDeEspera = getListaDeEsperaDaEnquete(enquete.id);
    const avaliacoes = consultas.getJogosIdConsulta12().all(enquete.id);
    const resumoAvaliacoes = consultas.getJogosIdConsulta13().get(enquete.id);
    return ({ view: 'jogo-detalhe', dados: {
        usuario: entrada.usuario, enquete, grupos, jogadores, confirmados, listaDeEspera,
        totalVotos: votos.length, avaliacoes, resumoAvaliacoes,
        aba: entrada.query.aba === 'avaliacoes' ? 'avaliacoes' : 'participacao',
        jogoAtual: consultas.getJogosIdConsulta14().get().id === enquete.id,
        ok: entrada.query.ok,
    }, status: 200 });
}

function postJogosIdExcluir(entrada) {
    const enqueteId = Number(entrada.params.id);
    consultas.postJogosIdExcluirConsulta15().run(enqueteId);
    return sucesso('/jogos', 'Jogo excluído.');
}

function postJogosIdConfirmar(entrada) {
    const enqueteId = Number(entrada.params.id);
    const jogadorId = Number(entrada.body.jogador_id);

    const enquete = consultas.postJogosIdConfirmarConsulta16().get(enqueteId);
    const jogador = consultas.postJogosIdConfirmarConsulta17().get(jogadorId);
    if (!enquete || !jogador) return ({ destino: '/jogos/' + enqueteId });

    // papel da confirmação segue o papel cadastrado da jogadora (lista de mensalistas em
    // /elenco), não é mais escolhido na hora — mantém coerência com o pagamento dela
    const papel = jogador.papel === 'mensalista' ? 'mensalista' : 'avulso';

    db.transaction(() => {
        consultas.postJogosIdConfirmarConsulta18().run(enqueteId, jogadorId, textoOpcaoConfirmada(), papel);
        marcarVotoManual(enqueteId, jogadorId);
    }).immediate();

    return sucesso(entrada.body.voltarAtual === '1' ? '/jogo/atual' : '/jogos/' + enqueteId, `${jogador.nome} confirmada manualmente!`);
}

function postJogosIdConfirmarJogadorIdRemover(entrada) {
    const enqueteId = Number(entrada.params.id);
    const jogadorId = Number(entrada.params.jogadorId);

    db.transaction(() => {
        consultas.postJogosIdConfirmarJogadorIdRemoverConsulta19().run(enqueteId, jogadorId);
        marcarVotoManual(enqueteId, jogadorId);
    }).immediate();

    return sucesso(entrada.body.voltarAtual === '1' ? '/jogo/atual?aba=' + (entrada.body.abaAtual === 'espera' ? 'espera' : 'presenca') : '/jogos/' + enqueteId, 'Confirmação removida.');
}

function getTimes(entrada) {
    const query = entrada.query.ok ? '&ok=' + encodeURIComponent(entrada.query.ok) : '';
    return ({ destino: '/jogo/atual?aba=times' + query });
}

function postTimesAusentes(entrada) {
    const enquete = consultas.postTimesAusentesConsulta20().get();
    if (!enquete) return ({ destino: '/jogo/atual?aba=times' });
    if (entrada.body.enqueteId && Number(entrada.body.enqueteId) !== enquete.id) return sucesso('/jogo/atual?aba=times', 'Uma nova enquete foi aberta. Confira os times antes de continuar.');
    const grupos = agruparPorDestino(getConfirmadosDaEnquete(enquete.id), entrada.body);
    setAusentesDaEnquete(enquete.id, grupos.ausente.map((j) => j.id));
    return sucesso('/jogo/atual?aba=times', 'Faltas salvas — sorteio refeito sem elas.');
}

function postTimesEnviar(entrada) {
    const grupoId = getConfig('enquete_grupo_id');
    if (!grupoId) {
        return sucesso('/jogo/atual?aba=times', 'Configure o grupo de destino em Configurações → Enquete antes de mandar.');
    }

    const enquete = consultas.postTimesEnviarConsulta21().get();
    if (!enquete) return ({ destino: '/jogo/atual?aba=times' });

    if (entrada.body.enqueteId && Number(entrada.body.enqueteId) !== enquete.id) return sucesso('/jogo/atual?aba=times', 'Uma nova enquete foi aberta. Confira os times antes de continuar.');
    const grupos = agruparPorDestino(getConfirmadosDaEnquete(enquete.id), entrada.body);
    setAusentesDaEnquete(enquete.id, grupos.ausente.map((j) => j.id));

    const times = [grupos.A, grupos.B, grupos.C].filter((time, t) => t < 2 || time.length > 0);
    if (grupos.A.length === 0 && grupos.B.length === 0) return ({ destino: '/jogo/atual?aba=times' });

    const { minutos, duracao } = configDeTimes();
    const texto = montarTextoTimes(
        enquete.titulo,
        times.map((time) => time.map((j) => j.nome)),
        grupos.reserva.map((j) => j.nome),
        montarRodizio(times, grupos.reserva, minutos, duracao),
        getConfig('times_mensagem'),
    );
    criarEnvioImediato(grupoId, texto, 'times');

    return sucesso('/jogo/atual?aba=times', 'Times enviados! Pode levar até 1 minuto pra aparecer no grupo.');
}

function getVotacao(entrada) {
    const enquete = consultas.getVotacaoConsulta22().get();
    if (!enquete) {
        return ({ view: 'votacao', dados: {
            layout: 'layout-auth',
            tituloPagina: 'Avaliar jogo',
            enquete: null,
            confirmados: [],
            avaliacoes: [],
            ok: null,
        }, status: 200 });
    }
    return ({ destino: '/votacao/' + enquete.id });
}

function getVotacaoId(entrada) {
    const enqueteId = Number(entrada.params.id);
    const enquete = consultas.getVotacaoIdConsulta23().get(enqueteId);

    const confirmados = enquete ? getConfirmadosDaEnquete(enqueteId) : [];
    const avaliacoes = enquete ? getAvaliacoesDaEnquete(enqueteId) : [];

    return ({ view: 'votacao', dados: {
        layout: 'layout-auth',
        tituloPagina: 'Avaliar jogo',
        enquete,
        confirmados,
        avaliacoes,
        ok: entrada.query.ok,
    }, status: 200 });
}

function postVotacaoIdAvaliar(entrada) {
    const enqueteId = Number(entrada.params.id);
    const avaliadorId = Number(entrada.body.avaliador_id);

    const confirmados = getConfirmadosDaEnquete(enqueteId);
    const idsValidos = new Set(confirmados.map((j) => j.id));

    if (!avaliadorId || !idsValidos.has(avaliadorId)) {
        return ({ destino: '/votacao/' + enqueteId });
    }

    for (const [chave, valor] of Object.entries(entrada.body)) {
        const match = chave.match(/^nota_(\d+)$/);
        if (!match) continue;

        const jogadorId = Number(match[1]);
        if (jogadorId === avaliadorId) continue; // ninguém avalia a si mesma
        if (!idsValidos.has(jogadorId)) continue;

        const nota = Number(valor);
        if (!Number.isInteger(nota) || nota < 1 || nota > 5) continue;

        registrarAvaliacao(enqueteId, jogadorId, avaliadorId, nota);
    }

    return sucesso(`/votacao/${enqueteId}?eu=${avaliadorId}`, 'Avaliação registrada!');
}

module.exports = { getConfirmados, getJogoAtual, postConfirmadosEnviarLista, getHome, getJogos, getJogosId, postJogosIdExcluir, postJogosIdConfirmar, postJogosIdConfirmarJogadorIdRemover, getTimes, postTimesAusentes, postTimesEnviar, getVotacao, getVotacaoId, postVotacaoIdAvaliar };
