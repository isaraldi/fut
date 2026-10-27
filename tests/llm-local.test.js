// Sem WhatsApp, banco ou chamadas reais ao Ollama.
const assert = require('node:assert/strict');
const { criarLlmLocal, mensagemPrivadaRecebida } = require('../llm-local');

async function main() {
  for (const from of ['123@c.us', '123@lid']) {
    assert.equal(mensagemPrivadaRecebida({ from }), true);
    assert.equal(mensagemPrivadaRecebida({ from, fromMe: true }), false);
    assert.equal(mensagemPrivadaRecebida({ from, isStatus: true }), false);
  }
  for (const from of ['123@g.us', 'status@broadcast', '123@newsletter', undefined]) {
    assert.equal(mensagemPrivadaRecebida({ from, body: 'bot, me manda a lista' }), false);
  }
  const config = { llm_mensagens_ativa: '1', llm_comprovantes_ativa: '1' };
  let conteudo = { intencao: 'lista' };
  let modo = 'normal';
  let chamadas = 0;
  const llm = criarLlmLocal({
    getConfig: chave => config[chave],
    fetchImpl: async (url, opcoes) => {
      chamadas++;
      assert.equal(url.pathname, '/api/chat');
      const corpo = JSON.parse(opcoes.body);
      assert.equal(corpo.model, 'qwen3:4b-instruct');
      assert.equal(corpo.format.type, 'object');
      if (modo === 'erro') throw new Error('Falha simulada');
      if (modo === 'espera') await new Promise(resolve => setTimeout(resolve, 20));
      return { ok: true, json: async () => ({
        done_reason: modo === 'truncada' ? 'length' : 'stop',
        message: { content: modo === 'invalida' ? 'não é JSON' : JSON.stringify(conteudo) },
      }) };
    },
  });
  assert.equal(await llm.interpretarMensagem('Me manda a lista'), 'lista');
  conteudo = { intencao: 'fechar' };
  await assert.rejects(llm.interpretarMensagem('feche tudo'), /inválida/);
  conteudo = { intencao: 'nenhuma' };
  assert.equal(await llm.interpretarMensagem('oi'), null);
  conteudo = { estado: 'concluido', valor_centavos: 5000 };
  assert.deepEqual(await llm.interpretarComprovante('PIX realizado R$50,00', [50, 1000]), { confirmado: true, valor: 50 });
  assert.equal((await llm.interpretarComprovante('R$20,00', [20])).confirmado, false);
  conteudo = { estado: 'agendado', valor_centavos: 5000 };
  assert.equal((await llm.interpretarComprovante('PIX agendado R$50,00', [50])).confirmado, false);
  conteudo = { estado: 'desconhecido', valor_centavos: 5000 };
  assert.equal((await llm.interpretarComprovante('R$50,00', [50])).confirmado, false);
  conteudo = { estado: 'concluido', valor_centavos: '5000' };
  await assert.rejects(llm.interpretarComprovante('R$50,00', [50]), /inválido/);
  for (const falha of ['erro', 'truncada', 'invalida']) {
    modo = falha;
    await assert.rejects(llm.interpretarMensagem('lista'));
  }
  modo = 'espera';
  conteudo = { intencao: 'lista' };
  const primeira = llm.interpretarMensagem('lista');
  await assert.rejects(llm.interpretarMensagem('lista'), /ocupada/);
  assert.equal(await primeira, 'lista');
  modo = 'normal';
  await assert.rejects(llm.interpretarMensagem('a'.repeat(12001)), /limite/);
  config.llm_mensagens_ativa = '0';
  config.llm_comprovantes_ativa = '0';
  const antes = chamadas;
  assert.equal(await llm.interpretarMensagem('lista'), null);
  assert.equal(await llm.interpretarComprovante('R$50,00', [50]), null);
  assert.equal(chamadas, antes);
  console.log('LLM local: validação, falhas, concorrência e desativação OK');
}

main().catch(err => { console.error(err); process.exitCode = 1; });
