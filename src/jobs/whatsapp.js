module.exports = function iniciarRotinas(tarefas, sincronizar) {
    return setInterval(() => {
        sincronizar();
        for (const tarefa of tarefas) tarefa();
    }, 60 * 1000);
};
