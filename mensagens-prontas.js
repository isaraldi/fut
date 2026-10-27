// monta o texto/sorteio que tanto o bot (comandos !fechar / !times) quanto o painel
// (botões "mandar pro grupo") usam — fica fora de db.js e index.js pra não duplicar entre
// os dois processos (bot e painel rodam separados, só compartilham o banco)

// Fecha no dia seguinte ao último jogo do mês, inclusive quando cai no mês seguinte.
// O dia é recebido de quem lê as configurações, mantendo este módulo independente do banco.
function fechamentoMensalDoMes(ano, mesIndex, diaSemana = 4) {
    if (!Number.isInteger(diaSemana) || diaSemana < 0 || diaSemana > 6) {
        throw new RangeError('Dia do jogo inválido');
    }
    const ultimo = new Date(ano, mesIndex + 1, 0);
    const distancia = (ultimo.getDay() - diaSemana + 7) % 7;
    return new Date(ano, mesIndex, ultimo.getDate() - distancia + 1);
}

// mês (YYYY-MM) que um pagamento feito "agora" deve contar: antes do fechamento do mensal
// (calculado dentro do próprio mês corrente) conta pro mês corrente; a partir dele (inclusive)
// já conta pro mês seguinte
function mesReferenciaAtual(agora = new Date(), diaSemana = 4) {
    const fechamento = fechamentoMensalDoMes(agora.getFullYear(), agora.getMonth(), diaSemana);
    let ano = agora.getFullYear();
    let mes = agora.getMonth();
    if (agora >= fechamento) {
        mes += 1;
        if (mes > 11) { mes = 0; ano += 1; }
    }
    return `${ano}-${String(mes + 1).padStart(2, '0')}`;
}

// mês (YYYY-MM) imediatamente anterior a um mês de referência — usado no fechamento do
// mensal pra achar quem pagou o ciclo que está terminando (mesReferenciaAtual() já devolve
// o mês novo a partir do dia do fechamento, então "o mês anterior" não é sempre "mês - 1"
// em relação a hoje: no caso raro de rollover, precisa andar a partir do mês novo mesmo)
function mesAnterior(mesReferencia) {
    const [ano, mes] = mesReferencia.split('-').map(Number); // mes: 1-12
    const data = new Date(ano, mes - 2, 1);
    return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}`;
}

function embaralhar(lista) {
    const copia = [...lista];
    for (let i = copia.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copia[i], copia[j]] = [copia[j], copia[i]];
    }
    return copia;
}

// posições contam menos que o nível na hora de montar os times (o time ainda não
// tem posição bem definida pra todo mundo), então o "custo" de posição usa um peso
// bem menor que 1 ponto de nível — só desempata/ajusta quando um time já acumulou
// gente demais numa mesma posição, sem nunca sobrepor uma diferença clara de nível
const PESO_POSICAO = 0.5;

// balanceia `jogadores` em `nTimes` times. `limite` (opcional) é o tamanho máximo de cada time;
// sem ele, divide o mais igual possível (ceil(n / nTimes)). Mantém as chaves legadas
// timeA/timeB/somaA/somaB pra quem ainda usa o formato de 2 times.
function balancearTimes(jogadores, nTimes = 2, limite = null) {
    const embaralhados = embaralhar(jogadores);
    const tamanhoMax = limite || Math.ceil(jogadores.length / nTimes);

    const times = Array.from({ length: nTimes }, () => []);
    const somas = new Array(nTimes).fill(0);
    const posicoes = Array.from({ length: nTimes }, () => ({}));

    const colocar = (indice, jogador) => {
        times[indice].push(jogador);
        somas[indice] += jogador.nivel;
        const pos = jogador.posicao && jogador.posicao !== 'indefinida' ? jogador.posicao : null;
        if (pos) posicoes[indice][pos] = (posicoes[indice][pos] || 0) + 1;
    };

    // time de menor custo (soma de nível + penalidade de posição repetida) que ainda tem vaga
    const melhorTime = (jogador) => {
        const pos = jogador.posicao && jogador.posicao !== 'indefinida' ? jogador.posicao : null;
        let melhor = -1;
        let melhorCusto = Infinity;
        for (let t = 0; t < nTimes; t++) {
            if (times[t].length >= tamanhoMax) continue;
            const custo = somas[t] + (pos ? (posicoes[t][pos] || 0) * PESO_POSICAO : 0);
            if (custo < melhorCusto) { melhorCusto = custo; melhor = t; }
        }
        return melhor;
    };

    // regra dura: no máximo 1 goleira por time. As de maior nível (uma pra cada time)
    // ficam garantidas; se sobrar goleira além do nº de times, não tem como respeitar
    // a regra, então ela entra no balanceamento normal como os demais
    const goleiras = embaralhados.filter((j) => j.posicao === 'goleira').sort((a, b) => b.nivel - a.nivel);
    const outros = embaralhados.filter((j) => j.posicao !== 'goleira');

    goleiras.slice(0, nTimes).forEach((jogador) => {
        const t = melhorTime(jogador);
        if (t >= 0) colocar(t, jogador);
    });

    const restantes = embaralhar([...goleiras.slice(nTimes), ...outros]).sort((a, b) => b.nivel - a.nivel);
    for (const jogador of restantes) {
        const t = melhorTime(jogador);
        colocar(t >= 0 ? t : somas.indexOf(Math.min(...somas)), jogador);
    }

    return { times, somas, timeA: times[0], timeB: times[1], somaA: somas[0], somaB: somas[1] };
}

// decide quantos times formar e quem fica de reserva. `jogadores` chega na ordem de confirmação:
// - >= 3 * porTime  -> 3 times completos (que revezam); o excedente (últimas a confirmar) é reserva
// - >= 2 * porTime  -> 2 times completos + reservas
// - menos que isso  -> 2 times divididos igualmente, sem reservas
function montarPlanoDeTimes(jogadores, porTime = 5) {
    const tamanho = Number.isFinite(porTime) && porTime >= 1 ? porTime : 5;
    const n = jogadores.length;

    let nTimes;
    let titulares;
    let reservas = [];
    if (n >= 3 * tamanho) {
        nTimes = 3;
        titulares = jogadores.slice(0, 3 * tamanho);
        reservas = jogadores.slice(3 * tamanho);
    } else if (n >= 2 * tamanho) {
        nTimes = 2;
        titulares = jogadores.slice(0, 2 * tamanho);
        reservas = jogadores.slice(2 * tamanho);
    } else {
        nTimes = 2;
        titulares = jogadores;
    }

    const { times, somas } = balancearTimes(titulares, nTimes, nTimes === 2 && reservas.length === 0 ? null : tamanho);
    return { times, somas, reservas };
}

const LETRAS_TIMES = ['A', 'B', 'C'];
const BOLINHAS_TIMES = ['🔵', '🔴', '🟢']; // mesmas cores dos blocos de times na mensagem

// ordem de rodízio, sorteada. 3 times: o que está esperando entra no lugar do que está há mais
// rodadas seguidas em campo (empate é sorteado). 2 times + reservas: reservas entram no lugar de quem está há mais tempo
// em campo (1 por intervalo; com 2+ reservas, 1 por time por intervalo ou mais). Goleiras ficam fora do rodízio (não trocam de lugar).
function montarRodizio(times, reservas, minutos = 10, duracao = 60) {
    const passo = Number.isFinite(minutos) && minutos >= 1 ? minutos : 10;
    const total = Math.max(1, Math.floor((Number.isFinite(duracao) && duracao >= passo ? duracao : 60) / passo));
    const linhas = [];

    if (times.length === 3) {
        let [emCampo1, emCampo2, espera] = embaralhar([0, 1, 2]);
        const seguidas = [0, 0, 0]; // rodadas seguidas em campo de cada time
        for (let r = 0; r < total; r++) {
            seguidas[emCampo1]++;
            seguidas[emCampo2]++;
            const time = (t) => `${BOLINHAS_TIMES[t]} Time ${LETRAS_TIMES[t]}`;
            linhas.push(`*${r + 1}) ${r * passo}–${(r + 1) * passo} min*\n${time(emCampo1)} × ${time(emCampo2)}\n${time(espera)} espera ⏸️\n`);
            // sai quem está há mais rodadas seguidas em campo; empate é sorteado
            let sai;
            if (seguidas[emCampo1] === seguidas[emCampo2]) sai = Math.random() < 0.5 ? emCampo1 : emCampo2;
            else sai = seguidas[emCampo1] > seguidas[emCampo2] ? emCampo1 : emCampo2;
            const fica = sai === emCampo1 ? emCampo2 : emCampo1;
            seguidas[sai] = 0;
            [emCampo1, emCampo2, espera] = [fica, espera, sai];
        }
    } else if (times.length === 2 && reservas.length > 0) {
        let banco = embaralhar(reservas.filter((j) => j.posicao !== 'goleira'));
        // posições em campo: { jogador, time, desde }
        let emCampo = [];
        times.forEach((time, t) => time.forEach((j) => {
            if (j.posicao !== 'goleira') emCampo.push({ jogador: j, time: t, desde: 0 });
        }));
        // 1 reserva só: troca 1 por intervalo. 2+ (pelo menos 1 por time): troca 1 por time por
        // intervalo, e com mais reservas ainda, mais trocas — sempre em número par, metade de cada time
        const trocasPorIntervalo = banco.length >= 2 ? 2 * Math.floor(banco.length / 2) : 1;
        for (let r = 1; r < total && banco.length > 0; r++) {
            const trocas = [];
            const saindoAgora = [];
            let timeDaVez = Math.random() < 0.5 ? 0 : 1;
            for (let k = 0; k < trocasPorIntervalo && banco.length > 0; k++) {
                const disponiveis = emCampo.filter((e) => !saindoAgora.includes(e));
                const doTime = disponiveis.filter((e) => e.time === timeDaVez);
                const base = doTime.length > 0 ? doTime : disponiveis;
                if (base.length === 0) break;
                const menorDesde = Math.min(...base.map((e) => e.desde));
                const saindo = embaralhar(base.filter((e) => e.desde === menorDesde))[0];
                saindoAgora.push(saindo);
                trocas.push({ saindo, entrando: banco.shift() });
                timeDaVez = 1 - timeDaVez;
            }
            if (trocas.length === 0) break;
            linhas.push(`*${r * passo} min*\n` + trocas.map(({ saindo, entrando }) =>
                `${BOLINHAS_TIMES[saindo.time]} ${entrando.nome} entra no lugar de ${saindo.jogador.nome}`).join('\n') + '\n');
            trocas.forEach(({ saindo, entrando }) => {
                banco.push(saindo.jogador);
                emCampo = emCampo.map((e) => (e === saindo ? { jogador: entrando, time: saindo.time, desde: r } : e));
            });
        }
    }

    if (linhas.length === 0) return '';
    return `🔁 *Rodízio (a cada ${passo} min)*\n\n${linhas.join('\n')}`;
}

// tira acento/maiúscula pra comparar nomes digitados à mão (!faltam ana, bia)
function normalizarNome(texto) {
    return String(texto).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

// casa nomes digitados (separados por vírgula, "e" ou quebra de linha) com as confirmadas.
// Nome exato ganha; senão aceita um começo/trecho que só bata com UMA confirmada.
function acharPorNomes(confirmados, texto) {
    const pedidos = String(texto).split(/,|\n|;| e /i).map(normalizarNome).filter(Boolean);
    const achadas = [];
    const naoEncontradas = [];
    const ambiguas = [];
    for (const pedido of pedidos) {
        let candidatas = confirmados.filter((j) => normalizarNome(j.nome) === pedido);
        if (candidatas.length === 0) candidatas = confirmados.filter((j) => normalizarNome(j.nome).startsWith(pedido));
        if (candidatas.length === 0) candidatas = confirmados.filter((j) => normalizarNome(j.nome).includes(pedido));
        if (candidatas.length === 1) {
            if (!achadas.some((a) => a.id === candidatas[0].id)) achadas.push(candidatas[0]);
        } else if (candidatas.length === 0) {
            naoEncontradas.push(pedido);
        } else {
            ambiguas.push(pedido);
        }
    }
    return { achadas, naoEncontradas, ambiguas };
}

// monta as seções "Mensalistas (n)" / "Avulsas (n)" — a ordem de cada lista é a mesma
// ordem em que os arrays chegam (sempre por ordem de confirmação, nunca alfabética)
function montarSecoesDeConfirmadas(confirmados) {
    let texto = '';
    const mensalistas = confirmados.filter((j) => j.papel === 'mensalista');
    const avulsas = confirmados.filter((j) => j.papel === 'avulso');

    if (mensalistas.length > 0) {
        texto += `*Mensalistas (${mensalistas.length}):*\n`;
        mensalistas.forEach((j, i) => { texto += `${i + 1}. ${j.nome}\n`; });
        texto += '\n';
    }
    if (avulsas.length > 0) {
        texto += `*Avulsas (${avulsas.length}):*\n`;
        avulsas.forEach((j, i) => { texto += `${i + 1}. ${j.nome}\n`; });
        texto += '\n';
    }
    return texto;
}

function aplicarTokens(template, tokens) {
    let texto = template;
    for (const [token, valor] of Object.entries(tokens)) {
        texto = texto.split(`{${token}}`).join(valor);
    }
    return texto;
}

// templates padrão — usados quando a config no banco (editável em Mensagens > Msgs.
// automáticas) ainda não foi preenchida; ficam aqui (não em db.js) pra o texto default
// continuar ao lado de quem monta as mensagens
const TEMPLATE_LISTA_CONFIRMADA_PADRAO = '📋 *Lista fechada — {titulo}*\n\n{lista}Total: {total}\n\n🔒 Lista fechada — votos depois disso não contam mais.';
const TEMPLATE_LISTA_ATUAL_PADRAO = '📋 *Lista atual — {titulo}*\n\n{lista}Total: {total}{espera}\n\nEssa lista ainda pode mudar — a enquete continua aberta.';
const TEMPLATE_LISTA_ESPERA_PADRAO = '⏳ *Lista de espera — {titulo}*\n\n{lista}\nSó entram se algum dos confirmados sair da lista.';
const TEMPLATE_TIMES_PADRAO = '⚽ *Times — {titulo}*\n\n🔵 *Time A:*\n{time_a}\n🔴 *Time B:*\n{time_b}{time_c}{reservas}{rodizio}';

// mensagem oficial de fechamento — só quem realmente tem vaga garantida entra aqui
function montarTextoListaConfirmadas(enquete, confirmados, template = TEMPLATE_LISTA_CONFIRMADA_PADRAO) {
    if (confirmados.length === 0) {
        return `📋 *Lista fechada — ${enquete.titulo}*\n\nNinguém confirmado ainda.`;
    }

    return aplicarTokens(template, {
        titulo: enquete.titulo,
        lista: montarSecoesDeConfirmadas(confirmados),
        total: `${confirmados.length} confirmada${confirmados.length === 1 ? '' : 's'}`,
    });
}

// prévia da enquete ainda aberta — mostra confirmadas E lista de espera, sem fechar nada
function montarTextoListaAtual(enquete, confirmados, listaDeEspera = [], template = TEMPLATE_LISTA_ATUAL_PADRAO) {
    if (confirmados.length === 0 && listaDeEspera.length === 0) {
        return `📋 *Lista atual — ${enquete.titulo}*\n\nNinguém confirmado ainda.`;
    }

    let espera = '';
    if (listaDeEspera.length > 0) {
        espera = `\n\n⏳ *Lista de espera (${listaDeEspera.length}):*\n`;
        listaDeEspera.forEach((j, i) => { espera += `${i + 1}. ${j.nome}\n`; });
        espera += '\nSó entra se algum dos confirmados sair da lista.';
    }

    return aplicarTokens(template, {
        titulo: enquete.titulo,
        lista: montarSecoesDeConfirmadas(confirmados),
        total: `${confirmados.length} confirmada${confirmados.length === 1 ? '' : 's'}`,
        espera,
    });
}

// só quem ficou de fora por causa do limite de vagas
function montarTextoListaEspera(enquete, listaDeEspera, template = TEMPLATE_LISTA_ESPERA_PADRAO) {
    let lista = '';
    listaDeEspera.forEach((j, i) => { lista += `${i + 1}. ${j.nome}\n`; });

    return aplicarTokens(template, {
        titulo: enquete.titulo,
        lista,
    });
}

// nomesPorTime: array de arrays de string (2 ou 3 times) — usado tanto com nomes de jogadores
// quanto com nomes vindos de inputs do painel. reservas: array de string. rodizioTexto: bloco já
// montado por montarRodizio ('' = sem rodízio). Blocos extras (Time C, reservas, rodízio) que o
// template salvo no painel não menciona são anexados no fim, pra não sumirem de templates antigos.
function montarTextoTimes(tituloJogo, nomesPorTime, reservas = [], rodizioTexto = '', template = TEMPLATE_TIMES_PADRAO) {
    const lista = (nomes) => nomes.map((nome) => `- ${nome}\n`).join('');
    const blocoTimeC = nomesPorTime[2] ? `\n🟢 *Time C:*\n${lista(nomesPorTime[2])}` : '';
    const blocoReservas = reservas.length > 0 ? `\n🪑 *Reservas:*\n${lista(reservas)}` : '';
    const blocoRodizio = rodizioTexto ? `\n${rodizioTexto}` : '';

    let texto = aplicarTokens(template, {
        titulo: tituloJogo,
        time_a: lista(nomesPorTime[0] || []),
        time_b: lista(nomesPorTime[1] || []),
        time_c: blocoTimeC,
        reservas: blocoReservas,
        rodizio: blocoRodizio,
    });
    if (blocoTimeC && !template.includes('{time_c}')) texto += blocoTimeC;
    if (blocoReservas && !template.includes('{reservas}')) texto += blocoReservas;
    if (blocoRodizio && !template.includes('{rodizio}')) texto += blocoRodizio;
    return texto;
}

function montarTextoMensal(resumo) {
    if (!resumo) return 'Ainda não há uma chamada de renovação do mensal. A fila começa na mensagem automática de fechamento.';
    const horario = (valor) => valor ? new Date(valor + 'Z').toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '';
    const secao = (titulo, lista, comHora = false) => `*${titulo} (${lista.length})*\n` +
        (lista.length ? lista.map((j, i) => `${i + 1}. ${j.nome}${comHora ? ' — ' + horario(j.respondido_em) : ''}`).join('\n') : 'Nenhuma.');
    return [`*Mensal — ${resumo.mesNovo}*`,
        `Prioridade para renovar até ${new Date(resumo.ciclo.prazo_em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.`,
        secao('Renovações confirmadas', resumo.renovadas), secao('Pendentes de renovação', resumo.pendentes),
        secao('Novas mensalistas aprovadas', resumo.aprovadas), secao('Fila de interessadas', resumo.fila, true),
        secao('Desistências / prazo encerrado', resumo.desistencias),
        'Reaja 👍 na mensagem de fechamento para continuar ou entrar na fila; 👎 (ou retirar o 👍) para desistir. Novas entradas dependem da confirmação da organização.'
    ].join('\n\n');
}

module.exports = {
    montarTextoMensal,
    embaralhar,
    balancearTimes,
    montarPlanoDeTimes,
    montarRodizio,
    acharPorNomes,
    montarTextoListaConfirmadas,
    montarTextoListaAtual,
    montarTextoListaEspera,
    montarTextoTimes,
    fechamentoMensalDoMes,
    mesReferenciaAtual,
    mesAnterior,
    TEMPLATE_LISTA_CONFIRMADA_PADRAO,
    TEMPLATE_LISTA_ATUAL_PADRAO,
    TEMPLATE_LISTA_ESPERA_PADRAO,
    TEMPLATE_TIMES_PADRAO,
};
