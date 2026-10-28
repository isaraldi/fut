const { getConfig, setConfig, getGrupos, getEnqueteOpcoes, criarMensagemUnica, criarMensagemSemanal, atualizarMensagemUnica, atualizarMensagemSemanal, getMensagensAgendadas, excluirMensagemAgendada, PUBLICOS_JOGADORAS, getDestinatariasPorPublico, enfileirarMensagemJogadora } = require('./fut.service');

const { sucesso, proximoFechamentoMensal, destinoAgendamentoValido, salvarConfiguracao } = require('./painel-support.service');

function getMensagens(entrada) {
    return ({ view: 'mensagens', dados: {
        usuario: entrada.usuario,
        mensagens: getMensagensAgendadas(),
        grupos: getGrupos(),
        publicosJogadoras: Object.entries(PUBLICOS_JOGADORAS).map(([chave, titulo]) => ({
            chave,
            titulo,
            destinatarias: getDestinatariasPorPublico(chave),
        })),
        mensagemJogadorasTexto: getConfig('mensagem_jogadoras_texto'),
        ok: entrada.query.ok,
    }, status: 200 });
}

function postMensagensJogadoras(entrada) {
    const texto = String(entrada.body.texto || '').trim();
    const publico = entrada.body.publico;
    if (!texto || !PUBLICOS_JOGADORAS[publico]) return ({ destino: '/mensagens' });

    setConfig('mensagem_jogadoras_texto', texto);
    const destinatarias = getDestinatariasPorPublico(publico);
    const comNumero = destinatarias.filter((j) => j.whatsapp_id || j.telefone);
    comNumero.forEach((j) => enfileirarMensagemJogadora(j.id, texto.replace(/{nome}/g, j.nome)));

    const semNumero = destinatarias.length - comNumero.length;
    return sucesso('/mensagens', comNumero.length === 0
        ? 'Nenhuma jogadora nesse público (ou sem número cadastrado) — nada foi enviado.'
        : `${comNumero.length} mensagem(ns) na fila${semNumero > 0 ? ` (${semNumero} sem número, ignorada(s))` : ''}. O bot envia aos poucos, com pausa entre cada uma — veja o resultado em Logs.`);
}

function getMensagensAutomaticas(entrada) {
    const proximoFechamento = proximoFechamentoMensal();
    return ({ view: 'mensagens-automaticas', dados: {
        usuario: entrada.usuario,
        fechamentoMensalAtivo: getConfig('fechamento_mensal_ativo') === '1',
        fechamentoMensalMensagem: getConfig('fechamento_mensal_mensagem'),
        fechamentoMensalHora: getConfig('fechamento_mensal_hora'),
        fechamentoMensalPrazoHoras: getConfig('fechamento_mensal_prazo_horas'),
        pagamentoDiaLimite: getConfig('pagamento_dia_limite'),
        proximoFechamentoMensalTexto: `${String(proximoFechamento.getDate()).padStart(2, '0')}/${String(proximoFechamento.getMonth() + 1).padStart(2, '0')}/${proximoFechamento.getFullYear()}`,
        enqueteAutoEnviar: getConfig('enquete_auto_enviar') === '1',
        enqueteEnvioDiaSemana: Number(getConfig('enquete_envio_dia_semana')),
        enqueteEnvioHora: getConfig('enquete_envio_hora'),
        enqueteTituloTemplate: getConfig('enquete_titulo_template'),
        enqueteOpcoes: getEnqueteOpcoes(),
        listaConfirmadaMensagem: getConfig('lista_confirmada_mensagem'),
        listaAtualMensagem: getConfig('lista_atual_mensagem'),
        listaEsperaMensagem: getConfig('lista_espera_mensagem'),
        timesMensagem: getConfig('times_mensagem'),
        ok: entrada.query.ok,
    }, status: 200 });
}

function postMensagensListaConfirmada(entrada) {
    salvarConfiguracao['/mensagens/lista-confirmada'](entrada.body);
    return sucesso('/mensagens/automaticas', 'Mensagem salva!');
}

function postMensagensListaAtual(entrada) {
    salvarConfiguracao['/mensagens/lista-atual'](entrada.body);
    return sucesso('/mensagens/automaticas', 'Mensagem salva!');
}

function postMensagensListaEspera(entrada) {
    salvarConfiguracao['/mensagens/lista-espera'](entrada.body);
    return sucesso('/mensagens/automaticas', 'Mensagem salva!');
}

function postMensagensTimes(entrada) {
    salvarConfiguracao['/mensagens/times'](entrada.body);
    return sucesso('/mensagens/automaticas', 'Mensagem salva!');
}

function postMensagens(entrada) {
    const { grupoId, texto, tipo, data, diaSemana, horaH, horaM } = entrada.body;
    if (!destinoAgendamentoValido(grupoId) || !texto || !texto.trim()) {
        return ({ destino: '/mensagens' });
    }

    const hh = String(horaH || '00').padStart(2, '0');
    const mm = String(horaM || '00').padStart(2, '0');

    if (tipo === 'semanal') {
        const diaSemanaNum = Number(diaSemana);
        if (diaSemanaNum < 0 || diaSemanaNum > 6) return ({ destino: '/mensagens' });
        criarMensagemSemanal(grupoId, texto.trim(), diaSemanaNum, `${hh}:${mm}`);
    } else {
        if (!data) return ({ destino: '/mensagens' });
        criarMensagemUnica(grupoId, texto.trim(), `${data} ${hh}:${mm}`);
    }

    return sucesso('/mensagens', 'Mensagem agendada!');
}

function postMensagensIdEditar(entrada) {
    const id = Number(entrada.params.id);
    const { grupoId, texto, tipo, data, diaSemana, horaH, horaM } = entrada.body;
    if (!destinoAgendamentoValido(grupoId) || !texto || !texto.trim()) {
        return ({ destino: '/mensagens' });
    }

    const hh = String(horaH || '00').padStart(2, '0');
    const mm = String(horaM || '00').padStart(2, '0');

    if (tipo === 'semanal') {
        const diaSemanaNum = Number(diaSemana);
        if (diaSemanaNum < 0 || diaSemanaNum > 6) return ({ destino: '/mensagens' });
        atualizarMensagemSemanal(id, grupoId, texto.trim(), diaSemanaNum, `${hh}:${mm}`);
    } else {
        if (!data) return ({ destino: '/mensagens' });
        atualizarMensagemUnica(id, grupoId, texto.trim(), `${data} ${hh}:${mm}`);
    }

    return sucesso('/mensagens', 'Mensagem atualizada!');
}

function postMensagensIdExcluir(entrada) {
    excluirMensagemAgendada(Number(entrada.params.id));
    return sucesso('/mensagens', 'Agendamento removido.');
}

module.exports = { getMensagens, postMensagensJogadoras, getMensagensAutomaticas, postMensagensListaConfirmada, postMensagensListaAtual, postMensagensListaEspera, postMensagensTimes, postMensagens, postMensagensIdEditar, postMensagensIdExcluir };
