(function () {
    var search = document.getElementById('historico-busca');
    var situation = document.getElementById('historico-status');
    if (search && situation) {
        var games = Array.from(document.querySelectorAll('[data-historico-jogo]'));
        var result = document.querySelector('[data-historico-resultado]');
        var empty = document.querySelector('[data-historico-vazio]');
        function normalize(text) {
            return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
        }
        function filter() {
            var query = normalize(search.value.trim());
            var count = 0;
            games.forEach(function (game) {
                game.hidden = !normalize(game.querySelector('a > div').textContent).includes(query) ||
                    (situation.value !== 'todas' && situation.value !== game.dataset.situacao);
                if (!game.hidden) count++;
            });
            result.textContent = count + ' de ' + games.length + (games.length === 1 ? ' jogo' : ' jogos');
            empty.hidden = count !== 0;
        }
        search.addEventListener('input', filter);
        situation.addEventListener('change', filter);
    }
    var input = document.getElementById('link-votacao');
    var copy = document.querySelector('[data-copiar-avaliacao]');
    var status = document.querySelector('[data-copiar-status]');
    if (input && copy) {
        input.value = window.location.origin + input.dataset.caminho;
        input.addEventListener('click', function () { input.select(); });
        copy.addEventListener('click', async function () {
            try {
                await navigator.clipboard.writeText(input.value);
                status.textContent = 'Link copiado.';
            } catch {
                input.focus();
                input.select();
                status.textContent = 'Link selecionado. Copie pelo teclado ou pelo menu do dispositivo.';
            }
        });
    }
})();
