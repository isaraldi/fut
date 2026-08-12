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
  getConfirmadosDaEnquete,
  registrarLog,
  getEnviosImediatosPendentes,
  removerEnvioImediato,
  fecharEnquete,
  getEnquetesFechadasNaoDesafixadas,
  marcarEnqueteDesafixada,
  registrarTentativaDesafixar,
} = require('./db');
const { balancearTimes, montarTextoListaConfirmadas, montarTextoTimes } = require('./mensagens-prontas');

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  }
});

const groupConfigs = {
  '120363425582736082@g.us': {
    mode: 'reaction',
    maxPlayers: 10
  },
  '1203630yyyyy@g.us': {
    mode: 'message',
    maxPlayers: 14
  }
};



// estado
let confirmedPlayers = new Map(); // userId -> { name, level }
let pollMessageId = null;

let config = {
  mode: 'reaction', // 'message' | 'reaction'
};

// níveis mock (depois vem do Drupal 👀)
const playerLevels = {
  "João": 5,
  "Maria": 4,
  "Pedro": 3,
  "Ana": 2,
  "Lucas": 1
};

client.on('qr', qr => {
  qrcode.generate(qr, { small: true });
});

client.on('ready', async () => {
  console.log('Bot pronto! 🤖');
  setInterval(() => {
    checarEnvioAutomaticoDeEnquete();
    checarMensagensAgendadas();
    checarEnviosImediatos();
    checarEnquetesParaDesafixar();
  }, 60 * 1000);
  await sincronizarGruposConhecidos();
});

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


// 🔥 função util
function getUserId(msg) {
  return msg.author || msg.from;
}

function getUserName(msg) {
  return msg._data.notifyName || "Jogador";
}

// 🧠 confirmação (modo lista)
function isConfirmation(text) {
  return ['!vou'].includes(text);
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

  const sent = await client.sendMessage(groupId, poll);

  db.prepare(
    'INSERT INTO enquetes (message_id, group_id, titulo) VALUES (?, ?, ?)'
  ).run(sent.id._serialized, groupId, titulo);

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
  if (agora.getHours() !== horaAlvo || agora.getMinutes() !== minutoAlvo) return;

  // trava por data local (não por semana) pra não reenviar se o processo reiniciar no mesmo
  // minuto, e nem depender de o processo ficar de pé por 7 dias inteiros sem reiniciar
  const hojeLocal = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}-${String(agora.getDate()).padStart(2, '0')}`;
  if (getConfig('enquete_auto_ultimo_envio') === hojeLocal) return;

  setConfig('enquete_auto_ultimo_envio', hojeLocal);
  console.log('⏰ Horário configurado atingido, enviando enquete automaticamente...');
  try {
    await abrirEnquete(grupoId, null, 'automática');
  } catch (err) {
    registrarLog('enquete', 'erro', `Falha ao enviar enquete automática: ${err.message}`, grupoId);
    console.error('Erro ao enviar enquete automática:', err);
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

    if (jogador.papel === 'mensalista') {
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

  // funciona em qualquer grupo, independente do groupConfigs legado
  if (msg.from.endsWith('@g.us') && text === '!enquete') {
    return abrirEnquete(msg.from, msg);
  }

  if (msg.from.endsWith('@g.us') && text === '!sincronizar') {
    return sincronizarElencoDoGrupo(msg);
  }

  // funciona em grupo OU em DM direto com o bot
  if (text === '!fechar') {
    return enviarListaDeConfirmadas(msg);
  }

  // funciona em grupo OU em DM direto com o bot
  if (text === '!times') {
    return enviarTimesSorteados(msg);
  }

  // roda em paralelo, sem travar o resto do handler (OCR pode levar alguns segundos)
  if (msg.from.endsWith('@g.us') && msg.hasMedia && msg.type === 'image') {
    processarPossivelComprovante(msg).catch((err) =>
      console.error('Erro ao processar possível comprovante:', err),
    );
  }

  const config = groupConfigs[msg.from];

  if (!config) return;

  const userId = getUserId(msg);
  const name = getUserName(msg);

  console.log(`📩 ${name} - ${userId}: ${text}`);

  // 🔁 TROCAR MODO
  if (text === '!modo lista') {
    config.mode = 'message';
    return msg.reply('📋 Modo LISTA ativado!');
  }

  if (text === '!modo enquete') {
    config.mode = 'reaction';
    return msg.reply('👍 Modo ENQUETE ativado!');
  }

  // 📋 MODO LISTA
  if (config.mode === 'message' && isConfirmation(text)) {
    confirmedPlayers.set(userId, {
      name,
      level: playerLevels[name] || 3
    });

    return msg.reply(`✅ ${name} confirmado!`);
  }

  // 👍 ABRIR ENQUETE
  if (text === '!abrir') {
    const sent = await client.sendMessage(
      msg.from,
      '⚽ *Quem vai jogar?*\nReaja com 👍 pra confirmar!'
    );

    pollMessageId = sent.id._serialized;
    confirmedPlayers.clear();

    return;
  }

  // 👥 VER CONFIRMADOS
  if (text === '!confirmados') {
    if (confirmedPlayers.size === 0) {
      return msg.reply('👀 Ninguém confirmado ainda!');
    }

    let list = '👥 *Confirmados:*\n';
    confirmedPlayers.forEach(p => {
      list += `- ${p.name}\n`;
    });

    return msg.reply(list);
  }

  // ♻️ RESET
  if (text === '!reset') {
    confirmedPlayers.clear();
    pollMessageId = null;
    return msg.reply('♻️ Resetado!');
  }

  // ⚽ GERAR TIMES
  if (text === '!times') {
    const players = Array.from(confirmedPlayers.values());

    if (players.length < 2) {
      return msg.reply('❌ Poucos jogadores ainda!');
    }

    const { teamA, teamB, sumA, sumB } = createBalancedTeams(players);

    let response = '⚽ *Times definidos:*\n\n';

    response += `🔵 Time A (${sumA}):\n`;
    teamA.forEach(p => response += `- ${p.name} (${p.level})\n`);

    response += `\n🔴 Time B (${sumB}):\n`;
    teamB.forEach(p => response += `- ${p.name} (${p.level})\n`);

    return msg.reply(response);
  }
});

// 👍 CAPTURA REAÇÃO (modo enquete)
client.on('message_reaction', async reaction => {
  console.log(reaction);
  if (config.mode !== 'reaction') return;

  try {
    // 👇 pega direto do objeto
    const messageId = reaction.msgId._serialized;

    if (messageId !== pollMessageId) return;

    if (reaction.reaction === '👍') {
      const userId = reaction.senderId;

      const contact = await client.getContactById(userId);
      const name = contact.pushname || contact.name || "Jogador";

      confirmedPlayers.set(userId, {
        name,
        level: playerLevels[name] || 3
      });

      console.log(`👍 ${name} confirmado via reação`);
    }

  } catch (err) {
    console.error('Erro ao processar reação:', err);
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
    if (enquete.fechada_em) {
      console.log(`🔒 Voto ignorado — enquete #${enquete.id} já está com a lista fechada`);
      return;
    }

    const idCanonico = await resolverIdCanonico(vote.voter);
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

// 🔄 SINCRONIZAR ELENCO COM MEMBROS ATUAIS DO GRUPO (sob demanda, admin manda no grupo)
async function sincronizarElencoDoGrupo(msg) {
  const chat = await msg.getChat();
  if (!chat.isGroup) return;

  let novos = 0;
  let total = 0;
  for (const participant of chat.participants) {
    const whatsappId = getIdSerialized(participant.id);
    if (!whatsappId) continue;

    const idCanonico = await resolverIdCanonico(whatsappId);
    const jaExistia = !!db
      .prepare('SELECT id FROM jogadores WHERE whatsapp_id = ?')
      .get(idCanonico);

    const jogadorId = await sincronizarJogadorPorId(whatsappId);
    if (!jogadorId) continue; // pulado: era o próprio bot, ou deu erro

    total++;
    if (!jaExistia) novos++;
  }

  return msg.reply(
    `🔄 Elenco sincronizado! ${total} membro(s) do grupo no elenco, ${novos} novo(s) adicionado(s).`
  );
}

// ⚖️ balanceamento
function createBalancedTeams(players) {
  players.sort((a, b) => b.level - a.level);

  const teamA = [];
  const teamB = [];

  let sumA = 0;
  let sumB = 0;

  for (let player of players) {
    if (sumA <= sumB) {
      teamA.push(player);
      sumA += player.level;
    } else {
      teamB.push(player);
      sumB += player.level;
    }
  }

  return { teamA, teamB, sumA, sumB };
}

client.initialize();