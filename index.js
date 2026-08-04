const { Client, LocalAuth, Poll } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { db, upsertJogador, getConfig, getEnqueteOpcoes } = require('./db');

const client = new Client({
  authStrategy: new LocalAuth()
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

client.on('ready', () => {
  console.log('Bot pronto! 🤖');
});


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
async function abrirEnquete(msg) {
  const { data, dia } = proximoDiaDeJogo();
  const hora = getConfig('enquete_hora') || '20:00';
  const template = getConfig('enquete_titulo_template') || 'JOGO DE QUARTA - {data}';
  const titulo = template
    .replace('{data}', data)
    .replace('{dia}', dia)
    .replace('{hora}', hora);

  const opcoes = getEnqueteOpcoes();
  if (opcoes.length < 2) {
    return msg.reply('❌ Configure pelo menos 2 opções da enquete no painel antes de abrir.');
  }

  const poll = new Poll(
    titulo,
    opcoes.map(o => o.texto),
    { allowMultipleAnswers: false }
  );

  const sent = await client.sendMessage(msg.from, poll);

  db.prepare(
    'INSERT INTO enquetes (message_id, group_id, titulo) VALUES (?, ?, ?)'
  ).run(sent.id._serialized, msg.from, titulo);

  console.log(`🗳️ Enquete criada: ${titulo}`);
}

client.on('message', async msg => {
  console.log('msg from:', msg.from);

  const text = msg.body.toLowerCase().trim();

  // funciona em qualquer grupo, independente do groupConfigs legado
  if (msg.from.endsWith('@g.us') && text === '!enquete') {
    return abrirEnquete(msg);
  }

  if (msg.from.endsWith('@g.us') && text === '!sincronizar') {
    return sincronizarElencoDoGrupo(msg);
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
      .prepare('SELECT id FROM enquetes WHERE message_id = ?')
      .get(msgId);
    if (!enquete) return; // enquete de outra origem, ignora

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