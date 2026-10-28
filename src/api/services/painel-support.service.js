const { db, getResumoMensal, definirPapelJogador, getConfig, setConfig, getEnqueteOpcoes, getAusentesDaEnquete, PUBLICOS_JOGADORAS } = require('./fut.service');
const { montarPlanoDeTimes, fechamentoMensalDoMes } = require('../../utils/mensagens-prontas');

const consultas = require('../repositories/painel-support.repository');

function sucesso(caminho, mensagem) {
    const separador = caminho.includes('?') ? '&' : '?';
    return { destino: caminho + separador + 'ok=' + encodeURIComponent(mensagem) };
}

const POSICOES_VALIDAS = ['goleira', 'defesa', 'meio', 'ataque', 'indefinida'];

const posicaoValida = (p) => (POSICOES_VALIDAS.includes(p) ? p : 'indefinida');

const salvarConfiguracao = {
    '/elenco/config': (body) => {
        setConfig('elenco_auto_incluir_grupo', body.autoIncluir === 'on' ? '1' : '0');
    },
    '/jogo/config': (body) => {
        if (Object.hasOwn(body, 'diaSemana')) {
            const diaSemana = Number(body.diaSemana);
            if (Number.isInteger(diaSemana) && diaSemana >= 0 && diaSemana <= 6) setConfig('enquete_dia_semana', String(diaSemana));
            const horaH = String(body.horaH || '20').padStart(2, '0');
            const horaM = String(body.horaM || '00').padStart(2, '0');
            setConfig('enquete_hora', `${horaH}:${horaM}`);
        }
        for (const [campo, chave] of [['valorMensal', 'valor_mensal'], ['valorAvulso', 'valor_avulso']]) {
            if (!Object.hasOwn(body, campo)) continue;
            const valor = parseFloat(String(body[campo]).replace(',', '.'));
            setConfig(chave, Number.isFinite(valor) && valor > 0 ? valor.toFixed(2) : '');
        }
        if (Object.hasOwn(body, 'vagasMaximo')) {
            const vagas = parseInt(body.vagasMaximo, 10);
            setConfig('jogo_vagas_maximo', Number.isFinite(vagas) && vagas > 0 ? String(vagas) : '');
        }
    },
    '/jogo/config/times': (body) => {
        const inteiro = (valor, padrao, minimo) => {
            const n = parseInt(valor, 10);
            return String(Number.isFinite(n) && n >= minimo ? n : padrao);
        };
        setConfig('jogo_jogadoras_por_time', inteiro(body.porTime, 5, 1));
        setConfig('jogo_times_modo', body.timesModo === 'manual' ? 'manual' : 'automatico');
        setConfig('jogo_rodizio_minutos', inteiro(body.rodizioMinutos, 10, 1));
        setConfig('jogo_duracao_minutos', inteiro(body.duracaoMinutos, 60, 1));
    },
    '/enquete/config/auto': (body) => {
        const envioDiaSemana = Number(body.envioDiaSemana);
        const envioHoraH = String(body.envioHoraH || '09').padStart(2, '0');
        const envioHoraM = String(body.envioHoraM || '00').padStart(2, '0');

        if (envioDiaSemana >= 0 && envioDiaSemana <= 6) {
            setConfig('enquete_envio_dia_semana', String(envioDiaSemana));
        }
        setConfig('enquete_envio_hora', `${envioHoraH}:${envioHoraM}`);
        if (body.grupoId) setConfig('enquete_grupo_id', body.grupoId);
        setConfig('enquete_auto_enviar', body.autoEnviar === 'on' ? '1' : '0');
    },
    '/enquete/config/titulo': (body) => {
        const titulo = (body.titulo || '').trim();
        if (titulo) setConfig('enquete_titulo_template', titulo);
    },
    '/mensagens/fechamento-mensal': (body) => {
        setConfig('fechamento_mensal_ativo', body.fechamentoMensalAtivo === 'on' ? '1' : '0');

        const mensagem = String(body.fechamentoMensalMensagem || '').trim();
        if (mensagem) setConfig('fechamento_mensal_mensagem', mensagem);

        const diaLimite = parseInt(body.pagamentoDiaLimite, 10);
        setConfig('pagamento_dia_limite', Number.isFinite(diaLimite) && diaLimite >= 1 && diaLimite <= 31 ? String(diaLimite) : '7');

        const horaH = String(body.fechamentoMensalHoraH || '00').padStart(2, '0');
        const horaM = String(body.fechamentoMensalHoraM || '00').padStart(2, '0');
        setConfig('fechamento_mensal_hora', `${horaH}:${horaM}`);

        const prazoHoras = parseInt(body.fechamentoMensalPrazoHoras, 10);
        setConfig('fechamento_mensal_prazo_horas', Number.isFinite(prazoHoras) && prazoHoras >= 1 ? String(prazoHoras) : '36');
    },
    '/mensagens/lista-confirmada': (body) => {
        const mensagem = String(body.mensagem || '').trim();
        if (mensagem) setConfig('lista_confirmada_mensagem', mensagem);
    },
    '/mensagens/lista-atual': (body) => {
        const mensagem = String(body.mensagem || '').trim();
        if (mensagem) setConfig('lista_atual_mensagem', mensagem);
    },
    '/mensagens/lista-espera': (body) => {
        const mensagem = String(body.mensagem || '').trim();
        if (mensagem) setConfig('lista_espera_mensagem', mensagem);
    },
    '/mensagens/times': (body) => {
        const mensagem = String(body.mensagem || '').trim();
        if (mensagem) setConfig('times_mensagem', mensagem);
    },
};

const configuracoesPorPagina = {
    '/jogo/config': ['/jogo/config', '/jogo/config/times'],
    '/enquete/config': ['/enquete/config/auto', '/enquete/config/titulo'],
    '/mensagens/automaticas': ['/mensagens/lista-confirmada', '/mensagens/lista-atual', '/mensagens/lista-espera', '/mensagens/times', '/mensagens/fechamento-mensal'],
    '/elenco/config': ['/elenco/config'],
    '/elenco': [],
};

function carregarVotosAgrupados(enqueteId) {
    const votos = consultas.carregarVotosAgrupadosConsulta1()
        .all(enqueteId);

    const grupos = {};
    getEnqueteOpcoes().forEach((o) => {
        grupos[o.texto] = [];
    });
    votos.forEach((v) => {
        if (!grupos[v.opcao]) grupos[v.opcao] = [];
        grupos[v.opcao].push(v);
    });

    return { votos, grupos };
}

function textoOpcaoConfirmada() {
    const opcao = getEnqueteOpcoes().find((o) => o.conta === 1);
    return opcao ? opcao.texto : 'Confirmada manualmente';
}

function salvarJogadora(id, campos) {
    const atual = consultas.salvarJogadoraConsulta2().get(id);
    const nome = (campos.nome || '').trim();
    const nivel = Number(campos.nivel);
    if (!atual || !nome || !Number.isInteger(nivel) || nivel < 1 || nivel > 5) throw new Error('Dados da jogadora inválidos');
    consultas.salvarJogadoraConsulta3()
        .run(nome, (campos.telefone || '').trim() || null, nivel, posicaoValida(campos.posicao), id);
}

const COMANDOS_DO_BOT = [
    { comando: '!confirmarlista', onde: 'Grupo configurado', descricao: 'Aplica a prévia da lista editada que você reenviou. Corrige presenças sem alterar mensalistas ou pagamentos.' },
    { comando: '!cancelarlista', onde: 'Grupo configurado', descricao: 'Descarta sua correção de lista pendente.' },
    { comando: '!mensal', onde: 'Grupo ou DM', descricao: 'Mostra renovações, pendências, desistências, novas aprovadas e fila do mensal por ordem de reação.' },
    { comando: '!enquete', onde: 'Grupo', descricao: 'Abre uma nova enquete de confirmação pro jogo.' },
    { comando: '!sincronizar', onde: 'Grupo', descricao: 'Sincroniza o elenco com os membros atuais do grupo do WhatsApp.' },
    { comando: '!fechar', onde: 'Grupo ou DM', descricao: 'Fecha a enquete: manda quem realmente vai jogar (respeitando o limite de vagas) e trava novos votos.' },
    { comando: '!lista', onde: 'Grupo ou DM', descricao: 'Mostra a lista atual — confirmadas e lista de espera — sem fechar a enquete. Pode repetir quantas vezes quiser.' },
    { comando: '!espera', onde: 'Grupo ou DM', descricao: 'Mostra só quem está na lista de espera agora.' },
    { comando: '!times', onde: 'Grupo ou DM', descricao: 'Sorteia e manda os times balanceados por nível (3 times se couber, senão 2 + reservas, com a ordem de rodízio). Em modo manual, avisa pra usar o painel.' },
    { comando: '!faltam Ana, Bia', onde: 'Grupo ou DM', descricao: 'Marca quem confirmou mas não chegou, pra ficar fora do sorteio de times. Cada uso substitui a lista anterior; "!faltam" sozinho mostra a lista e "!faltam ninguém" limpa.' },
];

const TOKENS_DISPONIVEIS = [
    { token: '{data}', onde: 'Título da enquete (Enquete > Configuração)', descricao: 'Data do próximo jogo, no formato DD/MM.' },
    { token: '{dia}', onde: 'Título da enquete (Enquete > Configuração)', descricao: 'Dia da semana do jogo por extenso (ex: quarta-feira).' },
    { token: '{hora}', onde: 'Título da enquete (Enquete > Configuração)', descricao: 'Horário do jogo configurado em Jogo.' },
    { token: '{mes_anterior}', onde: 'Fechamento do mensal (Mensagens)', descricao: 'Mês que acabou de fechar, formato AAAA-MM (ex: 2026-08).' },
    { token: '{mes_atual}', onde: 'Fechamento do mensal (Mensagens)', descricao: 'Mês que está começando, formato AAAA-MM (ex: 2026-09).' },
    { token: '{mensalistas_mes_anterior}', onde: 'Fechamento do mensal (Mensagens)', descricao: 'Lista das mensalistas atuais convidadas a renovar (independentemente do pagamento).' },
    { token: '{valor_mensal}', onde: 'Fechamento do mensal (Mensagens)', descricao: 'Valor da mensalidade configurado em Jogo > Valores, formatado em R$.' },
    { token: '{data_limite_pagamento}', onde: 'Fechamento do mensal (Mensagens)', descricao: 'Dia limite de pagamento configurado ali mesmo, formato DD/MM do mês que está começando (ex: 07/09).' },
    { token: '{fechamento_mensal_prazo_horas}', onde: 'Fechamento do mensal (Mensagens)', descricao: 'Prazo (em horas) configurado ali mesmo pra reagir antes de virar avulsa automaticamente (ex: 36).' },
    { token: '{titulo}', onde: 'Lista fechada, Lista atual, Lista de espera, Times (Mensagens > Msgs. automáticas)', descricao: 'Título da enquete do jogo.' },
    { token: '{lista}', onde: 'Lista fechada, Lista atual, Lista de espera (Mensagens > Msgs. automáticas)', descricao: 'Bloco com as seções Mensalistas/Avulsas (ou os nomes, na lista de espera), numeradas.' },
    { token: '{total}', onde: 'Lista fechada, Lista atual (Mensagens > Msgs. automáticas)', descricao: 'Texto com a contagem de confirmadas (ex: "12 confirmadas").' },
    { token: '{espera}', onde: 'Lista atual (Mensagens > Msgs. automáticas)', descricao: 'Bloco da lista de espera, já formatado — vazio se não tiver ninguém esperando.' },
    { token: '{time_a}', onde: 'Times (Mensagens > Msgs. automáticas)', descricao: 'Nomes do Time A, um por linha.' },
    { token: '{time_b}', onde: 'Times (Mensagens > Msgs. automáticas)', descricao: 'Nomes do Time B, um por linha.' },
    { token: '{time_c}', onde: 'Times (Mensagens > Msgs. automáticas)', descricao: 'Bloco "Time C" já formatado (vazio se o jogo tem só 2 times).' },
    { token: '{reservas}', onde: 'Times (Mensagens > Msgs. automáticas)', descricao: 'Bloco "Reservas" já formatado (vazio se não tem reservas).' },
    { token: '{rodizio}', onde: 'Times (Mensagens > Msgs. automáticas)', descricao: 'Ordem de rodízio/substituição já formatada. Blocos que o template não menciona são adicionados no fim automaticamente.' },
];

function proximoFechamentoMensal() {
    const agora = new Date();
    const hoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
    const dia = Number(getConfig('enquete_dia_semana'));
    for (const deslocamento of [-1, 0, 1]) {
        const mes = new Date(agora.getFullYear(), agora.getMonth() + deslocamento, 1);
        const candidato = fechamentoMensalDoMes(mes.getFullYear(), mes.getMonth(), dia);
        if (candidato >= hoje) return candidato;
    }
}

function ajustarParticipacaoMensal(id, papel) {
    return db.transaction(() => {
        const jogadora = consultas.ajustarParticipacaoMensalConsulta4().get(id);
        if (!jogadora) return 404;
        if (papel === 'mensalista' && jogadora.papel !== 'mensalista') {
            const resumo = getResumoMensal();
            if (resumo && (resumo.pendentes.length || resumo.fila.length)) return 409;
        }
        definirPapelJogador(id, papel);
        return 200;
    }).immediate();
}

function responderAjusteMensal(papel, id) {
    if (!['mensalista', 'avulso'].includes(papel)) return ({ mensagem: 'Participação inválida.', status: 400 });
    const status = ajustarParticipacaoMensal(id, papel);
    if (status === 404) return ({ mensagem: 'Jogadora não encontrada.', status: 404 });
    if (status === 409) return ({ mensagem: 'Há renovações pendentes ou interessadas na fila. Use a aba Renovação e fila para aprovar novas entradas na ordem.', status: 409 });
    return sucesso('/mensal', papel === 'mensalista' ? 'Mensalista adicionada manualmente.' : 'Jogadora retirada do mensal. O cadastro e os pagamentos foram preservados.');
}

function destinoAgendamentoValido(grupoId) {
    if (!grupoId) return false;
    return grupoId.startsWith('jogadoras:') ? Boolean(PUBLICOS_JOGADORAS[grupoId.slice('jogadoras:'.length)]) : true;
}

const DESTINOS_TIMES = ['A', 'B', 'C', 'reserva', 'ausente'];

function configDeTimes() {
    return {
        porTime: parseInt(getConfig('jogo_jogadoras_por_time'), 10),
        minutos: parseInt(getConfig('jogo_rodizio_minutos'), 10),
        duracao: parseInt(getConfig('jogo_duracao_minutos'), 10),
    };
}

function dadosDosTimes(enquete, confirmados) {
    const ausentesIds = enquete ? getAusentesDaEnquete(enquete.id) : [];
    const presentes = confirmados.filter((j) => !ausentesIds.includes(j.id));

    // destino sugerido de cada confirmada (editável no formulário antes de mandar)
    const destinos = {};
    ausentesIds.forEach((id) => { destinos[id] = 'ausente'; });
    let plano = null;
    if (presentes.length >= 2) {
        plano = montarPlanoDeTimes(presentes, configDeTimes().porTime);
        plano.times.forEach((time, t) => time.forEach((j) => { destinos[j.id] = DESTINOS_TIMES[t]; }));
        plano.reservas.forEach((j) => { destinos[j.id] = 'reserva'; });
    }

    return { plano, destinos, modoManual: getConfig('jogo_times_modo') === 'manual' };
}

function agruparPorDestino(confirmados, body) {
    const grupos = { A: [], B: [], C: [], reserva: [], ausente: [] };
    confirmados.forEach((j) => {
        const destino = DESTINOS_TIMES.includes(body[`dest_${j.id}`]) ? body[`dest_${j.id}`] : 'reserva';
        grupos[destino].push(j);
    });
    return grupos;
}

module.exports = { sucesso, carregarVotosAgrupados, textoOpcaoConfirmada, salvarJogadora, proximoFechamentoMensal, ajustarParticipacaoMensal, responderAjusteMensal, destinoAgendamentoValido, configDeTimes, dadosDosTimes, agruparPorDestino, POSICOES_VALIDAS, posicaoValida, salvarConfiguracao, configuracoesPorPagina, COMANDOS_DO_BOT, TOKENS_DISPONIVEIS, DESTINOS_TIMES };
