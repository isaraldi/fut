// Schema e migrações existentes, executados na mesma ordem em ambos os processos.
module.exports = function inicializarSchema(db, getConfig, setConfig) {
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

    -- um convite por mensalista que pagou o mês anterior, criado junto com a mensagem de
    -- fechamento do mensal — correlaciona a reação 👍/👎 dela naquela mensagem específica
    -- com a decisão de continuar (ou não) mensalista
    CREATE TABLE IF NOT EXISTS fechamento_mensal_convites (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        jogador_id INTEGER NOT NULL REFERENCES jogadores(id) ON DELETE CASCADE,
        message_id TEXT NOT NULL,
        mes_anterior TEXT NOT NULL,
        resposta TEXT CHECK(resposta IN ('sim', 'nao') OR resposta IS NULL),
        respondido_em TEXT,
        criado_em TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(jogador_id, message_id)
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
        conta INTEGER NOT NULL DEFAULT 0 CHECK(conta IN (0, 1)),
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

    CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tipo TEXT NOT NULL CHECK(tipo IN ('enquete', 'mensagem', 'comprovante', 'lista', 'times')),
        nivel TEXT NOT NULL DEFAULT 'sucesso' CHECK(nivel IN ('sucesso', 'aviso', 'erro')),
        mensagem TEXT NOT NULL,
        grupo_id TEXT,
        criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS envios_imediatos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        grupo_id TEXT NOT NULL,
        texto TEXT NOT NULL,
        tipo TEXT NOT NULL CHECK(tipo IN ('lista', 'times')),
        criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- mensagens privadas (DM) pras jogadoras, enfileiradas pelo painel e enviadas pelo bot
    CREATE TABLE IF NOT EXISTS mensagens_jogadoras_pendentes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        jogador_id INTEGER NOT NULL REFERENCES jogadores(id) ON DELETE CASCADE,
        texto TEXT NOT NULL,
        criado_em TEXT NOT NULL DEFAULT (datetime('now'))
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

db.exec(`CREATE TABLE IF NOT EXISTS fechamento_mensal_ciclos (
    message_id TEXT PRIMARY KEY,
    mes_anterior TEXT NOT NULL UNIQUE,
    criado_em INTEGER NOT NULL,
    prazo_em INTEGER NOT NULL
)`);

db.transaction(() => {
    const colunasConvites = db.prepare('PRAGMA table_info(fechamento_mensal_convites)').all();
    for (const [nome, definicao] of Object.entries({
        prioridade: 'INTEGER NOT NULL DEFAULT 1',
        ordem: 'INTEGER',
        aprovada: 'INTEGER NOT NULL DEFAULT 0',
        expirada: 'INTEGER NOT NULL DEFAULT 0',
    })) {
        if (!colunasConvites.some(c => c.name === nome)) db.exec(`ALTER TABLE fechamento_mensal_convites ADD COLUMN ${nome} ${definicao}`);
    }
    if (!colunasConvites.some(c => c.name === 'mensalista_referencia')) {
        db.exec('ALTER TABLE fechamento_mensal_convites ADD COLUMN mensalista_referencia INTEGER NOT NULL DEFAULT 0');
        db.exec('UPDATE fechamento_mensal_convites SET mensalista_referencia = prioridade');
    }
}).immediate();

const colunasVotosLista = db.prepare('PRAGMA table_info(votos)').all();

if (!colunasVotosLista.some(c => c.name === 'ordem_manual')) {
    db.exec('ALTER TABLE votos ADD COLUMN ordem_manual INTEGER');
}

db.exec(`CREATE TABLE IF NOT EXISTS listas_importacoes (
    message_id TEXT PRIMARY KEY,
    grupo_id TEXT NOT NULL,
    autor_id TEXT NOT NULL,
    enquete_id INTEGER NOT NULL REFERENCES enquetes(id) ON DELETE CASCADE,
    dados TEXT NOT NULL,
    estado TEXT NOT NULL DEFAULT 'pendente',
    criado_em INTEGER NOT NULL,
    expira_em INTEGER NOT NULL
)`);

db.exec(`CREATE TABLE IF NOT EXISTS whatsapp_interacoes (
    tipo TEXT NOT NULL,
    message_id TEXT NOT NULL,
    jogador_id INTEGER NOT NULL REFERENCES jogadores(id) ON DELETE CASCADE,
    conteudo TEXT,
    evento_em INTEGER,
    manual_em INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (tipo, message_id, jogador_id)
)`);

const colunasJogadores = db.prepare('PRAGMA table_info(jogadores)').all();

if (!colunasJogadores.some((c) => c.name === 'posicao')) {
    db.exec(
        "ALTER TABLE jogadores ADD COLUMN posicao TEXT NOT NULL DEFAULT 'indefinida' CHECK(posicao IN ('goleira', 'defesa', 'meio', 'ataque', 'indefinida'))",
    );
}

if (!colunasJogadores.some((c) => c.name === 'pode_comandar')) {
    db.exec('ALTER TABLE jogadores ADD COLUMN pode_comandar INTEGER NOT NULL DEFAULT 0');
}

if (!colunasJogadores.some((c) => c.name === 'ativo')) {
    db.exec('ALTER TABLE jogadores ADD COLUMN ativo INTEGER NOT NULL DEFAULT 1');
}

const colunasVotos = db.prepare('PRAGMA table_info(votos)').all();

if (!colunasVotos.some((c) => c.name === 'papel')) {
    db.exec('ALTER TABLE votos ADD COLUMN papel TEXT');
}

const colunasEnquetes = db.prepare('PRAGMA table_info(enquetes)').all();

if (!colunasEnquetes.some((c) => c.name === 'fechada_em')) {
    db.exec('ALTER TABLE enquetes ADD COLUMN fechada_em TEXT');
}

if (!colunasEnquetes.some((c) => c.name === 'desafixada_em')) {
    db.exec('ALTER TABLE enquetes ADD COLUMN desafixada_em TEXT');
}

if (!colunasEnquetes.some((c) => c.name === 'tentativas_desafixar')) {
    db.exec('ALTER TABLE enquetes ADD COLUMN tentativas_desafixar INTEGER NOT NULL DEFAULT 0');
}

if (!colunasEnquetes.some((c) => c.name === 'vagas_maximo')) {
    db.exec('ALTER TABLE enquetes ADD COLUMN vagas_maximo INTEGER');
}

if (!colunasEnquetes.some((c) => c.name === 'fechada_automaticamente')) {
    db.exec('ALTER TABLE enquetes ADD COLUMN fechada_automaticamente INTEGER NOT NULL DEFAULT 0');
}

if (!colunasEnquetes.some((c) => c.name === 'prazo_mensalista')) {
    db.exec('ALTER TABLE enquetes ADD COLUMN prazo_mensalista TEXT');
}

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

const schemaLogs = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'logs'")
    .get();

if (schemaLogs && !schemaLogs.sql.includes("'times'")) {
    db.exec(`
        CREATE TABLE logs_novo (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tipo TEXT NOT NULL CHECK(tipo IN ('enquete', 'mensagem', 'comprovante', 'lista', 'times')),
            nivel TEXT NOT NULL DEFAULT 'sucesso' CHECK(nivel IN ('sucesso', 'aviso', 'erro')),
            mensagem TEXT NOT NULL,
            grupo_id TEXT,
            criado_em TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO logs_novo SELECT * FROM logs;
        DROP TABLE logs;
        ALTER TABLE logs_novo RENAME TO logs;
    `);
}

const schemaLogsElenco = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'logs'")
    .get();

if (schemaLogsElenco && !schemaLogsElenco.sql.includes("'elenco'")) {
    db.exec(`
        CREATE TABLE logs_novo (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tipo TEXT NOT NULL CHECK(tipo IN ('enquete', 'mensagem', 'comprovante', 'lista', 'times', 'elenco')),
            nivel TEXT NOT NULL DEFAULT 'sucesso' CHECK(nivel IN ('sucesso', 'aviso', 'erro')),
            mensagem TEXT NOT NULL,
            grupo_id TEXT,
            criado_em TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO logs_novo SELECT * FROM logs;
        DROP TABLE logs;
        ALTER TABLE logs_novo RENAME TO logs;
    `);
}

const schemaOpcoes = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'enquete_opcoes'")
    .get();

if (schemaOpcoes && schemaOpcoes.sql.includes('papel')) {
    db.exec(`
        CREATE TABLE enquete_opcoes_novo (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            texto TEXT NOT NULL,
            conta INTEGER NOT NULL DEFAULT 0 CHECK(conta IN (0, 1)),
            ordem INTEGER NOT NULL DEFAULT 0
        );
        INSERT INTO enquete_opcoes_novo (id, texto, conta, ordem)
            SELECT id, texto, CASE WHEN papel IS NOT NULL THEN 1 ELSE 0 END, ordem FROM enquete_opcoes;
        DROP TABLE enquete_opcoes;
        ALTER TABLE enquete_opcoes_novo RENAME TO enquete_opcoes;
    `);
}

const totalOpcoes = db.prepare('SELECT COUNT(*) AS c FROM enquete_opcoes').get().c;

if (totalOpcoes === 0) {
    const inserirOpcao = db.prepare(
        'INSERT INTO enquete_opcoes (texto, conta, ordem) VALUES (?, ?, ?)',
    );
    inserirOpcao.run('Eu vou', 1, 0);
    inserirOpcao.run('Não vou', 0, 1);
}

db.transaction(() => {
    if (getConfig('mensal_calendario_v2') !== '1') {
        if (getConfig('enquete_dia_semana') === '3') setConfig('enquete_dia_semana', '4');
        if (getConfig('enquete_titulo_template') === 'JOGO DE QUARTA - {data}') setConfig('enquete_titulo_template', 'JOGO DE {dia} - {data}');
        db.prepare(`INSERT OR IGNORE INTO fechamento_mensal_ciclos
            SELECT message_id, mes_anterior, CAST(strftime('%s', MIN(criado_em)) AS INTEGER) * 1000,
                CAST(strftime('%s', MIN(criado_em)) AS INTEGER) * 1000 + ?
            FROM fechamento_mensal_convites GROUP BY message_id, mes_anterior ORDER BY MIN(criado_em) DESC`)
            .run((parseInt(getConfig('fechamento_mensal_prazo_horas'), 10) || 36) * 3600000);
        setConfig('mensal_calendario_v2', '1');
    }
}).immediate();

if (getConfig('whatsapp_interacoes_v1') !== '1') {
    db.transaction(() => {
        db.prepare(`UPDATE fechamento_mensal_convites SET expirada = 1
            WHERE resposta = 'nao' AND prioridade = 1 AND EXISTS (
                SELECT 1 FROM fechamento_mensal_ciclos c WHERE c.message_id = fechamento_mensal_convites.message_id
                AND (julianday(respondido_em) - 2440587.5) * 86400000 >= c.prazo_em
            )`).run();
        setConfig('whatsapp_interacoes_v1', '1');
    }).immediate();
}

db.exec(`CREATE TABLE IF NOT EXISTS caixa_lancamentos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    data TEXT NOT NULL,
    tipo TEXT NOT NULL CHECK(tipo IN ('entrada', 'gasto', 'inicial')),
    valor_centavos INTEGER NOT NULL,
    descricao TEXT NOT NULL,
    categoria TEXT NOT NULL,
    origem TEXT UNIQUE,
    criado_em TEXT NOT NULL DEFAULT (datetime('now')),
    cancelado_em TEXT
);
CREATE INDEX IF NOT EXISTS caixa_data ON caixa_lancamentos(data, id);`);

db.exec(`CREATE TABLE IF NOT EXISTS pagamentos_historico (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    jogador_id INTEGER NOT NULL,
    nome TEXT NOT NULL,
    tipo TEXT NOT NULL CHECK(tipo IN ('mensal', 'avulso')),
    referencia TEXT NOT NULL,
    jogo TEXT,
    pago INTEGER NOT NULL,
    origem TEXT NOT NULL CHECK(origem IN ('manual', 'comprovante', 'anterior')),
    valor_centavos INTEGER,
    registrado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS pagamentos_historico_data ON pagamentos_historico(registrado_em, id);`);

db.transaction(() => {
    if (getConfig('pagamentos_historico_v1') === '1') return;
    db.prepare(`INSERT INTO pagamentos_historico
        (jogador_id, nome, tipo, referencia, pago, origem, registrado_em)
        SELECT p.jogador_id, j.nome, 'mensal', p.mes_referencia, p.pago, 'anterior', p.atualizado_em
        FROM pagamentos p JOIN jogadores j ON j.id = p.jogador_id`).run();
    db.prepare(`INSERT INTO pagamentos_historico
        (jogador_id, nome, tipo, referencia, jogo, pago, origem, registrado_em)
        SELECT p.jogador_id, j.nome, 'avulso', CAST(p.enquete_id AS TEXT), e.titulo, p.pago, 'anterior', p.atualizado_em
        FROM pagamentos_avulsos p JOIN jogadores j ON j.id = p.jogador_id JOIN enquetes e ON e.id = p.enquete_id`).run();
    setConfig('pagamentos_historico_v1', '1');
}).immediate();
};
