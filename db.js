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
`);

// migração leve: votos.papel (denormalizado no momento do voto,
// pra não depender de enquete_opcoes que pode mudar depois)
const colunasVotos = db.prepare('PRAGMA table_info(votos)').all();
if (!colunasVotos.some((c) => c.name === 'papel')) {
    db.exec('ALTER TABLE votos ADD COLUMN papel TEXT');
}

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
    enquete_dia_semana: '3', // 0=domingo ... 6=sábado (3=quarta, mantém o padrão atual)
    enquete_hora: '20:00',
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

function getEnqueteOpcoes() {
    return db
        .prepare('SELECT * FROM enquete_opcoes ORDER BY ordem ASC, id ASC')
        .all();
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

function upsertJogador(whatsappId, nome, papelSugerido, telefone) {
    const existente = db
        .prepare('SELECT id, telefone FROM jogadores WHERE whatsapp_id = ?')
        .get(whatsappId);

    if (existente) {
        // só preenche telefone se ainda não tiver (autofill não sobrescreve edição manual)
        if (telefone && !existente.telefone) {
            db.prepare(
                'UPDATE jogadores SET nome = ?, telefone = ? WHERE id = ?',
            ).run(nome, telefone, existente.id);
        } else {
            db.prepare('UPDATE jogadores SET nome = ? WHERE id = ?').run(
                nome,
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
        .run(nome, whatsappId, telefone || null, papelInicial);
    registrarMudancaPapel(info.lastInsertRowid, null, papelInicial);
    return info.lastInsertRowid;
}

module.exports = {
    db,
    upsertJogador,
    getConfig,
    setConfig,
    getEnqueteOpcoes,
    registrarMudancaPapel,
    getPapelHistorico,
};
