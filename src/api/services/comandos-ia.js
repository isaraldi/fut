const { mensagemPrivadaRecebida } = require('./llm-local');

const AJUDA_IA = 'Você pode pedir: “coloca a Carol no próximo jogo”, “a Bruna Fuchs não vai mais”, “quantas vagas sobraram?”, “quem ainda não confirmou?”, lista do jogo, lista de espera, resumo do mensal, sortear times, fechar a lista, abrir enquete no grupo configurado, sincronizar elenco, consultar faltas ou definir quem está faltando. Para corrigir a presença, envie a lista completa editada e depois diga “confirmar a correção da lista” ou “cancelar a correção da lista”.';
const CONSULTAS = new Set(['lista', 'espera', 'mensal', 'vagas', 'pendentes', 'ajuda']);
const DO_GRUPO = new Set(['enquete', 'sincronizar', 'confirmarlista', 'cancelarlista']);

function configuracaoGruposIa(getConfig) {
  const configuracao = getConfig('llm_grupos_autorizados');
  if (configuracao === null || configuracao === undefined || configuracao === '') {
    const grupo = getConfig('enquete_grupo_id');
    return { modo: 'padrao', ids: grupo ? [grupo] : [] };
  }
  try {
    const grupos = JSON.parse(configuracao);
    if (Array.isArray(grupos) && grupos.every(id => typeof id === 'string' && id.endsWith('@g.us'))) {
      return { modo: 'selecionados', ids: [...new Set(grupos)] };
    }
  } catch { /* Configuração inválida não libera nenhum grupo. */ }
  return { modo: 'invalida', ids: [] };
}

function grupoPermitidoIa(getConfig, grupo) {
  return !!grupo && configuracaoGruposIa(getConfig).ids.includes(grupo);
}

function criarExecutorComandosIa({ llm, autorizado, obterContexto, sincronizar, acoes, registrarErro,
  grupoAutorizado = () => false, botMencionado = async () => false }) {
  async function tratar(msg) {
    const grupo = !msg.fromMe && !msg.isStatus && typeof msg.from === 'string' && msg.from.endsWith('@g.us');
    if ((!mensagemPrivadaRecebida(msg) && !grupo) || !llm.habilitada('mensagens') || msg.hasMedia
      || !msg.body?.trim() || msg.body.trim().startsWith('!')) return false;
    if (grupo && (!grupoAutorizado(msg.from) || !Array.isArray(msg.mentionedIds) || !msg.mentionedIds.length)) return false;
    if (!(await autorizado(msg))) return true;
    if (grupo && !(await botMencionado(msg))) return false;
    const contexto = await obterContexto(msg);
    let pedido;
    try {
      pedido = await llm.interpretarPedido(msg.body, { correcaoPendente: contexto.correcaoPendente });
    } catch {
      if (!llm.habilitada('mensagens') || !(await autorizado(msg)) || (grupo && !grupoAutorizado(msg.from))) return true;
      await msg.reply('Não consegui interpretar agora. Tente novamente em instantes. Você também pode usar os comandos tradicionais.');
      return true;
    }
    if (!pedido || !llm.habilitada('mensagens') || !(await autorizado(msg)) || (grupo && !grupoAutorizado(msg.from))) return true;
    if (pedido.intencao === 'ajuda') {
      await msg.reply(AJUDA_IA);
      return true;
    }
    const acao = Object.hasOwn(acoes, pedido.intencao) ? acoes[pedido.intencao] : null;
    if (typeof acao !== 'function') return true;
    try {
      await sincronizar();
      if (!llm.habilitada('mensagens') || !(await autorizado(msg)) || (grupo && !grupoAutorizado(msg.from))) return true;
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

module.exports = { criarExecutorComandosIa, grupoPermitidoIa, configuracaoGruposIa, AJUDA_IA };
