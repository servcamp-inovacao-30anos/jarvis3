/* Página do cartão de visita (cartao.html, aberta pelo QR Code em /cartao/<apelido>).
   Sem login e sem servidor: os dados vêm de assets/cartao/cartoes.js. */
(function () {
  "use strict";
  const C = window.SC_CARTOES;
  const raiz = document.getElementById("ct");
  if (!C || !raiz) return;
  const E = C.EMPRESA;
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const IC = {
    salvar: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>',
    zap: '<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5z"/>',
    tel: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>',
    mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 6-10 7L2 6"/>',
    site: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
    mapa: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
    enviar: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>',
    ok: '<path d="M20 6 9 17l-5-5"/>'
  };
  const ic = n => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${IC[n]}</svg>`;

  // /cartao/gabi (endereço do QR) ou cartao.html?p=gabi
  const apelido = (location.pathname.match(/\/cartao\/([a-z0-9-]+)\/?$/i) || [])[1] || new URLSearchParams(location.search).get("p") || "";
  const p = C.CARTOES[String(apelido).toLowerCase()] || null;

  const fixo = E.fixos[0];
  const zap = p && C.zapLink(p.whatsapp || p.celular, `Olá, ${p.primeiro}! Peguei seu cartão de visita do ${E.curto} e gostaria de conversar.`);
  const email = (p && p.email) || "comercial@gruposervcamp.com.br";
  const assunto = "?subject=" + encodeURIComponent("Contato pelo cartão de visita — " + E.curto);

  const acoes = [];
  if (zap) acoes.push(`<a class="ct-ac ct-ac-zap" href="${esc(zap)}" target="_blank" rel="noopener">${ic("zap")}<span>WhatsApp</span></a>`);
  acoes.push(`<a class="ct-ac" href="${esc(C.telLink(p && p.celular ? p.celular : fixo))}">${ic("tel")}<span>Ligar</span></a>`);
  acoes.push(`<a class="ct-ac" href="mailto:${esc(email)}${esc(assunto)}">${ic("mail")}<span>E-mail</span></a>`);
  acoes.push(`<a class="ct-ac" href="${esc(E.site)}" target="_blank" rel="noopener">${ic("site")}<span>Site</span></a>`);
  acoes.push(`<a class="ct-ac" href="${esc(C.mapaLink())}" target="_blank" rel="noopener">${ic("mapa")}<span>Como chegar</span></a>`);
  if (navigator.share) acoes.push(`<button type="button" class="ct-ac" id="ctEnviar">${ic("enviar")}<span>Compartilhar</span></button>`);

  const linhas = [];
  if (p && p.celular) linhas.push(`<li>${ic("zap")}<div><small>Celular / WhatsApp</small><a href="${esc(C.telLink(p.celular))}">${esc(p.celular)}</a></div></li>`);
  linhas.push(`<li>${ic("tel")}<div><small>Telefone fixo</small>${E.fixos.map(f => `<a href="${esc(C.telLink(f))}">${esc(f)}</a>`).join('<i class="ct-sep">·</i>')}</div></li>`);
  linhas.push(`<li>${ic("mail")}<div><small>E-mail</small><a href="mailto:${esc(email)}${esc(assunto)}">${esc(email)}</a></div></li>`);
  linhas.push(`<li>${ic("site")}<div><small>Site</small><a href="${esc(E.site)}" target="_blank" rel="noopener">${esc(E.siteTexto)}</a></div></li>`);
  const en = E.endereco;
  linhas.push(`<li>${ic("mapa")}<div><small>Endereço</small><a href="${esc(C.mapaLink())}" target="_blank" rel="noopener">${esc(en.rua)} - ${esc(en.bairro)}<br>${esc(en.cidade)}/${esc(en.uf)} · CEP <span class="ct-nw">${esc(en.cep)}</span></a></div></li>`);

  const topo = p
    ? `<img class="ct-foto" src="${esc(p.foto)}" alt="Foto de ${esc(p.nome)}" width="120" height="120">
       <h1>${esc(p.nome)}</h1>
       <p class="ct-cargo">${esc(p.cargo)} · ${esc(E.curto)}</p>
       <a class="ct-salvar" href="${esc(p.contato)}">${ic("salvar")}<span>Salvar contato</span></a>`
    : `<h1>${esc(E.nome)}</h1><p class="ct-cargo">${E.anos} anos de terceirização de serviços</p>`;

  document.title = (p ? p.nome + " — " : "") + "Cartão de visita | " + E.curto;
  raiz.innerHTML = `
    <section class="ct-cartao">
      <img class="ct-logo" src="/assets/cartao/logo-servcamp-30.svg" alt="Grupo ServCamp terceirizações — 30 anos" width="220" height="77">
      ${topo}
      <nav class="ct-acoes" data-n="${acoes.length}" aria-label="Falar com ${esc(p ? p.primeiro : E.curto)}">${acoes.join("")}</nav>
    </section>
    <section class="ct-bloco">
      <h2>Sobre o ${esc(E.curto)}</h2>
      <p>${esc(E.sobre)}</p>
      <ul class="ct-serv">${E.servicos.map(s => `<li>${ic("ok")}${esc(s)}</li>`).join("")}</ul>
    </section>
    <section class="ct-bloco">
      <h2>Contato</h2>
      <ul class="ct-lista">${linhas.join("")}</ul>
    </section>`;

  const bt = document.getElementById("ctEnviar");
  if (bt) bt.addEventListener("click", () => {
    navigator.share({ title: (p ? p.nome + " — " : "") + E.curto, text: p ? `${p.nome} · ${p.cargo} · ${E.curto}` : E.nome, url: location.href }).catch(() => {});
  });
})();
