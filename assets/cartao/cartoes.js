/* Cartões de visita digitais do Grupo ServCamp: os dados de cada pessoa ficam SÓ aqui.
   Usado em três lugares:
   • cartao.html  — a página que o QR Code abre no celular do cliente (/cartao/<apelido>);
   • a guia "🪪 Cartão de Visita" do painel (assets/cartao/painel.js) — QR, impressão, link;
   • o contato para salvar na agenda (assets/cartao/contato/<arquivo>.vcf), gerado a partir daqui.
   Mudou algum dado? Edite aqui e rode:  node assets/cartao/gerar-contatos.js
   (o test/cartao.test.js avisa se o .vcf ficou diferente destes dados).
   Para um vendedor novo, copie o bloco da Gabi com outro apelido e coloque a foto em assets/cartao/. */
(function (raiz) {
  "use strict";

  const EMPRESA = {
    nome: "Grupo ServCamp Terceirizações",
    curto: "Grupo ServCamp",
    anos: 30,
    site: "https://www.gruposervcamp.com.br",
    siteTexto: "www.gruposervcamp.com.br",
    endereco: { rua: "Av. Dermival Bernardes Siqueira, 3.582", bairro: "Swiss Park", cidade: "Campinas", uf: "SP", cep: "13049-252" },
    fixos: ["(19) 3114-3778", "(19) 3326-8739"],
    sobre: "Há 30 anos o Grupo ServCamp cuida da terceirização de serviços para condomínios, empresas e indústrias de Campinas e região — com equipe treinada, supervisão em campo e acompanhamento de perto de cada posto.",
    servicos: ["Portaria e controle de acesso", "Limpeza e conservação", "Zeladoria", "Jardinagem", "Apoio administrativo"],
    // Endereço onde o cartão fica no ar. Vazio = o mesmo do painel. Quando a empresa tiver um endereço próprio
    // (ex.: https://cartao.gruposervcamp.com.br), coloque aqui: o QR passa a apontar para ele.
    enderecoCartao: ""
  };

  const CARTOES = {
    gabi: {
      nome: "Gabriela Alvarenga",
      primeiro: "Gabriela",
      sobrenome: "Alvarenga",
      cargo: "Comercial",
      foto: "/assets/cartao/gabi.jpg",
      email: "comercial@gruposervcamp.com.br",
      celular: "",   // ex.: "(19) 99999-9999" — com ele aparecem os botões WhatsApp e Ligar no celular
      whatsapp: "",  // vazio = usa o celular
      contato: "/assets/cartao/contato/gabriela-alvarenga.vcf"
    }
  };

  const soDigitos = s => String(s || "").replace(/\D/g, "");
  // (19) 3114-3778 → +551931143778 (para tel: e wa.me)
  const internacional = tel => { const d = soDigitos(tel); return d ? (d.length <= 11 ? "55" + d : d) : ""; };
  const telLink = tel => { const d = internacional(tel); return d ? "tel:+" + d : ""; };
  const zapLink = (tel, texto) => { const d = internacional(tel); return d ? "https://wa.me/" + d + (texto ? "?text=" + encodeURIComponent(texto) : "") : ""; };
  const enderecoLinha = () => { const e = EMPRESA.endereco; return `${e.rua} - ${e.bairro}, ${e.cidade}/${e.uf} · CEP ${e.cep}`; };
  const mapaLink = () => { const e = EMPRESA.endereco; return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(`${e.rua} - ${e.bairro}, ${e.cidade} - ${e.uf}, ${e.cep}`); };
  const urlCartao = (apelido, origem) => (EMPRESA.enderecoCartao || origem || "").replace(/\/+$/, "") + "/cartao/" + apelido;

  // vCard 3.0 (o formato que iPhone e Android abrem como "Adicionar contato"). fotoBase64 é opcional.
  function vcard(apelido, fotoBase64) {
    const p = CARTOES[apelido];
    if (!p) throw new Error("cartão não existe: " + apelido);
    const e = EMPRESA.endereco;
    const esc = s => String(s).replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/([,;])/g, "\\$1");
    const linhas = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      `N:${esc(p.sobrenome)};${esc(p.primeiro)};;;`,
      `FN:${esc(p.nome)}`,
      `ORG:${esc(EMPRESA.nome)}`,
      `TITLE:${esc(p.cargo)}`
    ];
    if (p.celular) linhas.push(`TEL;TYPE=CELL,VOICE:+${internacional(p.celular)}`);
    EMPRESA.fixos.forEach(f => linhas.push(`TEL;TYPE=WORK,VOICE:+${internacional(f)}`));
    linhas.push(`EMAIL;TYPE=INTERNET,WORK:${p.email}`);
    linhas.push(`URL:${EMPRESA.site}`);
    linhas.push(`ADR;TYPE=WORK:;;${esc(e.rua + " - " + e.bairro)};${esc(e.cidade)};${esc(e.uf)};${esc(e.cep)};Brasil`);
    linhas.push(`NOTE:${esc(EMPRESA.curto + " - " + EMPRESA.anos + " anos em terceirização de serviços.")}`);
    if (fotoBase64) linhas.push(`PHOTO;ENCODING=b;TYPE=JPEG:${fotoBase64}`);
    linhas.push("END:VCARD");
    return linhas.map(dobrar).join("\r\n") + "\r\n";
  }
  // linhas do vCard têm no máximo 75 bytes; a continuação começa com um espaço (sem cortar acento ao meio)
  function dobrar(linha) {
    const partes = [];
    let atual = "", bytes = 0, limite = 75;
    for (const ch of linha) {
      const n = ch.codePointAt(0) < 0x80 ? 1 : ch.codePointAt(0) < 0x800 ? 2 : ch.codePointAt(0) < 0x10000 ? 3 : 4;
      if (bytes + n > limite) { partes.push(atual); atual = ""; bytes = 0; limite = 74; }
      atual += ch; bytes += n;
    }
    partes.push(atual);
    return partes.join("\r\n ");
  }

  const api = { EMPRESA, CARTOES, internacional, telLink, zapLink, enderecoLinha, mapaLink, urlCartao, vcard };
  if (typeof module === "object" && module.exports) module.exports = api;
  else raiz.SC_CARTOES = api;
})(this);
