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

// migração leve: jogadores.pode_comandar — whitelist de quem pode usar comandos do bot no
// WhatsApp (!fechar, !enquete, etc). Começa desligado pra todo mundo, inclusive quem já
// estava cadastrado — precisa liberar manualmente no painel depois de subir essa versão
if (!colunasJogadores.some((c) => c.name === 'pode_comandar')) {
    db.exec('ALTER TABLE jogadores ADD COLUMN pode_comandar INTEGER NOT NULL DEFAULT 0');
}

// migração leve: jogadores.ativo — marcado automaticamente pela sincronização de elenco
// (quem some dos participantes do grupo sincronizado vira inativa, nunca é excluída, pra não
// perder o histórico de pagamentos/presença). Começa ativo pra todo mundo que já existia
if (!colunasJogadores.some((c) => c.name === 'ativo')) {
    db.exec('ALTER TABLE jogadores ADD COLUMN ativo INTEGER NOT NULL DEFAULT 1');
}

// migração leve: votos.papel (denormalizado no momento do voto,
// pra não depender de enquete_opcoes que pode mudar depois)
const colunasVotos = db.prepare('PRAGMA table_info(votos)').all();
if (!colunasVotos.some((c) => c.name === 'papel')) {
    db.exec('ALTER TABLE votos ADD COLUMN papel TEXT');
}

// migração leve: enquetes.fechada_em/desafixada_em — controla o "fechamento" manual da
// lista (o WhatsApp não tem API pra travar uma enquete nativa contra novos votos)
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
// migração leve: enquetes.vagas_maximo — snapshot do limite configurado no momento em que a
// enquete foi criada. Não lê o config ao vivo pra não reescrever quem "jogou" em jogos passados
// se o limite for alterado depois no painel.
if (!colunasEnquetes.some((c) => c.name === 'vagas_maximo')) {
    db.exec('ALTER TABLE enquetes ADD COLUMN vagas_maximo INTEGER');
}
// migração leve: enquetes.fechada_automaticamente/prazo_mensalista — controla o fechamento
// sozinho quando as vagas enchem. fechada_automaticamente distingue de um !fechar manual (só
// o fechamento automático reage a desistência depois, promovendo a lista de espera ou
// reabrindo). prazo_mensalista é o prazo travado no momento da criação da enquete
if (!colunasEnquetes.some((c) => c.name === 'fechada_automaticamente')) {
    db.exec('ALTER TABLE enquetes ADD COLUMN fechada_automaticamente INTEGER NOT NULL DEFAULT 0');
}
if (!colunasEnquetes.some((c) => c.name === 'prazo_mensalista')) {
    db.exec('ALTER TABLE enquetes ADD COLUMN prazo_mensalista TEXT');
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

// migração leve: logs.tipo precisa aceitar 'lista' e 'times' também — já existem linhas em
// produção, então preserva os dados (SQLite não altera CHECK constraint direto, precisa
// recriar a tabela)
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

// migração leve: logs.tipo precisa aceitar 'elenco' também (sincronização disparada pelo painel)
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
    bot_reinicio_ultimo: '', // data (YYYY-MM-DD) do último reinício diário agendado da sessão do WhatsApp
    enquete_solicitar_envio: '0', // '1' = botão "Enviar agora" do painel pediu pra abrir a enquete
    valor_mensal: '', // valor (R$) da mensalidade — usado pra reconhecer comprovantes automaticamente
    valor_avulso: '', // valor (R$) do avulso — idem
    jogo_vagas_maximo: '', // nº máximo de jogadoras no jogo — vazio = sem limite. Snapshot em enquetes.vagas_maximo na criação
    sincronizar_grupo_pendente: '', // whatsapp_id do grupo que o botão do painel pediu pra sincronizar agora
    fechamento_automatico_ativo: '0', // '1' = fecha a lista sozinha quando as vagas encherem
    mensalista_prazo_dia_semana: '2', // prazo pra mensalista confirmar: dia da semana (2 = terça)
    mensalista_prazo_hora: '18:00', // prazo pra mensalista confirmar: horário
    fechamento_mensal_ativo: '0', // '1' = manda a mensagem de fechamento do mensal automaticamente
    fechamento_mensal_mensagem: 'O mensal de {mes_anterior} fechou! 💰\n\nQuem quer continuar mensalista, reaja 👍 nessa mensagem. Quem não reagir 👍 libera a vaga pra uma nova mensalista.\n\nMensalistas de {mes_anterior}:\n{mensalistas_mes_anterior}\n\n*Valor da mensalidade ({mes_atual}):* {valor_mensal}\n*Pague até {data_limite_pagamento}*',
    fechamento_mensal_ultimo_envio: '', // data (YYYY-MM-DD) do último envio, evita duplicar no mesmo dia
    pagamento_dia_limite: '7', // dia do mês (1-31) até quando a mensalidade deve ser paga — token {data_limite_pagamento}
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

// registra um evento (enquete/mensagem/comprovante) pra tela de Logs do painel.
// mantém só os últimos 1000 registros, pra não crescer pra sempre
function registrarLog(tipo, nivel, mensagem, grupoId = null) {
    db.prepare(
        'INSERT INTO logs (tipo, nivel, mensagem, grupo_id) VALUES (?, ?, ?, ?)',
    ).run(tipo, nivel, mensagem, grupoId);
    db.prepare(
        'DELETE FROM logs WHERE id NOT IN (SELECT id FROM logs ORDER BY id DESC LIMIT 1000)',
    ).run();
}

function getLogs(tipo, limite = 200) {
    const query = tipo
        ? db.prepare(
              `SELECT l.*, g.nome AS grupo_nome FROM logs l
               LEFT JOIN grupos g ON g.whatsapp_id = l.grupo_id
               WHERE l.tipo = ? ORDER BY l.id DESC LIMIT ?`,
          )
        : db.prepare(
              `SELECT l.*, g.nome AS grupo_nome FROM logs l
               LEFT JOIN grupos g ON g.whatsapp_id = l.grupo_id
               ORDER BY l.id DESC LIMIT ?`,
          );
    return tipo ? query.all(tipo, limite) : query.all(limite);
}

// fila de "manda isso pro grupo assim que puder" — usada pelos botões do painel (que roda num
// processo separado do bot, sem acesso direto ao client do WhatsApp). O bot confere essa fila
// junto com o resto a cada minuto.
function criarEnvioImediato(grupoId, texto, tipo) {
    db.prepare(
        'INSERT INTO envios_imediatos (grupo_id, texto, tipo) VALUES (?, ?, ?)',
    ).run(grupoId, texto, tipo);
}

function getEnviosImediatosPendentes() {
    return db.prepare('SELECT * FROM envios_imediatos ORDER BY id ASC').all();
}

function removerEnvioImediato(id) {
    db.prepare('DELETE FROM envios_imediatos WHERE id = ?').run(id);
}

// fecha a lista: novos votos (ou mudanças de voto) da enquete passam a ser ignorados.
// idempotente — chamar duas vezes não perde a data original do fechamento
function fecharEnquete(enqueteId) {
    db.prepare(
        `UPDATE enquetes SET fechada_em = datetime('now') WHERE id = ? AND fechada_em IS NULL`,
    ).run(enqueteId);
}

// enquetes fechadas mas que ainda não foram desafixadas do grupo — o bot confere isso
// periodicamente, porque fechar pelo painel não tem acesso direto ao client do WhatsApp
function getEnquetesFechadasNaoDesafixadas() {
    return db
        .prepare('SELECT * FROM enquetes WHERE fechada_em IS NOT NULL AND desafixada_em IS NULL')
        .all();
}

function marcarEnqueteDesafixada(enqueteId) {
    db.prepare(
        `UPDATE enquetes SET desafixada_em = datetime('now') WHERE id = ?`,
    ).run(enqueteId);
}

function registrarTentativaDesafixar(enqueteId) {
    db.prepare(
        'UPDATE enquetes SET tentativas_desafixar = tentativas_desafixar + 1 WHERE id = ?',
    ).run(enqueteId);
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

function getMensagemAgendada(id) {
    return db.prepare('SELECT * FROM mensagens_agendadas WHERE id = ?').get(id);
}

// edição sempre volta o agendamento pro estado "pendente" (mesmo que já tivesse sido
// enviado) — editar significa reconfigurar quando/o quê deve ser mandado
function atualizarMensagemUnica(id, grupoId, texto, enviarEm) {
    db.prepare(
        `UPDATE mensagens_agendadas
         SET grupo_id = ?, texto = ?, tipo = 'unica', enviar_em = ?,
             dia_semana = NULL, hora = NULL, ultimo_envio = NULL, enviada_em = NULL
         WHERE id = ?`,
    ).run(grupoId, texto, enviarEm, id);
}

function atualizarMensagemSemanal(id, grupoId, texto, diaSemana, hora) {
    db.prepare(
        `UPDATE mensagens_agendadas
         SET grupo_id = ?, texto = ?, tipo = 'semanal', dia_semana = ?, hora = ?,
             enviar_em = NULL, ultimo_envio = NULL, enviada_em = NULL
         WHERE id = ?`,
    ).run(grupoId, texto, diaSemana, hora, id);
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

// marca (só liga, nunca desliga) o pagamento da mensalidade de um mês — usado tanto pelo
// toggle manual do painel quanto pela leitura automática de comprovante no grupo
function marcarPagamentoMensalista(jogadorId, mesReferencia) {
    const atual = db
        .prepare('SELECT * FROM pagamentos WHERE jogador_id = ? AND mes_referencia = ?')
        .get(jogadorId, mesReferencia);

    if (atual) {
        if (!atual.pago) {
            db.prepare(
                "UPDATE pagamentos SET pago = 1, atualizado_em = datetime('now') WHERE id = ?",
            ).run(atual.id);
        }
    } else {
        db.prepare(
            'INSERT INTO pagamentos (jogador_id, mes_referencia, pago) VALUES (?, ?, 1)',
        ).run(jogadorId, mesReferencia);
    }
}

// mensalistas que pagaram um mês de referência — base tanto do token {mensalistas_mes_anterior}
// quanto da lista de convidadas a renovar no fechamento do mensal
function getMensalistasPagos(mesReferencia) {
    return db
        .prepare(
            `SELECT j.id, j.nome FROM jogadores j
             JOIN pagamentos p ON p.jogador_id = j.id
             WHERE j.papel = 'mensalista' AND p.mes_referencia = ? AND p.pago = 1
             ORDER BY j.nome ASC`,
        )
        .all(mesReferencia);
}

// cria o convite de renovação de uma mensalista pra uma mensagem de fechamento específica —
// 1 linha por (jogador, mensagem), correlacionada depois pela reação 👍/👎 dela na mensagem
function criarConviteFechamentoMensal(jogadorId, messageId, mesAnteriorRef) {
    db.prepare(
        'INSERT INTO fechamento_mensal_convites (jogador_id, message_id, mes_anterior) VALUES (?, ?, ?)',
    ).run(jogadorId, messageId, mesAnteriorRef);
}

// localiza o convite de uma jogadora numa mensagem específica — usado pra confirmar que a
// reação recebida é realmente sobre a mensagem de fechamento do mensal e sobre uma jogadora
// que foi de fato convidada (não qualquer reação aleatória de qualquer pessoa no grupo)
function getConviteFechamentoMensal(messageId, jogadorId) {
    return db
        .prepare('SELECT * FROM fechamento_mensal_convites WHERE message_id = ? AND jogador_id = ?')
        .get(messageId, jogadorId);
}

function registrarRespostaConviteFechamentoMensal(id, resposta) {
    db.prepare(
        `UPDATE fechamento_mensal_convites SET resposta = ?, respondido_em = datetime('now') WHERE id = ?`,
    ).run(resposta, id);
}

// muda o papel de uma jogadora e registra no histórico — só escreve/loga se o papel
// realmente mudou, devolve true nesse caso (idempotente: reagir de novo com o mesmo emoji
// não gera mudança nem entrada duplicada no histórico)
function definirPapelJogador(jogadorId, papelNovo) {
    const atual = db.prepare('SELECT papel FROM jogadores WHERE id = ?').get(jogadorId);
    if (!atual || atual.papel === papelNovo) return false;
    db.prepare('UPDATE jogadores SET papel = ? WHERE id = ?').run(papelNovo, jogadorId);
    registrarMudancaPapel(jogadorId, atual.papel, papelNovo);
    return true;
}

// mesma ideia, mas pro pagamento avulso de um jogo específico
function marcarPagamentoAvulso(jogadorId, enqueteId) {
    const atual = db
        .prepare('SELECT * FROM pagamentos_avulsos WHERE jogador_id = ? AND enquete_id = ?')
        .get(jogadorId, enqueteId);

    if (atual) {
        if (!atual.pago) {
            db.prepare(
                "UPDATE pagamentos_avulsos SET pago = 1, atualizado_em = datetime('now') WHERE id = ?",
            ).run(atual.id);
        }
    } else {
        db.prepare(
            'INSERT INTO pagamentos_avulsos (jogador_id, enquete_id, pago) VALUES (?, ?, 1)',
        ).run(jogadorId, enqueteId);
    }
}

function getJogadorPorWhatsappId(whatsappId) {
    return db.prepare('SELECT * FROM jogadores WHERE whatsapp_id = ?').get(whatsappId);
}

// whitelist de comandos — só quem tem pode_comandar = 1 consegue usar !fechar, !enquete etc
function podeUsarComandos(whatsappId) {
    const jogador = db
        .prepare('SELECT pode_comandar FROM jogadores WHERE whatsapp_id = ?')
        .get(whatsappId);
    return !!(jogador && jogador.pode_comandar);
}

function getJogadoresParaPermissao() {
    return db
        .prepare('SELECT id, nome, telefone, pode_comandar FROM jogadores ORDER BY nome ASC')
        .all();
}

function definirPermissaoComando(jogadorId, pode) {
    db.prepare('UPDATE jogadores SET pode_comandar = ? WHERE id = ?').run(pode ? 1 : 0, jogadorId);
}

function reativarJogador(jogadorId) {
    db.prepare('UPDATE jogadores SET ativo = 1 WHERE id = ?').run(jogadorId);
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

// separa quem votou (papel preenchido) em "tem vaga" x "lista de espera", respeitando o
// limite de vagas travado na própria enquete (enquetes.vagas_maximo). Mensalista sempre tem
// prioridade sobre avulso pra alocação de vaga; dentro do mesmo grupo, quem confirmou
// primeiro fica com a vaga. Isso decide QUEM entra — a EXIBIÇÃO é outra regra (ver abaixo)
function separarConfirmadosPorVagas(enqueteId) {
    const todos = db
        .prepare(
            `SELECT j.id, j.nome, j.nivel, j.posicao, v.papel, v.votado_em
             FROM votos v
             JOIN jogadores j ON j.id = v.jogador_id
             WHERE v.enquete_id = ? AND v.papel IS NOT NULL`,
        )
        .all(enqueteId);

    const { vagas_maximo: vagasMaximo } =
        db.prepare('SELECT vagas_maximo FROM enquetes WHERE id = ?').get(enqueteId) || {};

    const porNome = (a, b) => a.nome.localeCompare(b.nome, 'pt-BR');
    const porOrdemDeChegada = (a, b) => a.votado_em.localeCompare(b.votado_em);

    // exibição: mensalistas sempre em ordem alfabética; avulsas sempre por ordem de
    // confirmação na enquete (e a lista de espera herda essa mesma ordem, automaticamente)
    const paraExibicao = (lista) => [
        ...lista.filter((j) => j.papel === 'mensalista').sort(porNome),
        ...lista.filter((j) => j.papel === 'avulso').sort(porOrdemDeChegada),
    ];

    if (!vagasMaximo) {
        return { dentro: paraExibicao(todos), fora: [] };
    }

    // alocação das vagas: sempre por ordem de chegada, mensalista primeiro
    const fila = [
        ...todos.filter((j) => j.papel === 'mensalista').sort(porOrdemDeChegada),
        ...todos.filter((j) => j.papel === 'avulso').sort(porOrdemDeChegada),
    ];

    return {
        dentro: paraExibicao(fila.slice(0, vagasMaximo)),
        fora: paraExibicao(fila.slice(vagasMaximo)),
    };
}

// jogadoras que confirmaram presença E têm vaga garantida — usadas tanto pro sorteio de times
// quanto pra tela pública de avaliação pós-jogo e pra cobrança de pagamento avulso
function getConfirmadosDaEnquete(enqueteId) {
    return separarConfirmadosPorVagas(enqueteId).dentro;
}

// quem confirmou mas ficou de fora por causa do limite de vagas (só entra se alguém da lista
// de confirmados sair)
function getListaDeEsperaDaEnquete(enqueteId) {
    return separarConfirmadosPorVagas(enqueteId).fora;
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
    registrarLog,
    getLogs,
    criarEnvioImediato,
    getEnviosImediatosPendentes,
    removerEnvioImediato,
    fecharEnquete,
    getEnquetesFechadasNaoDesafixadas,
    marcarEnqueteDesafixada,
    registrarTentativaDesafixar,
    getEnqueteOpcoes,
    criarMensagemUnica,
    criarMensagemSemanal,
    getMensagemAgendada,
    atualizarMensagemUnica,
    atualizarMensagemSemanal,
    getMensagensAgendadas,
    getMensagensUnicasParaEnviar,
    getMensagensSemanais,
    marcarMensagemEnviada,
    marcarMensagemSemanalEnviada,
    excluirMensagemAgendada,
    marcarPagamentoMensalista,
    marcarPagamentoAvulso,
    getMensalistasPagos,
    criarConviteFechamentoMensal,
    getConviteFechamentoMensal,
    registrarRespostaConviteFechamentoMensal,
    definirPapelJogador,
    getJogadorPorWhatsappId,
    podeUsarComandos,
    getJogadoresParaPermissao,
    definirPermissaoComando,
    reativarJogador,
    registrarMudancaPapel,
    getPapelHistorico,
    getConfirmadosDaEnquete,
    getListaDeEsperaDaEnquete,
    getAvaliacoesDaEnquete,
    registrarAvaliacao,
};
