// monta o texto/sorteio que tanto o bot (comandos !fechar / !times) quanto o painel
// (botões "mandar pro grupo") usam — fica fora de db.js e index.js pra não duplicar entre
// os dois processos (bot e painel rodam separados, só compartilham o banco)

// o mensal fecha na quinta-feira seguinte à última quarta-feira do mês — normalmente cai
// dentro do próprio mês, mas se o mês terminar numa quarta-feira a quinta vira dia 1º do mês
// seguinte (o construtor de Date normaliza esse overflow de dia sozinho)
function fechamentoMensalDoMes(ano, mesIndex) {
    const ultimoDia = new Date(ano, mesIndex + 1, 0).getDate();
    let ultimaQuarta = null;
    for (let dia = ultimoDia; dia >= 1; dia--) {
        if (new Date(ano, mesIndex, dia).getDay() === 3) {
            ultimaQuarta = dia;
            break;
        }
    }
    return new Date(ano, mesIndex, ultimaQuarta + 1);
}

// mês (YYYY-MM) que um pagamento feito "agora" deve contar: antes do fechamento do mensal
// (calculado dentro do próprio mês corrente) conta pro mês corrente; a partir dele (inclusive)
// já conta pro mês seguinte
function mesReferenciaAtual(agora = new Date()) {
    const fechamento = fechamentoMensalDoMes(agora.getFullYear(), agora.getMonth());
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

function balancearTimes(jogadores) {
    const embaralhados = embaralhar(jogadores);

    const timeA = [];
    const timeB = [];
    let somaA = 0;
    let somaB = 0;
    const posicoesA = {};
    const posicoesB = {};

    // regra dura: no máximo 1 goleira por time. As duas de maior nível (uma pra cada time)
    // ficam garantidas; se sobrar uma terceira goleira confirmada, não tem como respeitar
    // a regra dos dois lados, então ela entra no balanceamento normal como os demais
    const goleiras = embaralhados.filter((j) => j.posicao === 'goleira').sort((a, b) => b.nivel - a.nivel);
    const outros = embaralhados.filter((j) => j.posicao !== 'goleira');

    goleiras.slice(0, 2).forEach((jogador) => {
        if (somaA <= somaB) {
            timeA.push(jogador);
            somaA += jogador.nivel;
            posicoesA.goleira = (posicoesA.goleira || 0) + 1;
        } else {
            timeB.push(jogador);
            somaB += jogador.nivel;
            posicoesB.goleira = (posicoesB.goleira || 0) + 1;
        }
    });

    const restantes = embaralhar([...goleiras.slice(2), ...outros]).sort((a, b) => b.nivel - a.nivel);

    for (const jogador of restantes) {
        const posicao = jogador.posicao && jogador.posicao !== 'indefinida' ? jogador.posicao : null;
        const custoA = somaA + (posicao ? (posicoesA[posicao] || 0) * PESO_POSICAO : 0);
        const custoB = somaB + (posicao ? (posicoesB[posicao] || 0) * PESO_POSICAO : 0);

        if (custoA <= custoB) {
            timeA.push(jogador);
            somaA += jogador.nivel;
            if (posicao) posicoesA[posicao] = (posicoesA[posicao] || 0) + 1;
        } else {
            timeB.push(jogador);
            somaB += jogador.nivel;
            if (posicao) posicoesB[posicao] = (posicoesB[posicao] || 0) + 1;
        }
    }

    return { timeA, timeB, somaA, somaB };
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

// mensagem oficial de fechamento — só quem realmente tem vaga garantida entra aqui
function montarTextoListaConfirmadas(enquete, confirmados) {
    let texto = `📋 *Lista fechada — ${enquete.titulo}*\n\n`;

    if (confirmados.length === 0) {
        texto += 'Ninguém confirmado ainda.';
        return texto;
    }

    texto += montarSecoesDeConfirmadas(confirmados);
    texto += `Total: ${confirmados.length} confirmada${confirmados.length === 1 ? '' : 's'}`;
    texto += '\n\n🔒 Lista fechada — votos depois disso não contam mais.';
    return texto;
}

// prévia da enquete ainda aberta — mostra confirmadas E lista de espera, sem fechar nada
function montarTextoListaAtual(enquete, confirmados, listaDeEspera = []) {
    let texto = `📋 *Lista atual — ${enquete.titulo}*\n\n`;

    if (confirmados.length === 0 && listaDeEspera.length === 0) {
        texto += 'Ninguém confirmado ainda.';
        return texto;
    }

    texto += montarSecoesDeConfirmadas(confirmados);
    texto += `Total: ${confirmados.length} confirmada${confirmados.length === 1 ? '' : 's'}`;

    if (listaDeEspera.length > 0) {
        texto += `\n\n⏳ *Lista de espera (${listaDeEspera.length}):*\n`;
        listaDeEspera.forEach((j, i) => { texto += `${i + 1}. ${j.nome}\n`; });
        texto += '\nSó entra se algum dos confirmados sair da lista.';
    }

    texto += '\n\nEssa lista ainda pode mudar — a enquete continua aberta.';
    return texto;
}

// nomesTimeA/nomesTimeB: arrays de string — usado tanto com jogadores completos ({nome: ...})
// quanto com nomes já extraídos (ex: vindos de inputs hidden do formulário do painel)
function montarTextoTimes(tituloJogo, nomesTimeA, nomesTimeB) {
    let texto = `⚽ *Times — ${tituloJogo}*\n\n`;
    texto += '🔵 *Time A:*\n';
    nomesTimeA.forEach((nome) => { texto += `- ${nome}\n`; });
    texto += '\n🔴 *Time B:*\n';
    nomesTimeB.forEach((nome) => { texto += `- ${nome}\n`; });
    return texto;
}

module.exports = {
    embaralhar,
    balancearTimes,
    montarTextoListaConfirmadas,
    montarTextoListaAtual,
    montarTextoTimes,
    fechamentoMensalDoMes,
    mesReferenciaAtual,
    mesAnterior,
};
