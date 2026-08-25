// monta o texto/sorteio que tanto o bot (comandos !fechar / !times) quanto o painel
// (botões "mandar pro grupo") usam — fica fora de db.js e index.js pra não duplicar entre
// os dois processos (bot e painel rodam separados, só compartilham o banco)

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

function montarTextoListaConfirmadas(enquete, confirmados, listaDeEspera = []) {
    let texto = `📋 *Lista fechada — ${enquete.titulo}*\n\n`;

    if (confirmados.length === 0 && listaDeEspera.length === 0) {
        texto += 'Ninguém confirmado ainda.';
        return texto;
    }

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
    texto += `Total: ${confirmados.length} confirmada${confirmados.length === 1 ? '' : 's'}`;

    if (listaDeEspera.length > 0) {
        texto += `\n\n⏳ *Lista de espera (${listaDeEspera.length}):*\n`;
        listaDeEspera.forEach((j, i) => { texto += `${i + 1}. ${j.nome}\n`; });
        texto += '\nSó entra se algum dos confirmados sair da lista.';
    }

    texto += '\n\n🔒 Lista fechada — votos depois disso não contam mais.';
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
    montarTextoTimes,
};
