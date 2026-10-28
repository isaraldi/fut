// Sem WhatsApp, banco ou chamadas reais ao Ollama.
const assert = require('node:assert/strict');
const { criarLlmLocal, mensagemPrivadaRecebida } = require('../llm-local');
const { avaliarOcrComprovante, extrairValoresBRL } = require('../comprovantes-ocr');

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
  let imagemEnviada;
  const llm = criarLlmLocal({
    getConfig: chave => config[chave],
    fetchImpl: async (url, opcoes) => {
      chamadas++;
      assert.equal(url.pathname, '/api/chat');
      const corpo = JSON.parse(opcoes.body);
      const visual = !!corpo.messages[1].images;
      assert.equal(corpo.model, visual ? 'qwen3-vl:2b-instruct' : 'qwen3:4b-instruct');
      imagemEnviada = corpo.messages[1].images;
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
  const media = { mimetype: 'image/png', data: 'aW1hZ2Vt' };
  conteudo = { estado: 'concluido', valor_centavos: 5000,
    texto_visivel: 'Comprovante PIX. Pagamento realizado com sucesso. R$50,00' };
  assert.deepEqual(await llm.interpretarImagemComprovante(media), { confirmado: true, valor: 50 });
  assert.deepEqual(imagemEnviada, [media.data]);
  conteudo.valor_centavos = 6000;
  assert.equal((await llm.interpretarImagemComprovante(media)).confirmado, false);
  conteudo.valor_centavos = 5000;
  conteudo.estado = 'agendado';
  assert.equal((await llm.interpretarImagemComprovante(media)).confirmado, false);
  conteudo.estado = 'concluido';
  conteudo.texto_visivel = 'PIX R$50,00';
  assert.equal((await llm.interpretarImagemComprovante(media)).confirmado, false);
  conteudo.texto_visivel = 'Pagamento realizado R$50,00. Saldo R$100,00';
  assert.equal((await llm.interpretarImagemComprovante(media)).confirmado, false);
  await assert.rejects(llm.interpretarImagemComprovante({ ...media, mimetype: 'image/svg+xml' }));
  await assert.rejects(llm.interpretarImagemComprovante({ ...media, data: 'data:image/png;base64,abc' }));
  await assert.rejects(llm.interpretarImagemComprovante({ ...media, data: 'a'.repeat(14 * 1024 * 1024 + 1) }));
  const claro = 'Comprovante PIX. Pagamento realizado com sucesso. R$50,00';
  assert.equal(avaliarOcrComprovante(claro, 95).seguro, true);
  assert.equal(avaliarOcrComprovante(claro, 50).seguro, false);
  assert.equal(avaliarOcrComprovante(claro, undefined).seguro, false);
  assert.equal(avaliarOcrComprovante(claro + ' Saldo R$100,00', 95).seguro, false);
  assert.equal(avaliarOcrComprovante('PIX agendado R$50,00', 95).seguro, false);
  assert.equal(avaliarOcrComprovante(claro + ' Não confirmado', 95).seguro, false);
  assert.equal(avaliarOcrComprovante('', 0).seguro, false);
  assert.equal(avaliarOcrComprovante('foto do jogo', 95).temPalavraChave, false);
  assert.deepEqual(extrairValoresBRL('R$ 1.234,56 R$1000,00 R$50,00'), [1234.56, 1000, 50]);
  await assert.rejects(llm.interpretarMensagem('a'.repeat(12001)), /limite/);
  config.llm_mensagens_ativa = '0';
  config.llm_comprovantes_ativa = '0';
  const antes = chamadas;
  assert.equal(await llm.interpretarMensagem('lista'), null);
  assert.equal(await llm.interpretarComprovante('R$50,00', [50]), null);
  assert.equal(await llm.interpretarImagemComprovante(media), null);
  assert.equal(chamadas, antes);
  console.log('LLM local: validação, falhas, concorrência e desativação OK');
}

main().catch(err => { console.error(err); process.exitCode = 1; });
