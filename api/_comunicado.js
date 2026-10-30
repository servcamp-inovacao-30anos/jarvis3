// api/_comunicado.js — comunicado semanal de faltas injustificadas dentro do painel.
// Arquivo com prefixo "_" → NÃO vira rota na Vercel; é só importado.
//
// O e-mail oficial da semana (api/_faltas_email.js) guarda, para cada área, uma cópia do que foi
// enviado: o supervisor abre no painel o MESMO comunicado do e-mail, mesmo que alguma falta seja
// abonada depois. A cópia vai num evento próprio da fm_auditoria, separado do registro do envio
// (FALTAS_EMAIL_ENVIADO): o painel do aviso lê esse registro inteiro a cada abertura, e o comunicado
// (todas as linhas, o histórico do ano) pesaria em toda leitura. Aqui só se lê o que a tela precisa.
//
// Quem vê: a coordenação, todas as áreas; o supervisor, a dele (a mesma regra de MD.daArea das medidas).
// Sem tabela nova e sem código de link: o endereço do botão não leva nada do caso, só abre a tela, e
// a checagem de área é do servidor.

const MD = require("./_medida_regras");

const ENTIDADE = "fm_email";
const ACAO_COMUNICADO = "FALTAS_EMAIL_COMUNICADO"; // a cópia do que foi enviado a uma área em uma semana
const ACAO_ABERTO = "FALTAS_COMUNICADO_ABERTO";    // o supervisor abriu o comunicado (uma vez por pessoa, semana e área)
const SEMANAS_NA_LISTA = 8;

const chaveDe = (semana, area) => String(semana) + "|" + String(area);
const ehData = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));

// Grava a cópia do comunicado desta área. Falhar aqui não pode desfazer o envio do e-mail: quem chama
// só registra o problema (o e-mail já saiu e o supervisor continua com a tela de "faltas em aberto").
async function guardar(db, ator, d) {
  await db.inserir("fm_auditoria", [{
    ator: ator || "sistema", acao: ACAO_COMUNICADO, entidade: ENTIDADE, chave: chaveDe(d.semana, d.area), antes: null,
    depois: {
      semana: d.semana, area: d.area, nome: d.nome, inicio: d.inicio, fim: d.fim, origem: d.origem || null,
      enviadoEm: d.enviadoEm || new Date().toISOString(),
      qtd: d.qtd, colaboradores: d.colaboradores, linhas: d.linhas, atualizacoes: d.atualizacoes || null
    }
  }]);
}

// Lista leve (sem as linhas): uma por semana e área, a cópia mais recente (o envio oficial pode se repetir).
async function listar(db, ator) {
  const rows = await db.listar(
    "fm_auditoria?select=id,chave,criado_em,semana:depois->>semana,area:depois->>area,nome:depois->>nome,inicio:depois->>inicio,fim:depois->>fim," +
    "qtd:depois->>qtd,colaboradores:depois->>colaboradores,enviadoEm:depois->>enviadoEm" +
    `&acao=eq.${ACAO_COMUNICADO}&order=id.desc&limit=400`);
  const vistos = new Set(), saida = [], semanas = [];
  for (const r of rows) {
    if (vistos.has(r.chave) || !MD.daArea(ator, r.nome)) continue;
    vistos.add(r.chave);
    if (!semanas.includes(r.semana)) {
      if (semanas.length >= SEMANAS_NA_LISTA) continue; // só as últimas semanas
      semanas.push(r.semana);
    }
    saida.push({
      semana: r.semana, area: r.area, nome: r.nome, inicio: r.inicio, fim: r.fim,
      qtd: Number(r.qtd) || 0, colaboradores: Number(r.colaboradores) || 0, enviadoEm: r.enviadoEm || r.criado_em
    });
  }
  return saida;
}

// O comunicado completo de uma área e semana, ou null (não existe ou não é da área de quem pediu).
async function ler(db, ator, semana, area) {
  if (!ehData(semana) || !area) return null;
  const [e] = await db.obter(`fm_auditoria?select=id,criado_em,depois&acao=eq.${ACAO_COMUNICADO}&chave=eq.${encodeURIComponent(chaveDe(semana, area))}&order=id.desc&limit=1`);
  if (!e || !e.depois || !MD.daArea(ator, e.depois.nome)) return null;
  return { ...e.depois, enviadoEm: e.depois.enviadoEm || e.criado_em };
}

// Registra que o supervisor abriu (uma vez por pessoa, semana e área). A coordenação olhando não conta: quem
// precisa ler é o supervisor, e é isso que o painel do aviso mostra.
async function registrarAbertura(db, ator, c) {
  if (!ator || MD.ehCoordenacao(ator)) return false;
  const chave = chaveDe(c.semana, c.area);
  const [ja] = await db.obter(`fm_auditoria?select=id&acao=eq.${ACAO_ABERTO}&chave=eq.${encodeURIComponent(chave)}&ator=eq.${encodeURIComponent(ator)}&limit=1`);
  if (ja) return false;
  await db.inserir("fm_auditoria", [{ ator, acao: ACAO_ABERTO, entidade: ENTIDADE, chave, antes: null, depois: { semana: c.semana, area: c.area } }]);
  return true;
}

// Quem já abriu, por chave (semana|área), a partir da segunda desta semana: o painel do aviso mostra ao lado de cada área.
async function aberturas(db, desde) {
  const rows = await db.listar(`fm_auditoria?select=id,ator,chave,criado_em&acao=eq.${ACAO_ABERTO}&criado_em=gte.${desde}T00:00:00Z&order=id.asc`);
  const m = new Map();
  rows.forEach(r => { if (!m.has(r.chave)) m.set(r.chave, { por: r.ator, em: r.criado_em }); });
  return m;
}

module.exports = { ACAO_COMUNICADO, ACAO_ABERTO, ENTIDADE, chaveDe, guardar, listar, ler, registrarAbertura, aberturas };
