(function () {
    var forms = Array.from(document.querySelectorAll('form[data-config-form]'));
    var bar = document.querySelector('.config-save-bar');
    if (!forms.length || !bar) return;

    var save = bar.querySelector('[data-config-save]');
    var discard = bar.querySelector('[data-config-discard]');
    var status = bar.querySelector('[data-config-status]');
    var error = bar.querySelector('[data-config-error]');
    var saving = false;
    var leaving = false;

    function values(form) {
        return Array.from(new FormData(form).entries()).filter(function (entry) {
            return entry[0] !== '_csrf';
        });
    }

    var initial = new Map(forms.map(function (form) {
        return [form, JSON.stringify(values(form))];
    }));

    function changed() {
        return forms.filter(function (form) {
            return JSON.stringify(values(form)) !== initial.get(form);
        });
    }

    function update() {
        if (saving) return;
        var dirty = changed().length > 0;
        bar.hidden = !dirty;
        document.body.classList.toggle('has-unsaved-config', dirty);
        status.textContent = 'Alterações não salvas';
        error.hidden = true;
    }

    document.body.classList.add('config-enhanced');
    document.addEventListener('input', function (event) {
        if (forms.includes(event.target.form)) update();
    });
    document.addEventListener('change', function (event) {
        if (forms.includes(event.target.form)) update();
    });
    forms.forEach(function (form) {
        form.addEventListener('submit', function (event) {
            event.preventDefault();
            save.click();
        });
    });

    discard.addEventListener('click', function () {
        if (saving) return;
        forms.forEach(function (form) { form.reset(); });
        update();
    });

    save.addEventListener('click', async function () {
        if (saving) return;
        var dirty = changed();
        if (!dirty.length) return;
        if (dirty.some(function (form) { return !form.reportValidity(); })) return;
        var payload = new URLSearchParams({
            _csrf: forms[0].querySelector('[name="_csrf"]').value,
            pagina: window.location.pathname,
            alteracoes: JSON.stringify(dirty.map(function (form) {
                return { action: new URL(form.action).pathname, campos: Object.fromEntries(values(form)) };
            }))
        });
        // Impede novas edições durante o envio para não perder alterações ao recarregar.
        var controls = forms.flatMap(function (form) { return Array.from(form.elements); });
        var enabled = controls.filter(function (control) { return !control.disabled; });
        saving = true;
        enabled.forEach(function (control) { control.disabled = true; });
        save.disabled = discard.disabled = true;
        error.hidden = true;
        status.textContent = 'Salvando alterações…';
        try {
            var response = await fetch('/configuracoes/salvar', {
                method: 'POST', body: payload, headers: { Accept: 'application/json' }
            });
            if (response.status === 403 || response.redirected) {
                throw new Error('Sua sessão expirou. Abra o login em outra aba e entre novamente antes de tentar salvar.');
            }
            if (!(response.headers.get('content-type') || '').includes('application/json')) {
                throw new Error('Não foi possível confirmar o salvamento. Suas edições continuam nesta página.');
            }
            var result = await response.json();
            if (!response.ok) throw new Error(result.erro || 'Não foi possível salvar as alterações.');
            leaving = true;
            window.location.assign(result.destino);
        } catch (err) {
            enabled.forEach(function (control) { control.disabled = false; });
            saving = false;
            save.disabled = discard.disabled = false;
            status.textContent = 'Alterações não salvas';
            error.textContent = err instanceof TypeError ? 'Falha de conexão. Suas edições foram mantidas; tente novamente.' : err.message;
            error.hidden = false;
        }
    });

    window.addEventListener('beforeunload', function (event) {
        if (!leaving && (saving || changed().length)) {
            event.preventDefault();
            event.returnValue = '';
        }
    });
    update();
})();
