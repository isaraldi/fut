# Recuperação de interações do WhatsApp

O bot consulta os votos da enquete atual (se estiver aberta) e as reações à
chamada mensal mais recente ao conectar e a cada 30 minutos. Reconexões
forçam uma nova consulta. Essas leituras não enviam mensagens ao grupo.

Eventos ao vivo e consultas passam pela mesma fila. O último estado e os
horários do WhatsApp ficam no SQLite para que reinícios e consultas repetidas
não dupliquem inscrições nem desfaçam eventos mais recentes. Confirmações e
remoções manuais feitas no painel ficam protegidas de votos remotos anteriores.

A recuperação usa o horário original da interação, inclusive para a ordem das
interessadas e para renovar dentro do prazo congelado da chamada. Uma pendência
expirada pode ser corrigida quando o WhatsApp informa uma renovação feita a tempo.
Aprovações continuam manuais; enquetes fechadas e chamadas antigas são ignoradas.

Na renovação mensal, 👍 e 👎 são reconhecidos com qualquer tom de pele, tanto nos
eventos ao vivo quanto na recuperação. Mudar apenas o tom mantém a resposta e não
altera o horário da renovação nem a posição na fila. Reações recuperadas continuam
usando o horário original do WhatsApp para verificar o prazo.

O WhatsApp disponibiliza o estado que chegou ao cliente, não um histórico
completo de todas as alterações. Votos com opções vazias e reações de retirada
recebidas como evento são processados. A ausência de uma reação na consulta,
sozinha, não é tratada como desistência: cache incompleto ou falha de leitura
não pode retirar uma mensalista. Retirar e recolocar a mesma reação durante a
indisponibilidade pode não deixar o estado intermediário disponível.

Se a mensagem não estiver disponível ou a leitura falhar, os dados existentes
são preservados e a próxima consulta tenta novamente. Falhas aparecem em
Atividade do bot, com limitação de frequência e sem dados de remetentes.
Comprovantes e mensagens livres não são reprocessados por essa recuperação.

Verificação sem iniciar o bot nem acessar WhatsApp:

```
node tests/sincronizacao-whatsapp.test.js
node tests/reacoes-mensal.test.js
node tests/mensal.test.js
node tests/configuracoes.test.js
node tests/jogo-atual.test.js
```
