const { mensagemPrivadaRecebida } = require('./llm-local');

const AJUDA_IA = 'Você pode pedir: lista do jogo, lista de espera, resumo do mensal, sortear times, fechar a lista, abrir enquete no grupo configurado, sincronizar elenco, consultar faltas ou definir quem está faltando. Para corrigir a presença, envie a lista completa editada e depois diga “confirmar a correção da lista” ou “cancelar a correção da lista”.';
const CONSULTAS = new Set(['lista', 'espera', 'mensal', 'ajuda']);
const DO_GRUPO = new Set(['enquete', 'sincronizar', 'confirmarlista', 'cancelarlista']);

function criarExecutorComandosIa({ llm, autorizado, obterContexto, sincronizar, acoes, registrarErro }) {
  async function tratar(msg) {
    if (!mensagemPrivadaRecebida(msg) || !llm.habilitada('mensagens') || msg.hasMedia
      || !msg.body?.trim() || msg.body.trim().startsWith('!')) return false;
    if (!(await autorizado(msg))) return true;
    const contexto = await obterContexto(msg);
    let pedido;
    try {
      pedido = await llm.interpretarPedido(msg.body, { correcaoPendente: contexto.correcaoPendente });
    } catch {
      await msg.reply('Não consegui interpretar agora. Tente novamente em instantes. Você também pode usar os comandos tradicionais.');
      return true;
    }
    if (!pedido || !(await autorizado(msg))) return true;
    if (pedido.intencao === 'ajuda') {
      await msg.reply(AJUDA_IA);
      return true;
    }
    const acao = Object.hasOwn(acoes, pedido.intencao) ? acoes[pedido.intencao] : null;
    if (typeof acao !== 'function') return true;
    try {
      await sincronizar();
      if (!(await autorizado(msg))) return true;
      const atual = await obterContexto(msg);
      if (!CONSULTAS.has(pedido.intencao)
        && (atual.grupo !== contexto.grupo || atual.enqueteId !== contexto.enqueteId
          || (['confirmarlista', 'cancelarlista'].includes(pedido.intencao) && atual.correcaoId !== contexto.correcaoId))) {
        await msg.reply('O grupo, jogo ou prévia mudou enquanto eu interpretava. Confira a lista atual e envie o pedido novamente.');
        return true;
      }
      if (DO_GRUPO.has(pedido.intencao) && !atual.grupo?.endsWith('@g.us')) {
        await msg.reply('Configure o grupo do futebol no painel antes de fazer esse pedido.');
        return true;
      }
      await acao(msg, pedido, atual);
    } catch (erro) {
      registrarErro(erro);
      await msg.reply('Não consegui concluir o pedido. Confira a situação atual antes de tentar novamente.');
    }
    return true;
  }
  return { tratar };
}

module.exports = { criarExecutorComandosIa, AJUDA_IA };
