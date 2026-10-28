const consultas = require('../repositories/sincronizacao-whatsapp.repository');
// Recuperação consultiva: lê o estado do WhatsApp, sem enviar mensagens.
const dados = require('../services/fut.service');
const { db, getEnqueteOpcoes, getCicloMensalAtual, getConviteFechamentoMensal,
    responderChamadaMensal, getJogadorPorWhatsappId, upsertJogador, registrarLog } = dados;

function serializado(id) {
    return typeof id === 'string' ? id : id?._serialized || id?.$1 || null;
}

function instante(valor) {
    const numero = Number(valor);
    if (!Number.isFinite(numero) || numero <= 0) return null;
    return Math.round(numero < 1e12 ? numero * 1000 : numero);
}

function criarSincronizadorWhatsApp({ client, resolverIdCanonico, limitar = promise => promise, agora = Date.now }) {
    let fila = Promise.resolve();
    let sincronizando = null;
    let ultimaTentativa = -Infinity;
    let ultimaFalha = -Infinity;
    let conectado = false;
    let geracao = 0;

    function falha(tipo) {
        if (agora() - ultimaFalha < 10 * 60 * 1000) return;
        ultimaFalha = agora();
        registrarLog('mensagem', 'erro', `Sincronização do WhatsApp incompleta (${tipo}). Os dados existentes foram preservados; haverá nova tentativa.`);
    }
    function enfileirar(tarefa) {
        const resultado = fila.then(tarefa);
        fila = resultado.catch(() => falha('processamento'));
        return resultado.catch(() => false);
    }
    function estado(tipo, mensagem, jogador) {
        return consultas.estadoConsulta1()
            .get(tipo, mensagem, jogador);
    }
    function salvarEstado(tipo, mensagem, jogador, conteudo, evento) {
        consultas.salvarEstadoConsulta2()
            .run(tipo, mensagem, jogador, conteudo, evento);
    }
    function antigo(anterior, evento, conteudo, recuperado) {
        if (!anterior?.evento_em) return false;
        if (evento < anterior.evento_em) return true;
        if (evento === anterior.evento_em) return recuperado || conteudo === anterior.conteudo;
        return false;
    }
    async function jogadorPara(id, criar) {
        const bruto = serializado(id);
        if (!bruto) return null;
        const canonico = await limitar(resolverIdCanonico(bruto));
        if (!canonico) return null;
        let jogador = getJogadorPorWhatsappId(canonico);
        if (!jogador && criar) {
            const contato = await limitar(client.getContactById(canonico));
            const idJogador = upsertJogador(canonico, contato.pushname || contato.name || 'Jogador', null,
                canonico.endsWith('@lid') ? null : contato.number || null);
            jogador = consultas.jogadorParaConsulta3().get(idJogador);
        }
        return jogador;
    }
    async function processarVoto(voto, recuperado, recebidoEm) {
        const messageId = serializado(voto.parentMessage?.id) || serializado(voto.parentMsgKey);
        const enquete = consultas.processarVotoConsulta4().get(messageId);
        if (!enquete || enquete.fechada_em || !Array.isArray(voto.selectedOptions)) return false;
        const evento = instante(voto.interractedAtTs) || (!recuperado ? recebidoEm : null);
        if (!evento || evento > agora() + 60000) return false;
        if (voto.selectedOptions.some(opcao => typeof opcao.name !== 'string')) return false;
        const texto = voto.selectedOptions.map(opcao => opcao.name).join(', ');
        const jogador = await jogadorPara(voto.voter, texto !== '');
        if (!jogador) return false;
        return db.transaction(() => {
            // O painel pode ter fechado a enquete enquanto a identidade era resolvida.
            if (consultas.processarVotoConsulta5().get(enquete.id)?.fechada_em) return false;
            const anterior = estado('voto', messageId, jogador.id);
            if (antigo(anterior, evento, texto, recuperado)) return false;
            const votoAtual = consultas.processarVotoConsulta6().get(enquete.id, jogador.id);
            const manual = anterior?.manual_em || (!anterior && votoAtual ? Date.parse(votoAtual.votado_em.replace(' ', 'T') + 'Z') : 0);
            salvarEstado('voto', messageId, jogador.id, texto, evento);
            if (evento <= manual) return false;
            if (!texto) {
                consultas.processarVotoConsulta7().run(enquete.id, jogador.id);
                return true;
            }
            // Repetir a consulta não altera vínculo, confirmação manual nem posição na fila.
            if (!anterior && votoAtual?.opcao === texto) return false;
            const confirma = getEnqueteOpcoes().some(opcao => opcao.texto === texto && opcao.conta);
            const papelAtual = consultas.processarVotoConsulta8().get(jogador.id).papel;
            consultas.processarVotoConsulta9()
                .run(enquete.id, jogador.id, texto, confirma ? papelAtual : null,
                    new Date(evento).toISOString().replace('T', ' ').replace('Z', ''));
            return true;
        }).immediate();
    }
    async function processarReacao(reacao, recuperada, recebidoEm) {
        const messageId = serializado(reacao.msgId);
        const ciclo = getCicloMensalAtual();
        if (!ciclo || ciclo.message_id !== messageId) return false;
        const evento = instante(reacao.timestamp) || (!recuperada ? recebidoEm : null);
        if (!evento || evento < ciclo.criado_em - 1000 || evento > agora() + 60000) return false;
        const jogador = await jogadorPara(reacao.senderId, false);
        if (!jogador) return false;
        const emoji = reacao.reaction || '';
        return db.transaction(() => {
            if (getCicloMensalAtual()?.message_id !== messageId) return false;
            const anterior = estado('mensal', messageId, jogador.id);
            if (antigo(anterior, evento, emoji, recuperada)) return false;
            // getReactions arredonda para segundos, ao contrário do evento ao vivo.
            if (anterior?.conteudo === emoji) {
                salvarEstado('mensal', messageId, jogador.id, emoji, Math.max(evento, anterior.evento_em || 0));
                return false;
            }
            const convite = getConviteFechamentoMensal(messageId, jogador.id);
            if (emoji !== '👍' && emoji !== '👎' && convite?.resposta !== 'sim') return false;
            if (!anterior && convite?.respondido_em && !convite.expirada &&
                evento <= Date.parse(convite.respondido_em.replace(' ', 'T') + 'Z')) {
                salvarEstado('mensal', messageId, jogador.id, emoji, evento);
                return false;
            }
            const mudou = responderChamadaMensal(messageId, jogador.id, emoji === '👍' ? 'sim' : 'nao', evento, true);
            if (mudou) salvarEstado('mensal', messageId, jogador.id, emoji, evento);
            return mudou;
        }).immediate();
    }
    function receberVoto(voto) {
        const recebidoEm = agora();
        return enfileirar(() => processarVoto(voto, false, recebidoEm));
    }
    function receberReacao(reacao) {
        const recebidoEm = agora();
        return enfileirar(() => processarReacao(reacao, false, recebidoEm));
    }
    async function consultar() {
        const versao = geracao;
        let alteracoes = 0;
        const enquete = consultas.consultarConsulta10().get();
        if (enquete && !enquete.fechada_em) {
            try {
                const mensagem = await limitar(client.getMessageById(enquete.message_id));
                if (!mensagem || mensagem.type !== 'poll_creation') throw new Error('Enquete indisponível');
                const votos = await limitar(mensagem.getPollVotes());
                if (!Array.isArray(votos)) throw new Error('Votos indisponíveis');
                votos.sort((a, b) => (instante(a.interractedAtTs) || 0) - (instante(b.interractedAtTs) || 0));
                for (const voto of votos) {
                    if (versao !== geracao || !conectado) return;
                    if (!instante(voto.interractedAtTs)) { falha('voto sem horário'); continue; }
                    const recuperado = { ...voto, parentMsgKey: enquete.message_id };
                    if (await enfileirar(() => processarVoto(recuperado, true, agora()))) alteracoes++;
                }
            } catch { falha('enquete'); }
        }
        const ciclo = getCicloMensalAtual();
        if (ciclo && versao === geracao && conectado) {
            try {
                const mensagem = await limitar(client.getMessageById(ciclo.message_id));
                if (!mensagem) throw new Error('Chamada indisponível');
                const grupos = await limitar(mensagem.getReactions());
                if (grupos !== undefined && !Array.isArray(grupos)) throw new Error('Reações indisponíveis');
                // Uma ausência no cache não prova retirada: só aplica reações efetivamente obtidas.
                const reacoes = (grupos || []).flatMap(grupo => {
                    if (!Array.isArray(grupo.senders)) throw new Error('Remetentes indisponíveis');
                    return grupo.senders.map(reacao => ({ ...reacao, reaction: reacao.reaction ?? grupo.id, msgId: ciclo.message_id }));
                }).sort((a, b) => (instante(a.timestamp) || 0) - (instante(b.timestamp) || 0));
                for (const reacao of reacoes) {
                    if (versao !== geracao || !conectado) return;
                    if (!instante(reacao.timestamp)) { falha('reação sem horário'); continue; }
                    if (await enfileirar(() => processarReacao(reacao, true, agora()))) alteracoes++;
                }
            } catch { falha('mensal'); }
        }
        if (alteracoes) registrarLog('mensagem', 'sucesso', `Sincronização do WhatsApp recuperou ${alteracoes} atualização(ões).`);
    }
    function sincronizar(forcar = false) {
        if (sincronizando) return sincronizando;
        if (!conectado || (!forcar && agora() - ultimaTentativa < 30 * 60 * 1000)) return fila;
        ultimaTentativa = agora();
        sincronizando = consultar().catch(() => falha('consulta')).finally(() => { sincronizando = null; });
        return sincronizando;
    }
    function conectar() {
        conectado = true;
        geracao++;
        // Um novo ready pode chegar enquanto a consulta da conexão anterior termina.
        if (sincronizando) return sincronizando.then(() => sincronizar(true));
        return sincronizar(true);
    }
    function desconectar() { conectado = false; geracao++; }
    return { receberVoto, receberReacao, sincronizar, conectar, desconectar };
}

module.exports = { criarSincronizadorWhatsApp };
