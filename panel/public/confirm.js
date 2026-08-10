document.addEventListener('submit', function (ev) {
    var form = ev.target;
    if (!form.matches('[data-confirm]')) return;

    var mensagem = form.dataset.confirm.replace('{nome}', form.dataset.confirmNome || '');
    if (!window.confirm(mensagem)) ev.preventDefault();
});
