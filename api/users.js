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
const crypto = require("crypto");

// Quem pode entrar: as mesmas chaves do USERS do index.html (test/users.test.js
// avisa se as duas listas se desencontrarem). Sem esta lista, qualquer nome
// inventado entraria com a senha padrão e sairia com um token válido.
const USUARIOS = [
  "joaoygor", "paulocampana", "ingridycampana", "amauriantonio", "eduardocipriano",
  "sirleimodesto", "jussilenealmeida", "gabrielaalvarenga", "rosisantos", "fabianalassala",
  "raphaelvictor", "sandraalves", "testejoao", "rafaelandrade", "adrianomacedo",
  "edneyferraz", "frankpimentel", "carlos", "jeankleber", "paulosergio", "ronaldocimadon", "joyce"
];

// Administradores fixos: os mesmos com admin:true no USERS do index.html. Quem é
// criado pela tela de Configurações ganha admin pelo campo perms do banco.
const ADMINS = ["joaoygor"];
// Permissões que a tela de Configurações pode dar (as mesmas chaves do USERS).
const PERMS_VALIDAS = ["admin", "rh", "rhDash", "com", "comDash", "prj", "qual", "lig", "sup", "fm", "bdv", "metas"];
// Mesma regra do _normUser do index.html: "Maria da Silva" -> "mariadasilva".
function chaveDe(nome) {
  return String(nome || "").toUpperCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Z0-9]/g, "").toLowerCase();
}
// Senha temporária: 8 letras/números sem os que se confundem (l, 1, o, 0, i).
function senhaTemporaria() {
  const a = "abcdefghjkmnpqrstuvwxyz23456789";
  let s = "";
  for (let i = 0; i < 8; i++) s += a[crypto.randomInt(a.length)];
  return s;
}
// Usuário criado pela tela: existe só no banco (tem nome lá).
function criadoPelaTela(row) { return !!(row && row.nome); }
// Bloqueado pela tela de Configurações (vale para fixos e para criados pela tela).
function bloqueado(row) { return !!(row && row.ativo === false); }
const MSG_BLOQUEADO = "Seu acesso está bloqueado. Fale com o administrador.";

// Sessão: 12 h no navegador (some ao fechar). "Manter conectado" (celular do supervisor): fica guardada
// no aparelho por 30 dias, renovados a cada uso (ação renew). Quem decide o prazo é o servidor.
const HORAS_SESSAO = 12;
const DIAS_SESSAO_SALVA = 30;
const emitirSessao = (userKey, secret, manter) =>
  manter ? _auth.sign(userKey, secret, DIAS_SESSAO_SALVA * 24, { m: 1 }) : _auth.sign(userKey, secret, HORAS_SESSAO);

// Senha inicial própria de quem ainda não tem senha no banco (entra no lugar da padrão e sem troca
// obrigatória). Fica aqui só o HASH, nunca a senha. Quando a senha for gravada no banco
// (app_users.custom_password), ela passa a valer e esta linha pode sair. Pedido do Raphael, 13/10/2026.
const SENHA_INICIAL = {
  rosisantos: "scrypt:16384:8:1:vobcWfZMyPvhKBh/FXN1hg==:EEl3tl/1OdL+WwgHori5bsYDljQWTLugQgxjxs3GqHA=",
  joyce: "scrypt:16384:8:1:aWeD1J+f4aMK+N3kJ1L9oA==:taSS/EJ8t6D2hWaAbbeg0sAb650fIg3K/xAXIKjpA+g="
};

// Senha inicial que precisa ser trocada no primeiro acesso (a da Joyce, por pedido, não precisa).
const INICIAL_COM_TROCA = new Set(["rosisantos"]);

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
    const r = await fetch(`${TABELA}?user_key=eq.${encodeURIComponent(userKey)}&select=*`, { headers });
    if (!r.ok) throw new Error("Supabase " + r.status);
    const rows = await r.json();
    return rows[0] || null;
  }

  // Confere a senha de userKey: a própria, se já tiver; senão, a padrão.
  // Devolve { ok, row, padrao } ou, quando não dá para conferir, { erro, status }.
  async function conferirSenha(userKey, senha) {
    if (USUARIOS.indexOf(userKey) < 0) {
      // criado pela tela de Configurações: só entra se existir no banco, ativo e com senha
      let r;
      try { r = await lerUsuario(userKey); } catch (e) {
        return { erro: "Não foi possível conferir a senha agora. Tente novamente.", status: 502 };
      }
      if (!criadoPelaTela(r) || !r.custom_password) return { ok: false };
      return { ok: await _senha.verify(senha, r.custom_password), row: r };
    }
    let row;
    try { row = await lerUsuario(userKey); } catch (e) {
      return { erro: "Não foi possível conferir a senha agora. Tente novamente.", status: 502 };
    }
    if (row && row.custom_password) return { ok: await _senha.verify(senha, row.custom_password), row };
    if (SENHA_INICIAL[userKey]) return { ok: await _senha.verify(senha, SENHA_INICIAL[userKey]), row, inicial: true };
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

  // Quem está logado (pelo token) e é administrador? Devolve a chave ou null.
  async function adminDoToken() {
    const a = _auth.requireAuth(req);
    const k = a.ok && a.user && a.user.u;
    if (!k) return null;
    if (ADMINS.indexOf(k) >= 0) return k;
    try {
      const r = await lerUsuario(k);
      if (criadoPelaTela(r) && r.ativo !== false && r.perms && r.perms.admin === true) return k;
    } catch (e) {}
    return null;
  }

  if (req.method === "GET") {
    // Painel de Configuração (admin): lista todos os usuários com campos SEGUROS
    // (nunca a senha) — só quem já tem senha própria, se deve trocar e o último acesso.
    if (req.query.all === "1") {
      const _ga = _auth.requireAuth(req);
      if (!_ga.ok) return res.status(401).json({ error: "Não autenticado." });
      // a lista (com quem está bloqueado) é da tela de Configurações: só administrador
      if (_ga.enforced && !(await adminDoToken())) return res.status(403).json({ error: "Só administradores." });
      const url = `${TABELA}?select=*`;
      const resp = await fetch(url, { headers });
      if (!resp.ok) return res.status(resp.status).json({ error: "Erro ao consultar Supabase." });
      const rows = await resp.json();
      const safe = rows.map(r => ({
        user_key: r.user_key,
        has_custom: !!r.custom_password,      // tem senha própria? (booleano, não a senha)
        must_change: precisaTrocar(r),
        last_login: r.last_login || null,
        login_count: r.login_count || 0,
        updated_at: r.updated_at || null,
        // criados pela tela de Configurações: o perfil mora no banco
        ...(r.nome ? { nome: r.nome, cargo: r.cargo || null, perms: r.perms || {}, ativo: r.ativo !== false } : (r.ativo === false ? { ativo: false } : {})),
        ...(r.perms && r.perms.guias ? { guias: r.perms.guias } : {})
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
      // bloqueado na tela de Configurações: só avisa depois da senha certa
      if (bloqueado(c.row)) return res.status(403).json({ ok: false, error: MSG_BLOQUEADO });
      const emTextoClaro = !!(c.row && c.row.custom_password) && !_senha.isHash(c.row.custom_password);
      await Promise.all([
        emTextoClaro ? converterParaHash(userKey, password) : null,
        registrarAcesso(userKey, c.row)
      ]);
      const mustChange = c.inicial ? INICIAL_COM_TROCA.has(userKey) : precisaTrocar(c.row);
      const secret = process.env.AUTH_SECRET;
      return res.status(200).json({
        ok: true,
        must_change: mustChange,
        has_custom: !c.padrao,
        // sem token: troca pendente (sai na troca) ou AUTH_SECRET ausente (modo graça)
        token: secret && !mustChange ? emitirSessao(userKey, secret, body.manter === true) : null,
        manter: body.manter === true,
        grace: !secret,
        // criado pela tela: a tela não conhece o perfil, então ele vai junto
        perfil: criadoPelaTela(c.row) ? { nome: c.row.nome, cargo: c.row.cargo || "", perms: c.row.perms || {} } : null,
        // guias ligadas/desligadas na Configuração (valem por cima da regra do perfil)
        guias: (c.row && c.row.perms && c.row.perms.guias) || null
      });
    }

    // Redefinir senha (só administrador): gera uma senha temporária, mostrada uma
    // única vez para o administrador; no primeiro acesso a pessoa cria a própria.
    if (body.action === "admin_reset") {
      const admin = await adminDoToken();
      if (!admin) return res.status(403).json({ error: "Só administradores podem redefinir senhas." });
      if (!userKey) return res.status(400).json({ error: "userKey é obrigatório." });
      let row;
      try { row = await lerUsuario(userKey); } catch (e) { return res.status(502).json({ error: "Erro ao consultar Supabase." }); }
      if (USUARIOS.indexOf(userKey) < 0 && !criadoPelaTela(row)) return res.status(404).json({ error: "Usuário não encontrado." });
      const senha = senhaTemporaria();
      const resp = await fetch(TABELA, {
        method: "POST",
        headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ user_key: userKey, custom_password: await _senha.hash(senha), must_change: true, updated_at: new Date().toISOString() })
      });
      if (!resp.ok) {
        console.error("users: erro ao redefinir senha", resp.status, (await resp.text()).slice(0, 200));
        return res.status(502).json({ error: "Erro ao salvar a senha temporária." });
      }
      // a senha antiga deixa de abrir o painel em qualquer aparelho que tenha ficado conectado
      try { await _auth.revogarSessoes(userKey, admin); } catch (e) { console.error("users: não consegui encerrar as sessões de", userKey, e.message); }
      console.log("users: senha redefinida", userKey, "por", admin);
      return res.status(200).json({ ok: true, userKey, senha });
    }

    // Criar usuário (só administrador): grava no banco com senha temporária e
    // troca obrigatória no primeiro acesso.
    if (body.action === "create_user") {
      const admin = await adminDoToken();
      if (!admin) return res.status(403).json({ error: "Só administradores podem criar usuários." });
      const nome = String(body.nome || "").trim().replace(/\s+/g, " ");
      const cargo = String(body.cargo || "").trim().slice(0, 80);
      if (nome.length < 3 || nome.length > 80) return res.status(400).json({ error: "Informe o nome completo (3 a 80 caracteres)." });
      const chave = chaveDe(nome);
      if (chave.length < 3) return res.status(400).json({ error: "O nome precisa ter letras." });
      if (!/^[\p{L} .'-]+$/u.test(nome)) return res.status(400).json({ error: "Use só letras no nome (sem números ou símbolos)." });
      if (!/^[\p{L}\p{N} .,'()&\/-]*$/u.test(cargo)) return res.status(400).json({ error: "Use só letras e números no cargo." });
      let row;
      try { row = await lerUsuario(chave); } catch (e) { return res.status(502).json({ error: "Erro ao consultar Supabase." }); }
      if (USUARIOS.indexOf(chave) >= 0 || row) return res.status(409).json({ error: "Já existe um usuário com esse nome." });
      const perms = {};
      PERMS_VALIDAS.forEach(p => { if (body.perms && body.perms[p] === true) perms[p] = true; });
      const senha = senhaTemporaria();
      const agora = new Date().toISOString();
      const resp = await fetch(TABELA, {
        method: "POST",
        headers: { ...headers, Prefer: "return=minimal" },
        body: JSON.stringify({ user_key: chave, nome, cargo, perms, ativo: true, custom_password: await _senha.hash(senha),
                               must_change: true, criado_por: admin, criado_em: agora, updated_at: agora })
      });
      if (!resp.ok) {
        const t = (await resp.text()).slice(0, 300);
        console.error("users: erro ao criar usuário", resp.status, t);
        if (/column|nome|perms|ativo|criado/i.test(t)) {
          return res.status(503).json({ error: "O banco ainda não está preparado para usuários novos: falta rodar o SQL que cria as colunas nome, cargo, perms, ativo, criado_por e criado_em em app_users." });
        }
        return res.status(502).json({ error: "Erro ao criar o usuário." });
      }
      console.log("users: usuário criado", chave, "por", admin);
      return res.status(200).json({ ok: true, userKey: chave, nome, senha });
    }

    // Guias que a pessoa vê (só administrador): { pagina: true|false } por cima da regra
    // do perfil. Só o que difere do padrão é guardado; {} volta tudo ao padrão.
    // Configurações fica de fora: nenhum administrador pode perder a tela que libera os outros.
    if (body.action === "set_guias") {
      const admin = await adminDoToken();
      if (!admin) return res.status(403).json({ error: "Só administradores podem mudar as guias." });
      if (!userKey) return res.status(400).json({ error: "userKey é obrigatório." });
      const g = body.guias;
      if (!g || typeof g !== "object" || Array.isArray(g)) return res.status(400).json({ error: "guias deve ser um objeto." });
      const guias = {};
      for (const [pg, v] of Object.entries(g)) {
        if (!/^[a-z0-9]{2,24}$/.test(pg) || typeof v !== "boolean") return res.status(400).json({ error: "Guia inválida: " + String(pg).slice(0, 30) });
        if (pg !== "config") guias[pg] = v;
      }
      if (Object.keys(guias).length > 80) return res.status(400).json({ error: "Guias demais." });
      let row;
      try { row = await lerUsuario(userKey); } catch (e) { return res.status(502).json({ error: "Erro ao consultar Supabase." }); }
      if (USUARIOS.indexOf(userKey) < 0 && !criadoPelaTela(row)) return res.status(404).json({ error: "Usuário não encontrado." });
      const perms = { ...((row && row.perms) || {}), guias };
      const resp = await fetch(TABELA, {
        method: "POST",
        headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ user_key: userKey, perms, updated_at: new Date().toISOString() })
      });
      if (!resp.ok) {
        console.error("users: erro ao salvar guias", resp.status, (await resp.text()).slice(0, 200));
        return res.status(502).json({ error: "Erro ao salvar." });
      }
      console.log("users: guias de", userKey, "alteradas por", admin, JSON.stringify(guias));
      return res.status(200).json({ ok: true, userKey, guias });
    }

    // Bloquear ou liberar o acesso (só administrador). Bloqueado não entra, e quem
    // já está com o painel aberto cai no próximo batimento do /api/hq (~15 s).
    // Ninguém bloqueia a si mesmo nem um administrador fixo: o sistema não pode
    // ficar sem ninguém que consiga liberar os outros.
    if (body.action === "set_active") {
      const admin = await adminDoToken();
      if (!admin) return res.status(403).json({ error: "Só administradores podem bloquear ou liberar acessos." });
      if (!userKey) return res.status(400).json({ error: "userKey é obrigatório." });
      if (typeof body.ativo !== "boolean") return res.status(400).json({ error: "ativo deve ser true ou false." });
      if (!body.ativo && userKey === admin) return res.status(400).json({ error: "Você não pode bloquear o seu próprio acesso." });
      if (!body.ativo && ADMINS.indexOf(userKey) >= 0) return res.status(400).json({ error: "Este administrador não pode ser bloqueado." });
      let row;
      try { row = await lerUsuario(userKey); } catch (e) { return res.status(502).json({ error: "Erro ao consultar Supabase." }); }
      if (USUARIOS.indexOf(userKey) < 0 && !criadoPelaTela(row)) return res.status(404).json({ error: "Usuário não encontrado." });
      const resp = await fetch(TABELA, {
        method: "POST",
        headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ user_key: userKey, ativo: body.ativo, updated_at: new Date().toISOString() })
      });
      if (!resp.ok) {
        console.error("users: erro ao bloquear/liberar", resp.status, (await resp.text()).slice(0, 200));
        return res.status(502).json({ error: "Erro ao salvar." });
      }
      _auth.esquecerBloqueio(userKey);
      console.log("users:", body.ativo ? "acesso liberado" : "acesso bloqueado", userKey, "por", admin);
      return res.status(200).json({ ok: true, userKey, ativo: body.ativo });
    }

    // Renovar a sessão salva no aparelho: quem usa o painel continua conectado, quem some por 30 dias volta ao login.
    // Só renova token de "manter conectado"; bloqueado ou encerrado não renova.
    if (body.action === "renew") {
      const a = _auth.requireAuth(req);
      if (!a.ok) return res.status(401).json({ ok: false, error: "Sessão vencida. Entre de novo." });
      if (!a.enforced || !a.user || a.user.s || !a.user.m) return res.status(400).json({ ok: false, error: "Esta sessão não é de \"manter conectado\"." });
      const v = await _auth.sessaoValida(a.user);
      if (!v.ok) return res.status(401).json({ ok: false, bloqueado: !!v.bloqueado, encerrada: !!v.encerrada, error: v.bloqueado ? MSG_BLOQUEADO : "Sessão encerrada. Entre de novo." });
      return res.status(200).json({ ok: true, token: emitirSessao(a.user.u, process.env.AUTH_SECRET, true) });
    }

    // Sair de todos os aparelhos: as sessões emitidas até agora (inclusive esta) deixam de valer.
    if (body.action === "logout_all") {
      const a = _auth.requireAuth(req);
      if (!a.ok || !a.user || !a.user.u || a.user.s) return res.status(401).json({ ok: false, error: "Sessão vencida. Entre de novo." });
      try { await _auth.revogarSessoes(a.user.u, a.user.u); }
      catch (e) { console.error("users: encerrar sessões falhou", e.message); return res.status(502).json({ ok: false, error: "Não consegui encerrar as sessões agora. Tente de novo." }); }
      return res.status(200).json({ ok: true });
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
      if (bloqueado(c.row)) return res.status(403).json({ error: MSG_BLOQUEADO });
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
      // quem trocou a senha sai dos outros aparelhos (o token novo é emitido depois do encerramento, então continua valendo)
      try { await _auth.revogarSessoes(userKey, userKey); } catch (e) { console.error("users: não consegui encerrar as sessões de", userKey, e.message); }
      // já devolve um token válido: quem acabou de definir a senha entra autenticado
      const secret = process.env.AUTH_SECRET;
      return res.status(200).json({ ok: true, token: secret ? emitirSessao(userKey, secret, body.manter === true) : null });
    }

    return res.status(400).json({ error: "action inválida (use authenticate, renew, logout_all, change_password, admin_reset, create_user, set_active ou set_guias)." });
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "Método não permitido." });
};

module.exports.USUARIOS = USUARIOS;
