const path = require('path');
const Database = require('better-sqlite3');

const db = new Database(path.join(__dirname, 'data', 'fut.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
    CREATE TABLE IF NOT EXISTS jogadores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT NOT NULL,
        whatsapp_id TEXT UNIQUE,
        telefone TEXT,
        nivel INTEGER NOT NULL DEFAULT 3,
        papel TEXT NOT NULL DEFAULT 'avulso' CHECK(papel IN ('mensalista', 'avulso')),
        posicao TEXT NOT NULL DEFAULT 'indefinida' CHECK(posicao IN ('goleira', 'defesa', 'meio', 'ataque', 'indefinida')),
        criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS enquetes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id TEXT UNIQUE NOT NULL,
        group_id TEXT NOT NULL,
        titulo TEXT NOT NULL,
        criada_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS votos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        enquete_id INTEGER NOT NULL REFERENCES enquetes(id) ON DELETE CASCADE,
        jogador_id INTEGER NOT NULL REFERENCES jogadores(id) ON DELETE CASCADE,
        opcao TEXT NOT NULL,
        votado_em TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(enquete_id, jogador_id)
    );

    CREATE TABLE IF NOT EXISTS pagamentos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        jogador_id INTEGER NOT NULL REFERENCES jogadores(id) ON DELETE CASCADE,
        mes_referencia TEXT NOT NULL,
        pago INTEGER NOT NULL DEFAULT 0,
        atualizado_em TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(jogador_id, mes_referencia)
    );

    CREATE TABLE IF NOT EXISTS pagamentos_avulsos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        jogador_id INTEGER NOT NULL REFERENCES jogadores(id) ON DELETE CASCADE,
        enquete_id INTEGER NOT NULL REFERENCES enquetes(id) ON DELETE CASCADE,
        pago INTEGER NOT NULL DEFAULT 0,
        atualizado_em TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(jogador_id, enquete_id)
    );

    CREATE TABLE IF NOT EXISTS admin_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        usuario TEXT UNIQUE NOT NULL,
        senha_hash TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS configuracoes (
        chave TEXT PRIMARY KEY,
        valor TEXT
    );

    CREATE TABLE IF NOT EXISTS enquete_opcoes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        texto TEXT NOT NULL,
        papel TEXT CHECK(papel IN ('mensalista', 'avulso') OR papel IS NULL),
        ordem INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS papel_historico (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        jogador_id INTEGER NOT NULL REFERENCES jogadores(id) ON DELETE CASCADE,
        papel_anterior TEXT,
        papel_novo TEXT NOT NULL,
        alterado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
        sid TEXT PRIMARY KEY,
        dados TEXT NOT NULL,
        expira_em INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS grupos (
        whatsapp_id TEXT PRIMARY KEY,
        nome TEXT NOT NULL,
        atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS avaliacoes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        enquete_id INTEGER NOT NULL REFERENCES enquetes(id) ON DELETE CASCADE,
        jogador_id INTEGER NOT NULL REFERENCES jogadores(id) ON DELETE CASCADE,
        avaliador_id INTEGER NOT NULL REFERENCES jogadores(id) ON DELETE CASCADE,
        nota INTEGER NOT NULL CHECK(nota BETWEEN 1 AND 5),
        criado_em TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(enquete_id, jogador_id, avaliador_id)
    );
`);

// migração leve: jogadores.posicao (times criados antes desse recurso não têm a coluna)
const colunasJogadores = db.prepare('PRAGMA table_info(jogadores)').all();
if (!colunasJogadores.some((c) => c.name === 'posicao')) {
    db.exec(
        "ALTER TABLE jogadores ADD COLUMN posicao TEXT NOT NULL DEFAULT 'indefinida' CHECK(posicao IN ('goleira', 'defesa', 'meio', 'ataque', 'indefinida'))",
    );
}

// migração leve: votos.papel (denormalizado no momento do voto,
// pra não depender de enquete_opcoes que pode mudar depois)
const colunasVotos = db.prepare('PRAGMA table_info(votos)').all();
if (!colunasVotos.some((c) => c.name === 'papel')) {
    db.exec('ALTER TABLE votos ADD COLUMN papel TEXT');
}

// mensagens_agendadas: recria do zero se ainda for o shape antigo (só data específica) —
// tabela nova, sem dados em produção, então é mais simples que uma migração incremental
const tabelaMensagensExiste = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'mensagens_agendadas'")
    .get();
if (tabelaMensagensExiste) {
    const colunasMensagens = db.prepare('PRAGMA table_info(mensagens_agendadas)').all();
    if (!colunasMensagens.some((c) => c.name === 'tipo')) {
        db.exec('DROP TABLE mensagens_agendadas');
    }
}
db.exec(`
    CREATE TABLE IF NOT EXISTS mensagens_agendadas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        grupo_id TEXT NOT NULL,
        texto TEXT NOT NULL,
        tipo TEXT NOT NULL DEFAULT 'unica' CHECK(tipo IN ('unica', 'semanal')),
        enviar_em TEXT, -- usado quando tipo='unica': 'YYYY-MM-DD HH:MM' local (America/Sao_Paulo)
        dia_semana INTEGER, -- usado quando tipo='semanal': 0=domingo ... 6=sábado
        hora TEXT, -- usado quando tipo='semanal': 'HH:MM'
        ultimo_envio TEXT, -- usado quando tipo='semanal': data local do último disparo, evita duplicar
        enviada_em TEXT, -- usado quando tipo='unica': quando foi enviada
        criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    )
`);

// seed das opções padrão (mesmas que já estavam fixas no código)
const totalOpcoes = db.prepare('SELECT COUNT(*) AS c FROM enquete_opcoes').get().c;
if (totalOpcoes === 0) {
    const inserirOpcao = db.prepare(
        'INSERT INTO enquete_opcoes (texto, papel, ordem) VALUES (?, ?, ?)',
    );
    inserirOpcao.run('Eu vou (MENSALISTAS)', 'mensalista', 0);
    inserirOpcao.run('Não vou (MENSALISTAS)', null, 1);
    inserirOpcao.run('Eu quero (AVULSAS)', 'avulso', 2);
}

const DEFAULT_CONFIG = {
    enquete_titulo_template: 'JOGO DE QUARTA - {data}',
    elenco_auto_incluir_grupo: '0',
    enquete_dia_semana: '3', // dia do JOGO: 0=domingo ... 6=sábado (3=quarta, mantém o padrão atual) — usado nos tokens {data}/{dia}/{hora} do título
    enquete_hora: '20:00', // horário do JOGO
    enquete_auto_enviar: '0',
    enquete_envio_dia_semana: '1', // dia em que a ENQUETE é disparada (independente do dia do jogo)
    enquete_envio_hora: '09:00', // horário em que a ENQUETE é disparada
    enquete_grupo_id: '', // preenchido automaticamente na 1ª vez que alguém manda !enquete no grupo
};

function getConfig(chave) {
    const row = db
        .prepare('SELECT valor FROM configuracoes WHERE chave = ?')
        .get(chave);
    if (row) return row.valor;
    return DEFAULT_CONFIG[chave] ?? null;
}

function setConfig(chave, valor) {
    db.prepare(
        `INSERT INTO configuracoes (chave, valor) VALUES (?, ?)
         ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor`,
    ).run(chave, valor);
}

// registra/atualiza um grupo do WhatsApp que o bot conhece, pra aparecer como opção
// no seletor de "pra qual grupo mandar a enquete automática" no painel
function upsertGrupo(whatsappId, nome) {
    db.prepare(
        `INSERT INTO grupos (whatsapp_id, nome, atualizado_em) VALUES (?, ?, datetime('now'))
         ON CONFLICT(whatsapp_id) DO UPDATE SET nome = excluded.nome, atualizado_em = datetime('now')`,
    ).run(whatsappId, nome);
}

function getGrupos() {
    return db.prepare('SELECT * FROM grupos ORDER BY nome ASC').all();
}

function getEnqueteOpcoes() {
    return db
        .prepare('SELECT * FROM enquete_opcoes ORDER BY ordem ASC, id ASC')
        .all();
}

function criarMensagemUnica(grupoId, texto, enviarEm) {
    db.prepare(
        `INSERT INTO mensagens_agendadas (grupo_id, texto, tipo, enviar_em) VALUES (?, ?, 'unica', ?)`,
    ).run(grupoId, texto, enviarEm);
}

function criarMensagemSemanal(grupoId, texto, diaSemana, hora) {
    db.prepare(
        `INSERT INTO mensagens_agendadas (grupo_id, texto, tipo, dia_semana, hora) VALUES (?, ?, 'semanal', ?, ?)`,
    ).run(grupoId, texto, diaSemana, hora);
}

function getMensagensAgendadas() {
    return db
        .prepare(
            `SELECT m.*, g.nome AS grupo_nome
             FROM mensagens_agendadas m
             LEFT JOIN grupos g ON g.whatsapp_id = m.grupo_id
             ORDER BY m.tipo ASC, m.enviar_em DESC, m.dia_semana ASC`,
        )
        .all();
}

// mensagens únicas pendentes cujo horário já chegou (comparação por string funciona
// porque 'YYYY-MM-DD HH:MM' é ordenável lexicograficamente)
function getMensagensUnicasParaEnviar() {
    const agora = new Date();
    const agoraLocal = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}-${String(agora.getDate()).padStart(2, '0')} ${String(agora.getHours()).padStart(2, '0')}:${String(agora.getMinutes()).padStart(2, '0')}`;
    return db
        .prepare(
            `SELECT * FROM mensagens_agendadas
             WHERE tipo = 'unica' AND enviada_em IS NULL AND enviar_em <= ?
             ORDER BY enviar_em ASC`,
        )
        .all(agoraLocal);
}

function getMensagensSemanais() {
    return db.prepare(`SELECT * FROM mensagens_agendadas WHERE tipo = 'semanal'`).all();
}

function marcarMensagemEnviada(id) {
    db.prepare(
        `UPDATE mensagens_agendadas SET enviada_em = datetime('now') WHERE id = ?`,
    ).run(id);
}

function marcarMensagemSemanalEnviada(id, dataLocal) {
    db.prepare(
        'UPDATE mensagens_agendadas SET ultimo_envio = ? WHERE id = ?',
    ).run(dataLocal, id);
}

function excluirMensagemAgendada(id) {
    db.prepare('DELETE FROM mensagens_agendadas WHERE id = ?').run(id);
}

function registrarMudancaPapel(jogadorId, papelAnterior, papelNovo) {
    db.prepare(
        'INSERT INTO papel_historico (jogador_id, papel_anterior, papel_novo) VALUES (?, ?, ?)',
    ).run(jogadorId, papelAnterior, papelNovo);
}

function getPapelHistorico(jogadorId) {
    return db
        .prepare(
            'SELECT * FROM papel_historico WHERE jogador_id = ? ORDER BY alterado_em DESC, id DESC',
        )
        .all(jogadorId);
}

// jogadoras que confirmaram presença (papel preenchido) num jogo específico,
// usadas tanto pro sorteio de times quanto pra tela pública de avaliação pós-jogo
function getConfirmadosDaEnquete(enqueteId) {
    return db
        .prepare(
            `SELECT j.id, j.nome, j.nivel, j.papel, j.posicao
             FROM votos v
             JOIN jogadores j ON j.id = v.jogador_id
             WHERE v.enquete_id = ? AND v.papel IS NOT NULL
             ORDER BY j.nome ASC`,
        )
        .all(enqueteId);
}

// todas as notas já registradas num jogo, pra pré-preencher o formulário de quem já votou
function getAvaliacoesDaEnquete(enqueteId) {
    return db
        .prepare('SELECT jogador_id, avaliador_id, nota FROM avaliacoes WHERE enquete_id = ?')
        .all(enqueteId);
}

// nível = média (arredondada, entre 1 e 5) de todas as notas recebidas pela jogadora até hoje
function recalcularNivel(jogadorId) {
    const { media } = db
        .prepare('SELECT AVG(nota) AS media FROM avaliacoes WHERE jogador_id = ?')
        .get(jogadorId);
    if (media == null) return;

    const nivel = Math.min(5, Math.max(1, Math.round(media)));
    db.prepare('UPDATE jogadores SET nivel = ? WHERE id = ?').run(nivel, jogadorId);
}

// registra (ou atualiza, se a mesma pessoa já avaliou essa jogadora nesse jogo) uma nota
// de 1 a 5 e recalcula o nível da jogadora avaliada
function registrarAvaliacao(enqueteId, jogadorId, avaliadorId, nota) {
    db.prepare(
        `INSERT INTO avaliacoes (enquete_id, jogador_id, avaliador_id, nota)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(enquete_id, jogador_id, avaliador_id) DO UPDATE SET
             nota = excluded.nota,
             criado_em = datetime('now')`,
    ).run(enqueteId, jogadorId, avaliadorId, nota);

    recalcularNivel(jogadorId);
}

// remove emojis, seletores de variação, ZWJ e modificadores de tom de pele do nome
// vindo do WhatsApp; se sobrar vazio (nome só com emoji), cai no fallback "Jogador"
function limparNome(nome) {
    const limpo = String(nome || '')
        .replace(/\p{Extended_Pictographic}/gu, '')
        .replace(/[\u{1F3FB}-\u{1F3FF}\u{FE0F}\u{200D}]/gu, '')
        .replace(/\s+/g, ' ')
        .trim();
    return limpo || 'Jogador';
}

function upsertJogador(whatsappId, nome, papelSugerido, telefone) {
    const existente = db
        .prepare('SELECT id, telefone FROM jogadores WHERE whatsapp_id = ?')
        .get(whatsappId);

    if (existente) {
        // nome não é sincronizado depois da primeira importação — só a criação pega do
        // WhatsApp, edição manual no painel não pode ser sobrescrita depois.
        // telefone segue a mesma lógica: só preenche se ainda não tiver.
        if (telefone && !existente.telefone) {
            db.prepare('UPDATE jogadores SET telefone = ? WHERE id = ?').run(
                telefone,
                existente.id,
            );
        }
        return existente.id;
    }

    const papelInicial = papelSugerido || 'avulso';
    const info = db
        .prepare(
            'INSERT INTO jogadores (nome, whatsapp_id, telefone, papel) VALUES (?, ?, ?, ?)',
        )
        .run(limparNome(nome), whatsappId, telefone || null, papelInicial);
    registrarMudancaPapel(info.lastInsertRowid, null, papelInicial);
    return info.lastInsertRowid;
}

module.exports = {
    db,
    upsertJogador,
    getConfig,
    setConfig,
    upsertGrupo,
    getGrupos,
    getEnqueteOpcoes,
    criarMensagemUnica,
    criarMensagemSemanal,
    getMensagensAgendadas,
    getMensagensUnicasParaEnviar,
    getMensagensSemanais,
    marcarMensagemEnviada,
    marcarMensagemSemanalEnviada,
    excluirMensagemAgendada,
    registrarMudancaPapel,
    getPapelHistorico,
    getConfirmadosDaEnquete,
    getAvaliacoesDaEnquete,
    registrarAvaliacao,
};
