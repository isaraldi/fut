const { TEMPLATE_LISTA_CONFIRMADA_PADRAO, TEMPLATE_LISTA_ATUAL_PADRAO, TEMPLATE_LISTA_ESPERA_PADRAO, TEMPLATE_TIMES_PADRAO } = require('../utils/mensagens-prontas');

const DEFAULT_CONFIG = {
    lista_importacao_prazo_minutos: '10',
    enquete_titulo_template: 'JOGO DE {dia} - {data}',
    elenco_auto_incluir_grupo: '0',
    enquete_dia_semana: '4', // dia do jogo e base do fechamento: 0=domingo ... 6=sábado
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
    fechamento_mensal_ativo: '0', // '1' = manda a mensagem de fechamento do mensal automaticamente
    fechamento_mensal_mensagem: 'O mensal de {mes_anterior} fechou! 💰\n\nQuem quer continuar mensalista, reaja 👍 nessa mensagem. Quem não reagir em até {fechamento_mensal_prazo_horas}h vira avulsa automaticamente, liberando a vaga pra uma nova mensalista.\n\nMensalistas de {mes_anterior}:\n{mensalistas_mes_anterior}\n\n*Valor da mensalidade ({mes_atual}):* {valor_mensal}\n*Pague até {data_limite_pagamento}*',
    fechamento_mensal_ultimo_envio: '', // data (YYYY-MM-DD) do último envio, evita duplicar no mesmo dia
    fechamento_mensal_hora: '00:00', // horário de envio da mensagem de fechamento (0h = manda assim que o dia do fechamento vira, comportamento original antes de virar configurável)
    fechamento_mensal_prazo_horas: '36', // prazo (em horas, a partir do envio) pra reagir antes de virar avulsa automaticamente
    pagamento_dia_limite: '7', // dia do mês (1-31) até quando a mensalidade deve ser paga — token {data_limite_pagamento}
    lista_confirmada_mensagem: TEMPLATE_LISTA_CONFIRMADA_PADRAO, // !fechar / painel "Confirmados → Enviar lista"
    lista_atual_mensagem: TEMPLATE_LISTA_ATUAL_PADRAO, // !lista
    lista_espera_mensagem: TEMPLATE_LISTA_ESPERA_PADRAO, // !espera
    times_mensagem: TEMPLATE_TIMES_PADRAO, // !times / painel "Times"
    jogo_jogadoras_por_time: '5', // jogadoras por time — 3 times se couber (3x), senão 2 times + reservas
    jogo_times_modo: 'automatico', // 'automatico' = !times sorteia e manda direto; 'manual' = só pelo painel (Times)
    jogo_rodizio_minutos: '10', // intervalo entre trocas do rodízio
    jogo_duracao_minutos: '60', // duração total do jogo, define quantas trocas aparecem no rodízio
    mensagem_jogadoras_texto: '', // último texto usado em Mensagens > "Mandar mensagem pras jogadoras" (só pra já vir preenchido)
    times_ausentes: '', // JSON {enquete_id, ids}: confirmadas que avisaram que faltam (!faltam) — ficam fora do sorteio
};

const PUBLICOS_JOGADORAS = {
    renovaram: 'Mensalistas que renovaram (👍 no último fechamento do mensal)',
    mensalistas: 'Todas as mensalistas',
    avulsas_confirmadas: 'Avulsas confirmadas no jogo atual',
};

module.exports = { DEFAULT_CONFIG, PUBLICOS_JOGADORAS };
