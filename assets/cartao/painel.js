/* Guia "🪪 Cartão de Visita" do painel (menu Comercial).
   Mostra o QR Code que abre o cartão digital (cartao.html em /cartao/<apelido>) e deixa:
   mostrar em tela cheia numa reunião, baixar a imagem do QR, imprimir o cartão (frente e verso),
   copiar o link e mandar pelo WhatsApp. Os dados vêm de assets/cartao/cartoes.js; o QR, do
   assets/vendor/qrcode-generator.js (o mesmo da assinatura de medidas). Não usa o servidor. */
(function (raiz) {
  "use strict";
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const toast = t => { if (typeof raiz.hqToast === "function") raiz.hqToast(t); };
  const CV = { apelido: null };

  const C = () => raiz.SC_CARTOES;
  const url = apelido => C().urlCartao(apelido, location.origin);

  // matriz do QR (nível M: aguenta um pouco de sujeira/dobra no papel)
  function matriz(texto) {
    const q = raiz.qrcode(0, "M");
    q.addData(texto);
    q.make();
    const n = q.getModuleCount(), m = [];
    for (let r = 0; r < n; r++) { m.push([]); for (let c = 0; c < n; c++) m[r].push(q.isDark(r, c)); }
    return m;
  }
  function qrSvg(texto, cor, borda) {
    const m = matriz(texto), n = m.length, b = borda == null ? 4 : borda, t = n + b * 2;
    let d = "";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (m[r][c]) d += `M${c + b} ${r + b}h1v1h-1z`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${t} ${t}" shape-rendering="crispEdges" role="img" aria-label="QR Code do cartão de visita"><rect width="${t}" height="${t}" fill="#fff"/><path d="${d}" fill="${cor || "#0b1a2e"}"/></svg>`;
  }

  function pessoaAtual() {
    const lista = Object.keys(C().CARTOES);
    if (!CV.apelido || !C().CARTOES[CV.apelido]) {
      // a Gabi (ou quem estiver logado, se tiver cartão) aparece primeiro
      const eu = (sessionStorage.getItem("userNome") || "").toLowerCase();
      CV.apelido = lista.find(a => eu && eu.indexOf(C().CARTOES[a].primeiro.toLowerCase()) === 0) || lista[0];
    }
    return CV.apelido;
  }

  function render() {
    const box = document.getElementById("cv-content");
    if (!box) return;
    if (!C() || typeof raiz.qrcode !== "function") { box.innerHTML = '<div class="cv-msg">Não foi possível carregar o cartão. Recarregue a página.</div>'; return; }
    const ap = pessoaAtual(), p = C().CARTOES[ap], E = C().EMPRESA, link = url(ap);
    const chips = Object.keys(C().CARTOES).length > 1
      ? `<div class="cv-chips">${Object.keys(C().CARTOES).map(a => `<button type="button" class="cv-chip${a === ap ? " on" : ""}" onclick="cvEscolher('${esc(a)}')">${esc(C().CARTOES[a].nome)}</button>`).join("")}</div>` : "";
    const avisos = [];
    if (!p.celular) avisos.push(`<li><b>Falta o celular de ${esc(p.primeiro)}.</b> Hoje o cartão mostra só os telefones fixos. Com o celular cadastrado, aparecem o botão de WhatsApp e a ligação direta para o celular.</li>`);
    if (!E.enderecoCartao) avisos.push(`<li><b>Endereço do link:</b> o QR aponta para o endereço do painel (${esc(location.host)}). Para imprimir em quantidade, vale ter um endereço da empresa (ex.: cartao.gruposervcamp.com.br) — aí é só trocar em um lugar e reimprimir.</li>`);

    box.innerHTML = `
      ${chips}
      <div class="cv-grade">
        <section class="cv-card cv-principal">
          <div class="cv-qr" title="Toque para mostrar em tela cheia" role="button" tabindex="0" onclick="cvTelaCheia()" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();cvTelaCheia()}">${qrSvg(link)}</div>
          <div class="cv-quem"><img src="${esc(p.foto)}" alt="" width="48" height="48"><div><b>${esc(p.nome)}</b><span>${esc(p.cargo)} · ${esc(E.curto)}</span></div></div>
          <div class="cv-link"><input type="text" readonly value="${esc(link)}" aria-label="Link do cartão" onclick="this.select()"><button type="button" class="cv-bt" onclick="cvCopiar()">Copiar</button></div>
        </section>
        <section class="cv-card cv-lado">
          <h3>O que fazer com o QR</h3>
          <div class="cv-acoes">
            <button type="button" class="cv-ac cv-ac-pri" onclick="cvTelaCheia()"><span>⛶</span><div><b>Mostrar em tela cheia</b><small>O cliente aponta a câmera direto da tela</small></div></button>
            <button type="button" class="cv-ac" onclick="cvBaixar()"><span>⬇️</span><div><b>Baixar o QR Code</b><small>Imagem grande, para gráfica, crachá ou apresentação</small></div></button>
            <button type="button" class="cv-ac" onclick="cvImprimir()"><span>🖨️</span><div><b>Imprimir o cartão de visita</b><small>Frente e verso no tamanho 9 × 5 cm (ou salvar em PDF)</small></div></button>
            <button type="button" class="cv-ac" onclick="cvZap()"><span>💬</span><div><b>Enviar pelo WhatsApp</b><small>Manda o link do cartão para um cliente</small></div></button>
            <a class="cv-ac" href="${esc(link)}" target="_blank" rel="noopener"><span>↗️</span><div><b>Abrir o cartão</b><small>Ver a página como o cliente vê</small></div></a>
          </div>
          ${avisos.length ? `<ul class="cv-avisos">${avisos.join("")}</ul>` : ""}
        </section>
        <section class="cv-card cv-previa">
          <h3>Como o cliente vê</h3>
          <div class="cv-cel"><div><iframe src="${esc(link.replace(/^https?:\/\/[^/]+/, ""))}" title="Prévia do cartão no celular" loading="lazy"></iframe></div></div>
        </section>
      </div>`;
  }

  raiz.cvLoad = render;
  raiz.cvEscolher = a => { CV.apelido = a; render(); };

  raiz.cvCopiar = async () => {
    const link = url(pessoaAtual());
    try { await navigator.clipboard.writeText(link); toast("🔗 Link do cartão copiado"); }
    catch (e) { const i = document.querySelector("#cv-content .cv-link input"); if (i) { i.select(); document.execCommand("copy"); toast("🔗 Link do cartão copiado"); } }
  };

  raiz.cvZap = () => {
    const p = C().CARTOES[pessoaAtual()];
    const txt = `Olá! Aqui é ${p.primeiro}, do ${C().EMPRESA.curto}. Segue meu cartão de visita — por ele você salva meu contato e conhece nossos serviços: ${url(pessoaAtual())}`;
    window.open("https://wa.me/?text=" + encodeURIComponent(txt), "_blank", "noopener");
  };

  raiz.cvTelaCheia = () => {
    const ap = pessoaAtual(), p = C().CARTOES[ap];
    const fundo = document.createElement("div");
    fundo.className = "cv-cheia";
    fundo.setAttribute("role", "dialog");
    fundo.setAttribute("aria-label", "QR Code em tela cheia");
    fundo.innerHTML = `<div class="cv-cheia-box"><div class="cv-cheia-qr">${qrSvg(url(ap))}</div><b>${esc(p.nome)}</b><span>${esc(p.cargo)} · ${esc(C().EMPRESA.curto)}</span><p>📷 Aponte a câmera do celular para o código</p></div><button type="button" class="cv-cheia-x" aria-label="Fechar">✕</button>`;
    const fechar = () => { fundo.remove(); document.removeEventListener("keydown", tecla); };
    const tecla = e => { if (e.key === "Escape") fechar(); };
    fundo.addEventListener("click", fechar);
    document.addEventListener("keydown", tecla);
    document.body.appendChild(fundo);
    fundo.querySelector(".cv-cheia-x").focus();
  };

  // PNG grande (1200 px): o QR puro, com a margem branca que o leitor precisa
  raiz.cvBaixar = () => {
    const ap = pessoaAtual(), m = matriz(url(ap)), n = m.length, borda = 4;
    const cel = Math.ceil(1200 / (n + borda * 2)), lado = cel * (n + borda * 2);
    const cv = document.createElement("canvas");
    cv.width = cv.height = lado;
    const g = cv.getContext("2d");
    g.fillStyle = "#fff"; g.fillRect(0, 0, lado, lado);
    g.fillStyle = "#0b1a2e";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (m[r][c]) g.fillRect((c + borda) * cel, (r + borda) * cel, cel, cel);
    const a = document.createElement("a");
    a.download = "qrcode-cartao-" + C().CARTOES[ap].nome.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-") + ".png";
    a.href = cv.toDataURL("image/png");
    document.body.appendChild(a); a.click(); a.remove();
    toast("⬇️ QR Code baixado");
  };

  // Cartão 9 × 5 cm, frente e verso, numa folha A4 — imprimir em papel ou "Salvar como PDF" para a gráfica
  raiz.cvImprimir = () => {
    const ap = pessoaAtual(), p = C().CARTOES[ap], E = C().EMPRESA, link = url(ap), o = location.origin;
    const fixos = E.fixos.join("  ·  ");
    const w = window.open("", "_blank");
    if (!w) { toast("⚠️ O navegador bloqueou a janela de impressão. Libere pop-ups para o painel."); return; }
    w.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Cartão de visita — ${esc(p.nome)}</title><style>
      @page{size:A4;margin:15mm}
      *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
      body{margin:0;font-family:"Segoe UI",Arial,sans-serif;color:#0d1f35}
      .dica{font-size:11px;color:#64748b;margin:0 0 8mm}
      .rot{font-size:9px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;margin:0 0 2mm}
      .c{width:90mm;height:50mm;border:0.2mm dashed #cbd5e1;position:relative;overflow:hidden;margin:0 0 8mm}
      .f{background:#fff;padding:5mm 5mm 4mm 9mm}
      .f:before{content:"";position:absolute;left:0;top:0;bottom:0;width:3.2mm;background:#0d1f35;border-right:1mm solid #facc15}
      .f .logo{position:absolute;right:4mm;top:3.5mm;width:30mm}
      .f h1{margin:7.5mm 0 0;font-size:15pt;line-height:1.1;letter-spacing:-.2px}
      .f .cg{margin:.8mm 0 0;font-size:8.5pt;color:#2148c4;font-weight:700}
      .f ul{list-style:none;margin:3mm 0 0;padding:0;font-size:7pt;line-height:1.5;color:#334155}
      @media screen{body{padding:10mm}}
      .f li b{color:#0d1f35}
      .v{background:linear-gradient(135deg,#0d1f35,#14335a 60%,#1e4d8c);color:#fff;display:flex;align-items:center;gap:5mm;padding:5mm 6mm;border-bottom:1.2mm solid #facc15}
      .v .q{flex:0 0 33mm;width:33mm;height:33mm;background:#fff;border-radius:2mm;padding:1mm}
      .v .q svg{display:block;width:100%;height:100%}
      .v b{display:block;font-size:12pt;line-height:1.2}
      .v span{display:block;font-size:8pt;color:#cbd5e1;margin-top:1.5mm;line-height:1.4}
      .v em{display:block;font-style:normal;margin-top:3mm;font-size:7.5pt;color:#facc15;font-weight:700;letter-spacing:.3px}
      @media print{.dica{display:none}}
    </style></head><body>
      <p class="dica">Tamanho real: 9 × 5 cm. Para mandar à gráfica, escolha <b>Salvar como PDF</b> no destino da impressão. A linha tracejada é só a marca de corte.</p>
      <p class="rot">Frente</p>
      <div class="c f">
        <img class="logo" src="${o}/assets/cartao/logo-servcamp-30.svg" alt="Grupo ServCamp — 30 anos">
        <h1>${esc(p.nome)}</h1>
        <p class="cg">${esc(p.cargo)}</p>
        <ul>
          ${p.celular ? `<li><b>Cel./WhatsApp</b> ${esc(p.celular)}</li>` : ""}
          <li><b>Tel.</b> ${esc(fixos)}</li>
          <li><b>E-mail</b> ${esc(p.email)}</li>
          <li><b>Site</b> ${esc(E.siteTexto)}</li>
          <li>${esc(E.endereco.rua)} - ${esc(E.endereco.bairro)} · ${esc(E.endereco.cidade)}/${esc(E.endereco.uf)}</li>
        </ul>
      </div>
      <p class="rot">Verso</p>
      <div class="c v">
        <div class="q">${qrSvg(link, "#0b1a2e", 2)}</div>
        <div><b>${esc(E.curto)}</b><span>${E.anos} anos em terceirização de serviços</span><em>Aponte a câmera e salve meu contato</em></div>
      </div>
      <script>window.onload=function(){setTimeout(function(){window.print();},250);};<\/script>
    </body></html>`);
    w.document.close();
  };
})(window);
