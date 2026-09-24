// api/users.js
// Login, token e troca de senha. A senha é conferida AQUI, no servidor:
// nenhuma rota devolve senha ao navegador (nem o hash).
// Usa a SERVICE_ROLE_KEY do Supabase no servidor — nunca exposta ao navegador.
//
// Onde ficam as senhas:
//   • Senha própria: app_users.custom_password, em hash scrypt (api/_senha.js).
//     Linha antiga ainda em texto claro é convertida no próximo login certo.
//   • Senha padrão (de quem ainda não criou a sua): fora do código. O servidor
//     confere contra a env DEFAULT_PASSWORD_HASH, gerada com `node api/_senha.js`.
//     Sem essa env o primeiro acesso fica fechado; quem já tem senha própria
//     continua entrando normalmente.
//
// Token (api/_auth.js): só sai depois de a senha ser conferida, e nunca para
// quem tem troca pendente — esse recebe o token ao criar a senha nova.

const _auth = require("./_auth");
const _senha = require("./_senha");

// Quem pode entrar: as mesmas chaves do USERS do index.html (test/users.test.js
// avisa se as duas listas se desencontrarem). Sem esta lista, qualquer nome
// inventado entraria com a senha padrão e sairia com um token válido.
const USUARIOS = [
  "joaoygor", "paulocampana", "ingridycampana", "amauriantonio", "eduardocipriano",
  "sirleimodesto", "jussilenealmeida", "gabrielaalvarenga", "rosisantos", "fabianalassala",
  "raphaelvictor", "sandraalves", "testejoao", "rafaelandrade", "adrianomacedo",
  "edneyferraz", "frankpimentel", "carlos", "jeankleber", "paulosergio", "ronaldocimadon"
];

// Troca pendente: sempre para quem está na senha padrão; para quem já tem
// senha própria, só se must_change estiver marcado no banco.
function precisaTrocar(row) {
  return !(row && row.custom_password) || row.must_change !== false;
}

module.exports = async function handler(req, res) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: "SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não configuradas." });
  }

  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json"
  };
  const TABELA = `${SUPABASE_URL}/rest/v1/app_users`;

  // Lança se o Supabase falhar: "não consegui ler" NÃO pode virar "não tem
  // senha própria", senão a senha padrão abriria qualquer conta num soluço do banco.
  async function lerUsuario(userKey) {
    const r = await fetch(`${TABELA}?user_key=eq.${encodeURIComponent(userKey)}&select=custom_password,must_change,login_count`, { headers });
    if (!r.ok) throw new Error("Supabase " + r.status);
    const rows = await r.json();
    return rows[0] || null;
  }

  // Confere a senha de userKey: a própria, se já tiver; senão, a padrão.
  // Devolve { ok, row, padrao } ou, quando não dá para conferir, { erro, status }.
  async function conferirSenha(userKey, senha) {
    if (USUARIOS.indexOf(userKey) < 0) return { ok: false };
    let row;
    try { row = await lerUsuario(userKey); } catch (e) {
      return { erro: "Não foi possível conferir a senha agora. Tente novamente.", status: 502 };
    }
    if (row && row.custom_password) return { ok: await _senha.verify(senha, row.custom_password), row };
    const padrao = process.env.DEFAULT_PASSWORD_HASH;
    if (!_senha.isHash(padrao)) {
      return { erro: "Primeiro acesso indisponível: a senha padrão não está configurada no servidor (DEFAULT_PASSWORD_HASH).", status: 503 };
    }
    return { ok: await _senha.verify(senha, padrao), row, padrao: true };
  }

  // Linha antiga em texto claro → hash. Só grava se a linha AINDA estiver em
  // texto claro: se a senha tiver sido trocada nesse meio-tempo, não sobrescreve.
  // Falhar aqui não impede o login; a conversão fica para o próximo.
  async function converterParaHash(userKey, senha) {
    try {
      const r = await fetch(`${TABELA}?user_key=eq.${encodeURIComponent(userKey)}&custom_password=not.like.${encodeURIComponent("scrypt:*")}`, {
        method: "PATCH",
        headers: { ...headers, Prefer: "return=minimal" },
        body: JSON.stringify({ custom_password: await _senha.hash(senha) })
      });
      if (!r.ok) console.error("users: conversão da senha para hash falhou", r.status, (await r.text()).slice(0, 200));
    } catch (e) { console.error("users: conversão da senha para hash falhou", e.message); }
  }

  // Último acesso (auditoria do painel de Configuração). O upsert preserva a senha.
  async function registrarAcesso(userKey, row) {
    try {
      await fetch(TABELA, {
        method: "POST",
        headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ user_key: userKey, last_login: new Date().toISOString(), login_count: ((row && row.login_count) || 0) + 1 })
      });
    } catch (e) {}
  }

  if (req.method === "GET") {
    // Painel de Configuração (admin): lista todos os usuários com campos SEGUROS
    // (nunca a senha) — só quem já tem senha própria, se deve trocar e o último acesso.
    if (req.query.all === "1") {
      const _ga = _auth.requireAuth(req);
      if (!_ga.ok) return res.status(401).json({ error: "Não autenticado." });
      const url = `${TABELA}?select=user_key,must_change,last_login,login_count,updated_at,custom_password`;
      const resp = await fetch(url, { headers });
      if (!resp.ok) return res.status(resp.status).json({ error: "Erro ao consultar Supabase." });
      const rows = await resp.json();
      const safe = rows.map(r => ({
        user_key: r.user_key,
        has_custom: !!r.custom_password,      // tem senha própria? (booleano, não a senha)
        must_change: precisaTrocar(r),
        last_login: r.last_login || null,
        login_count: r.login_count || 0,
        updated_at: r.updated_at || null
      }));
      return res.status(200).json({ users: safe });
    }
    // Estado da senha de um usuário: só os dois booleanos, nunca a senha.
    const userKey = String(req.query.userKey || "");
    if (!userKey) return res.status(400).json({ error: "userKey é obrigatório." });
    let row;
    try { row = await lerUsuario(userKey); } catch (e) {
      return res.status(502).json({ error: "Erro ao consultar Supabase." });
    }
    return res.status(200).json({ has_custom: !!(row && row.custom_password), must_change: precisaTrocar(row) });
  }

  if (req.method === "POST") {
    const body = req.body || {};
    const userKey = String(body.userKey || "");

    // Login: confere a senha e, se não houver troca pendente, devolve o token.
    if (body.action === "authenticate") {
      const password = String(body.password || "");
      if (!userKey || !password) return res.status(400).json({ error: "userKey e password são obrigatórios." });
      const c = await conferirSenha(userKey, password);
      if (c.erro) return res.status(c.status).json({ ok: false, error: c.erro });
      if (!c.ok) return res.status(401).json({ ok: false, error: "Usuário ou senha incorretos" });
      const emTextoClaro = !!(c.row && c.row.custom_password) && !_senha.isHash(c.row.custom_password);
      await Promise.all([
        emTextoClaro ? converterParaHash(userKey, password) : null,
        registrarAcesso(userKey, c.row)
      ]);
      const mustChange = precisaTrocar(c.row);
      const secret = process.env.AUTH_SECRET;
      return res.status(200).json({
        ok: true,
        must_change: mustChange,
        has_custom: !c.padrao,
        // sem token: troca pendente (sai na troca) ou AUTH_SECRET ausente (modo graça)
        token: secret && !mustChange ? _auth.sign(userKey, secret, 12) : null,
        grace: !secret
      });
    }

    // Troca de senha: exige a senha atual — a própria, ou a padrão no primeiro
    // acesso. Sem essa prova ninguém troca a senha de ninguém. Sem "action" é o
    // formato antigo do front, que agora também precisa da senha atual.
    if (!body.action || body.action === "change_password") {
      const atual = String(body.currentPassword || "");
      const nova = String(body.newPassword || "");
      if (!userKey || !nova) return res.status(400).json({ error: "userKey e newPassword são obrigatórios." });
      if (!atual) return res.status(401).json({ error: "Informe a senha atual para trocar a senha." });
      if (nova.length < 6) return res.status(400).json({ error: "Senha deve ter ao menos 6 caracteres." });
      if (nova.length > 200) return res.status(400).json({ error: "Senha deve ter no máximo 200 caracteres." });
      const c = await conferirSenha(userKey, atual);
      if (c.erro) return res.status(c.status).json({ error: c.erro });
      if (!c.ok) return res.status(401).json({ error: "Senha atual incorreta." });
      if (nova === atual) return res.status(400).json({ error: "A nova senha precisa ser diferente da atual." });
      // a senha padrão é compartilhada: não pode virar a senha própria de ninguém
      const padrao = process.env.DEFAULT_PASSWORD_HASH;
      if (!c.padrao && _senha.isHash(padrao) && await _senha.verify(nova, padrao)) {
        return res.status(400).json({ error: "A nova senha não pode ser a senha padrão." });
      }
      const resp = await fetch(TABELA, {
        method: "POST",
        headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({
          user_key: userKey,
          custom_password: await _senha.hash(nova),
          must_change: false,
          updated_at: new Date().toISOString()
        })
      });
      if (!resp.ok) {
        console.error("users: erro ao salvar senha", resp.status, (await resp.text()).slice(0, 200));
        return res.status(502).json({ error: "Erro ao salvar senha." });
      }
      // já devolve um token válido: quem acabou de definir a senha entra autenticado
      const secret = process.env.AUTH_SECRET;
      return res.status(200).json({ ok: true, token: secret ? _auth.sign(userKey, secret, 12) : null });
    }

    return res.status(400).json({ error: "action inválida (use authenticate ou change_password)." });
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "Método não permitido." });
};

module.exports.USUARIOS = USUARIOS;
