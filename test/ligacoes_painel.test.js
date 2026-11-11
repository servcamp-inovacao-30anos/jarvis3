// Feedback de Faltas, modelo receptivo: situação de cada pessoa (mensagem, aguardando, base, acompanhando).
const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../api/_lig_painel");
const L = require("../api/_lig_regras");

const hoje = "2026-11-10";
const d = n => L.somaDias(hoje, n);
const f = (re, data, codigo, extra) => ({ re, data, codigo: codigo || "I", nome: "PESSOA " + re, posto: "POSTO A", supervisor: "SUP", tipo: "CONTRATO", ...extra });
const envio = (re, data) => ({ chave: re + "|PESSOA", data });
const conversa = (id, nome, data, extra) => ({ id, colaborador: nome, data_contato: data, efetivo: true, criado_por: "Ingridy Campana", baixa: null, ...extra });
const painel = o => P.montarPainel({ hoje, faltas: [], contatos: [], envios: [], telefones: {}, ...o });
const de = (r, re) => r.pessoas.find(p => p.re === String(re));

test("faltou e ninguém mandou mensagem: Mandar mensagem", () => {
  const r = painel({ faltas: [f(1, d(-1)), f(1, d(-2))] });
  const p = de(r, 1);
  assert.equal(p.situacao, "mensagem");
  assert.deepEqual(p.faltas, [d(-2), d(-1)]);
  assert.equal(p.tentativas, 0);
});

test("mensagem enviada dentro do prazo: Aguardando retorno, ainda sem tentativa", () => {
  const p = de(painel({ faltas: [f(1, d(-1))], envios: [envio(1, hoje)] }), 1);
  assert.equal(p.situacao, "aguardando");
  assert.equal(p.envio, "prazo");
  assert.equal(p.prazo_ate, d(1));
  assert.equal(p.tentativas, 0);
});

test("o prazo é até o fim do dia seguinte ao envio", () => {
  assert.equal(P.venceu(d(-1), hoje), false, "enviada ontem: ainda dá tempo até hoje à noite");
  assert.equal(P.venceu(d(-2), hoje), true, "enviada anteontem: venceu");
  const p = de(painel({ faltas: [f(1, d(-3))], envios: [envio(1, d(-2))] }), 1);
  assert.equal(p.situacao, "aguardando");
  assert.equal(p.envio, "sem_retorno", "passou do prazo: não respondeu");
  assert.equal(p.tentativas, 1);
});

test("1ª tentativa sem retorno + falta nova: volta para Mandar mensagem com a tentativa contada", () => {
  const p = de(painel({ faltas: [f(1, d(-5)), f(1, d(-1))], envios: [envio(1, d(-4))] }), 1);
  assert.equal(p.situacao, "mensagem");
  assert.equal(p.tentativas, 1);
});

test("2ª falta, 2ª mensagem sem resposta: Chamar na base", () => {
  const p = de(painel({ faltas: [f(1, d(-8)), f(1, d(-4))], envios: [envio(1, d(-7)), envio(1, d(-3))] }), 1);
  assert.equal(p.situacao, "base");
  assert.equal(p.tentativas, 2);
});

test("duas mensagens para a mesma falta contam uma tentativa só", () => {
  const p = de(painel({ faltas: [f(1, d(-8))], envios: [envio(1, d(-7)), envio(1, d(-5))] }), 1);
  assert.equal(p.tentativas, 1);
  assert.notEqual(p.situacao, "base");
});

test("a 2ª mensagem precisa ter passado do prazo para contar", () => {
  const p = de(painel({ faltas: [f(1, d(-5)), f(1, d(-1))], envios: [envio(1, d(-4)), envio(1, d(-1))] }), 1);
  assert.equal(p.tentativas, 1, "a de ontem ainda está dentro do prazo");
  assert.equal(p.situacao, "aguardando");
});

test("'Não consegui falar' registrado à mão conta como tentativa na hora", () => {
  const tent = { id: 5, colaborador: "PESSOA 1", data_contato: d(-3), efetivo: false };
  const p = de(painel({ faltas: [f(1, d(-4)), f(1, d(-1))], contatos: [tent], envios: [envio(1, d(-1))] }), 1);
  assert.equal(p.tentativas, 1);
  const q = de(painel({ faltas: [f(1, d(-4)), f(1, d(-2))], contatos: [tent], envios: [envio(1, d(-2))] }), 1);
  assert.equal(q.tentativas, 2);
  assert.equal(q.situacao, "base");
});

test("mensagem de antes da falta não conta", () => {
  const p = de(painel({ faltas: [f(1, d(-1))], envios: [envio(1, d(-9))] }), 1);
  assert.equal(p.situacao, "mensagem");
  assert.equal(p.tentativas, 0);
});

test("a pessoa ligou e foi registrado: sai da fila e vai para o acompanhamento", () => {
  const r = painel({ faltas: [f(1, d(-6)), f(1, d(-3))], contatos: [conversa(1, "PESSOA 1", d(-2))], envios: [envio(1, d(-5))] });
  const p = de(r, 1);
  assert.equal(p.situacao, "acomp");
  assert.equal(p.acomp.dia, 2);
  assert.equal(r.resumo.mensagem + r.resumo.aguardando + r.resumo.base, 0);
});

test("antes x depois: menos faltas melhorou, igual é na mesma, mais é faltou de novo", () => {
  assert.equal(P.veredito(4, 0, 12), "melhorando");
  assert.equal(P.veredito(4, 1, 12), "melhorando");
  assert.equal(P.veredito(3, 3, 12), "mesma");
  assert.equal(P.veredito(2, 3, 12), "piorou");
  assert.equal(P.veredito(2, 0, 3), "comecando", "ainda é cedo para dizer que melhorou");
  assert.equal(P.veredito(0, 1, 3), "piorou");
});

test("o acompanhamento conta só falta injustificada ou tratada; abonada aparece à parte", () => {
  const faltas = [f(1, d(-40)), f(1, d(-35)), f(1, d(-33), "T"), f(1, d(-20), "T"), f(1, d(-10)), f(1, d(-8), "A")];
  const p = de(painel({ faltas, contatos: [conversa(1, "PESSOA 1", d(-25), { baixa: { re: 1, por: "Raphael Victor" } })] }), 1);
  assert.equal(p.situacao, "acomp");
  assert.equal(p.acomp.antes, 3, "40, 35 e 33 dias atrás estão nos 30 dias antes do contato (25 dias atrás)");
  assert.equal(p.acomp.depois, 2);
  assert.equal(p.acomp.abonadas_depois, 1);
  assert.equal(p.acomp.veredito, "melhorando");
  assert.equal(p.acomp.ultima_falta_depois, d(-10));
  assert.deepEqual(p.acomp.faltas_depois, [d(-20), d(-10)], "as datas das faltas depois do contato, para o card mostrar quais foram");
});

test("passados os 30 dias a pessoa sai do acompanhamento; falta nova volta para a fila", () => {
  const velho = conversa(1, "PESSOA 1", d(-40));
  assert.equal(de(painel({ faltas: [f(1, d(-45))], contatos: [velho] }), 1), undefined, "sem falta pendente e fora dos 30 dias: não aparece");
  const p = de(painel({ faltas: [f(1, d(-45)), f(1, d(-2))], contatos: [velho] }), 1);
  assert.equal(p.situacao, "mensagem");
  assert.deepEqual(p.faltas, [d(-2)], "só a falta depois da última conversa");
});

test("desligado, histórico antigo e abonada não pedem mensagem", () => {
  const r = painel({ faltas: [f(1, d(-2), "A"), f(2, d(-2), "D"), f(3, d(-2), "I", { tipo: "HISTORICO" }), f(4, d(-50))] });
  assert.equal(r.pessoas.length, 0);
});

test("contato com acordo: a planilha abonando a falta marca 'cumpriu'; passou o prazo sem justificativa, 'não cumpriu'", () => {
  const hist = [[d(-6), "A"]];
  assert.equal(P.acordoAuto({ data_contato: d(-5), data_falta: d(-6), acordo_prazo: d(3) }, hist, hoje), "cumpriu");
  assert.equal(P.acordoAuto({ data_contato: d(-5), data_falta: d(-6), acordo_prazo: d(3) }, [[d(-6), "T"]], hoje), "pendente");
  assert.equal(P.acordoAuto({ data_contato: d(-5), data_falta: d(-6), acordo_prazo: d(-1) }, [[d(-6), "T"]], hoje), "nao_cumpriu");
  assert.equal(P.acordoAuto({ data_contato: d(-5), acordo_prazo: d(-1), acordo_status: "cumprido" }, [[d(-6), "T"]], hoje), "cumpriu", "marcação manual vale mais");
  assert.equal(P.acordoAuto({ data_contato: d(-5) }, hist, hoje), null);
  assert.equal(P.acordoAuto({ data_contato: d(-5), acordo_prazo: d(2) }, [[d(-6), "I"]], hoje), "pendente", "sem data da falta, vale a mais recente antes do contato");
});

test("telefone vem do cadastro (pt_contatos) pelo RE", () => {
  const p = de(painel({ faltas: [f(1, d(-1))], telefones: { 1: "5519999998888" } }), 1);
  assert.equal(p.telefone, "5519999998888");
  assert.equal(de(painel({ faltas: [f(2, d(-1))], telefones: { 1: "5519999998888" } }), 2).telefone, "");
});

test("o resumo conta por situação e por veredito", () => {
  const r = painel({
    faltas: [f(1, d(-1)), f(2, d(-1)), f(3, d(-20)), f(4, d(-9)), f(4, d(-3)), f(5, d(-30)), f(5, d(-12)), f(5, d(-6))],
    envios: [envio(2, hoje)],
    contatos: [conversa(1, "PESSOA 3", d(-15)), conversa(2, "PESSOA 5", d(-10))]
  });
  assert.equal(r.resumo.mensagem, 2, "pessoas 1 e 4");
  assert.equal(r.resumo.aguardando, 1);
  assert.equal(r.resumo.acomp, 2);
  assert.equal(r.resumo.vereditos.melhorando + r.resumo.vereditos.mesma + r.resumo.vereditos.piorou + r.resumo.vereditos.comecando, 2);
});

test("contato registrado sem falta na planilha ainda entra no acompanhamento", () => {
  const p = painel({ contatos: [conversa(9, "MARIA SEM FALTA", d(-4), { baixa: { re: 77, por: "Raphael Victor" } })] }).pessoas[0];
  assert.equal(p.situacao, "acomp");
  assert.equal(p.re, "77");
});
