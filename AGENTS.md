# Instruções para o Codex

Estas regras se aplicam a todo este repositório. Foram adaptadas do `CLAUDE.md` para preservar o conhecimento e os cuidados específicos do projeto.

## Forma de trabalhar

- Responda em português do Brasil, de forma direta.
- Leia o código envolvido antes de alterar e mantenha o estilo existente (Node.js com CommonJS, Express e EJS).
- Faça mudanças focadas no pedido, sem refatorações ou novas dependências desnecessárias.
- Preserve alterações existentes do usuário e não exponha credenciais, conteúdo do `.env`, sessões do WhatsApp ou dados pessoais em respostas e logs.
- Ao concluir, informe o que mudou, como foi verificado e qualquer limitação real. Não afirme ter executado verificações que não executou.

## O projeto

Bot de WhatsApp e painel administrativo para organizar um futebol recorrente: enquetes de presença, mensalistas e avulsos, pagamentos, comprovantes por OCR e balanceamento de times.

- `src/app.js`: classe que monta o Express; `src/server.js`: inicialização HTTP; `src/bot.js`: inicialização do WhatsApp.
- `src/routes/` e `src/api/controllers/`: rotas, autenticação HTTP, entrada/saída e delegação aos serviços.
- `src/api/services/`: regras de negócio compartilhadas e casos de uso do painel/bot, sem objetos Express.
- `src/api/repositories/`: SQL e statements SQLite; `src/api/models/schema.js`: schema e migrações.
- `src/loaders/database.js`: conexão compartilhada por processo com `better-sqlite3`. Bot e painel continuam acessando o mesmo banco, sem API intermediária.
- `src/config/`, `src/jobs/`, `src/api/subscribers/`, `src/helpers/` e `src/utils/`: configuração, rotinas, eventos, adaptadores e funções auxiliares.
- As views EJS ficam em `src/views/` e os arquivos estáticos em `public/`. A URL dos uploads continua `/uploads/`, com persistência no volume do ambiente.
- O código da aplicação fica em `src/`; utilitários administrativos ficam em `scripts/`. Não recrie atalhos de compatibilidade JavaScript na raiz.
- `patches/whatsapp-web.js+1.34.7.patch`: correção de busca de mensagens em votos de enquete.
- Consulte `ARQUITETURA.md` para o fluxo entre camadas e os comandos atuais.

## Comandos e verificação

- `npm install`: instala dependências e executa `patch-package` no `postinstall`.
- `node src/bot.js`: inicia o bot e pode conectar ao WhatsApp e executar agendamentos reais. A primeira autenticação exibe QR code; a sessão usa `LocalAuth` em `.wwebjs_auth/`.
- `node src/server.js`: inicia o painel na variável `PORT`, com padrão 4000.
- Não há build ou linter configurado. `npm test` executa os testes isolados de `tests/*.test.js` com o runner nativo do Node. `npm run dev` inicia somente o painel com Nodemon.
- Para alterações JavaScript, use `node --check caminho/do/arquivo.js` nos arquivos alterados e faça verificações funcionais proporcionais à mudança, preferindo dados temporários e ambiente isolado.
- Não inicie o bot real apenas para verificar sintaxe: ele pode enviar mensagens e modificar dados. Não envie mensagens de teste a grupos reais sem autorização.

## Regras de negócio que devem ser preservadas

- As configurações de comportamento vivem na tabela `configuracoes`, acessada por `getConfig`/`setConfig`: horários, título de enquete, valores, vagas, fechamento automático e permissões de comandos. Não recrie `groupConfigs`, confirmação por reações ou níveis fictícios de jogadores de protótipos antigos.
- O grupo é escolhido em tempo de execução pelo painel/configuração `enquete_grupo_id`, definida no primeiro `!enquete` em grupo ou pela lista de grupos sincronizados. `GRUPO_OFICIAL_ID` e `GRUPO_TESTE_ID` não são usados pelo código atual.
- Comandos como `!lista`, `!fechar`, `!espera`, `!times`, `!enquete` e `!sincronizar` passam por `remetenteAutorizado(msg)` e `podeUsarComandos(idCanonico)`. A autorização vem da whitelist por jogador mantida na página Comandos; pertencer ao grupo não basta.
- Preserve recursos que funcionam em grupo e em mensagem direta para o bot. Não coloque esses handlers atrás de `msg.from.endsWith('@g.us')`, pois isso descarta DMs silenciosamente. Atenção especial ao recebimento de comprovantes.
- O OCR em `processarPossivelComprovante` usa `tesseract.js` em WASM. Exige palavra relacionada a pagamento (`PALAVRAS_COMPROVANTE`) e valor em `R$`; imagens sem indícios de comprovante podem ser ignoradas.
- O valor extraído, comparado com `valor_mensal` e `valor_avulso`, determina o tipo de pagamento. Não use o papel cadastrado do jogador para decidir entre mensalidade e avulso.
- Preserve `registrarLog` nos resultados do processamento de comprovantes: sucesso, ambiguidade, remetente não cadastrado e valor incompatível.
- Mantenha `process.env.TZ = 'America/Sao_Paulo'` no início de `src/bot.js` e `src/server.js`, antes das demais operações. Agendamentos, dias da semana e competência dos pagamentos usam horário de Brasília.

## Painel e segurança

- Preserve autenticação e sessões no SQLite, inclusive após reinícios. O administrador inicial vem de `ADMIN_USER`/`ADMIN_PASSWORD`; o painel também usa `SESSION_SECRET` e `PORT`.
- Todo novo `<form method="post">` em `src/views/` deve incluir `<input type="hidden" name="_csrf" value="<%= csrfToken %>">`.
- Formulários multipart são exceção apenas à verificação global: a rota deve validar o token depois de o `multer` interpretar o corpo, antes de aceitar a operação.
- Preserve `helmet({ contentSecurityPolicy: false })`. As views possuem scripts inline sem nonce; habilitar CSP padrão exige adaptar essas views antes.
- Em produção, o cookie de sessão usa `secure: true` e `sameSite: 'lax'`. Preserve `app.set('trust proxy', 1)` e o encaminhamento de `X-Forwarded-Proto` pelo proxy para que o login HTTPS funcione.

## Dependências e persistência

- Não descarte o patch do `whatsapp-web.js`. Ao atualizar a biblioteca, confira e reconcilie/regere o patch para a nova versão.
- O banco aberto por `src/loaders/database.js` fica em `data/fut.db`. Não presuma que o arquivo `fut.db` na raiz é o banco em uso.
- Em produção, o volume Docker `fut_data` está montado em `/app/storage`. O entrypoint cria links de `/app/data` e `/app/.wwebjs_auth` para esse volume. Banco e autenticação do WhatsApp são persistentes; preserve-os em mudanças de infraestrutura.
- Não apague ou reinicialize banco, volume ou autenticação como parte de uma correção comum. Use cópias temporárias para verificações que escrevam dados.
- O entrypoint prepara links e permissões como root e depois executa os processos com `gosu node`. Novos processos devem seguir esse padrão de usuário sem privilégios.

## Implantação

### Ambientes e destino das alterações

| Ambiente | Container | Endereço no host | Persistência | Processos |
| --- | --- | --- | --- | --- |
| Produção | `fut` | `http://127.0.0.1:4000` | Volume `fut_data` em `/app/storage` | Bot real do WhatsApp e painel |
| Teste local | `fut-painel-local` | `http://127.0.0.1:4001` | Volume separado `fut_dev_data` em `/app/data` | Somente painel, sem iniciar o bot |

- **Toda implementação deve ser aplicada e validada primeiro no `fut-painel-local`, na porta 4001.** Pedidos como “implemente”, “corrija”, “atualize o local” ou relatos de que a alteração não apareceu referem-se primeiro a esse ambiente de teste.
- **Só atualizar produção quando o usuário pedir explicitamente a implantação em produção/no container `fut`.** Aprovar uma implementação ou um teste local não autoriza alterar, substituir ou reiniciar `fut`, nem escrever no volume `fut_data`. Uma autorização para uma implantação específica não autoriza implantações futuras automaticamente.
- Ambos os containers rodam na mesma máquina. “Docker local” não significa ambiente de teste: `fut` continua sendo produção, mesmo acessado por `127.0.0.1`.
- Antes de atualizar qualquer ambiente, confirme o container, a porta, os volumes e o comando de inicialização com `docker inspect`, sem exibir variáveis ou segredos. Quando houver print ou URL, confira a porta para identificar o ambiente correto.
- O `fut-painel-local` monta este repositório em `/source` e, ao iniciar, copia `src/` e `public/` para `/app`. Alterar arquivos no repositório não atualiza a cópia já carregada. No fluxo de desenvolvimento, reinicie **somente `fut-painel-local`** quando necessário para carregar as mudanças e valide `http://127.0.0.1:4001`. Confira o comando atual antes de presumir que esse mecanismo continua igual.
- Preserve o isolamento: testes não devem montar `fut_data` ou a autenticação de produção, nem iniciar `src/bot.js`. O painel local sozinho não valida conexão do bot, OCR ou comportamento real do WhatsApp; use verificações isoladas para essas partes e informe essa limitação.
- Ao concluir, diga em qual ambiente a mudança foi aplicada. Se passou apenas pelo teste local, informe que produção ainda não foi atualizada.

### Produção

- A implantação descrita no `CLAUDE.md` usa o container `fut`, imagem `fut-bot`, porta `127.0.0.1:4000:4000`, volume `fut_data` e política `--restart unless-stopped`. Não há Compose; Fly.io não é mais o destino descrito.
- Antes de uma implantação autorizada, confirme o estado atual com `docker inspect fut`; preserve opções, volume e variáveis ao reconstruir a imagem e recriar o container. Não exponha segredos da inspeção.
- `docker-entrypoint.sh` inicia bot e painel e usa `wait -n`: se um processo termina, encerra o outro para permitir o reinício do container.
- O acesso externo descrito usa Tailscale no host Windows, com proxy para `127.0.0.1:4000` e terminação HTTPS. Confira a infraestrutura real antes de alterá-la.
- Alterar código não implica autorização para reiniciar serviços de produção ou fazer deploy em produção. A atualização do painel de teste segue o fluxo local acima.

## Renovação do mensal

- O fechamento acompanha `enquete_dia_semana`: dia seguinte ao último jogo desse dia da semana no mês. A regra também define a competência dos pagamentos.
- `!mensal` consulta renovações, pendências, desistências e fila no grupo ou em DM, respeitando a whitelist de comandos.
- Mensalistas atuais têm prioridade dentro do prazo congelado no envio da chamada. Novas interessadas e renovações tardias entram na fila; repetir 👍 não muda a posição, desistir e voltar vai para o fim.
- Novas entradas são aprovadas manualmente no painel, em ordem, depois de resolver as renovações pendentes. Reações a chamadas antigas não devem alterar o ciclo atual.
- `node tests/mensal.test.js` verifica as regras usando um banco temporário, sem iniciar o bot.
