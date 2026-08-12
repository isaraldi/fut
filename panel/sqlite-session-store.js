const { Store } = require('express-session');

// guarda a sessão do painel no mesmo banco sqlite (que já vive no volume persistente do Fly),
// pra login não cair toda vez que o processo reinicia (MemoryStore, o padrão do express-session,
// perde tudo a cada restart)
class SqliteSessionStore extends Store {
    constructor(db) {
        super();
        this.db = db;
        this.db.prepare('DELETE FROM sessions WHERE expira_em < ?').run(Date.now());
    }

    get(sid, cb) {
        try {
            const row = this.db
                .prepare('SELECT dados, expira_em FROM sessions WHERE sid = ?')
                .get(sid);
            if (!row || row.expira_em < Date.now()) return cb(null, null);
            cb(null, JSON.parse(row.dados));
        } catch (err) {
            cb(err);
        }
    }

    set(sid, sessionData, cb) {
        try {
            const maxAge = sessionData.cookie?.maxAge ?? 1000 * 60 * 60 * 12;
            const expiraEm = Date.now() + maxAge;
            this.db
                .prepare(
                    `INSERT INTO sessions (sid, dados, expira_em) VALUES (?, ?, ?)
                     ON CONFLICT(sid) DO UPDATE SET dados = excluded.dados, expira_em = excluded.expira_em`,
                )
                .run(sid, JSON.stringify(sessionData), expiraEm);
            cb && cb();
        } catch (err) {
            cb && cb(err);
        }
    }

    destroy(sid, cb) {
        try {
            this.db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
            cb && cb();
        } catch (err) {
            cb && cb(err);
        }
    }

    touch(sid, sessionData, cb) {
        this.set(sid, sessionData, cb);
    }
}

module.exports = SqliteSessionStore;
