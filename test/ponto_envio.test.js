// Envio de SMS com o provedor falso (Etapa 7), contra um Supabase falso.
// Nenhum teste toca a rede nem manda SMS de verdade.

process.env.SUPABASE_URL = "http://supabase.falso";
process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-falsa";
process.env.AUTH_SECRET = "segredo-de-teste";
delete process.env.AUTH_ENFORCE;

const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../api/_ponto_regras");
const SMS = require("../api/_sms");
const ponto = require("../api/_ponto");
const { supabaseFalso, chamar } = require("./_supabase_falso");

ponto.APROVADORES.add("aprovador");
const hoje = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
const provedorOriginal = SMS.provedorSMS;

const TXT = "SERVCAMP | ORIENTACAO DE PONTO\nOla, Maria. Marque o ponto no horario. RE 521.";
const msg = (id, extra) => ({ id, re: 521, data_jornada: "2026-09-20", ocorrencia_ids: [id], telefone_e164: "+5519998765432", texto_gerado: TXT, texto_final: null, status: "APROVADA", motivo_bloqueio: null, is_test: false, ...extra });

function base(extra) {
  return {
    pt_config: [
      { chave: "sms_limite_dia", valor: "50" }, { chave: "sms_limite_mes", valor: "300" },
      { chave: "alerta_pct", valor: "80" }, { chave: "critico_pct", valor: "90" }, ...((extra && extra.config) || [])
    ],
    pt_contatos: [
      { re: 521, telefone_e164: "+5519998765432", tipo_telefone: "CELULAR", enviavel: true },
      { re: 522, telefone_e164: "+5519911112222", tipo_telefone: "CELULAR", enviavel: true },
      { re: 523, telefone_e164: "+551932345678", tipo_telefone: "FIXO", enviavel: false }
    ],
    pt_ocorrencias: [
      { id: 1, diferenca_minutos: 40 }, { id: 2, diferenca_minutos: 10 }, { id: 3, diferenca_minutos: 60 },
      { id: 4, diferenca_minutos: 30 }, { id: 5, diferenca_minutos: 30 }, { id: 6, diferenca_minutos: 30 }, { id: 7, diferenca_minutos: 30 }
    ],
    pt_mensagens: [
      msg(1),
      msg(2, { re: 522, texto_gerado: TXT.replace("Maria", "Joao").replace("521", "522") }),
      msg(3, { data_jornada: "2026-09-21" }),
      msg(4, { re: 523 }),
      msg(5, { re: 522, status: "AGUARDANDO_VALIDACAO" }),
      msg(6, { re: 524, status: "ENVIADA", enviado_em: "2026-09-10T12:00:00Z" }),
      msg(7, { re: 525 })
    ],
    pt_sms_uso: []
  };
}

const enviar = (body, usuario) => chamar(ponto, { method: "POST", query: { t: "enviar" }, usuario: usuario || "aprovador", body });
const TODAS = [1, 2, 3, 4, 5, 6, 7];

test("planejarEnvio", async t => {
  const contatos = new Map(base().pt_contatos.map(c => [String(c.re), c]));
  const minutos = new Map([[1, 40], [2, 10], [3, 60], [4, 30], [5, 30], [6, 30], [7, 30]]);
  const cota = disponivel => ({ disponivel, hoje: { usado: 0, limite: 50 }, mes: { usado: 0, limite: 300 } });
  await t.test("maior tempo primeiro, 1 por colaborador por dia, e cada bloqueio com o motivo", () => {
    const p = R.planejarEnvio(base().pt_mensagens, { contatosPorRE: contatos, minutosPorId: minutos, cota: cota(50) });
    assert.deepEqual(p.enviar.map(c => c.id), [3, 2]);
    assert.deepEqual(p.esperam, [{ id: 1, motivo: "UMA_POR_DIA" }]);
    assert.deepEqual(p.bloqueadas.map(b => [b.id, b.motivo]), [[4, "TELEFONE_FIXO"], [5, "NAO_APROVADA"], [6, "JA_ENVIADA"], [7, "TELEFONE_AUSENTE"]]);
    assert.equal(p.resumo.cabe_tudo, true);
  });
  await t.test("a primeira que não cabe na cota encerra o lote", () => {
    const p = R.planejarEnvio(base().pt_mensagens, { contatosPorRE: contatos, minutosPorId: minutos, cota: cota(1) });
    assert.deepEqual(p.enviar.map(c => c.id), [3]);
    assert.deepEqual(p.nao_cabe.map(c => c.id), [2]);
    assert.equal(p.resumo.cabe_tudo, false);
    assert.deepEqual(p.cota.depois, { hoje: 1, mes: 1 });
  });
  await t.test("quem já recebeu SMS hoje espera", () => {
    const p = R.planejarEnvio(base().pt_mensagens, { contatosPorRE: contatos, minutosPorId: minutos, cota: cota(50), jaOrientadosHoje: new Set(["521"]) });
    assert.deepEqual(p.enviar.map(c => c.id), [2]);
    assert.deepEqual(p.esperam.map(e => [e.id, e.motivo]).sort(), [[1, "JA_ORIENTADO_HOJE"], [3, "JA_ORIENTADO_HOJE"]]);
  });
  await t.test("o telefone é conferido na base de agora, não no da mensagem", () => {
    const semTelefone = new Map([...contatos].filter(([re]) => re !== "522"));
    const p = R.planejarEnvio(base().pt_mensagens, { contatosPorRE: semTelefone, minutosPorId: minutos, cota: cota(50) });
    assert.ok(p.bloqueadas.some(b => b.id === 2 && b.motivo === "TELEFONE_AUSENTE"));
  });
});

test("provedor falso", async () => {
  const p = new SMS.MockSmsProvider();
  const r = await p.enviar("+5519998765432", "oi");
  assert.equal(r.ok, true);
  assert.match(r.id, /^mock-/);
  assert.equal(p.enviados.length, 1);
});

test("POST enviar", async t => {
  t.afterEach(() => { SMS.provedorSMS = provedorOriginal; delete process.env.SMS_PROVIDER; });

  await t.test("sem confirmar é só o plano: nada muda", async () => {
    process.env.SMS_PROVIDER = "mock";
    const tabelas = base();
    const log = supabaseFalso(tabelas);
    const r = await enviar({ ids: TODAS });
    assert.equal(r.statusCode, 200);
    assert.equal(r.body.simulacao, true);
    assert.deepEqual(r.body.enviar.map(c => c.id), [3, 2]);
    assert.equal(r.body.resumo.segmentos_a_enviar, 2);
    assert.deepEqual(r.body.cota.depois, { hoje: 2, mes: 2 });
    assert.equal(log.filter(c => c.metodo === "PATCH" || c.tabela.startsWith("rpc/")).length, 0);
  });

  await t.test("sem SMS_PROVIDER o envio fica desligado e nada é marcado", async () => {
    const tabelas = base();
    supabaseFalso(tabelas);
    const r = await enviar({ ids: TODAS, confirmar: true });
    assert.equal(r.statusCode, 409);
    assert.equal(r.body.codigo, "SMS_DESLIGADO");
    assert.ok(tabelas.pt_mensagens.filter(m => m.id !== 6).every(m => m.status !== "ENVIADA"));
  });

  await t.test("com o mock, envia pela ordem, registra e conta a cota", async () => {
    process.env.SMS_PROVIDER = "mock";
    const tabelas = base();
    supabaseFalso(tabelas);
    const r = await enviar({ ids: TODAS, confirmar: true });
    assert.equal(r.statusCode, 200);
    assert.deepEqual(r.body.enviadas, [3, 2]);
    const m3 = tabelas.pt_mensagens.find(m => m.id === 3);
    assert.equal(m3.status, "ENVIADA");
    assert.equal(m3.provider, "mock");
    assert.match(m3.provider_message_id, /^mock-/);
    assert.ok(m3.enviado_em);
    assert.equal(tabelas.pt_mensagens.find(m => m.id === 1).status, "APROVADA", "a outra do mesmo colaborador espera");
    assert.equal(tabelas.pt_sms_uso.find(u => u.dia === hoje).segmentos_dia, 2);
    assert.equal(tabelas.pt_auditoria.filter(a => a.acao === "MENSAGEM_ENVIADA").length, 2);
    assert.equal(r.body.cota.hoje.usado, 2);
  });

  await t.test("no dia seguinte do mesmo colaborador... ainda hoje ele espera", async () => {
    process.env.SMS_PROVIDER = "mock";
    const tabelas = base();
    tabelas.pt_mensagens.find(m => m.id === 3).status = "ENVIADA";
    tabelas.pt_mensagens.find(m => m.id === 3).enviado_em = new Date().toISOString();
    supabaseFalso(tabelas);
    const r = await enviar({ ids: [1], confirmar: true });
    assert.deepEqual(r.body.enviadas, []);
    assert.deepEqual(r.body.nao_enviadas, [{ id: 1, motivo: "JA_ORIENTADO_HOJE" }]);
  });

  await t.test("cota do dia corta o lote; o resto continua aprovado", async () => {
    process.env.SMS_PROVIDER = "mock";
    const tabelas = base({ config: [] });
    tabelas.pt_config.find(c => c.chave === "sms_limite_dia").valor = "1";
    supabaseFalso(tabelas);
    const r = await enviar({ aprovadas: true, confirmar: true });
    assert.deepEqual(r.body.enviadas, [3]);
    assert.ok(r.body.nao_enviadas.some(x => x.id === 2 && x.motivo === "SEM_COTA"));
    assert.equal(tabelas.pt_mensagens.find(m => m.id === 2).status, "APROVADA");
    assert.equal(tabelas.pt_sms_uso.find(u => u.dia === hoje).segmentos_dia, 1);
  });

  await t.test("limite da API (429) para o lote, devolve a cota e não marca como enviada", async () => {
    SMS.provedorSMS = () => ({ nome: "textbee", status: async () => ({ ok: true, online: true }), enviar: async () => ({ ok: false, codigo: "LIMITE_API", mensagem: "HTTP 429" }) });
    const tabelas = base();
    supabaseFalso(tabelas);
    const r = await enviar({ ids: TODAS, confirmar: true });
    assert.equal(r.body.parado_por, "LIMITE_API");
    assert.deepEqual(r.body.enviadas, []);
    const m3 = tabelas.pt_mensagens.find(m => m.id === 3);
    assert.equal(m3.status, "APROVADA", "continua na fila");
    assert.equal(m3.erro_codigo, "LIMITE_API");
    assert.equal(tabelas.pt_mensagens.find(m => m.id === 2).status, "APROVADA", "nem foi tentada");
    assert.equal(tabelas.pt_sms_uso.find(u => u.dia === hoje).segmentos_dia, 0, "cota devolvida");
    assert.equal((tabelas.pt_auditoria || []).filter(a => a.acao === "MENSAGEM_ENVIADA").length, 0);
  });

  await t.test("falha de uma mensagem vira FALHA e não para as outras", async () => {
    let n = 0;
    SMS.provedorSMS = () => ({ nome: "textbee", status: async () => ({ ok: true, online: true }), enviar: async () => (++n === 1 ? { ok: false, codigo: "NUMERO_INVALIDO", mensagem: "número recusado" } : { ok: true, id: "tb-2" }) });
    const tabelas = base();
    supabaseFalso(tabelas);
    const r = await enviar({ ids: TODAS, confirmar: true });
    assert.deepEqual(r.body.falhas.map(f => [f.id, f.codigo]), [[3, "NUMERO_INVALIDO"]]);
    assert.deepEqual(r.body.enviadas, [2]);
    assert.equal(tabelas.pt_mensagens.find(m => m.id === 3).status, "FALHA");
    assert.equal(tabelas.pt_sms_uso.find(u => u.dia === hoje).segmentos_dia, 1, "só a que saiu conta");
    assert.equal(tabelas.pt_auditoria.filter(a => a.acao === "MENSAGEM_FALHOU").length, 1);
  });

  await t.test("outro envio esgotando a cota no meio do lote: para, sem estourar o limite", async () => {
    const tabelas = base();
    tabelas.pt_config.find(c => c.chave === "sms_limite_dia").valor = "2";
    SMS.provedorSMS = () => ({
      nome: "textbee", status: async () => ({ ok: true, online: true }),
      enviar: async () => {
        // enquanto este SMS sai, outra pessoa gasta o último segmento do dia
        const u = tabelas.pt_sms_uso.find(x => x.dia === hoje);
        u.segmentos_dia = 2;
        return { ok: true, id: "tb-1" };
      }
    });
    supabaseFalso(tabelas);
    const r = await enviar({ ids: TODAS, confirmar: true });
    assert.deepEqual(r.body.enviadas, [3]);
    assert.equal(r.body.parado_por, "SEM_COTA");
    assert.equal(tabelas.pt_mensagens.find(m => m.id === 2).status, "APROVADA");
    assert.ok(tabelas.pt_sms_uso.find(u => u.dia === hoje).segmentos_dia <= 2);
  });

  await t.test("duplo clique: cada SMS sai uma vez só", async () => {
    process.env.SMS_PROVIDER = "mock";
    const tabelas = base();
    supabaseFalso(tabelas);
    let chamadas = 0;
    const mock = new SMS.MockSmsProvider();
    const enviarOriginal = mock.enviar.bind(mock);
    mock.enviar = async (d, t2) => { chamadas++; await new Promise(r => setTimeout(r, 5)); return enviarOriginal(d, t2); };
    SMS.provedorSMS = () => mock;
    const [a, b] = await Promise.all([enviar({ ids: [2, 3], confirmar: true }), enviar({ ids: [2, 3], confirmar: true })]);
    assert.equal(chamadas, 2);
    assert.deepEqual([...a.body.enviadas, ...b.body.enviadas].sort(), [2, 3]);
    assert.equal(tabelas.pt_sms_uso.find(u => u.dia === hoje).segmentos_dia, 2);
  });

  await t.test("só aprovador envia", async () => {
    process.env.SMS_PROVIDER = "mock";
    const tabelas = base();
    supabaseFalso(tabelas);
    const r = await enviar({ ids: TODAS, confirmar: true }, "outra.pessoa");
    assert.equal(r.statusCode, 403);
    assert.equal(tabelas.pt_mensagens.find(m => m.id === 3).status, "APROVADA");
  });

  await t.test("sem nada selecionado", async () => {
    supabaseFalso(base());
    assert.equal((await enviar({ ids: [] })).body.codigo, "SEM_SELECAO");
  });
});

test("GET quota informa o provedor em uso", async () => {
  process.env.SMS_PROVIDER = "mock";
  supabaseFalso(base());
  const r = await chamar(ponto, { query: { t: "quota" }, usuario: "outra.pessoa" });
  assert.equal(r.body.provedor.nome, "mock");
  delete process.env.SMS_PROVIDER;
  const r2 = await chamar(ponto, { query: { t: "quota" } });
  assert.equal(r2.body.provedor.nome, "desligado");
});
