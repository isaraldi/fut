const consultas = require('../repositories/jogos.repository');
const { db, getConfig, podeUsarComandos, getConfirmadosDaEnquete, getListaDeEsperaDaEnquete,
    marcarVotoManual, getEnqueteOpcoes, getAusentesDaEnquete, setAusentesDaEnquete, registrarLog } = require('./fut.service');

function normalizar(nome) {
    return nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ').trim();
}

// Nenhuma chamada externa entre a validação do contexto e a alteração da presença.
function executarPedidoPresenca(pedido, contexto) {
    return db.transaction(() => {
        if (!podeUsarComandos(contexto.autor)) return 'Você não tem permissão para administrar o jogo.';
        const enquete = consultas.getJogoAtualConsulta1().get();
        if (!enquete || !contexto.grupo || enquete.group_id !== contexto.grupo
            || getConfig('enquete_grupo_id') !== contexto.grupo || enquete.id !== contexto.enqueteId) {
            return 'Não há um jogo atual no grupo configurado, ou o jogo mudou. Confira a lista e envie o pedido novamente.';
        }
        const jogadoras = consultas.jogadoresParaPresencaIa().all(enquete.id);
        const confirmadasAntes = getConfirmadosDaEnquete(enquete.id);
        const esperaAntes = getListaDeEsperaDaEnquete(enquete.id);
        const referencia = `Jogo: ${enquete.titulo}`;
        if (pedido.intencao === 'vagas') {
            const vagas = enquete.vagas_maximo ? Math.max(0, enquete.vagas_maximo - confirmadasAntes.length) : null;
            return `${referencia}\n${vagas === null ? 'Sem limite de vagas configurado' : `${vagas} vaga(s) disponível(is)`}. ${confirmadasAntes.length} confirmada(s) e ${esperaAntes.length} na espera.`;
        }
        if (pedido.intencao === 'pendentes') {
            const pendentes = jogadoras.filter(j => j.ativo && !j.papel_voto);
            return `${referencia}\n${pendentes.length ? 'Ainda não confirmaram:\n' + pendentes.map(j => `• ${j.nome}`).join('\n') : 'Todas as jogadoras ativas já confirmaram.'}`;
        }
        if (!['confirmarpresenca', 'retirarpresenca'].includes(pedido.intencao)
            || !Array.isArray(pedido.nomes) || pedido.nomes.length !== 1 || typeof pedido.nomes[0] !== 'string'
            || !pedido.nomes[0].trim()) return 'Envie um pedido por vez, com o nome da jogadora.';
        const nome = normalizar(pedido.nomes[0]);
        let candidatas = jogadoras.filter(j => normalizar(j.nome) === nome);
        if (!candidatas.length) candidatas = jogadoras.filter(j => normalizar(j.nome).startsWith(nome + ' '));
        if (candidatas.length > 1) {
            return 'Encontrei mais de uma jogadora com esse nome. Reenvie o pedido com o nome completo. Se os nomes forem iguais, diferencie-os no cadastro. Nenhuma presença foi alterada.';
        }
        if (!candidatas.length) return 'Não encontrei essa jogadora no elenco ativo ou na lista do jogo. Confira o nome e reenvie o pedido; nenhuma presença foi alterada.';
        const jogadora = candidatas[0];
        const retirar = pedido.intencao === 'retirarpresenca';
        if (retirar && !jogadora.papel_voto) return `${referencia}\n${jogadora.nome} já está fora da lista do jogo.`;
        if (!retirar && jogadora.papel_voto) return `${referencia}\n${jogadora.nome} já está ${esperaAntes.some(j => j.id === jogadora.id) ? 'na lista de espera' : 'confirmada'}.`;
        if (!retirar && !jogadora.ativo) return 'Essa jogadora está inativa. Reative o cadastro no painel antes de confirmar.';
        if (retirar) {
            consultas.postJogosIdConfirmarJogadorIdRemoverConsulta19().run(enquete.id, jogadora.id);
        } else {
            const opcao = getEnqueteOpcoes().find(o => o.conta === 1)?.texto || 'Confirmada manualmente';
            consultas.postJogosIdConfirmarConsulta18().run(enquete.id, jogadora.id, opcao, jogadora.papel);
        }
        marcarVotoManual(enquete.id, jogadora.id);
        setAusentesDaEnquete(enquete.id, getAusentesDaEnquete(enquete.id).filter(id => id !== jogadora.id));
        const confirmadas = getConfirmadosDaEnquete(enquete.id);
        const espera = getListaDeEsperaDaEnquete(enquete.id);
        const promovidas = confirmadas.filter(j => esperaAntes.some(a => a.id === j.id));
        const deslocadas = espera.filter(j => confirmadasAntes.some(a => a.id === j.id));
        registrarLog('lista', 'sucesso', `Presença ${retirar ? 'removida' : 'incluída'} pela IA no jogo ${enquete.id}.`);
        return `${referencia}\n${jogadora.nome} ${retirar ? 'foi retirada da lista do jogo' : espera.some(j => j.id === jogadora.id) ? 'entrou na lista de espera' : 'foi confirmada no jogo'}.`
            + (promovidas.length ? `\nEntrou na vaga: ${promovidas.map(j => j.nome).join(', ')}.` : '')
            + (deslocadas.length ? `\nPassou para a espera pela prioridade das mensalistas: ${deslocadas.map(j => j.nome).join(', ')}.` : '');
    }).immediate();
}

module.exports = { executarPedidoPresenca };
