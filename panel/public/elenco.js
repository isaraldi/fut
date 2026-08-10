document.addEventListener('click', function (ev) {
    var btn = ev.target.closest('.edit-toggle');
    if (!btn) return;
    var row = btn.closest('.jogador-row');
    if (!row) return;

    var editing = row.classList.toggle('editing');
    btn.classList.toggle('active', editing);
    btn.setAttribute('aria-pressed', editing ? 'true' : 'false');

    row.querySelectorAll('.field').forEach(function (field) {
        if (editing) {
            field.removeAttribute('tabindex');
        } else {
            field.setAttribute('tabindex', '-1');
        }
    });

    if (editing) {
        var first = row.querySelector('.field:not([type=hidden])');
        if (first) first.focus();
    }
});

document.addEventListener('change', function (ev) {
    var select = ev.target;
    if (!select.matches('select[data-badge-field]')) return;

    Array.from(select.options).forEach(function (opt) {
        select.classList.remove(opt.value);
    });
    select.classList.add(select.value);
});
