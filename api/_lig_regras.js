// api/_lig_regras.js — regras puras do módulo Feedback de Faltas (contato do SAC com quem faltou).
// Nada aqui fala com o banco: quem lê e grava é o api/ligacoes.js. Prefixo "_" → não vira rota.
//
// Decidido com o Raphael em 05/11/2026:
//   • falta SEM feedback registrado continua na cobrança (Faltas x Medidas), como sempre;
//   • falta de quem JÁ teve o feedback registrado e baixado sai da cobrança (código "T") e passa a ser
//     acompanhada só no perfil da pessoa, na janela de 30 dias. Sem alarme no painel principal;
//   • só o Raphael e a coordenação dão a baixa (quem pode gerar medida: api/_medida_regras.js);
//   • quem tem 2 ou mais faltas injustificadas e nenhum feedback vai para a pasta "Sem posicionamento",
//     só para sinalizar à coordenação.
// Sem tabela nova: a baixa, o prazo do acordo, as exclusões e os envios de WhatsApp são eventos na
// fm_auditoria (entidade "lig_contato"), como os atestados e as medidas geradas. O último evento vale.

"use strict";

const MD = require("./_medida_regras");

const ENTIDADE = "lig_contato";
const ACAO_BAIXA = "FEEDBACK_BAIXA";               // coordenação deu a baixa: as faltas da janela saem da cobrança
const ACAO_BAIXA_FIM = "FEEDBACK_BAIXA_DESFEITA";  // baixa desfeita: as faltas voltam à cobrança
const ACAO_EDITADO = "LIG_CONTATO_EDITADO";
const ACAO_EXCLUIDO = "LIG_CONTATO_EXCLUIDO";      // o contato inteiro fica em "antes": dá para recuperar
const ACAO_ACORDO = "LIG_ACORDO";                  // prazo do acordo firmado (aberto | cumprido | descumprido)
const ACAO_ZAP_ENVIO = "LIG_ZAP_ENVIO";            // cada mensagem de WhatsApp enviada (ou que falhou)
const ACAO_ZAP_CONFIG = "LIG_ZAP_CONFIG";          // endereço e chave do serviço Baileys, registrados pela coordenação na própria tela
const ACAO_ZAP_MODELO = "LIG_ZAP_MODELO";          // mensagem padrão editável
const ACAO_ZAP_CONEXAO = "LIG_ZAP_CONEXAO";        // número do SAC desconectado
const ACAO_RESULTADO = "LIG_RESULTADO";            // resultado do contato e próxima ação (o último de cada contato vale)
const ACAO_ATIVIDADE = "LIG_ATIVIDADE";            // próxima ação concluída, cancelada ou reagendada

const JANELA_DIAS = 30;      // acompanhamento depois do contato (e antes: faltas que originaram o feedback)
const MIN_FALTAS_SEM_RETORNO = 2;

// Quem entra na guia: os mesmos com "lig" no USERS do index.html (test/ligacoes_regras confere). Quem foi criado
// pela tela de Configurações tem a permissão no banco; o api/ligacoes.js consulta.
const NOMES = {
  ingridycampana: "Ingridy Campana", jussilenealmeida: "Jussilene Almeida", raphaelvictor: "Raphael Victor",
  joyce: "Joyce", joaoygor: "João Ygor"
};
const USUARIOS = new Set(Object.keys(NOMES));

// Dar a baixa e desfazê-la, excluir contato, conectar o WhatsApp e editar a mensagem padrão: só a coordenação.
const podeBaixar = ator => MD.ehCoordenacao(ator);
const podeUsar = (ator, permsDoBanco) => !!ator && (USUARIOS.has(ator) || !!(permsDoBanco && (permsDoBanco.lig === true || permsDoBanco.admin === true)));

// ── texto e datas ────────────────────────────────────────────────────────────
const semAcento = s => String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "");
const norm = s => semAcento(s).toUpperCase().replace(/\s+/g, " ").trim();
const primeiroNome = s => norm(s).split(" ")[0] || "";
const iso = v => (v == null ? "" : String(v).slice(0, 10));
const ehData = v => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v || ""))) return false;
  const t = Date.parse(v + "T12:00:00Z");
  return !isNaN(t) && new Date(t).toISOString().slice(0, 10) === v;
};
const somaDias = (d, n) => { const x = new Date(iso(d) + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const reDe = v => String(v == null ? "" : v).trim().replace(/^0+(?=\d)/, "");
const limpa = (v, max) => String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

// Janela em que as faltas de quem teve o feedback baixado ficam fora da cobrança.
function janela(dataContato) {
  const d = iso(dataContato);
  return ehData(d) ? { de: somaDias(d, -JANELA_DIAS), ate: somaDias(d, JANELA_DIAS) } : null;
}

// ── resultado do contato e próxima ação ─────────────────────────────────────
// Dois grupos, porque mudam a regra: TENTATIVA (não conseguiu falar com o colaborador) não tira ninguém da fila de
// contato nem permite retirar a falta da cobrança; CONVERSA (falou com o colaborador) sim. Contato antigo, sem
// resultado registrado, continua valendo como conversa: nada do histórico muda de sentido.
const RESULTADOS = {
  NAO_ATENDEU: { rot: "Não atendeu", grupo: "tentativa", proxima: "RETORNAR" },
  CAIXA_POSTAL: { rot: "Caixa postal", grupo: "tentativa", proxima: "RETORNAR" },
  NUMERO_INVALIDO: { rot: "Número inválido ou inexistente", grupo: "tentativa", proxima: "COORDENACAO" },
  SEM_RESPOSTA: { rot: "Sem resposta no WhatsApp", grupo: "tentativa", proxima: "RETORNAR" },
  RECADO: { rot: "Deixou recado com familiar", grupo: "tentativa", proxima: "RETORNAR" },
  PEDIU_RETORNO: { rot: "Pediu para ligar depois", grupo: "tentativa", proxima: "RETORNAR" },
  EXPLICOU: { rot: "Explicou o motivo", grupo: "conversa", proxima: "ACOMPANHAR" },
  VAI_ENTREGAR: { rot: "Vai entregar atestado ou documento", grupo: "conversa", proxima: "COBRAR" },
  NAO_JUSTIFICOU: { rot: "Não justificou a falta", grupo: "conversa", proxima: "COORDENACAO" },
  VAI_VOLTAR: { rot: "Confirmou que volta ao trabalho", grupo: "conversa", proxima: "ACOMPANHAR" }
};
// Próxima ação: o sistema sugere pelo resultado, quem registra decide. As com data viram atividade com prazo.
const PROXIMAS = {
  RETORNAR: { rot: "Ligar de novo", data: true, dias: 1 },
  COBRAR: { rot: "Cobrar o documento", data: true, dias: 2 },
  COORDENACAO: { rot: "Encaminhar à coordenação", data: false },
  ACOMPANHAR: { rot: "Acompanhar por 30 dias", data: false },
  ENCERRAR: { rot: "Encerrar", data: false }
};
const efetivo = resultado => !resultado || !RESULTADOS[resultado] || RESULTADOS[resultado].grupo === "conversa";

// body → { ok, valor: { resultado, proxima, retorno } | null } ou { ok:false, erro }. Sem nada disso no pedido → valor null.
function sanitizarResultado(body, hoje) {
  const b = body && typeof body === "object" ? body : {};
  if (b.resultado === undefined && b.proxima === undefined && b.retorno === undefined) return { ok: true, valor: null };
  const resultado = b.resultado == null || b.resultado === "" ? null : String(b.resultado).toUpperCase();
  if (resultado && !RESULTADOS[resultado]) return { ok: false, erro: "Resultado do contato inválido." };
  let proxima = b.proxima == null || b.proxima === "" ? (resultado ? RESULTADOS[resultado].proxima : null) : String(b.proxima).toUpperCase();
  if (proxima === "NENHUMA") proxima = null; // a tela nova não pede próxima ação: sem atividade, só o resultado
  if (proxima && !PROXIMAS[proxima]) return { ok: false, erro: "Próxima ação inválida." };
  let retorno = b.retorno == null || b.retorno === "" ? null : iso(b.retorno);
  if (retorno && !ehData(retorno)) return { ok: false, erro: "Data da próxima ação inválida." };
  if (proxima && PROXIMAS[proxima].data) {
    if (!retorno) retorno = hoje ? somaDias(hoje, PROXIMAS[proxima].dias) : null;
    if (hoje && retorno && retorno < hoje) return { ok: false, erro: "A data da próxima ação não pode ficar no passado." };
    if (hoje && retorno && retorno > somaDias(hoje, 90)) return { ok: false, erro: "A próxima ação pode ser marcada para até 90 dias." };
  } else retorno = null;
  return { ok: true, valor: { resultado, proxima, retorno } };
}
// eventos LIG_RESULTADO e LIG_ATIVIDADE → { contatoId: { resultado, proxima, retorno, situacao, em } }
function atividadesAtuais(eventos) {
  const out = {};
  porOrdem(eventos).forEach(e => {
    const k = String(e.chave), d = e.depois || {};
    if (e.acao === ACAO_RESULTADO) out[k] = { resultado: d.resultado || null, proxima: d.proxima || null, retorno: d.retorno || null, situacao: "aberta", em: e.criado_em || null };
    else if (e.acao === ACAO_ATIVIDADE && out[k]) {
      if (d.op === "reagendar" && ehData(d.data)) Object.assign(out[k], { retorno: d.data, situacao: "aberta" });
      else if (d.op === "concluir") Object.assign(out[k], { situacao: "concluida", em: e.criado_em || null, por: e.ator || "" });
      else if (d.op === "cancelar") Object.assign(out[k], { situacao: "cancelada", em: e.criado_em || null, por: e.ator || "" });
    }
  });
  return out;
}

// ── validação do contato (o servidor não confia no que a tela mandou) ───────
const MOTIVOS = ["Saúde", "Familiar", "Pessoal", "Transporte", "Conduta", "Financeiro", "Sem justificativa", "Outro"];
const CANAIS = ["LIGAÇÃO", "PESSOAL", "WHATSAPP"];
const ABONOS = ["I", "A", "J", "L"];
const CAMPOS_TEXTO = { colaborador: 120, posto: 120, supervisor: 120, justificativa: 1000, acordo: 1000, impressao: 1000 };

// body → { ok, row } ou { ok:false, erro }. "completo": criação (colaborador é obrigatório e os padrões entram).
// "motivos": nomes aceitos (os padrões e os criados pelo SAC, ver _lig_indicadores.motivosAceitos); sem a lista, só os padrões.
function sanitizarContato(body, { completo, hoje, motivos } = {}) {
  const b = body && typeof body === "object" ? body : {};
  const row = {};
  const tem = k => b[k] !== undefined;
  for (const [k, max] of Object.entries(CAMPOS_TEXTO)) if (tem(k)) row[k] = limpa(b[k], max) || null;
  if (completo && !row.colaborador) return { ok: false, erro: "Informe o colaborador." };
  if (tem("colaborador") && !row.colaborador) return { ok: false, erro: "Informe o colaborador." };
  if (tem("telefone")) {
    const t = String(b.telefone == null ? "" : b.telefone).trim();
    if (t && !/^[0-9()+\-.\s]{8,25}$/.test(t)) return { ok: false, erro: "Telefone inválido: use só números, DDD e traço." };
    row.telefone = t || null;
  }
  for (const k of ["data_contato", "data_falta"]) {
    if (!tem(k)) continue;
    const v = b[k] == null || b[k] === "" ? null : iso(b[k]);
    if (v && !ehData(v)) return { ok: false, erro: "Data inválida em " + (k === "data_contato" ? "data do contato" : "data da falta") + "." };
    if (k === "data_contato" && v && hoje && v > somaDias(hoje, 1)) return { ok: false, erro: "A data do contato não pode ser no futuro." };
    row[k] = v;
  }
  if (tem("canal")) {
    const c = b.canal == null || b.canal === "" ? null : String(b.canal).toUpperCase();
    if (c && !CANAIS.includes(c)) return { ok: false, erro: "Canal inválido." };
    row.canal = c;
  }
  if (tem("motivo")) {
    const m = b.motivo == null || b.motivo === "" ? null : limpa(b.motivo, 40);
    if (m && !(Array.isArray(motivos) && motivos.length ? motivos : MOTIVOS).includes(m)) return { ok: false, erro: "Motivo inválido." };
    row.motivo = m;
  }
  if (tem("abono")) {
    const a = b.abono == null || b.abono === "" ? null : String(b.abono).toUpperCase();
    if (a && !ABONOS.includes(a)) return { ok: false, erro: "Tipo da falta inválido." };
    row.abono = a;
  }
  if (tem("duracao_min")) {
    if (b.duracao_min == null || b.duracao_min === "") row.duracao_min = null;
    else {
      const n = Number(b.duracao_min);
      if (!Number.isInteger(n) || n < 0 || n > 240) return { ok: false, erro: "Duração: de 0 a 240 minutos." };
      row.duracao_min = n;
    }
  }
  if (completo) {
    if (row.canal === undefined || row.canal === null) row.canal = "LIGAÇÃO";
    if (!row.data_contato) row.data_contato = iso(hoje) || null;
  }
  return { ok: true, row };
}

// ── eventos: o último de cada chave vale ─────────────────────────────────────
const porOrdem = eventos => [...(eventos || [])].sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0));
function ultimoPorChave(eventos, acoes) {
  const m = new Map();
  porOrdem(eventos).forEach(e => { if (acoes.includes(e.acao)) m.set(String(e.chave), e); });
  return m;
}

// Baixas em vigor: [{ contato, re, nome1, nome, de, ate, dataContato, por, em }]
function baixasAtivas(eventos) {
  const out = [];
  ultimoPorChave(eventos, [ACAO_BAIXA, ACAO_BAIXA_FIM]).forEach((e, chave) => {
    if (e.acao !== ACAO_BAIXA || !e.depois) return;
    const d = e.depois, j = janela(d.dataContato);
    if (!j || !d.re) return;
    out.push({ contato: chave, re: String(d.re), nome1: d.nome1 || primeiroNome(d.nome), nome: d.nome || "", dataContato: iso(d.dataContato), de: j.de, ate: j.ate, por: e.ator || d.por || "", em: e.criado_em || null });
  });
  return out;
}

// Map "RE|PRIMEIRONOME" → [{ de, ate }] — o que a apuração das faltas (_faltas_regras.classificarFalta) consulta.
function tratadasParaApuracao(baixas) {
  const m = new Map();
  (baixas || []).forEach(b => {
    const k = reDe(b.re) + "|" + primeiroNome(b.nome1 || b.nome);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push({ de: b.de, ate: b.ate });
  });
  return m;
}

// Prazo dos acordos: { contatoId → { prazo, status, por } }
function acordosAtuais(eventos) {
  const out = {};
  ultimoPorChave(eventos, [ACAO_ACORDO]).forEach((e, chave) => { if (e.depois && ehData(e.depois.prazo)) out[chave] = { prazo: e.depois.prazo, status: e.depois.status || "aberto", por: e.ator || "", em: e.criado_em || null }; });
  return out;
}

// ── pasta "Sem posicionamento" ───────────────────────────────────────────────
// faltas: [{ re, data, nome, posto, supervisor }] já injustificadas (código "I") do período;
// contatos: [{ colaborador, data_contato }]; envios: eventos LIG_ZAP_ENVIO (chave "RE|PRIMEIRONOME").
// Entra quem tem 2 ou mais faltas injustificadas e nenhum contato registrado desde a primeira delas.
function semPosicionamento(faltas, contatos, envios) {
  const por = new Map();
  (faltas || []).forEach(f => {
    const k = reDe(f.re) + "|" + primeiroNome(f.nome);
    if (!por.has(k)) por.set(k, { re: reDe(f.re), nome: f.nome || "", posto: f.posto || "", supervisor: f.supervisor || "", datas: [] });
    const p = por.get(k);
    p.datas.push(iso(f.data));
    if (f.posto) p.posto = f.posto;
    if (f.supervisor) p.supervisor = f.supervisor;
  });
  const contatosPor = new Map();
  const tentativasLig = [];
  (contatos || []).forEach(c => {
    if (c.efetivo === false) { tentativasLig.push(c); return; } // ligou e não falou: é tentativa, não contato
    const k = norm(c.colaborador); if (!contatosPor.has(k)) contatosPor.set(k, []); contatosPor.get(k).push(iso(c.data_contato || c.criado_em));
  });
  const tentativas = new Map();
  (envios || []).forEach(e => {
    if (!e.depois || e.depois.ok !== true) return;
    const t = tentativas.get(String(e.chave)) || { n: 0, ultima: "" };
    t.n++; t.ultima = iso(e.criado_em) > t.ultima ? iso(e.criado_em) : t.ultima;
    tentativas.set(String(e.chave), t);
  });
  const out = [];
  por.forEach((p, k) => {
    const datas = [...new Set(p.datas)].sort();
    if (datas.length < MIN_FALTAS_SEM_RETORNO) return;
    if ((contatosPor.get(norm(p.nome)) || []).some(d => d >= datas[0])) return;
    const t = Object.assign({ n: 0, ultima: "" }, tentativas.get(k));
    tentativasLig.filter(c => norm(c.colaborador) === norm(p.nome) && iso(c.data_contato || c.criado_em) >= datas[0]).forEach(c => { const d = iso(c.data_contato || c.criado_em); t.n++; if (d > t.ultima) t.ultima = d; });
    out.push({ re: p.re, nome: p.nome, posto: p.posto, supervisor: p.supervisor, datas, tentativas: t.n, ultimaTentativa: t.ultima || null });
  });
  return out.sort((a, b) => b.datas.length - a.datas.length || a.nome.localeCompare(b.nome));
}

// "(19) 99999-8888" → "5519999998888". Fixo, número curto ou lixo → null (não manda). Mesma regra do serviço do WhatsApp.
function celular(tel) {
  let d = String(tel || "").replace(/\D/g, "");
  if (d.startsWith("55") && d.length >= 12) d = d.slice(2);
  d = d.replace(/^0+/, "");
  return /^[1-9][1-9]9\d{8}$/.test(d) ? "55" + d : null;
}

const MODELO_PADRAO = "Olá, {nome}. Aqui é o SAC do Grupo ServCamp. Registramos a sua ausência no trabalho{data} e precisamos entender o que aconteceu. Por favor, ligue para este número assim que puder, para conversarmos sobre o motivo da falta. Contamos com você.";

module.exports = {
  ENTIDADE, ACAO_BAIXA, ACAO_BAIXA_FIM, ACAO_EDITADO, ACAO_EXCLUIDO, ACAO_ACORDO, ACAO_ZAP_ENVIO, ACAO_ZAP_CONFIG, ACAO_ZAP_MODELO, ACAO_ZAP_CONEXAO, ACAO_RESULTADO, ACAO_ATIVIDADE, RESULTADOS, PROXIMAS,
  JANELA_DIAS, MIN_FALTAS_SEM_RETORNO, NOMES, USUARIOS, MOTIVOS, CANAIS, ABONOS, MODELO_PADRAO,
  celular, podeBaixar, podeUsar, norm, primeiroNome, ehData, somaDias, reDe, limpa, janela,
  sanitizarContato, baixasAtivas, tratadasParaApuracao, acordosAtuais, semPosicionamento, efetivo, sanitizarResultado, atividadesAtuais
};
