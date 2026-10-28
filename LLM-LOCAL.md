# LLM local

Requer Node.js 20 (como a imagem Docker do projeto) e Ollama acessível pelo processo do bot.
Usa `qwen3:4b-instruct` para mensagens e `qwen3-vl:2b-instruct` para imagens duvidosas.
O Tesseract local é sempre a primeira tentativa de leitura.
Nenhuma configuração é ativada automaticamente.

## Ativar

Primeiro verifique a conectividade **no ambiente onde o bot executa**, inclusive dentro
do container se usar Docker:

```sh
curl --connect-timeout 5 http://172.19.176.1:11434/api/tags
```

Depois de disponibilizar estes arquivos no ambiente do bot, configure no mesmo ambiente
e volume do banco:

```sh
node configurar-llm.js ativar http://172.19.176.1:11434
```

Baixe também o modelo de visão no PowerShell conectado ao servidor Ollama:

```powershell
$env:OLLAMA_HOST = "172.19.176.1:11434"
ollama pull qwen3-vl:2b-instruct
```

O comando de configuração grava `llm_url`, `llm_modelo`, `llm_modelo_visao`, `llm_mensagens_ativa` e
`llm_comprovantes_ativa` na tabela `configuracoes`. Não inicia nem reinicia processos.
Para código novo entrar em uso, o bot precisa de implantação/reinício autorizado separado.
Não execute o comando no banco local supondo que ele configura o volume Docker de produção.

No Windows, mantenha o servidor Ollama aberto. Para reproduzir o teste que funcionou,
no PowerShell:

```powershell
$env:OLLAMA_HOST = "172.19.176.1:11434"
$env:OLLAMA_VULKAN = "0"
$env:CUDA_VISIBLE_DEVICES = "-1"
ollama serve
```

Esse processo usa CPU. As variáveis são temporárias; o endereço NAT pode mudar depois
de reiniciar o WSL. Atualize o endereço no servidor e na configuração se necessário.
Mantenha a API restrita à máquina/rede privada necessária, pois ela não exige login.

## Uso e limites

- A LLM atua somente em conversas privadas com o número do bot: `me manda a lista`,
  `quem está na espera?`, `como estão as renovações do mensal?`.
  Mensagens e imagens de grupos nunca são enviadas à LLM, mesmo com o prefixo `bot`.
  Os comandos explícitos e o processamento original de comprovantes por OCR nos grupos
  continuam funcionando.
- Apenas remetentes na whitelist podem executar pedidos. As permissões são verificadas
  antes e depois da inferência. A IA escolhe uma operação permitida e extrai nomes;
  as respostas e alterações usam as funções existentes. Não executa SQL nem código gerado.
- Todos os comandos existentes têm equivalentes em linguagem natural no privado:

  | Comando | Exemplo de pedido |
  | --- | --- |
  | `!lista` | Me manda a lista do jogo |
  | `!espera` | Quem está na espera? |
  | `!mensal` | Como estão as renovações do mensal? |
  | `!times` | Sorteie os times do jogo |
  | `!fechar` | Feche a lista do jogo |
  | `!enquete` | Abra a enquete no grupo |
  | `!sincronizar` | Sincronize o elenco do grupo |
  | `!faltam` | Quem está faltando? |
  | `!faltam Ana, Bia` | Defina as faltas como Ana e Bia |
  | `!faltam ninguém` | Limpe a lista de faltas |
  | `!confirmarlista` | Confirme a correção da lista |
  | `!cancelarlista` | Cancele a correção da lista |

  `O que você faz?` mostra a ajuda. Envie um pedido por mensagem. Conversas casuais,
  relatos, hipóteses e pedidos negados são classificados como sem ação.
- Enquetes são publicadas no grupo configurado no painel; sincronização usa esse grupo.
  Respostas de lista, fechamento, times e consultas vão para o privado que fez o pedido.
  Configuração ausente ou grupo/jogo alterado durante a inferência impede a ação.
- Faltas substituem a lista completa de faltas, como no comando original. Os nomes
  precisam aparecer no pedido e ser encontrados sem ambiguidade entre as confirmadas;
  se algum nome não for resolvido, nada é alterado. Pedidos incrementais de adicionar
  ou remover uma falta pedem a lista completa em vez de limpar faltas anteriores.
- Para corrigir a presença, envie no privado a lista completa no formato já suportado
  pelo bot. Você recebe a prévia das diferenças e depois confirma ou cancela em linguagem
  natural. Havendo prévia pendente, `sim` ou `pode aplicar` também confirma. Somente o
  autor pode confirmar; expiração e validação de mudanças continuam no módulo original.
  A IA não altera nomes ou votos diretamente nem gera uma lista substituta.
- Não existem comandos para registrar pagamentos por mensagem de texto. Comprovantes
  continuam no fluxo de OCR/visão descrito abaixo; dizer `paguei` não marca como pago.
- No privado, OCR com confiança de pelo menos 85, palavra de pagamento, indicação de
  conclusão, um único valor em R$ e sem indicação de pendência resolve sem LLM.
  A confiança do Tesseract é um indicador de legibilidade, não garantia de autenticidade.
  OCR duvidoso ou falho envia a **imagem original** para o modelo visual, que precisa
  identificar conclusão e valor único em R$ no texto visível. Imagem sem texto legível
  também tenta visão; imagem com texto sem sinais de comprovante é ignorada, a menos
  que a legenda indique pagamento (por exemplo, `comprovante`).
  As mesmas validações de cadastro, valores configurados, enquete e competência são
  aplicadas depois. Não há conciliação bancária nem detecção garantida de fraude.
  Se o OCR indicar agendamento, falha ou pendência, o caso vai para conferência manual,
  sem permitir que o modelo visual autorize o pagamento.
- Análise inconclusiva, erro, modelo ocupado ou valor inválido: registra aviso e não
  marca pagamento. A conferência é manual pelo painel; não existe fila automática
  para reprocessar essas imagens.
- Uma inferência por vez, sem fila ilimitada, timeout de 60 segundos para mensagens e
  180 segundos para imagens; PNG/JPEG/WebP em base64 de até 14 MiB (aproximadamente
  10 MiB de arquivo), entrada textual de até 12 mil caracteres e saída estruturada.
  Modelo ocupado nas mensagens orienta usar
  os comandos originais. Nenhum histórico de conversa é enviado.
- A imagem original pode conter dados pessoais; ela é enviada ao Ollama local configurado
  somente quando a leitura de comprovante privado precisar da visão.
  As respostas e prompts da LLM não são registrados em logs pelo cliente.

## Desativar e verificar

```sh
node configurar-llm.js desativar
node tests/llm-local.test.js
node tests/comandos-ia.test.js
node tests/listas-whatsapp.test.js
```

Desativar restaura o fluxo original de comandos e OCR. Os testes usam respostas
simuladas, sem banco, WhatsApp ou acesso ao Ollama; não medem precisão do modelo real.
