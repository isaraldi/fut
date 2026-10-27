# Corrigir a escalação pela lista reenviada

Uma pessoa autorizada em **Comandos** pode copiar a resposta de `!lista`, editar
os nomes e reenviar a lista completa no grupo configurado para o jogo.
O bot reconhece o cabeçalho `Lista atual — título do jogo` ou `Lista fechada —
título do jogo`, as seções Mensalistas e Avulsas e o total de confirmadas.
Também aceita o bloco de lista de espera do bot.

1. Reenvie a lista com os nomes numerados e o título completo do jogo atual.
2. Confira a prévia: entradas, saídas, alterações na espera e novas convidadas.
3. A mesma pessoa envia `!confirmarlista` em até 10 minutos para aplicar.
   `!cancelarlista` descarta a própria prévia.
4. Use `!lista` para conferir. O próximo `!times` usa a escalação corrigida.

A prévia não muda presenças nem cria cadastros. Convidadas são cadastradas
como avulsas sem telefone ou WhatsApp apenas na confirmação; usam os valores
padrão do cadastro para posição e nível até que o perfil seja ajustado.
Nomes completos e sem ambiguidade evitam confundir uma convidada com alguém
já cadastrada. O nome exato é comparado sem diferenciar maiúsculas e acentos.

As seções digitadas não mudam o vínculo mensal. O bot usa o vínculo registrado
na confirmação existente ou, em novas confirmações, no cadastro. Cabeçalhos
com contagem antiga e intervalos na numeração podem ser reorganizados na prévia,
mas o total de confirmadas precisa corresponder aos nomes enviados.

Ao aplicar, os votos positivos de quem ficou fora da lista completa são removidos,
inclusive da espera se esses nomes não estiverem no bloco correspondente. Isso é
informado na prévia. A lista respeita o limite de vagas e a prioridade das mensalistas;
a ordem manual decide a distribuição dentro de cada grupo. Um novo voto posterior
entra depois dessa distribuição. Não há alteração de pagamentos, permissões,
vínculo mensal ou prazo de renovação. Faltas já marcadas para quem continua são
preservadas. O funcionamento vale também para correções após fechar a enquete.

Se os votos, nomes, vínculos, vagas ou enquete mudarem entre a prévia e a confirmação,
o bot pede uma nova lista. As alterações são transacionais: uma falha não deixa
cadastros ou presenças parcialmente modificados. Consultas antigas do WhatsApp
não desfazem a correção manual.

A configuração `lista_importacao_prazo_minutos` controla a validade da prévia
(padrão 10 minutos, mínimo 1 e máximo 60). Propostas ficam no SQLite e continuam
válidas após reinício, dentro desse prazo. Não há leitura de listas antigas no
histórico do grupo nem edição automática de uma mensagem anterior: é necessário
reenviar a lista como uma nova mensagem.

Verificação sem conectar ao WhatsApp:

```
node tests/listas-whatsapp.test.js
```
