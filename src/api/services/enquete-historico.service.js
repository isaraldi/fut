const consultas = require('../repositories/enquete-historico.repository');
const { db, enfileirarMensagemJogadora } = require('./fut.service');

function registrar(enquete, jogador, resposta, papel, ocorrido = Date.now(), origem = 'painel', fechada = false) {
    const ultimo = consultas.ultimo(enquete, jogador);
    const anterior = fechada && ultimo ? { opcao: ultimo.resposta, papel: ultimo.papel } : consultas.voto(enquete, jogador);
    const instante = new Date(ocorrido).toISOString();
    if (ultimo && instante < ultimo.ocorrido_em) return;
    if ((anterior?.opcao || '') === resposta && (anterior?.papel || null) === papel) return;
    consultas.inserir({ enquete, jogador, anterior: anterior?.opcao || '', resposta,
        papelAnterior: anterior?.papel || null, papel, origem, ocorrido: instante });
}
function listar(enquete) {
    return consultas.listar(enquete).map(item => ({ ...item,
        retirada: item.papel_anterior !== null && item.papel === null,
        multavel: item.papel_anterior === 'mensalista' && item.papel === null &&
            new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(new Date(item.ocorrido_em)) === item.data_jogo,
    }));
}
function cobrar(enquete, historicoId) {
    return db.transaction(() => {
        const item = listar(enquete).find(h => h.id === historicoId);
        if (!item?.multavel || item.cobrada) return 'Cobrança indisponível ou já enfileirada para esta jogadora neste jogo.';
        if (!consultas.contato(item.jogador_id)?.whatsapp_id) return 'Cadastre o WhatsApp da jogadora antes de cobrar.';
        const data = item.data_jogo.split('-').reverse().join('/');
        enfileirarMensagemJogadora(item.jogador_id, `Olá, ${item.nome}! Você confirmou presença e desistiu no dia do jogo (${data}). Conforme as regras do time, a multa é de R$ 20,00. Por favor, realize o pagamento e envie o comprovante. Obrigada!`);
        consultas.marcar(item.id);
        return 'Cobrança de R$ 20,00 enfileirada para envio privado pelo bot.';
    }).immediate();
}
module.exports = { registrar, listar, cobrar };
