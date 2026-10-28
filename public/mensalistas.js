(function () {
    var search = document.getElementById('mensal-busca');
    if (!search) return;
    var rows = Array.from(document.querySelectorAll('[data-mensalista-row]'));
    var empty = document.querySelector('[data-mensalista-vazio]');
    function normalize(text) { return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR'); }
    search.addEventListener('input', function () {
        var query = normalize(search.value.trim());
        rows.forEach(function (row) { row.hidden = !normalize(row.querySelector('[data-mensalista-nome]').textContent).includes(query); });
        if (empty) empty.hidden = rows.some(function (row) { return !row.hidden; });
    });
})();
