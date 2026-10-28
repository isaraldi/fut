(function () {
    var form = document.querySelector('[data-times-form]');
    if (!form) return;
    function values() {
        return JSON.stringify(Array.from(new FormData(form).entries()).sort(function (a, b) {
            return a[0].localeCompare(b[0]);
        }));
    }
    var initial = values();
    var submitting = false;
    var cards = Array.from(form.querySelectorAll('[data-time-card]'));
    function refresh() {
        cards.forEach(function (card) {
            var players = Array.from(card.querySelectorAll('[data-time-jogadora]'));
            card.querySelector('[data-time-count]').textContent = players.length + (players.length === 1 ? ' jogadora' : ' jogadoras');
            card.querySelector('[data-time-vazio]').hidden = players.length !== 0;
            var sum = card.querySelector('[data-time-soma]');
            if (sum) sum.textContent = players.reduce(function (total, player) { return total + Number(player.dataset.nivel); }, 0);
        });
    }
    form.addEventListener('change', function (event) {
        var select = event.target;
        if (!select.matches('select[name^="dest_"]')) return;
        var destination = cards.find(function (card) { return card.dataset.timeCard === select.value; });
        if (!destination) return;
        var player = select.closest('[data-time-jogadora]');
        var details = select.closest('details');
        destination.querySelector('[data-time-lista]').appendChild(player);
        details.open = false;
        details.querySelector('summary').focus();
        refresh();
    });
    form.addEventListener('submit', function () { submitting = true; });
    window.addEventListener('beforeunload', function (event) {
        if (!submitting && values() !== initial) {
            event.preventDefault();
            event.returnValue = '';
        }
    });
    refresh();
})();
