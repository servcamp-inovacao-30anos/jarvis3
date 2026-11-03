// api/_medida_doc.js — o TEXTO do documento da medida disciplinar, para o PDF selado no servidor.
// Arquivo com prefixo "_" → NÃO vira rota; é só importado.
//
// É a mesma redação do docHtml de assets/medida/medida.js (a tela e a impressão). O PDF não pode dizer
// outra coisa: test/assinatura.test.js roda o docHtml de verdade e confere cada trecho daqui no texto dele.
// Mudou a redação lá? Mude aqui também (o teste avisa).

const MES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const FECHO = "Não só esperamos que tome as necessárias providências a fim de que não se repita (m) a (s) irregularidade (s) acima discriminada (s), como também aproveitamos para esclarecer-lhes que a repetição ou a prática de outra Prevista em nossos Regulamentos, Ordens de Serviços, etc., irá contribuir desfavoravelmente em seu progresso nesta Empresa, além de poder acarretar-lhe penalidades mais severas, conforme preceitua as disposições do Artigo 482 e suas alíneas da Consolidação das leis do trabalho.";

const iso = d => String(d || "").slice(0, 10);
const dma = d => { const s = iso(d); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.slice(8, 10) + "/" + s.slice(5, 7) + "/" + s.slice(0, 4) : "—"; };
const extenso = d => { const s = iso(d); return s ? (+s.slice(8, 10)) + " de " + MES[+s.slice(5, 7) - 1] + " de " + s.slice(0, 4) : ""; };

// d: { empresa, re, nome, tipoId, dias, inicio, motivo, docData, numero, geradoPor, geradoEm }
function conteudo(d) {
  const nome = String(d.nome || "").toUpperCase();
  const dt = d.inicio ? dma(d.inicio) : "(data)";
  let titulo, abre, motivoTitulo;
  if (d.tipoId === "SUSPENSAO") {
    const n = Number(d.dias) || 0;
    titulo = "AVISO DO EMPREGADOR PARA SUSPENDER O EMPREGADO DO SERVIÇO";
    abre = `Na conformidade da Consolidação das leis do trabalho pelo presente o notificamos que a partir de ${dt} esta suspenso de suas atividades pelo período de ${n || "(dias)"} dia (s) pelo seguinte motivo:`;
    motivoTitulo = "MOTIVO DA SUSPENSÃO";
  } else if (d.tipoId === "ADVERTENCIA_VERBAL") {
    titulo = "REGISTRO DE ADVERTÊNCIA VERBAL";
    abre = `Na conformidade da Consolidação das leis do trabalho, registramos que em ${dt} o(a) colaborador(a) acima foi advertido(a) verbalmente pelo seguinte motivo:`;
    motivoTitulo = "MOTIVO DA ADVERTÊNCIA VERBAL";
  } else if (d.tipoId === "ADVERTENCIA_ESCRITA") {
    titulo = "AVISO DO EMPREGADOR DE ADVERTÊNCIA DISCIPLINAR";
    abre = `Na conformidade da Consolidação das leis do trabalho pelo presente o advertimos formalmente, em ${dt}, pelo seguinte motivo:`;
    motivoTitulo = "MOTIVO DA ADVERTÊNCIA";
  } else {
    throw new Error("tipo de medida inválido");
  }
  return {
    empresa: String(d.empresa || "").toUpperCase(),
    titulo,
    re: `RE: ${d.re} – ${nome}`,
    abre,
    motivoTitulo,
    motivo: String(d.motivo || "").trim().toUpperCase(),
    fecho: FECHO,
    local: `Campinas, ${extenso(d.docData)}`,
    atenciosamente: "atenciosamente"
  };
}

module.exports = { conteudo, FECHO, extenso, dma };
