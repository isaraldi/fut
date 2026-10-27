(function () {
    var rows = Array.from(document.querySelectorAll('[data-jogadora-row]'));
    var search = document.getElementById('elenco-busca');
    var filters = Array.from(document.querySelectorAll('[data-elenco-filtro]'));
    var filter = 'todas';
    var empty = document.querySelector('[data-elenco-vazio]');
    var result = document.querySelector('[data-elenco-resultado]');
    var createDialog = document.getElementById('jogadora-nova');
    var editDialog = document.getElementById('jogadora-edicao');
    var editor = document.getElementById('jogadora-editor');
    var activeRow = null;
    var draft = '';

    function values(form) {
        return JSON.stringify(Array.from(new FormData(form).entries()).filter(function (entry) {
            return entry[0] !== '_csrf';
        }));
    }
    var initial = new Map(rows.map(function (row) {
        var form = row.querySelector('form');
        return [row, values(form)];
    }));
    function normalize(text) {
        return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
    }
    function refreshRows() {
        rows.forEach(function (row) {
            var form = row.querySelector('form');
            row.querySelector('[data-jogadora-nome]').textContent = form.elements.nome.value;
            row.querySelector('[data-jogadora-alterada]').hidden = values(form) === initial.get(row);
            var position = form.elements.posicao.value;
            row.querySelector('[data-jogadora-perfil]').textContent = (position === 'indefinida' ? 'Posição não informada' : position) + ' · Nível ' + form.elements.nivel.value;
            row.querySelector('[data-jogadora-editar]').setAttribute('aria-label', 'Editar ' + form.elements.nome.value);
        });
    }
    function applyFilter() {
        var query = normalize(search.value.trim());
        var visible = 0;
        rows.forEach(function (row) {
            var form = row.querySelector('form');
            row.hidden = !normalize(form.elements.nome.value).includes(query) ||
                (filter !== 'todas' && row.dataset.participacao !== filter);
            if (!row.hidden) visible++;
        });
        if (empty) empty.hidden = visible !== 0;
        result.textContent = visible + ' de ' + rows.length + ' jogadora(s)';
    }
    search.addEventListener('input', applyFilter);
    filters.forEach(function (button) {
        button.addEventListener('click', function () {
            filter = button.dataset.elencoFiltro;
            filters.forEach(function (item) { item.setAttribute('aria-pressed', String(item === button)); });
            applyFilter();
        });
    });
    rows.forEach(function (row) {
        row.querySelector('form').addEventListener('reset', function () {
            requestAnimationFrame(function () { refreshRows(); applyFilter(); });
        });
        row.querySelector('[data-jogadora-editar]').addEventListener('click', function () {
            activeRow = row;
            var source = row.querySelector('form');
            ['nome', 'telefone', 'nivel', 'posicao'].forEach(function (name) {
                editor.elements[name].value = source.elements[name].value;
            });
            document.getElementById('jogadora-edicao-titulo').textContent = source.elements.nome.value;
            var remove = document.getElementById('jogadora-remover');
            remove.action = '/elenco/' + row.dataset.jogadoraId + '/excluir';
            remove.dataset.confirmNome = source.elements.nome.value;
            draft = values(editor);
            editDialog.showModal();
            editor.elements.nome.focus();
        });
    });
    document.querySelector('[data-jogadora-adicionar]').addEventListener('click', function () {
        createDialog.showModal();
        createDialog.querySelector('[name="nome"]').focus();
    });
    function close(dialog) {
        if (dialog === editDialog && values(editor) !== draft &&
            !window.confirm('Descartar a edição desta jogadora?')) return;
        dialog.close();
    }
    document.querySelectorAll('[data-dialog-fechar]').forEach(function (button) {
        button.addEventListener('click', function () { close(button.closest('dialog')); });
    });
    editDialog.addEventListener('cancel', function (event) {
        event.preventDefault();
        close(editDialog);
    });
    editor.addEventListener('submit', function (event) {
        event.preventDefault();
        if (!editor.reportValidity() || !activeRow) return;
        var target = activeRow.querySelector('form');
        ['nome', 'telefone', 'nivel', 'posicao'].forEach(function (name) {
            target.elements[name].value = editor.elements[name].value;
        });
        target.elements.nome.dispatchEvent(new Event('input', { bubbles: true }));
        refreshRows();
        editDialog.close();
    });
    window.addEventListener('beforeunload', function (event) {
        if (editDialog.open && values(editor) !== draft) {
            event.preventDefault();
            event.returnValue = '';
        }
    });
    refreshRows();
    applyFilter();
})();
