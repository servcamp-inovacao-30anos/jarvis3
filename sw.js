// sw.js — service worker do Painel ServCamp.
//
// Existe por dois motivos: permitir instalar o sistema como aplicativo (o
// Android só oferece "Instalar" quando há um service worker ativo) e não deixar
// a tela em branco quando o supervisor está em campo, num posto sem sinal.
//
// A regra mais importante aqui é NÃO servir versão velha do sistema.
// Um service worker mal escrito é pior que nenhum: ele congela o app numa
// versão antiga e o usuário fica sem entender por que a correção não chegou.
// Por isso o HTML é sempre buscado na rede primeiro, e o cache só entra quando
// a rede falha de fato.

// v2: a v1 guardava QUALQUER arquivo estático para sempre (scripts e estilos em
// /assets também), e quem já tinha o v1 ficaria preso numa versão velha. Trocar o
// nome faz o "activate" abaixo apagar esse cache antigo.
const VERSAO = "jarvis-v2";
const ESTATICOS = [
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
  "/favicon-32.png",
  "/site.webmanifest"
];

self.addEventListener("install", e => {
  // Assume o controle já nesta carga, em vez de esperar todas as abas fecharem.
  // Num painel que fica aberto o dia inteiro, esperar significaria nunca.
  self.skipWaiting();
  e.waitUntil(
    caches.open(VERSAO).then(c => c.addAll(ESTATICOS)).catch(() => {})
  );
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    // apaga caches de versões anteriores
    const nomes = await caches.keys();
    await Promise.all(nomes.filter(n => n !== VERSAO).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // CDN e terceiros passam direto

  // As APIs NUNCA são cacheadas. Presença, chat e planilha precisam ser reais;
  // mostrar resposta antiga aqui seria pior do que mostrar erro.
  if (url.pathname.startsWith("/api/")) return;

  // Navegação (abrir o sistema): rede primeiro, cache só como rede de segurança.
  if (req.mode === "navigate") {
    e.respondWith((async () => {
      try {
        const r = await fetch(req);
        const c = await caches.open(VERSAO);
        c.put("/index.html", r.clone());
        return r;
      } catch (err) {
        const cache = await caches.match("/index.html");
        return cache || Response.error();
      }
    })());
    return;
  }

  // Só os ícones e o manifesto (a lista fixa acima) vêm do cache: não mudam e são
  // pequenos. Scripts, estilos, fontes e sons mudam a cada versão do sistema e
  // vão sempre à rede, pelo caminho normal do navegador.
  if (ESTATICOS.indexOf(url.pathname) < 0) return;
  e.respondWith((async () => {
    const hit = await caches.match(req);
    if (hit) return hit;
    try {
      const r = await fetch(req);
      if (r && r.status === 200 && r.type === "basic") {
        const c = await caches.open(VERSAO);
        c.put(req, r.clone());
      }
      return r;
    } catch (err) {
      return Response.error();
    }
  })());
});

// ── Avisos de faltas (notificação push) ───────────────────────────────────
// O servidor (api/_avisos.js) manda { titulo, corpo, tipo, pg, url, tag }.
// O som da notificação é o do celular: nenhum navegador deixa a página escolher
// o toque de uma notificação push. O que dá para fazer daqui:
//   • vibração com um padrão próprio (três toques e um longo), que identifica
//     o aviso de faltas mesmo com o celular no bolso (Android);
//   • com o painel aberto, a página toca o som próprio (/assets/som/aviso-faltas.wav);
//   • no Android, o supervisor pode escolher esse mesmo arquivo como toque das
//     notificações do app (o painel explica como).
const VIBRA_FALTAS = [220, 90, 220, 90, 220, 160, 650];

self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { corpo: e.data ? e.data.text() : "" }; }
  const titulo = d.titulo || "ServCamp · faltas injustificadas";
  const opcoes = {
    body: d.corpo || "",
    icon: "/icon-192.png",
    badge: "/favicon-32.png",
    tag: d.tag || "faltas",
    renotify: true,                          // aviso novo com a mesma etiqueta toca e vibra de novo
    requireInteraction: d.tipo === "RESUMO", // o resumo fica na tela até alguém tocar
    silent: false,
    vibrate: VIBRA_FALTAS,
    timestamp: Date.now(),
    data: { pg: d.pg || "faltassup", url: d.url || "/?abrir=faltassup", tipo: d.tipo || "", aviso: d.aviso || "" }
  };
  e.waitUntil((async () => {
    await self.registration.showNotification(titulo, opcoes);
    // painel aberto: a própria página toca o som do aviso de faltas
    const abas = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    abas.forEach(c => c.postMessage({ tipo: "aviso-faltas", aviso: d.tipo || "" }));
  })());
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  const dados = e.notification.data || {};
  const pg = dados.pg || "faltassup";
  e.waitUntil((async () => {
    const abas = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const aba = abas.find(c => new URL(c.url).origin === self.location.origin);
    if (aba) {
      // reaproveita a aba aberta: ela mesma navega, respeitando login e permissões
      try { await aba.focus(); } catch (err) {}
      aba.postMessage({ tipo: "abrir", pg, aviso: dados.aviso || "" });
      return;
    }
    await self.clients.openWindow(dados.url || "/?abrir=" + pg);
  })());
});
