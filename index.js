process.env.TZ = 'America/Sao_Paulo'; // dia/hora configurados no painel são sempre no horário de Brasília

const os = require('os');
const fs = require('fs');
const path = require('path');
const { Client, LocalAuth, Poll } = require('whatsapp-web.js');
const { createWorker } = require('tesseract.js');
const qrcode = require('qrcode-terminal');
const { criarSincronizadorWhatsApp } = require('./sincronizacao-whatsapp');
const { ErroLista, pareceLista, prepararLista, confirmarLista, cancelarLista } = require('./listas-whatsapp');
const {
  db,
  upsertJogador,
  getConfig,
  getAusentesDaEnquete,
  setAusentesDaEnquete,
  setConfig,
  upsertGrupo,
  getEnqueteOpcoes,
  getMensagensUnicasParaEnviar,
  getMensagensSemanais,
  marcarMensagemEnviada,
  marcarMensagemSemanalEnviada,
  marcarPagamentoMensalista,
  marcarPagamentoAvulso,
  criarCicloMensal, expirarRenovacoesMensais, getResumoMensal,
  getJogadorPorWhatsappId,
  podeUsarComandos,
  getConfirmadosDaEnquete,
  getListaDeEsperaDaEnquete,
  registrarLog,
  getEnviosImediatosPendentes,
  getMensagensJogadorasPendentes,
  getDestinatariasPorPublico,
  enfileirarMensagemJogadora,
  removerMensagemJogadora,
  removerEnvioImediato,
  fecharEnquete,
  getEnquetesFechadasNaoDesafixadas,
  marcarEnqueteDesafixada,
  registrarTentativaDesafixar,
} = require('./db');
const { criarLlmLocal, mensagemPrivadaRecebida } = require('./llm-local');
const { avaliarOcrComprovante } = require('./comprovantes-ocr');
const llmLocal = criarLlmLocal({ getConfig });
const {
  montarPlanoDeTimes, montarRodizio, acharPorNomes, montarTextoListaConfirmadas, montarTextoListaAtual, montarTextoListaEspera, montarTextoTimes,
  fechamentoMensalDoMes, mesReferenciaAtual, mesAnterior, montarTextoMensal,
} = require('./mensagens-prontas');

// 💥 erro não tratado (bug real, não um erro esperado de rede/WhatsApp) — mais seguro encerrar
// e deixar o Docker reiniciar o processo do que continuar rodando em estado desconhecido
process.on('unhandledRejection', (motivo) => {
  console.error('🔥 unhandledRejection não tratada — encerrando processo:', motivo);
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  console.error('🔥 uncaughtException não tratada — encerrando processo:', err);
  process.exit(1);
});

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    timeout: 120000,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-software-rasterizer', '--disable-extensions', '--no-first-run']
  }
});

client.on('qr', qr => {
  qrcode.generate(qr, { small: true });
});

const sincronizadorWhatsApp = criarSincronizadorWhatsApp({
  client,
  resolverIdCanonico,
  limitar: promise => comTimeoutDeSessao(promise, 30000, 'Leitura de votos e reações'),
});
let whatsappJaFicouPronto = false;
client.on('disconnected', () => sincronizadorWhatsApp.desconectar());
client.on('change_state', estado => {
  if (estado !== 'CONNECTED') sincronizadorWhatsApp.desconectar();
  else if (whatsappJaFicouPronto) sincronizadorWhatsApp.conectar();
});

// evita criar um segundo setInterval quando 'ready' dispara de novo depois de
// um reiniciarSessaoWhatsapp() (destroy + initialize reautentica e reemite 'ready')
let intervaloIniciado = false;

client.on('ready', async () => {
  console.log('Bot pronto! 🤖');
  whatsappJaFicouPronto = true;
  if (!intervaloIniciado) {
    intervaloIniciado = true;
    setInterval(() => {
      // A leitura não atrasa os agendamentos; a expiração espera a recuperação abaixo.
      sincronizadorWhatsApp.sincronizar();
      checarEnvioAutomaticoDeEnquete();
      checarEnvioManualDeEnqueteViaPainel();
      checarMensagensAgendadas();
      checarEnviosImediatos();
      checarMensagensParaJogadoras();
      checarEnquetesParaDesafixar();
      checarReinicioAgendadoDoBot();
      checarSincronizacaoPendente();
      checarFechamentoMensal();
      checarConvitesFechamentoMensalExpirados();
    }, 60 * 1000);
  }
  await sincronizadorWhatsApp.conectar();
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
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      console.error(`⚠️ ${rotulo} travou (sem resposta em ${ms / 1000}s) — reiniciando sessão do WhatsApp...`);
      reiniciarSessaoWhatsapp().catch((err) => console.error('Falha ao reiniciar sessão do WhatsApp:', err));
      reject(new Error(`${rotulo} travou (sessão do WhatsApp reiniciada)`));
    }, ms);
  });
  // limpa o timer assim que a promise original resolver (sucesso ou erro), senão ele dispara
  // de qualquer jeito ms depois e reinicia a sessão à toa — mesmo quando não travou de verdade
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
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
  db.prepare(
    'INSERT INTO enquetes (message_id, group_id, titulo, vagas_maximo) VALUES (?, ?, ?, ?)'
  ).run(sent.id._serialized, groupId, titulo, vagasMaximo);

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
      await enviarMensagemAgendada(msg, 'Envio de mensagem única');
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
      await enviarMensagemAgendada(msg, 'Envio de mensagem semanal');
      marcarMensagemSemanalEnviada(msg.id, hojeLocal);
      registrarLog('mensagem', 'sucesso', `Mensagem semanal enviada: "${resumoTexto(msg.texto)}"`, msg.grupo_id);
      console.log(`✉️ Mensagem semanal #${msg.id} enviada`);
    } catch (err) {
      registrarLog('mensagem', 'erro', `Falha ao enviar mensagem semanal #${msg.id}: ${err.message}`, msg.grupo_id);
      console.error(`Erro ao enviar mensagem semanal #${msg.id}:`, err);
    }
  }
}

// Fecha no dia seguinte ao último jogo do mês. Verifica também o mês anterior,
// pois o fechamento pode cair no dia 1º do mês seguinte.
let enviandoFechamentoMensal = false;
function mesmaData(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

async function checarFechamentoMensal() {
  if (enviandoFechamentoMensal || getConfig('fechamento_mensal_ativo') !== '1') return;

  const grupoId = getConfig('enquete_grupo_id');
  if (!grupoId) return;

  const agora = new Date();
  const fechamentoDoMesAtual = fechamentoMensalDoMes(agora.getFullYear(), agora.getMonth(), Number(getConfig('enquete_dia_semana')));
  const mesAnteriorIndex = agora.getMonth() === 0 ? 11 : agora.getMonth() - 1;
  const anoDoMesAnterior = agora.getMonth() === 0 ? agora.getFullYear() - 1 : agora.getFullYear();
  const fechamentoDoMesAnterior = fechamentoMensalDoMes(anoDoMesAnterior, mesAnteriorIndex, Number(getConfig('enquete_dia_semana')));

  if (!mesmaData(agora, fechamentoDoMesAtual) && !mesmaData(agora, fechamentoDoMesAnterior)) return;

  const hojeLocal = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}-${String(agora.getDate()).padStart(2, '0')}`;
  if (getConfig('fechamento_mensal_ultimo_envio') === hojeLocal) return; // já enviada hoje

  // usa >= (não ===), igual o envio automático da enquete: se o horário configurado passar
  // batido (processo reiniciando, sessão travada etc.) tenta de novo nos minutos seguintes
  // em vez de esperar até o próximo fechamento
  const [horaAlvo, minutoAlvo] = (getConfig('fechamento_mensal_hora') || '00:00').split(':').map(Number);
  const minutosAgora = agora.getHours() * 60 + agora.getMinutes();
  const minutosAlvo = horaAlvo * 60 + minutoAlvo;
  if (minutosAgora < minutosAlvo) return;

  // A chamada usa as mensalistas atuais; o mês de pagamento já vira no fechamento.
  const mesNovo = mesReferenciaAtual(agora, Number(getConfig('enquete_dia_semana')));
  const mesAnteriorRef = mesAnterior(mesNovo);
  const valorMensal = parseFloat(getConfig('valor_mensal'));
  if (db.prepare('SELECT 1 FROM fechamento_mensal_ciclos WHERE mes_anterior = ?').get(mesAnteriorRef)) return;
  const pagantes = db.prepare("SELECT id, nome FROM jogadores WHERE papel = 'mensalista' AND ativo = 1 ORDER BY nome").all();
  const prazoHoras = parseInt(getConfig('fechamento_mensal_prazo_horas'), 10) || 36;

  const diaLimite = parseInt(getConfig('pagamento_dia_limite'), 10) || 7;
  const mesNovoNumero = mesNovo.split('-')[1];
  const dataLimitePagamento = `${String(diaLimite).padStart(2, '0')}/${mesNovoNumero}`;

  const template = getConfig('fechamento_mensal_mensagem');
  const textoBase = template
    .replace(/{mes_anterior}/g, mesAnteriorRef)
    .replace(/{mes_atual}/g, mesNovo)
    .replace(/{data_limite_pagamento}/g, dataLimitePagamento)
    .replace(/{fechamento_mensal_prazo_horas}/g, String(prazoHoras))
    .replace('{valor_mensal}', Number.isFinite(valorMensal) ? `R$${valorMensal.toFixed(2)}` : '(valor não configurado)')
    .replace('{mensalistas_mes_anterior}', pagantes.length ? pagantes.map((j, i) => `${i + 1}. ${j.nome}`).join('\n') : 'Nenhuma mensalista atual.');
  const texto = textoBase + '\n\n👍 Mensalistas atuais: confirmem a renovação dentro do prazo para manter a prioridade. Demais interessadas: reajam 👍 para entrar na fila por ordem de resposta. 👎 ou retirar o 👍 significa desistência. Depois do prazo, pedidos de renovação também entram na fila. Consulte com !mensal. Novas entradas dependem da organização.';

  enviandoFechamentoMensal = true;
  console.log('💰 Fechamento do mensal atingido, enviando mensagem automática...');
  try {
    const sent = await comTimeoutDeSessao(client.sendMessage(grupoId, texto), 30 * 1000, 'Envio do fechamento do mensal');
    const messageId = sent.id._serialized;
    criarCicloMensal(messageId, mesAnteriorRef, prazoHoras);
    setConfig('fechamento_mensal_ultimo_envio', hojeLocal);
    registrarLog('mensagem', 'sucesso', `Mensagem de fechamento do mensal enviada (${pagantes.length} convidada(s) a renovar — mês ${mesAnteriorRef})`, grupoId);
    console.log(`💰 Mensagem de fechamento do mensal enviada (${pagantes.length} convidada(s))`);
  } catch (err) {
    registrarLog('mensagem', 'erro', `Falha ao enviar mensagem de fechamento do mensal: ${err.message}`, grupoId);
    console.error('Erro ao enviar mensagem de fechamento do mensal:', err);
  } finally {
    enviandoFechamentoMensal = false;
  }
}

// O prazo é congelado por ciclo. Só respostas da chamada mais recente são aceitas.
async function checarConvitesFechamentoMensalExpirados() {
  await sincronizadorWhatsApp.sincronizar();
  expirarRenovacoesMensais();
}

// Eventos ao vivo e recuperação usam a mesma fila e os mesmos controles de repetição.
client.on('message_reaction', reacao => sincronizadorWhatsApp.receberReacao(reacao));

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

    const usarVisao = mensagemPrivadaRecebida(msg) && llmLocal.habilitada('comprovantes');
    let text = '';
    let confidence = 0;
    try {
      const worker = await getOcrWorker();
      const resultado = await worker.recognize(caminhoTemp);
      text = resultado.data.text || '';
      confidence = resultado.data.confidence;
    } catch (err) {
      if (!usarVisao) throw err;
      // Falha de OCR em DM: a imagem original ainda pode ser lida pelo modelo visual.
    }
    const ocr = avaliarOcrComprovante(text, confidence);
    const legenda = avaliarOcrComprovante(msg.body || '', 0);
    // Sem texto legível, tenta visão em DM; texto sem sinais de comprovante é ruído.
    if (!ocr.temPalavraChave && !ocr.temValor
      && !(usarVisao && (!text.trim() || legenda.temPalavraChave))) return;

    if (!usarVisao && !(ocr.temPalavraChave && ocr.temValor)) {
      registrarLog('comprovante', 'aviso', 'Imagem parece comprovante mas o OCR não confirmou palavra de pagamento e valor em R$ — conferir manualmente', msg.from);
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
    let valoresEncontrados = ocr.valores;
    if (usarVisao) {
      if (ocr.pendente) {
        registrarLog('comprovante', 'aviso', 'OCR indica agendamento, falha ou pendência — conferir manualmente; pagamento não alterado', msg.from);
        return;
      }
      if (!valoresConfigurados) {
        registrarLog('comprovante', 'aviso', 'Configure os valores de mensal e avulso antes de aceitar comprovantes pela análise local', msg.from);
        return;
      }
      if (!ocr.seguro) {
        let analise;
        try {
          analise = await llmLocal.interpretarImagemComprovante(media);
        } catch {
          registrarLog('comprovante', 'aviso', 'OCR duvidoso e análise da imagem indisponível ou inválida — conferir manualmente; pagamento não alterado', msg.from);
          return;
        }
        if (!analise || !analise.confirmado) {
          registrarLog('comprovante', 'aviso', 'OCR duvidoso e imagem sem confirmação de pagamento concluído e valor único em R$ — pagamento não alterado', msg.from);
          return;
        }
        valoresEncontrados = [analise.valor];
        registrarLog('comprovante', 'aviso', 'OCR duvidoso: imagem original analisada pelo modelo visual local; aplicando validações de pagamento', msg.from);
      }
    }

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
      const mes = mesReferenciaAtual(new Date(), Number(getConfig('enquete_dia_semana'))); // mês corrente, ou o seguinte se o mensal já fechou
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
    registrarLog('comprovante', 'erro', `Erro ao processar possível comprovante: ${err && err.message ? err.message : String(err)}`, msg.from);
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
  const texto = montarTextoListaConfirmadas(enquete, confirmados, getConfig('lista_confirmada_mensagem'));

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
  const texto = montarTextoListaAtual(enquete, confirmados, listaDeEspera, getConfig('lista_atual_mensagem'));

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

  const texto = montarTextoListaEspera(enquete, listaDeEspera, getConfig('lista_espera_mensagem'));

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

  if (getConfig('jogo_times_modo') === 'manual') {
    return msg.reply('⚽ Os times estão em modo manual — monte e envie pelo painel (Times).');
  }

  const ausentesIds = getAusentesDaEnquete(enquete.id);
  const confirmados = getConfirmadosDaEnquete(enquete.id).filter((j) => !ausentesIds.includes(j.id));
  if (confirmados.length < 2) {
    return msg.reply('⚽ Confirmados de menos pra sortear times (mínimo 2).');
  }

  const minutos = parseInt(getConfig('jogo_rodizio_minutos'), 10);
  const duracao = parseInt(getConfig('jogo_duracao_minutos'), 10);
  const { times, reservas } = montarPlanoDeTimes(confirmados, parseInt(getConfig('jogo_jogadoras_por_time'), 10));
  const texto = montarTextoTimes(
    enquete.titulo,
    times.map((time) => time.map((j) => j.nome)),
    reservas.map((j) => j.nome),
    montarRodizio(times, reservas, minutos, duracao),
    getConfig('times_mensagem'),
  );

  await msg.reply(texto);
  registrarLog(
    'times', 'sucesso',
    `Times sorteados e enviados (${confirmados.length} confirmada(s)) — "${enquete.titulo}"`,
    msg.from.endsWith('@g.us') ? msg.from : null,
  );
}

// 🙋 !faltam Ana, Bia — avisa quem confirmou mas não vai aparecer (ou ainda não chegou), pra elas
// ficarem fora do sorteio de times. Cada uso SUBSTITUI a lista (quem chegou é só tirar do comando);
// "!faltam" sozinho mostra a lista atual e "!faltam ninguém" limpa.
async function registrarFaltas(msg, argumentos) {
  const enquete = db.prepare('SELECT * FROM enquetes ORDER BY id DESC LIMIT 1').get();
  if (!enquete) return msg.reply('⚽ Nenhuma enquete foi aberta ainda.');

  const confirmados = getConfirmadosDaEnquete(enquete.id);
  const texto = argumentos.trim();

  if (!texto) {
    const ausentes = confirmados.filter((j) => getAusentesDaEnquete(enquete.id).includes(j.id));
    return msg.reply(ausentes.length > 0
      ? `🙋 Faltando: ${ausentes.map((j) => j.nome).join(', ')}.`
      : '🙋 Ninguém marcada como faltando. Use: !faltam Ana, Bia');
  }

  if (['ninguem', 'ninguém', 'limpar'].includes(texto.toLowerCase())) {
    setAusentesDaEnquete(enquete.id, []);
    registrarLog('times', 'sucesso', 'Lista de faltas limpa', msg.from.endsWith('@g.us') ? msg.from : null);
    return msg.reply('🙋 Lista de faltas limpa — todas as confirmadas entram no sorteio.');
  }

  const { achadas, naoEncontradas, ambiguas } = acharPorNomes(confirmados, texto);
  setAusentesDaEnquete(enquete.id, achadas.map((j) => j.id));

  let resposta = achadas.length > 0
    ? `🙋 Faltando: ${achadas.map((j) => j.nome).join(', ')}. Sobram ${confirmados.length - achadas.length} pra jogar.`
    : '🙋 Ninguém marcada como faltando.';
  if (naoEncontradas.length > 0) resposta += `\n⚠️ Não achei entre as confirmadas: ${naoEncontradas.join(', ')}.`;
  if (ambiguas.length > 0) resposta += `\n⚠️ Mais de uma bate com: ${ambiguas.join(', ')} — use o nome completo.`;

  registrarLog('times', 'sucesso', `Faltas marcadas: ${achadas.map((j) => j.nome).join(', ') || 'nenhuma'}`, msg.from.endsWith('@g.us') ? msg.from : null);
  return msg.reply(resposta);
}

// 📤 FILA DE ENVIO IMEDIATO — botões "mandar pro grupo" do painel caem aqui, já que o painel
// roda num processo separado e não tem acesso direto ao client do WhatsApp
async function checarEnviosImediatos() {
  const pendentes = getEnviosImediatosPendentes();
  for (const envio of pendentes) {
    try {
      await comTimeoutDeSessao(client.sendMessage(envio.grupo_id, envio.texto), 30 * 1000, 'Envio imediato via painel');
      registrarLog(envio.tipo, 'sucesso', `${envio.tipo === 'lista' ? 'Lista' : 'Times'} enviado(a) via painel`, envio.grupo_id);
    } catch (err) {
      registrarLog(envio.tipo, 'erro', `Falha ao enviar ${envio.tipo} via painel: ${err.message}`, envio.grupo_id);
      console.error(`Erro ao processar envio imediato #${envio.id}:`, err);
    } finally {
      removerEnvioImediato(envio.id);
    }
  }
}

// manda uma mensagem agendada: pra um grupo (grupo_id é o id do grupo) ou, quando grupo_id é
// "jogadoras:<público>", como DM individual pra cada jogadora do público — o público é
// resolvido só na hora do envio (quem renovou/confirmou pode mudar entre agendar e enviar)
async function enviarMensagemAgendada(msg, descricao) {
  if (!msg.grupo_id.startsWith('jogadoras:')) {
    return comTimeoutDeSessao(client.sendMessage(msg.grupo_id, msg.texto), 30 * 1000, descricao);
  }

  const publico = msg.grupo_id.slice('jogadoras:'.length);
  const destinatarias = getDestinatariasPorPublico(publico).filter((j) => j.whatsapp_id || j.telefone);
  if (destinatarias.length === 0) {
    registrarLog('mensagem', 'aviso', `Mensagem agendada #${msg.id} pro público "${publico}": ninguém pra enviar no momento`);
    return;
  }
  destinatarias.forEach((j) => enfileirarMensagemJogadora(j.id, msg.texto.replace(/{nome}/g, j.nome)));
  checarMensagensParaJogadoras().catch((err) => console.error('Erro ao enviar DMs agendadas:', err));
}

// 💌 MENSAGENS PRIVADAS PRAS JOGADORAS — enfileiradas pelo painel (Mensagens > "Mandar mensagem
// pras jogadoras"); o bot manda uma DM por jogadora, com pausa entre elas pra não parecer spam.
// Falha de uma não trava as outras, e nada é reenviado (a fila é esvaziada de qualquer jeito).
let enviandoMensagensJogadoras = false;
async function checarMensagensParaJogadoras() {
  if (enviandoMensagensJogadoras) return;
  const pendentes = getMensagensJogadorasPendentes();
  if (pendentes.length === 0) return;

  enviandoMensagensJogadoras = true;
  let enviadas = 0;
  const falhas = [];
  try {
    for (const item of pendentes) {
      try {
        const telefone = item.telefone ? `${String(item.telefone).replace(/\D/g, '')}@c.us` : null;
        const destino = item.whatsapp_id || telefone;
        if (!destino) throw new Error('sem número cadastrado');
        try {
          await comTimeoutDeSessao(client.sendMessage(destino, item.texto), 30 * 1000, 'Envio de DM pra jogadora');
        } catch (err) {
          if (!telefone || telefone === destino) throw err;
          await comTimeoutDeSessao(client.sendMessage(telefone, item.texto), 30 * 1000, 'Envio de DM pra jogadora');
        }
        enviadas++;
      } catch (err) {
        falhas.push(`${item.nome} (${err.message})`);
        console.error(`Erro ao mandar DM pra ${item.nome}:`, err);
      } finally {
        removerMensagemJogadora(item.id);
      }
      await new Promise((resolve) => setTimeout(resolve, 3000 + Math.random() * 3000));
    }
  } finally {
    enviandoMensagensJogadoras = false;
  }

  registrarLog(
    'mensagem', falhas.length > 0 ? 'aviso' : 'sucesso',
    `Mensagem privada: ${enviadas} enviada(s)${falhas.length > 0 ? `, ${falhas.length} falha(s): ${falhas.join('; ')}` : ''}`,
  );
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

async function tratarListaEditada(msg, text) {
  const comando = text === '!confirmarlista' || text === '!cancelarlista';
  if (!comando && !pareceLista(msg.body)) return false;
  if (msg.fromMe || msg.isStatus) return false;
  if (!(await remetenteAutorizado(msg))) {
    if (comando) await negarComando(msg);
    return comando;
  }
  if (msg.from !== getConfig('enquete_grupo_id') || !msg.from.endsWith('@g.us')) {
    if (comando) await msg.reply('Use este comando no grupo configurado para o jogo.');
    return comando;
  }
  try {
    await sincronizadorWhatsApp.sincronizar();
    const autor = await resolverIdCanonico(getUserId(msg));
    const args = { grupo: msg.from, autor };
    let resposta;
    if (text === '!confirmarlista') resposta = confirmarLista(args);
    else if (text === '!cancelarlista') resposta = cancelarLista(args);
    else resposta = prepararLista({ ...args, texto: msg.body, messageId: getIdSerialized(msg.id) });
    if (resposta) await msg.reply(resposta);
  } catch (erro) {
    const resposta = erro instanceof ErroLista ? erro.message : 'Não consegui concluir a solicitação. Confira com !lista antes de tentar novamente.';
    if (!(erro instanceof ErroLista)) registrarLog('lista', 'erro', 'Falha no processamento ou resposta da correção de lista pelo WhatsApp.');
    await msg.reply(resposta).catch(() => registrarLog('lista', 'erro', 'Não foi possível enviar a resposta da correção de lista.'));
  }
  return true;
}

client.on('message', async msg => {
  console.log('msg from:', msg.from);

  const text = msg.body.toLowerCase().trim();
  if (await tratarListaEditada(msg, text)) return;

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
    await sincronizadorWhatsApp.sincronizar();
    return enviarListaDeConfirmadas(msg);
  }

  // funciona em grupo OU em DM direto com o bot
  if (text === '!mensal') {
    if (!(await remetenteAutorizado(msg))) return negarComando(msg);
    await sincronizadorWhatsApp.sincronizar();
    return msg.reply(montarTextoMensal(getResumoMensal()));
  }

  if (text === '!lista') {
    if (!(await remetenteAutorizado(msg))) return negarComando(msg);
    await sincronizadorWhatsApp.sincronizar();
    return enviarListaAtual(msg);
  }

  // funciona em grupo OU em DM direto com o bot
  if (text === '!espera') {
    if (!(await remetenteAutorizado(msg))) return negarComando(msg);
    await sincronizadorWhatsApp.sincronizar();
    return enviarListaDeEspera(msg);
  }

  // funciona em grupo OU em DM direto com o bot
  if (text === '!times') {
    if (!(await remetenteAutorizado(msg))) return negarComando(msg);
    await sincronizadorWhatsApp.sincronizar();
    return enviarTimesSorteados(msg);
  }

  // funciona em grupo OU em DM direto com o bot
  if (text === '!faltam' || text.startsWith('!faltam ')) {
    if (!(await remetenteAutorizado(msg))) return negarComando(msg);
    return registrarFaltas(msg, msg.body.trim().slice('!faltam'.length));
  }

  // roda em paralelo, sem travar o resto do handler (OCR pode levar alguns segundos)
  // funciona em grupo OU em DM direto com o bot
  // status (stories) dos contatos também chegam como mensagem com imagem, mas não são comprovante
  // e o download deles falha — ignorar antes de tentar evita centenas de erros falsos nos logs
  if (msg.hasMedia && msg.type === 'image' && !msg.fromMe && !msg.isStatus && msg.from !== 'status@broadcast') {
    processarPossivelComprovante(msg).catch((err) =>
      console.error('Erro ao processar possível comprovante:', err),
    );
    return;
  }

  // A LLM interpreta somente conversas privadas recebidas no número do bot.
  // Consultas livres não fecham listas, sorteiam times ou alteram pagamentos.
  if (mensagemPrivadaRecebida(msg) && llmLocal.habilitada('mensagens')
    && !msg.hasMedia && text && !text.startsWith('!')) {
    if (!(await remetenteAutorizado(msg))) return;
    let intencao;
    try {
      intencao = await llmLocal.interpretarMensagem(msg.body);
    } catch {
      await msg.reply('Não consegui interpretar agora. Use !lista, !espera ou !mensal.');
      return;
    }
    if (!intencao) return;
    await sincronizadorWhatsApp.sincronizar();
    // Revalida a whitelist após a espera pela inferência.
    if (!(await remetenteAutorizado(msg))) return;
    if (intencao === 'lista') return enviarListaAtual(msg);
    if (intencao === 'espera') return enviarListaDeEspera(msg);
    if (intencao === 'mensal') return msg.reply(montarTextoMensal(getResumoMensal()));
  }
});

// 🗳️ CAPTURA VOTO DA ENQUETE NATIVA
client.on('vote_update', voto => sincronizadorWhatsApp.receberVoto(voto));

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
