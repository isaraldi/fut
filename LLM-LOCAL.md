# LLM local

Requer Node.js 20 (como a imagem Docker do projeto) e Ollama acessível pelo processo do bot.
Usa `qwen3:4b-instruct` no Windows; imagens continuam passando pelo Tesseract local.
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

O comando grava `llm_url`, `llm_modelo`, `llm_mensagens_ativa` e
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
- Apenas remetentes na whitelist podem consultar. Só são suportadas intenções
  `lista`, `espera` e `mensal`; as respostas vêm das funções existentes, não de texto
  livre gerado pelo modelo. Pedidos de fechar enquete, pagamentos e sorteios continuam
  usando comandos explícitos/painel.
- Comprovantes enviados em conversa privada exigem os sinais de pagamento e R$ do OCR. A LLM identifica pagamento
  concluído e o valor da transferência; o valor precisa existir no OCR e corresponder
  aos valores configurados no painel. Cadastro, enquete e competência continuam sendo
  validados pelo código. Não há conciliação bancária nem detecção garantida de fraude.
- Análise inconclusiva, erro, modelo ocupado ou valor inválido: registra aviso e não
  marca pagamento. A conferência é manual pelo painel; não existe fila automática
  para reprocessar essas imagens.
- Uma inferência por vez, sem fila ilimitada, timeout de 60 segundos, entrada de até
  12 mil caracteres e saída estruturada. Modelo ocupado nas mensagens orienta usar
  os comandos originais. Nenhum histórico de conversa é enviado.
- OCR pode conter dados pessoais do comprovante; ele é enviado ao Ollama configurado.
  As respostas e prompts da LLM não são registrados em logs pelo cliente.

## Desativar e verificar

```sh
node configurar-llm.js desativar
node tests/llm-local.test.js
```

Desativar restaura o fluxo original de comandos e OCR. Os testes usam respostas
simuladas, sem banco, WhatsApp ou acesso ao Ollama; não medem precisão do modelo real.
