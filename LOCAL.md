# Painel em desenvolvimento

Execute `sh painel-local.sh` e acesse <http://localhost:4001/login>.
É necessário ter Docker, a imagem local `fut-bot:latest` e o arquivo `.env`
com `ADMIN_USER`, `ADMIN_PASSWORD` e `SESSION_SECRET`.

O comando inicia somente o painel com `NODE_ENV=development`, permitindo
o cookie de sessão em HTTP. A porta fica disponível apenas no loopback.
O container `fut` de produção continua separado, com cookie seguro em HTTPS.

O banco local começa vazio e fica persistido no volume `fut_dev_data`.
Os uploads locais ficam em `data/uploads` nesse mesmo volume; `public/uploads` aponta para esse diretório.
O primeiro administrador usa as credenciais do `.env`; depois da criação,
o login usa o cadastro salvo nesse banco. Dados de produção não são copiados.

Para encerrar: `docker stop fut-painel-local`.
O comando copia `src/` e `public/` para `/app` antes de iniciar.
Para carregar alterações do código: reinicie somente `fut-painel-local` ou encerre e execute o script novamente.
Para escolher outra porta: `PORT_LOCAL=4002 sh painel-local.sh`.
Se as dependências mudarem, a imagem precisa ser reconstruída antes.
