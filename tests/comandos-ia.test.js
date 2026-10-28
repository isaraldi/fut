const assert = require('node:assert/strict');
const { criarExecutorComandosIa, grupoPermitidoIa } = require('../comandos-ia');

async function main() {
  const config = { enquete_grupo_id: 'principal@g.us' };
  const getConfig = chave => config[chave] ?? null;
  assert.equal(grupoPermitidoIa(getConfig, 'principal@g.us'), true);
  assert.equal(grupoPermitidoIa(getConfig, 'outro@g.us'), false);
  config.llm_grupos_autorizados = '["principal@g.us","outro@g.us"]';
  assert.equal(grupoPermitidoIa(getConfig, 'outro@g.us'), true);
  for (const valor of ['[]', 'inválido', '{}', '["principal@g.us",123]']) {
    config.llm_grupos_autorizados = valor;
    assert.equal(grupoPermitidoIa(getConfig, 'principal@g.us'), false);
  }
  let permitido = true;
  let ativo = true;
  let falhar = false;
  let trocarGrupo = false;
  let revogar = false;
  let grupo = 'teste@g.us';
  let pedido = { intencao: 'lista', nomes: [] };
  let classificacoes = 0;
  let sincronizacoes = 0;
  let erros = 0;
  const executados = [];
  const respostas = [];
  const msg = { from: 'teste@c.us', body: 'pedido de teste', reply: async texto => respostas.push(texto) };
  const nomes = ['lista', 'espera', 'mensal', 'times', 'fechar', 'enquete', 'sincronizar', 'faltam', 'limparfaltas', 'confirmarlista', 'cancelarlista'];
  const acoes = Object.fromEntries(nomes.map(nome => [nome, async (m, p, contexto) => {
    assert.equal(m, msg);
    assert.equal(contexto.grupo, grupo);
    executados.push(p.intencao);
  }]));
  const executor = criarExecutorComandosIa({
    autorizado: async () => permitido,
    obterContexto: async () => ({ grupo, enqueteId: 1, correcaoPendente: true }),
    sincronizar: async () => { sincronizacoes++; if (trocarGrupo) grupo = 'outro@g.us'; },
    registrarErro: () => { erros++; },
    acoes,
    llm: {
      habilitada: () => ativo,
      interpretarPedido: async (texto, contexto) => {
        classificacoes++;
        assert.equal(contexto.correcaoPendente, true);
        if (falhar) throw new Error('Indisponível');
        if (revogar) permitido = false;
        return pedido;
      },
    },
  });
  for (const intencao of nomes) {
    pedido = { intencao, nomes: [] };
    assert.equal(await executor.tratar(msg), true);
    assert.equal(executados.at(-1), intencao);
  }
  assert.deepEqual(executados, nomes);
  const antes = classificacoes;
  for (const alteracao of [{ from: 'grupo@g.us' }, { fromMe: true }, { isStatus: true }, { hasMedia: true }, { body: '!times' }, { body: '' }]) {
    assert.equal(await executor.tratar({ ...msg, ...alteracao }), false);
  }
  ativo = false;
  assert.equal(await executor.tratar(msg), false);
  ativo = true;
  permitido = false;
  await executor.tratar(msg);
  assert.equal(classificacoes, antes);
  permitido = true;
  const total = executados.length;
  pedido = { intencao: 'constructor', nomes: [] };
  await executor.tratar(msg);
  pedido = null;
  await executor.tratar(msg);
  pedido = { intencao: 'fechar', nomes: [] };
  revogar = true;
  await executor.tratar(msg);
  permitido = true;
  revogar = false;
  trocarGrupo = true;
  await executor.tratar(msg);
  assert.match(respostas.at(-1), /mudou/);
  trocarGrupo = false;
  grupo = null;
  pedido = { intencao: 'enquete', nomes: [] };
  await executor.tratar(msg);
  assert.match(respostas.at(-1), /Configure o grupo/);
  falhar = true;
  await executor.tratar(msg);
  assert.match(respostas.at(-1), /Não consegui interpretar/);
  falhar = false;
  pedido = { intencao: 'ajuda', nomes: [] };
  await executor.tratar(msg);
  assert.match(respostas.at(-1), /sortear times/);
  assert.equal(executados.length, total);
  assert(sincronizacoes >= nomes.length);
  acoes.lista = async () => { throw new Error('Falha de ação'); };
  pedido = { intencao: 'lista', nomes: [] };
  await executor.tratar(msg);
  assert.equal(erros, 1);
  assert.match(respostas.at(-1), /Confira a situação atual/);
  let autorizadoGrupo = true;
  let remetentePermitido = true;
  let revogarGrupo = false;
  let chamadasGrupo = 0;
  let acoesGrupo = 0;
  const mensagemGrupo = { ...msg, from: 'principal@g.us', mentionedIds: ['bot@c.us'] };
  const executorGrupo = criarExecutorComandosIa({
    llm: { habilitada: () => true, interpretarPedido: async () => {
      chamadasGrupo++;
      if (revogarGrupo) autorizadoGrupo = false;
      return { intencao: 'lista', nomes: [] };
    } },
    grupoAutorizado: origem => autorizadoGrupo && origem === 'principal@g.us',
    botMencionado: async m => m.mentionedIds.includes('bot@c.us'),
    autorizado: async () => remetentePermitido,
    obterContexto: async () => ({ grupo: 'principal@g.us', enqueteId: 1 }),
    sincronizar: async () => {}, registrarErro: () => { throw new Error('Erro inesperado'); },
    acoes: { lista: async m => { assert.equal(m, mensagemGrupo); acoesGrupo++; } },
  });
  for (const mudanca of [
    { mentionedIds: [] }, { mentionedIds: undefined, body: '@Bot sorteia os times' },
    { mentionedIds: ['outra@c.us'] }, { from: 'outro@g.us' },
    { hasMedia: true }, { fromMe: true }, { isStatus: true },
  ]) await executorGrupo.tratar({ ...mensagemGrupo, ...mudanca });
  remetentePermitido = false;
  await executorGrupo.tratar(mensagemGrupo);
  assert.equal(chamadasGrupo, 0);
  remetentePermitido = true;
  await executorGrupo.tratar(mensagemGrupo);
  assert.equal(chamadasGrupo, 1);
  assert.equal(acoesGrupo, 1);
  revogarGrupo = true;
  await executorGrupo.tratar(mensagemGrupo);
  assert.equal(chamadasGrupo, 2);
  assert.equal(acoesGrupo, 1);
  console.log('Comandos por IA: rotas, privado, autorização, contexto e falhas OK');
}

main().catch(erro => { console.error(erro); process.exitCode = 1; });
