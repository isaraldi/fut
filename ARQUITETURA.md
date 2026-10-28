# Estrutura MVC

O projeto continua em JavaScript com CommonJS, Express, EJS e SQLite. Bot e painel são processos separados e compartilham `data/fut.db`; não há API entre eles.

```text
src/
├── app.js                       Classe App: monta Express sem abrir porta
├── server.js                    Inicia apenas o painel
├── bot.js                       Inicia apenas o WhatsApp
├── api/
│   ├── controllers/             Entrada HTTP, sessão, upload e respostas
│   ├── models/schema.js         Schema SQLite e migrações existentes
│   ├── repositories/            SQL e construção de statements
│   ├── services/                Casos de uso e regras de negócio
│   └── subscribers/             Eventos e recuperação de interações do WhatsApp
├── config/                      Ambiente, caminhos absolutos e valores padrão
├── jobs/                        Rotinas periódicas do bot
├── loaders/                     Configuração de Express, SQLite e cliente WhatsApp
├── helpers/                     Segurança e apresentação dos resultados HTTP
├── utils/                       Formatação, mensagens, calendário, times e OCR
└── views/                       Views EJS e layouts
scripts/
└── configurar-llm.js            Utilitário administrativo da IA local
public/                         CSS, JavaScript do navegador e uploads
```

O fluxo HTTP é `route → controller → service → repository → SQLite`. Controllers recebem `req`/`res`, extraem os dados e delegam. Os serviços recebem objetos simples e retornam dados de apresentação (`view`/`dados`, `destino`, `json` ou `mensagem`); `helpers/apresentar.js` aplica o resultado ao Express. As regras de negócio e as transações ficam nos serviços. SQL e montagem de consultas ficam nos repositories, com parâmetros vinculados nos statements do `better-sqlite3`.

Os serviços do painel estão divididos por assunto: jogos, elenco, mensal, financeiro, mensagens, configurações, usuários e logs. `fut.service.js` reúne as operações compartilhadas pelo bot e pelo painel; `painel-support.service.js` reúne validações, configurações e cálculos usados por mais de uma tela. Schema e migrações mantêm a sequência existente e são inicializados pelo serviço compartilhado.

O bot cria o cliente em `loaders/whatsapp.js`, injeta-o na factory de handlers em `api/services/whatsapp.service.js` e registra os eventos pelo subscriber. O job recebe as tarefas a executar a cada minuto. Importar a factory de handlers não conecta ao WhatsApp; essa conexão só é iniciada pela entrada `src/bot.js`.

As views ficam em `src/views/` e os arquivos estáticos em `public/`, sem a pasta legada `panel/`. As URLs públicas continuam iguais. Em produção, `/app/public/uploads` aponta para `/app/storage/uploads`, mantendo os arquivos no volume `fut_data`; o entrypoint também aceita uploads da estrutura anterior sem sobrescrever os persistidos. No teste local, `public/uploads` aponta para `data/uploads`, dentro do volume exclusivo `fut_dev_data`. Os caminhos internos partem da raiz do projeto, independentemente do diretório atual do terminal. A autenticação do WhatsApp continua usando o diretório de trabalho, como antes: execute o bot a partir da raiz do projeto.

Não há arquivos JavaScript de compatibilidade na raiz. Docker, scripts de execução e testes usam diretamente `src/bot.js`, `src/server.js` e os módulos das respectivas camadas. Utilitários administrativos ficam em `scripts/`. A raiz mantém os manifestos, a configuração de infraestrutura e a documentação. Não foi criada uma pasta `types/`, pois o projeto não usa TypeScript.

## Comandos

Requer Node.js 20.19 ou superior e dependências instaladas com `npm ci`.

- `npm start`: inicia o bot real do WhatsApp.
- `npm run start:panel`: inicia somente o painel.
- `npm run dev`: inicia somente o painel com Nodemon, observando `src/` e `public/`.
- `npm run config:llm -- <argumentos>`: configura a IA local com o utilitário em `scripts/configurar-llm.js`, sem iniciar o bot.
- `npm test`: executa todos os testes isolados, sem iniciar o bot real.
- `sh painel-local.sh`: prepara o painel Docker de teste em `http://127.0.0.1:4001`, com volume `fut_dev_data`.

Os testes de banco e painel copiam `src/` e `public/` para seus diretórios temporários. Testes de migração limpam o cache das camadas temporárias ao simular um reinício. O teste de arquitetura cobre páginas, autenticação, usuários, upload, CSRF, persistência da sessão e criação dos handlers do bot sem conexão. O teste de persistência de uploads executa a preparação do entrypoint em uma árvore temporária, verificando migração e reinício sem iniciar processos da aplicação.

A produção no container `fut` só deve ser atualizada mediante pedido explícito. Reorganizar o código e atualizar o painel local não implica implantação em produção.
