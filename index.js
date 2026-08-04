const { Client, LocalAuth, Poll } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { db, upsertJogador } = require('./db');

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

// 📅 próxima quarta-feira (ou hoje, se hoje já for quarta)
function proximaQuarta() {
  const hoje = new Date();
  const diaSemana = hoje.getDay(); // 0=domingo ... 3=quarta
  const diff = (3 - diaSemana + 7) % 7;
  const alvo = new Date(hoje);
  alvo.setDate(hoje.getDate() + diff);
  const dd = String(alvo.getDate()).padStart(2, '0');
  const mm = String(alvo.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}`;
}

// 🗳️ ENQUETE NATIVA + registro no banco pro painel
async function abrirEnquete(msg) {
  const data = proximaQuarta();
  const titulo = `JOGO DE QUARTA - ${data}`;

  const poll = new Poll(
    titulo,
    ['Eu vou (MENSALISTAS)', 'Não vou (MENSALISTAS)', 'Eu quero (AVULSAS)'],
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

    const contact = await client.getContactById(vote.voter);
    const nome = contact.pushname || contact.name || 'Jogador';

    if (vote.selectedOptions.length === 0) {
      const jogador = db
        .prepare('SELECT id FROM jogadores WHERE whatsapp_id = ?')
        .get(vote.voter);
      if (jogador) {
        db.prepare(
          'DELETE FROM votos WHERE enquete_id = ? AND jogador_id = ?'
        ).run(enquete.id, jogador.id);
      }
      console.log(`🗳️ ${nome} removeu o voto`);
      return;
    }

    const opcao = vote.selectedOptions.map(o => o.name).join(', ');
    const papel = opcao.includes('MENSALISTAS') ? 'mensalista' : 'avulso';
    const jogadorId = upsertJogador(vote.voter, nome, papel);

    db.prepare(`
      INSERT INTO votos (enquete_id, jogador_id, opcao)
      VALUES (?, ?, ?)
      ON CONFLICT(enquete_id, jogador_id) DO UPDATE SET
        opcao = excluded.opcao,
        votado_em = datetime('now')
    `).run(enquete.id, jogadorId, opcao);

    console.log(`🗳️ ${nome} votou: ${opcao}`);
  } catch (err) {
    console.error('Erro ao processar voto:', err);
  }
});

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