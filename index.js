process.env.TZ = 'America/Sao_Paulo'; // dia/hora configurados no painel são sempre no horário de Brasília

const os = require('os');
const fs = require('fs');
const path = require('path');
const { Client, LocalAuth, Poll } = require('whatsapp-web.js');
const { createWorker } = require('tesseract.js');
const qrcode = require('qrcode-terminal');
const {
  db,
  upsertJogador,
  getConfig,
  setConfig,
  upsertGrupo,
  getEnqueteOpcoes,
  getMensagensUnicasParaEnviar,
  getMensagensSemanais,
  marcarMensagemEnviada,
  marcarMensagemSemanalEnviada,
  marcarPagamentoMensalista,
  marcarPagamentoAvulso,
  getJogadorPorWhatsappId,
  podeUsarComandos,
  getConfirmadosDaEnquete,
  getListaDeEsperaDaEnquete,
  registrarLog,
  getEnviosImediatosPendentes,
  removerEnvioImediato,
  fecharEnquete,
  getEnquetesFechadasNaoDesafixadas,
  marcarEnqueteDesafixada,
  registrarTentativaDesafixar,
} = require('./db');
const { balancearTimes, montarTextoListaConfirmadas, montarTextoListaAtual, montarTextoTimes } = require('./mensagens-prontas');

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  }
});

client.on('qr', qr => {
  qrcode.generate(qr, { small: true });
});

// evita criar um segundo setInterval quando 'ready' dispara de novo depois de
// um reiniciarSessaoWhatsapp() (destroy + initialize reautentica e reemite 'ready')
let intervaloIniciado = false;

client.on('ready', async () => {
  console.log('Bot pronto! 🤖');
  if (!intervaloIniciado) {
    intervaloIniciado = true;
    setInterval(() => {
      checarEnvioAutomaticoDeEnquete();
      checarEnvioManualDeEnqueteViaPainel();
      checarMensagensAgendadas();
      checarEnviosImediatos();
      checarEnquetesParaDesafixar();
      checarReinicioAgendadoDoBot();
      checarSincronizacaoPendente();
      checarFechamentoAutomatico();
    }, 60 * 1000);
  }
  await sincronizarGruposConhecidos();
});

// 🔄 REINÍCIO DA SESSÃO DO WHATSAPP — fecha e reabre o Chromium/Puppeteer mantendo a
// autenticação salva (LocalAuth não é apagada por destroy(), só por logout()), sem precisar
// escanear QR code de novo. Usado tanto pelo watchdog (sessão travou) quanto pelo reinício
// diário agendado (evita que a sessão fique de pé por dias e comece a travar sozinha).
let reiniciandoSessao = false;
async function reiniciarSessaoWhatsapp() {
  if (reiniciandoSessao) return; // já tem um reinício em andamento, não empilha outro
  reiniciandoSessao = true;
  try {
    console.log('🔄 Reiniciando sessão do WhatsApp...');
    await client.destroy();
    await client.initialize();
    console.log('🔄 Sessão do WhatsApp reiniciada.');
  } finally {
    reiniciandoSessao = false;
  }
}

// ⏳ corre uma promise contra um prazo; se estourar, loga, aciona o reinício da sessão do
// WhatsApp (a chamada travada só se resolve derrubando o navegador mesmo) e rejeita —
// evita depender do timeout padrão do Puppeteer (~3min) pra perceber que travou
function comTimeoutDeSessao(promise, ms, rotulo) {
  promise.catch(() => {}); // se a sessão for reiniciada, a promise original ainda pode rejeitar sozinha depois; evita unhandled rejection
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => {
        console.error(`⚠️ ${rotulo} travou (sem resposta em ${ms / 1000}s) — reiniciando sessão do WhatsApp...`);
        reiniciarSessaoWhatsapp().catch((err) => console.error('Falha ao reiniciar sessão do WhatsApp:', err));
        reject(new Error(`${rotulo} travou (sessão do WhatsApp reiniciada)`));
      }, ms);
    }),
  ]);
}

// reinicia a sessão 1x por dia, de madrugada, antes que dias de uptime a deixem instável
const REINICIO_DIARIO_HORA = 4; // 4h da manhã (horário de Brasília), baixo movimento
async function checarReinicioAgendadoDoBot() {
  const agora = new Date();
  if (agora.getHours() !== REINICIO_DIARIO_HORA || agora.getMinutes() !== 0) return;

  const hojeLocal = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}-${String(agora.getDate()).padStart(2, '0')}`;
  if (getConfig('bot_reinicio_ultimo') === hojeLocal) return;
  setConfig('bot_reinicio_ultimo', hojeLocal);

  console.log('🔄 Reinício diário agendado da sessão do WhatsApp...');
  try {
    await reiniciarSessaoWhatsapp();
  } catch (err) {
    console.error('Falha no reinício diário agendado da sessão do WhatsApp:', err);
  }
}

// 📋 lista os grupos que o bot participa e salva no banco, pra aparecerem como opção
// no seletor "pra qual grupo mandar a enquete automática" no painel
async function sincronizarGruposConhecidos() {
  try {
    const chats = await client.getChats();
    const grupos = chats.filter(c => c.isGroup);
    let sincronizados = 0;
    for (const g of grupos) {
      try {
        // alguns grupos podem não ter nome (ex: grupo sem assunto definido) — usa o id como
        // fallback, senão um único grupo sem nome quebrava a sincronização de todos os outros
        upsertGrupo(g.id._serialized, g.name || g.id._serialized);
        sincronizados++;
      } catch (err) {
        console.error(`Erro ao sincronizar grupo ${g.id._serialized}:`, err);
      }
    }
    console.log(`📋 ${sincronizados} grupo(s) sincronizado(s) pro painel`);
  } catch (err) {
    console.error('Erro ao sincronizar grupos:', err);
  }
}


function getUserId(msg) {
  return msg.author || msg.from;
}

// 🪪 extrai o id serializado de um Wid, tolerando o rename _serialized → $1
function getIdSerialized(widLike) {
  if (!widLike) return null;
  if (typeof widLike === 'string') return widLike;
  return widLike._serialized || widLike.$1 || null;
}

// 🔗 resolve um id @lid pro id baseado em telefone (@c.us) quando possível.
// O WhatsApp usa @lid como identidade "vinculada" (privacidade) em vários eventos
// (voto de enquete, reação, etc), mas @c.us (o número de telefone) é o que aparece
// na lista de participantes do grupo — sem isso, a mesma pessoa vira 2 jogadores.
async function resolverIdCanonico(whatsappId) {
  if (!whatsappId || !whatsappId.endsWith('@lid')) return whatsappId;
  try {
    const resolvido = await client.pupPage.evaluate((lidSerializado) => {
      const lidWid = window.require('WAWebWidFactory').createWid(lidSerializado);
      const phoneWid = window.require('WAWebApiContact').getPhoneNumber(lidWid);
      if (!phoneWid) return null;
      return phoneWid._serialized || phoneWid.$1 || null;
    }, whatsappId);
    return resolvido || whatsappId;
  } catch (err) {
    console.error(`Erro ao resolver id canônico de ${whatsappId}:`, err.message);
    return whatsappId;
  }
}

// 🔒 checa se quem mandou a mensagem está na whitelist de comandos (painel → Comandos)
async function remetenteAutorizado(msg) {
  const idCanonico = await resolverIdCanonico(getUserId(msg));
  return podeUsarComandos(idCanonico);
}

async function negarComando(msg) {
  return msg.reply('🔒 Você não tem permissão pra usar comandos do bot. Peça pra um admin te liberar no painel (Comandos).');
}

// 🤖 id do próprio bot, pra nunca incluir ele mesmo no elenco
function getBotId() {
  return client.info ? getIdSerialized(client.info.wid) : null;
}

const NOMES_DIA_SEMANA = [
  'domingo', 'segunda-feira', 'terça-feira', 'quarta-feira',
  'quinta-feira', 'sexta-feira', 'sábado'
];

// 📅 próxima data do dia da semana configurado (ou hoje, se hoje já for o dia)
function proximoDiaDeJogo() {
  const diaSemanaAlvo = Number(getConfig('enquete_dia_semana'));
  const hoje = new Date();
  const diaSemana = hoje.getDay();
  const diff = (diaSemanaAlvo - diaSemana + 7) % 7;
  const alvo = new Date(hoje);
  alvo.setDate(hoje.getDate() + diff);
  const dd = String(alvo.getDate()).padStart(2, '0');
  const mm = String(alvo.getMonth() + 1).padStart(2, '0');
  return { data: `${dd}/${mm}`, dia: NOMES_DIA_SEMANA[diaSemanaAlvo] };
}

// ⏳ calcula o prazo de confirmação de mensalista (dia da semana + hora configurados) a
// partir de uma data de referência, e devolve como texto UTC (mesmo formato do datetime('now')
// do SQLite) — travado no momento da criação da enquete, não muda se o config mudar depois
function calcularPrazoMensalista(referencia) {
  const diaSemanaAlvo = Number(getConfig('mensalista_prazo_dia_semana'));
  const [hora, minuto] = (getConfig('mensalista_prazo_hora') || '18:00').split(':').map(Number);
  const diaSemana = referencia.getDay();
  const diff = (diaSemanaAlvo - diaSemana + 7) % 7;
  const alvo = new Date(
    referencia.getFullYear(), referencia.getMonth(), referencia.getDate() + diff,
    hora, minuto, 0, 0,
  );
  return alvo.toISOString().slice(0, 19).replace('T', ' ');
}

// 🗳️ ENQUETE NATIVA + registro no banco pro painel
// groupId: grupo de destino. msgParaErro: opcional, só usado pra responder erros
// quando a enquete foi disparada manualmente via !enquete (o envio automático não tem msg).
async function abrirEnquete(groupId, msgParaErro, origem = 'manual') {
  const { data, dia } = proximoDiaDeJogo();
  const hora = getConfig('enquete_hora') || '20:00';
  const template = getConfig('enquete_titulo_template') || 'JOGO DE QUARTA - {data}';
  const titulo = template
    .replace('{data}', data)
    .replace('{dia}', dia)
    .replace('{hora}', hora);

  const opcoes = getEnqueteOpcoes();
  if (opcoes.length < 2) {
    const erro = '❌ Configure pelo menos 2 opções da enquete no painel antes de abrir.';
    registrarLog('enquete', 'erro', `Falha ao abrir enquete (${origem}): menos de 2 opções configuradas`, groupId);
    if (msgParaErro) return msgParaErro.reply(erro);
    console.error(erro);
    return;
  }

  const poll = new Poll(
    titulo,
    opcoes.map(o => o.texto),
    { allowMultipleAnswers: false }
  );

  const sent = await comTimeoutDeSessao(
    client.sendMessage(groupId, poll),
    30 * 1000,
    'Envio da enquete',
  );

  const vagasConfiguradas = parseInt(getConfig('jogo_vagas_maximo'), 10);
  const vagasMaximo = Number.isFinite(vagasConfiguradas) && vagasConfiguradas > 0 ? vagasConfiguradas : null;
  const prazoMensalista = vagasMaximo ? calcularPrazoMensalista(new Date()) : null;
  db.prepare(
    'INSERT INTO enquetes (message_id, group_id, titulo, vagas_maximo, prazo_mensalista) VALUES (?, ?, ?, ?, ?)'
  ).run(sent.id._serialized, groupId, titulo, vagasMaximo, prazoMensalista);

  registrarLog('enquete', 'sucesso', `Enquete "${titulo}" enviada (${origem})`, groupId);
  console.log(`🗳️ Enquete criada: ${titulo}`);

  // fixa por 7 dias; só funciona se o número do bot for admin do grupo
  try {
    const fixou = await sent.pin(7 * 24 * 60 * 60);
    if (!fixou) console.log('⚠️ Não consegui fixar a enquete (bot é admin do grupo?)');
  } catch (err) {
    console.error('Erro ao fixar enquete:', err);
  }
}

// ⏰ ENVIO AUTOMÁTICO — roda a cada minuto (chamado pelo setInterval em 'ready') e,
// se o toggle estiver ativo e for a hora configurada, abre a enquete sozinho.
async function checarEnvioAutomaticoDeEnquete() {
  if (getConfig('enquete_auto_enviar') !== '1') return;

  const grupoId = getConfig('enquete_grupo_id');
  if (!grupoId) return; // ainda não sabemos o grupo: precisa rodar !enquete manualmente 1x antes

  const diaSemanaAlvo = Number(getConfig('enquete_envio_dia_semana'));
  const [horaAlvo, minutoAlvo] = (getConfig('enquete_envio_hora') || '09:00').split(':').map(Number);

  const agora = new Date();
  if (agora.getDay() !== diaSemanaAlvo) return;

  // trava por data local (não por semana) pra não reenviar se o processo reiniciar no mesmo
  // dia, e nem depender de o processo ficar de pé por 7 dias inteiros sem reiniciar
  const hojeLocal = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}-${String(agora.getDate()).padStart(2, '0')}`;
  if (getConfig('enquete_auto_ultimo_envio') === hojeLocal) return; // já enviada com sucesso hoje

  // usa >= (não ===) e só marca como enviada depois do envio dar certo: se o WhatsApp travar
  // no minuto exato do horário configurado (ex: sessão do Chromium instável), tenta de novo
  // nos minutos seguintes em vez de desistir até a semana que vem
  const minutosAgora = agora.getHours() * 60 + agora.getMinutes();
  const minutosAlvo = horaAlvo * 60 + minutoAlvo;
  if (minutosAgora < minutosAlvo) return;

  console.log('⏰ Horário configurado atingido, enviando enquete automaticamente...');
  try {
    await abrirEnquete(grupoId, null, 'automática');
    setConfig('enquete_auto_ultimo_envio', hojeLocal);
  } catch (err) {
    registrarLog('enquete', 'erro', `Falha ao enviar enquete automática: ${err.message}`, grupoId);
    console.error('Erro ao enviar enquete automática:', err);
  }
}

// 🖱️ ENVIO MANUAL VIA PAINEL — botão "Enviar enquete agora" pede pelo config (o painel roda
// num processo separado, sem acesso ao client do WhatsApp). Só limpa o pedido depois de
// enviar com sucesso, pra tentar de novo nos minutos seguintes se a sessão travar.
async function checarEnvioManualDeEnqueteViaPainel() {
  if (getConfig('enquete_solicitar_envio') !== '1') return;

  const grupoId = getConfig('enquete_grupo_id');
  if (!grupoId) {
    registrarLog('enquete', 'erro', 'Pedido de envio via painel sem grupo configurado');
    setConfig('enquete_solicitar_envio', '0');
    return;
  }

  console.log('🖱️ Enviando enquete solicitada pelo painel...');
  try {
    await abrirEnquete(grupoId, null, 'painel');
    setConfig('enquete_solicitar_envio', '0');
  } catch (err) {
    registrarLog('enquete', 'erro', `Falha ao enviar enquete via painel: ${err.message}`, grupoId);
    console.error('Erro ao enviar enquete via painel:', err);
  }
}

// ✉️ MENSAGENS AGENDADAS — roda a cada minuto: manda mensagens únicas cujo horário já chegou
// e mensagens semanais recorrentes no dia/hora configurados
function resumoTexto(texto, tamanho = 60) {
  const limpo = texto.replace(/\s+/g, ' ').trim();
  return limpo.length > tamanho ? `${limpo.slice(0, tamanho)}…` : limpo;
}

async function checarMensagensAgendadas() {
  const unicas = getMensagensUnicasParaEnviar();
  for (const msg of unicas) {
    try {
      await client.sendMessage(msg.grupo_id, msg.texto);
      marcarMensagemEnviada(msg.id);
      registrarLog('mensagem', 'sucesso', `Mensagem única enviada: "${resumoTexto(msg.texto)}"`, msg.grupo_id);
      console.log(`✉️ Mensagem agendada #${msg.id} enviada`);
    } catch (err) {
      registrarLog('mensagem', 'erro', `Falha ao enviar mensagem única #${msg.id}: ${err.message}`, msg.grupo_id);
      console.error(`Erro ao enviar mensagem agendada #${msg.id}:`, err);
    }
  }

  const agora = new Date();
  const horaAtual = `${String(agora.getHours()).padStart(2, '0')}:${String(agora.getMinutes()).padStart(2, '0')}`;
  const hojeLocal = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}-${String(agora.getDate()).padStart(2, '0')}`;

  const semanais = getMensagensSemanais();
  for (const msg of semanais) {
    if (msg.dia_semana !== agora.getDay()) continue;
    if (msg.hora !== horaAtual) continue;
    if (msg.ultimo_envio === hojeLocal) continue; // já enviada hoje, evita duplicar

    try {
      await client.sendMessage(msg.grupo_id, msg.texto);
      marcarMensagemSemanalEnviada(msg.id, hojeLocal);
      registrarLog('mensagem', 'sucesso', `Mensagem semanal enviada: "${resumoTexto(msg.texto)}"`, msg.grupo_id);
      console.log(`✉️ Mensagem semanal #${msg.id} enviada`);
    } catch (err) {
      registrarLog('mensagem', 'erro', `Falha ao enviar mensagem semanal #${msg.id}: ${err.message}`, msg.grupo_id);
      console.error(`Erro ao enviar mensagem semanal #${msg.id}:`, err);
    }
  }
}

// 🧾 COMPROVANTE DE PAGAMENTO — OCR local (tesseract.js, roda em WASM, sem shell out)
// lazy + reaproveitado entre chamadas, pra não recarregar o modelo a cada imagem
let ocrWorkerPromise = null;
function getOcrWorker() {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = createWorker('por', undefined, {
      cachePath: path.join(__dirname, 'data', 'tesseract-cache'),
    });
  }
  return ocrWorkerPromise;
}

// sinais de que a imagem é um comprovante de pagamento e não só uma foto qualquer do grupo —
// sem isso, QUALQUER imagem postada por uma mensalista marcaria pagamento sozinha
const PALAVRAS_COMPROVANTE = [
  'comprovante', 'pix', 'transferência', 'transferencia', 'recibo',
  'pagamento', 'ted', 'boleto', 'transação', 'transacao',
];

// extrai todos os valores em R$ que aparecem no texto do OCR (aceita "R$ 1.234,56", "R$50,00" etc)
function extrairValoresBRL(texto) {
  const valores = [];
  const regex = /r\$\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2})?|\d+(?:,\d{2})?)/gi;
  let match;
  while ((match = regex.exec(texto)) !== null) {
    let bruto = match[1];
    bruto = bruto.includes(',') ? bruto.replace(/\./g, '').replace(',', '.') : bruto;
    const numero = parseFloat(bruto);
    if (Number.isFinite(numero)) valores.push(numero);
  }
  return valores;
}

// compara com tolerância de 1 centavo, pra escapar de arredondamento
function valorBate(valorExtraido, valorConfigurado) {
  return Math.abs(valorExtraido - valorConfigurado) < 0.01;
}

async function processarPossivelComprovante(msg) {
  let caminhoTemp;
  try {
    const media = await msg.downloadMedia();
    if (!media || !media.mimetype || !media.mimetype.startsWith('image/')) return;

    const extensao = media.mimetype.split('/')[1] || 'jpg';
    caminhoTemp = path.join(os.tmpdir(), `comprovante-${Date.now()}-${Math.random().toString(36).slice(2)}.${extensao}`);
    fs.writeFileSync(caminhoTemp, Buffer.from(media.data, 'base64'));

    const worker = await getOcrWorker();
    const { data: { text } } = await worker.recognize(caminhoTemp);
    const textoLower = text.toLowerCase();

    const temPalavraChave = PALAVRAS_COMPROVANTE.some((p) => textoLower.includes(p));
    const temValor = /r\$\s?\d/.test(textoLower);

    // nenhum sinal de comprovante (foto do jogo, meme, etc) — não loga, isso é ruído
    if (!temPalavraChave && !temValor) return;

    // achou só um dos dois sinais — provavelmente é um comprovante, mas o OCR não confirmou
    // os dois; vale registrar pra você conferir manualmente, mas não marca pagamento sozinho
    if (!(temPalavraChave && temValor)) {
      registrarLog(
        'comprovante', 'aviso',
        `Imagem parece comprovante mas não deu pra confirmar (OCR: "${resumoTexto(text, 100)}")`,
        msg.from,
      );
      return;
    }

    const idCanonico = await resolverIdCanonico(getUserId(msg));
    const jogador = getJogadorPorWhatsappId(idCanonico);
    if (!jogador) {
      registrarLog('comprovante', 'aviso', `Comprovante reconhecido, mas remetente (${idCanonico}) não está no elenco`, msg.from);
      return;
    }

    // com os valores de mensal/avulso configurados no painel (Jogo > Valores), o valor lido no
    // comprovante é que decide o tipo do pagamento — não o papel cadastrado do jogador. Se o
    // valor não bater com nenhum dos dois configurados, não marca pagamento nenhum
    const valorMensalCfg = parseFloat(getConfig('valor_mensal'));
    const valorAvulsoCfg = parseFloat(getConfig('valor_avulso'));
    const valoresConfigurados = Number.isFinite(valorMensalCfg) || Number.isFinite(valorAvulsoCfg);
    const valoresEncontrados = extrairValoresBRL(textoLower);

    let tipo;
    if (valoresConfigurados) {
      if (Number.isFinite(valorMensalCfg) && valoresEncontrados.some((v) => valorBate(v, valorMensalCfg))) {
        tipo = 'mensal';
      } else if (Number.isFinite(valorAvulsoCfg) && valoresEncontrados.some((v) => valorBate(v, valorAvulsoCfg))) {
        tipo = 'avulso';
      } else {
        registrarLog(
          'comprovante', 'aviso',
          `Comprovante de ${jogador.nome} reconhecido, mas o valor (${valoresEncontrados.map((v) => `R$${v.toFixed(2)}`).join(', ') || 'não identificado'}) não bate com a mensalidade nem o avulso configurados — não marcado como pago`,
          msg.from,
        );
        return;
      }
    } else {
      // fallback: valores ainda não configurados no painel, usa o papel cadastrado do jogador
      tipo = jogador.papel === 'mensalista' ? 'mensal' : 'avulso';
    }

    if (tipo === 'mensal') {
      const mes = new Date().toISOString().slice(0, 7); // mesmo cálculo do painel (mesAtual())
      marcarPagamentoMensalista(jogador.id, mes);
      registrarLog('comprovante', 'sucesso', `Comprovante de ${jogador.nome} reconhecido — mensalidade de ${mes} marcada como paga`, msg.from);
      console.log(`🧾 Comprovante de ${jogador.nome} reconhecido — mensalidade de ${mes} marcada como paga`);
    } else {
      const enquete = db.prepare('SELECT * FROM enquetes ORDER BY id DESC LIMIT 1').get();
      if (!enquete) return;
      const confirmado = getConfirmadosDaEnquete(enquete.id)
        .find((j) => j.id === jogador.id && j.papel === 'avulso');
      if (!confirmado) {
        registrarLog('comprovante', 'aviso', `Comprovante de ${jogador.nome} reconhecido, mas ela não confirmou como avulsa no jogo mais recente`, msg.from);
        return;
      }
      marcarPagamentoAvulso(jogador.id, enquete.id);
      registrarLog('comprovante', 'sucesso', `Comprovante de ${jogador.nome} reconhecido — pagamento avulso do jogo #${enquete.id} marcado como pago`, msg.from);
      console.log(`🧾 Comprovante de ${jogador.nome} reconhecido — pagamento avulso do jogo #${enquete.id} marcado como pago`);
    }

    try {
      await msg.react('✅');
    } catch (err) {
      // reação é só feedback visual, não crítico
    }
  } catch (err) {
    registrarLog('comprovante', 'erro', `Erro ao processar possível comprovante: ${err.message}`, msg.from);
    console.error('Erro ao processar possível comprovante:', err);
  } finally {
    if (caminhoTemp) fs.unlink(caminhoTemp, () => {});
  }
}

// 📋 FECHAR LISTA — manda a lista de confirmadas da enquete mais recente. Funciona tanto
// em grupo quanto em DM direto com o bot; responde sempre no mesmo chat de onde veio o pedido.
async function enviarListaDeConfirmadas(msg) {
  const enquete = db.prepare('SELECT * FROM enquetes ORDER BY id DESC LIMIT 1').get();
  if (!enquete) {
    return msg.reply('📋 Nenhuma enquete foi aberta ainda, não tem lista pra fechar.');
  }

  const confirmados = getConfirmadosDaEnquete(enquete.id);
  const texto = montarTextoListaConfirmadas(enquete, confirmados);

  await msg.reply(texto);
  fecharEnquete(enquete.id); // a partir daqui, novos votos na enquete são ignorados
  registrarLog(
    'lista', 'sucesso',
    `Lista de confirmadas enviada e enquete fechada (${confirmados.length} confirmada(s)) — "${enquete.titulo}"`,
    msg.from.endsWith('@g.us') ? msg.from : null,
  );
}

// 📋 LISTA ATUAL — prévia de quem está confirmada e quem está na espera, sem fechar a
// enquete. Funciona em grupo ou em DM, igual !fechar
async function enviarListaAtual(msg) {
  const enquete = db.prepare('SELECT * FROM enquetes ORDER BY id DESC LIMIT 1').get();
  if (!enquete) {
    return msg.reply('📋 Nenhuma enquete foi aberta ainda.');
  }

  const confirmados = getConfirmadosDaEnquete(enquete.id);
  const listaDeEspera = getListaDeEsperaDaEnquete(enquete.id);
  const texto = montarTextoListaAtual(enquete, confirmados, listaDeEspera);

  await msg.reply(texto);
  registrarLog(
    'lista', 'sucesso',
    `Lista atual enviada (${confirmados.length} confirmada(s), ${listaDeEspera.length} na espera) — "${enquete.titulo}"`,
    msg.from.endsWith('@g.us') ? msg.from : null,
  );
}

// ⏳ LISTA DE ESPERA — manda só quem ficou de fora por causa do limite de vagas
async function enviarListaDeEspera(msg) {
  const enquete = db.prepare('SELECT * FROM enquetes ORDER BY id DESC LIMIT 1').get();
  if (!enquete) {
    return msg.reply('⏳ Nenhuma enquete foi aberta ainda.');
  }

  const listaDeEspera = getListaDeEsperaDaEnquete(enquete.id);
  if (listaDeEspera.length === 0) {
    return msg.reply('⏳ Ninguém na lista de espera agora.');
  }

  let texto = `⏳ *Lista de espera — ${enquete.titulo}*\n\n`;
  listaDeEspera.forEach((j, i) => { texto += `${i + 1}. ${j.nome}\n`; });
  texto += '\nSó entram se algum dos confirmados sair da lista.';

  await msg.reply(texto);
  registrarLog(
    'lista', 'sucesso',
    `Lista de espera enviada (${listaDeEspera.length} na espera) — "${enquete.titulo}"`,
    msg.from.endsWith('@g.us') ? msg.from : null,
  );
}

// ⚽ SORTEIA E MANDA OS TIMES — funciona em grupo ou em DM, igual !fechar
async function enviarTimesSorteados(msg) {
  const enquete = db.prepare('SELECT * FROM enquetes ORDER BY id DESC LIMIT 1').get();
  if (!enquete) {
    return msg.reply('⚽ Nenhuma enquete foi aberta ainda, não tem confirmados pra sortear.');
  }

  const confirmados = getConfirmadosDaEnquete(enquete.id);
  if (confirmados.length < 2) {
    return msg.reply('⚽ Confirmados de menos pra sortear times (mínimo 2).');
  }

  const times = balancearTimes(confirmados);
  const texto = montarTextoTimes(
    enquete.titulo,
    times.timeA.map((j) => j.nome),
    times.timeB.map((j) => j.nome),
  );

  await msg.reply(texto);
  registrarLog(
    'times', 'sucesso',
    `Times sorteados e enviados (${confirmados.length} confirmada(s)) — "${enquete.titulo}"`,
    msg.from.endsWith('@g.us') ? msg.from : null,
  );
}

// 📤 FILA DE ENVIO IMEDIATO — botões "mandar pro grupo" do painel caem aqui, já que o painel
// roda num processo separado e não tem acesso direto ao client do WhatsApp
async function checarEnviosImediatos() {
  const pendentes = getEnviosImediatosPendentes();
  for (const envio of pendentes) {
    try {
      await client.sendMessage(envio.grupo_id, envio.texto);
      registrarLog(envio.tipo, 'sucesso', `${envio.tipo === 'lista' ? 'Lista' : 'Times'} enviado(a) via painel`, envio.grupo_id);
    } catch (err) {
      registrarLog(envio.tipo, 'erro', `Falha ao enviar ${envio.tipo} via painel: ${err.message}`, envio.grupo_id);
      console.error(`Erro ao processar envio imediato #${envio.id}:`, err);
    } finally {
      removerEnvioImediato(envio.id);
    }
  }
}

// 🔒 FECHAMENTO AUTOMÁTICO — roda a cada minuto. Fecha a enquete sozinha quando as vagas
// enchem: se encheu só com mensalistas, fecha na hora (mensalista sempre tem prioridade,
// esperar não muda nada); se tem avulsa no meio, espera o prazo de confirmação de mensalista
// passar antes de fechar — assim ainda dá tempo de uma mensalista furar a fila de uma avulsa
async function checarFechamentoAutomatico() {
  if (getConfig('fechamento_automatico_ativo') !== '1') return;

  const enquete = db.prepare('SELECT * FROM enquetes ORDER BY id DESC LIMIT 1').get();
  if (!enquete || enquete.fechada_em || !enquete.vagas_maximo) return;

  const confirmados = getConfirmadosDaEnquete(enquete.id);
  if (confirmados.length < enquete.vagas_maximo) return;

  const todosMensalistas = confirmados.every((j) => j.papel === 'mensalista');
  if (!todosMensalistas) {
    if (!enquete.prazo_mensalista) return; // sem prazo travado, não arrisca fechar cedo
    const prazo = new Date(`${enquete.prazo_mensalista.replace(' ', 'T')}Z`);
    if (new Date() < prazo) return; // ainda dentro do prazo de confirmação da mensalista
  }

  try {
    await client.sendMessage(enquete.group_id, montarTextoListaConfirmadas(enquete, confirmados));
    fecharEnquete(enquete.id);
    db.prepare('UPDATE enquetes SET fechada_automaticamente = 1 WHERE id = ?').run(enquete.id);
    registrarLog(
      'lista', 'sucesso',
      `Lista fechada automaticamente (${confirmados.length}/${enquete.vagas_maximo} vagas${todosMensalistas ? ', só mensalistas' : ', prazo de mensalista vencido'}) — "${enquete.titulo}"`,
      enquete.group_id,
    );
  } catch (err) {
    registrarLog('lista', 'erro', `Falha ao fechar lista automaticamente: ${err.message}`, enquete.group_id);
    console.error('Erro ao fechar lista automaticamente:', err);
  }
}

// 🔄 REAGE A DESISTÊNCIA DEPOIS DO FECHAMENTO AUTOMÁTICO — só entra em ação quando a lista foi
// fechada sozinha (não por !fechar manual, que é decisão final do admin). Se quem desistiu
// tinha vaga garantida, passa pra próxima da lista de espera; se não tinha ninguém esperando,
// reabre a enquete pra não deixar vaga sobrando sem ninguém poder confirmar
async function reagirADesistenciaPosFechamento(enquete, jogadorId) {
  const confirmadosAgora = getConfirmadosDaEnquete(enquete.id);
  if (confirmadosAgora.some((j) => j.id === jogadorId)) return; // ainda tem vaga, não desistiu de fato

  const listaDeEspera = getListaDeEsperaDaEnquete(enquete.id);
  if (listaDeEspera.length > 0) {
    const texto = `🔄 *Atualização — ${enquete.titulo}*\n\nAlguém confirmada desistiu — a vaga foi passada automaticamente pra próxima da lista de espera.\n\n${montarTextoListaConfirmadas(enquete, confirmadosAgora)}`;
    await client.sendMessage(enquete.group_id, texto);
    registrarLog('lista', 'sucesso', `Vaga repassada automaticamente após desistência — "${enquete.titulo}"`, enquete.group_id);
  } else {
    db.prepare('UPDATE enquetes SET fechada_em = NULL, fechada_automaticamente = 0 WHERE id = ?').run(enquete.id);
    const texto = `🔓 *Lista reaberta — ${enquete.titulo}*\n\nAlguém confirmada desistiu e não tinha ninguém na lista de espera — reabri a lista, ainda dá tempo de confirmar!`;
    await client.sendMessage(enquete.group_id, texto);
    registrarLog('lista', 'aviso', `Lista reaberta automaticamente — desistência sem substituta na espera — "${enquete.titulo}"`, enquete.group_id);
  }
}

// 📌 DESAFIXA ENQUETES JÁ FECHADAS — fechar pelo painel só grava no banco (processo sem
// client do WhatsApp), então o bot confere aqui e desafixa de fato a mensagem no grupo
const MAX_TENTATIVAS_DESAFIXAR = 5; // ~5 minutos tentando antes de desistir

async function checarEnquetesParaDesafixar() {
  const pendentes = getEnquetesFechadasNaoDesafixadas();
  for (const enquete of pendentes) {
    try {
      const msgOriginal = await client.getMessageById(enquete.message_id);
      if (!msgOriginal) {
        registrarLog('lista', 'aviso', `Não achei a mensagem da enquete #${enquete.id} pra desafixar (pode já ter sido apagada)`, enquete.group_id);
        marcarEnqueteDesafixada(enquete.id); // sem a mensagem não tem como tentar de novo
        continue;
      }

      const desafixou = await msgOriginal.unpin();
      if (desafixou) {
        marcarEnqueteDesafixada(enquete.id);
        continue;
      }

      // não marca como desafixada ainda: tenta de novo nos próximos minutos. Causa mais
      // comum de falhar: o número do bot precisa ser admin do grupo pra conseguir desafixar
      registrarTentativaDesafixar(enquete.id);
      if (enquete.tentativas_desafixar + 1 >= MAX_TENTATIVAS_DESAFIXAR) {
        registrarLog(
          'lista', 'aviso',
          `Desisti de tentar desafixar a enquete #${enquete.id} depois de ${MAX_TENTATIVAS_DESAFIXAR} tentativas — o bot provavelmente não é admin do grupo. Desafixe manualmente.`,
          enquete.group_id,
        );
        marcarEnqueteDesafixada(enquete.id); // desiste, evita ficar tentando pra sempre
      } else if (enquete.tentativas_desafixar === 0) {
        registrarLog(
          'lista', 'aviso',
          `Não consegui desafixar a enquete #${enquete.id} — o bot precisa ser admin do grupo. Vou tentar de novo.`,
          enquete.group_id,
        );
      }
    } catch (err) {
      registrarLog('lista', 'erro', `Erro ao desafixar enquete #${enquete.id}: ${err.message}`, enquete.group_id);
      console.error(`Erro ao desafixar enquete #${enquete.id}:`, err);
    }
  }
}

client.on('message', async msg => {
  console.log('msg from:', msg.from);

  const text = msg.body.toLowerCase().trim();

  if (msg.from.endsWith('@g.us') && text === '!enquete') {
    if (!(await remetenteAutorizado(msg))) return negarComando(msg);
    return abrirEnquete(msg.from, msg);
  }

  if (msg.from.endsWith('@g.us') && text === '!sincronizar') {
    if (!(await remetenteAutorizado(msg))) return negarComando(msg);
    return sincronizarElencoDoGrupo(msg);
  }

  // funciona em grupo OU em DM direto com o bot
  if (text === '!fechar') {
    if (!(await remetenteAutorizado(msg))) return negarComando(msg);
    return enviarListaDeConfirmadas(msg);
  }

  // funciona em grupo OU em DM direto com o bot
  if (text === '!lista') {
    if (!(await remetenteAutorizado(msg))) return negarComando(msg);
    return enviarListaAtual(msg);
  }

  // funciona em grupo OU em DM direto com o bot
  if (text === '!espera') {
    if (!(await remetenteAutorizado(msg))) return negarComando(msg);
    return enviarListaDeEspera(msg);
  }

  // funciona em grupo OU em DM direto com o bot
  if (text === '!times') {
    if (!(await remetenteAutorizado(msg))) return negarComando(msg);
    return enviarTimesSorteados(msg);
  }

  // roda em paralelo, sem travar o resto do handler (OCR pode levar alguns segundos)
  // funciona em grupo OU em DM direto com o bot
  if (msg.hasMedia && msg.type === 'image') {
    processarPossivelComprovante(msg).catch((err) =>
      console.error('Erro ao processar possível comprovante:', err),
    );
  }
});

// 🗳️ CAPTURA VOTO DA ENQUETE NATIVA
client.on('vote_update', async vote => {
  try {
    // WhatsApp renomeou a chave interna _serialized para $1; aceita os dois formatos
    const msgId =
      vote.parentMessage?.id?._serialized ||
      vote.parentMessage?.id?.$1 ||
      vote.parentMsgKey?._serialized ||
      vote.parentMsgKey?.$1;
    if (!msgId) return;

    const enquete = db
      .prepare('SELECT * FROM enquetes WHERE message_id = ?')
      .get(msgId);
    if (!enquete) return; // enquete de outra origem, ignora

    const idCanonico = await resolverIdCanonico(vote.voter);

    if (enquete.fechada_em) {
      if (!enquete.fechada_automaticamente) {
        console.log(`🔒 Voto ignorado — enquete #${enquete.id} já está com a lista fechada`);
        return;
      }
      // fechamento automático: só reage a desistência de quem já tinha vaga garantida — gente
      // nova continua de fora, isso não é uma reabertura geral da votação
      const jogadorExistente = db.prepare('SELECT id FROM jogadores WHERE whatsapp_id = ?').get(idCanonico);
      const tinhaVaga = jogadorExistente && getConfirmadosDaEnquete(enquete.id).some((j) => j.id === jogadorExistente.id);
      if (!tinhaVaga) {
        console.log(`🔒 Voto ignorado — enquete #${enquete.id} fechada automaticamente e ${idCanonico} não tinha vaga garantida`);
        return;
      }
    }

    const contact = await client.getContactById(idCanonico);
    const nome = contact.pushname || contact.name || 'Jogador';
    // autofill de telefone: só se o id já é baseado em telefone (@c.us).
    // se continuar @lid (não foi possível resolver), contact.number NÃO é o telefone real
    const telefone = idCanonico.endsWith('@lid') ? null : (contact.number || null);

    if (vote.selectedOptions.length === 0) {
      const jogador = db
        .prepare('SELECT id FROM jogadores WHERE whatsapp_id = ?')
        .get(idCanonico);
      if (jogador) {
        db.prepare(
          'DELETE FROM votos WHERE enquete_id = ? AND jogador_id = ?'
        ).run(enquete.id, jogador.id);
      }
      console.log(`🗳️ ${nome} removeu o voto`);
      if (enquete.fechada_em && enquete.fechada_automaticamente && jogador) {
        await reagirADesistenciaPosFechamento(enquete, jogador.id);
      }
      return;
    }

    const opcaoTexto = vote.selectedOptions.map(o => o.name).join(', ');
    const opcaoConfig = getEnqueteOpcoes().find(o => o.texto === opcaoTexto);
    const papel = opcaoConfig ? opcaoConfig.papel : null; // null = não conta como confirmado
    const jogadorId = upsertJogador(idCanonico, nome, papel, telefone);

    db.prepare(`
      INSERT INTO votos (enquete_id, jogador_id, opcao, papel)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(enquete_id, jogador_id) DO UPDATE SET
        opcao = excluded.opcao,
        papel = excluded.papel,
        votado_em = datetime('now')
    `).run(enquete.id, jogadorId, opcaoTexto, papel);

    console.log(`🗳️ ${nome} votou: ${opcaoTexto}`);

    if (enquete.fechada_em && enquete.fechada_automaticamente) {
      await reagirADesistenciaPosFechamento(enquete, jogadorId);
    }
  } catch (err) {
    console.error('Erro ao processar voto:', err);
  }
});

// 👤 helper: cria/atualiza jogador a partir de um whatsapp id (bruto, @lid ou @c.us),
// resolvendo pro id canônico e com autofill de telefone
async function sincronizarJogadorPorId(whatsappIdBruto) {
  const whatsappId = getIdSerialized(whatsappIdBruto);
  if (!whatsappId) return null;
  if (whatsappId.endsWith('@g.us') || whatsappId === 'status@broadcast') return null;

  const botId = getBotId();
  if (botId && whatsappId === botId) return null; // nunca inclui o próprio bot

  const idCanonico = await resolverIdCanonico(whatsappId);
  if (botId && idCanonico === botId) return null;

  try {
    const contact = await client.getContactById(idCanonico);
    const nome = contact.pushname || contact.name || contact.number || 'Jogador';
    const telefone = idCanonico.endsWith('@lid') ? null : (contact.number || null);
    return upsertJogador(idCanonico, nome, null, telefone);
  } catch (err) {
    console.error(`Erro ao sincronizar ${whatsappId}:`, err.message);
    return null;
  }
}

// ➕ NOVO MEMBRO NO GRUPO → inclui automaticamente no elenco (se ativado no painel)
client.on('group_join', async notification => {
  if (getConfig('elenco_auto_incluir_grupo') !== '1') return;

  for (const whatsappId of notification.recipientIds) {
    const id = await sincronizarJogadorPorId(whatsappId);
    if (id) console.log(`➕ ${whatsappId} entrou no grupo e foi incluído no elenco`);
  }
});

// 🔄 SINCRONIZAR ELENCO — percorre os participantes atuais do grupo e garante que todos
// estejam no elenco. Só ADICIONA quem ainda não está cadastrado; nunca remove ninguém, nem
// quem já saiu do grupo, pra não apagar o histórico de pagamentos/presença de quem já jogou
async function sincronizarElencoDeChat(chat) {
  let novos = 0;
  let total = 0;
  const idsNoGrupo = new Set();

  for (const participant of chat.participants) {
    const whatsappId = getIdSerialized(participant.id);
    if (!whatsappId) continue;

    const idCanonico = await resolverIdCanonico(whatsappId);
    const existente = db
      .prepare('SELECT id, ativo FROM jogadores WHERE whatsapp_id = ?')
      .get(idCanonico);

    const jogadorId = await sincronizarJogadorPorId(whatsappId);
    if (!jogadorId) continue; // pulado: era o próprio bot, ou deu erro

    idsNoGrupo.add(jogadorId);
    if (existente && !existente.ativo) {
      db.prepare('UPDATE jogadores SET ativo = 1 WHERE id = ?').run(jogadorId); // voltou pro grupo
    }

    total++;
    if (!existente) novos++;
  }

  // quem estava ativa mas não apareceu entre os participantes atuais desse grupo saiu —
  // marca como inativa (nunca exclui, pra preservar o histórico de pagamentos/presença)
  let inativados = 0;
  const marcarInativo = db.prepare('UPDATE jogadores SET ativo = 0 WHERE id = ?');
  for (const j of db.prepare('SELECT id FROM jogadores WHERE ativo = 1').all()) {
    if (!idsNoGrupo.has(j.id)) {
      marcarInativo.run(j.id);
      inativados++;
    }
  }

  return { total, novos, inativados };
}

// comando !sincronizar mandado direto no grupo
async function sincronizarElencoDoGrupo(msg) {
  const chat = await msg.getChat();
  if (!chat.isGroup) return;

  const { total, novos, inativados } = await sincronizarElencoDeChat(chat);
  let texto = `🔄 Elenco sincronizado! ${total} membro(s) do grupo no elenco, ${novos} novo(s) adicionado(s).`;
  if (inativados > 0) texto += ` ${inativados} marcada(s) como inativa(s) por não estarem mais no grupo.`;
  return msg.reply(texto);
}

// botão "Sincronizar agora" do painel — o painel roda num processo separado sem acesso ao
// client do WhatsApp, então só grava o pedido no config; o bot confere aqui a cada minuto
async function checarSincronizacaoPendente() {
  const grupoId = getConfig('sincronizar_grupo_pendente');
  if (!grupoId) return;

  try {
    const chat = await client.getChatById(grupoId);
    const { total, novos, inativados } = await sincronizarElencoDeChat(chat);
    registrarLog(
      'elenco', 'sucesso',
      `Elenco sincronizado pelo painel — ${total} membro(s) no elenco, ${novos} novo(s) adicionado(s), ${inativados} marcada(s) como inativa(s)`,
      grupoId,
    );
  } catch (err) {
    registrarLog('elenco', 'erro', `Falha ao sincronizar elenco via painel: ${err.message}`, grupoId);
    console.error('Erro ao sincronizar elenco via painel:', err);
  } finally {
    setConfig('sincronizar_grupo_pendente', '');
  }
}

client.initialize();