// assets/ligacoes/ligacoes.js — guia Feedback de Faltas (SAC): o SAC manda um WhatsApp pedindo que a pessoa ligue (modelo receptivo).
// Saiu do index.html (que tem limite de tamanho, ver test/auth_exigencia). Script clássico, carregado no fim do
// <body> como os outros módulos de assets/: usa do index.html _esc, rhFmt, ymd, ST, inR, mT, mA, DASHBOARD_DATA e VG,
// sempre na hora do uso (nada aqui depende deles ao carregar).
//
// Quatro situações, uma pessoa em cada uma (a conta é do servidor: api/_lig_painel.js, GET /api/ligacoes?acao=painel):
//   Mandar mensagem · Aguardando retorno · Chamar na base · Acompanhando 30 dias
// Cada card leva uma ação principal; clicar no card abre o panorama da pessoa num painel lateral.
const LIG_MOTIVOS=[["Saúde"],["Familiar"],["Pessoal"],["Transporte"],["Conduta"],["Financeiro"],["Sem justificativa"],["Outro"]];
// resultados que significam "não falei com a pessoa" (o servidor manda a lista completa; esta serve de reserva)
const FB_TENT=["NAO_ATENDEU","CAIXA_POSTAL","NUMERO_INVALIDO","SEM_RESPOSTA","RECADO","PEDIU_RETORNO"];
let LIG_C=[],LIG_P=[],LIG_RESUMO=null,LIG_PRAZO=1,LIG_RES={},LIG_ABANDONO_N=0,LIG_COD={},LIG_PODE_BAIXAR=false,LIG_ZAP=null,LIG_MODELO=null,LIG_HOJE="",LIG_VIEW=[],LIG_TAB="mensagem",LIG_VF="todos",LIG_HIST=null,LIG_PAN=null;
/* aba principal (fila · monit · desemp · hist), filtros do topo, números (GET ?acao=indicadores) e motivos (padrões + criados pelo SAC) */
let LIG_ABA="visao",LIG_IND=null,LIG_MOT=LIG_MOTIVOS.map(m=>({chave:m[0],nome:m[0],ativo:true,padrao:true,antigos:[]})),LIG_MOT_EDITA=false;
let LIG_F={per:"hoje",de:"",ate:"",turno:"todos",area:"todas",tipo:"todos"},LIG_DES={modo:"folha",ini:"",fim:"",ord:"var",dir:1,ef:"todos",mot:"",pt:"efetivo",ptord:"faltas"};
try{const t=localStorage.getItem("fbTab2");if(t)LIG_TAB=t;const a=localStorage.getItem("fbAba3");if(a)LIG_ABA=a;const m=localStorage.getItem("fbDesModo");if(m)LIG_DES.modo=m;}catch(e){}
let LIG_ASS="";
function ligLoad(){
  const ler=u=>fetch(u).then(r=>r.json().then(j=>({ok:r.ok,j})));
  const aux=u=>ler(u).then(x=>x.ok?x.j:null).catch(()=>null); // o que é complemento não derruba a tela
  const el=document.getElementById("lig-content");
  Promise.all([ler("/api/ligacoes"),ler("/api/ligacoes?acao=painel"),waStatus(),aux("/api/ligacoes?acao=zap_modelo"),aux("/api/ligacoes?acao=indicadores"),aux("/api/ligacoes?acao=motivos")]).then(([l,p,zap,mod,ind,mot])=>{
    if(!l.ok)throw new Error((l.j&&l.j.error)||"");
    if(!p.ok)throw new Error((p.j&&p.j.error)||"");
    LIG_C=l.j.rows||[];LIG_COD=l.j.codigos||{};LIG_PODE_BAIXAR=!!l.j.pode_baixar;LIG_RES=l.j.resultados||{};
    LIG_HOJE=p.j.hoje||l.j.hoje||"";LIG_P=p.j.pessoas||[];LIG_RESUMO=p.j.resumo||null;LIG_PRAZO=p.j.prazo_resposta_dias||1;
    LIG_ZAP=zap;if(LIG_ZAP)LIG_ZAP.pode_conectar=LIG_PODE_BAIXAR;LIG_MODELO=mod;LIG_IND=ind;
    if(mot&&Array.isArray(mot.motivos)){LIG_MOT=mot.motivos;LIG_MOT_EDITA=!!mot.pode_editar;}
    /* atualização automática do sistema: se a tela já está aberta, só troca o que mudou e sem animação (nada de piscar) */
    const ass=JSON.stringify([l.j,p.j,ind,mot]);
    if(document.getElementById("lig-root")&&LIG_ASS){if(ass===LIG_ASS)return;LIG_ASS=ass;if(document.querySelector(".fb-ov:not(.out)"))return;window._fbQuieto=1;try{fbNavContagens();ligPanel();}finally{window._fbQuieto=0;}return;}
    LIG_ASS=ass;
    fbFechar("lig-perfil-modal",true);
    ligRender();
  }).catch(err=>{console.error("Erro ligações:",err);if(el)el.innerHTML='<div style="padding:40px;text-align:center;color:#dc2626;font-size:.85rem">Erro ao carregar'+(err&&err.message?': '+_esc(err.message):'. Verifique a conexão.')+'</div>';});
}


/* ── dados que o index.html também usa: RE, código de cada falta, quem faltou no período (card Ligações da Visão Geral) ── */
/* colaboradores que faltaram DENTRO do período selecionado no filtro do
   sistema (além de turno e área) — nada de janela fixa própria. */
/* RE (matrícula) do colaborador.
   A falta passou a trazer RE direto da planilha, mas os snapshots enviados
   ANTES dessa mudança não têm o campo. Nesses casos a RE é buscada nos ATIVOS
   pelo nome — seguro aqui, porque a base tem 582 nomes para 582 registros, sem
   homônimos. Assim a tela já funciona antes de a planilha nova subir, e passa a
   usar o dado direto assim que ela subir. */
var _LIG_RE_MAP=null;
function ligREMapa(){
  if(_LIG_RE_MAP)return _LIG_RE_MAP;
  _LIG_RE_MAP={};
  const D=(typeof DASHBOARD_DATA!=="undefined"&&DASHBOARD_DATA)?DASHBOARD_DATA:{};
  (D.ativos||[]).forEach(a=>{
    const n=String(a.NOME||"").trim().toUpperCase();
    if(n&&a.RE)_LIG_RE_MAP[n]=a.RE;
  });
  return _LIG_RE_MAP;
}
function ligRE(nome,direto){
  if(direto)return String(direto);
  const v=ligREMapa()[String(nome||"").trim().toUpperCase()];
  return v?String(v):"";
}
/* BUSCA por nome ou RE (em todas as abas).
   Filtra o que já está na tela em vez de reconstruir o HTML: re-renderizar a
   cada tecla faria o cursor sair do campo a cada letra digitada.
   O termo fica guardado em LIG_BUSCA_P e é reaplicado a cada desenho da lista,
   senão qualquer atualização automática apagaria a busca em andamento.
   */
var LIG_BUSCA_P="";
function _ligNorm(v){
  return String(v||"").trim().toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
}
function _ligKey(re,nome,dia){
  return String(re==null?"":re).trim().replace(/^0+(?=\d)/,"")+"|"+(_ligNorm(nome).split(" ")[0]||"")+"|"+String(dia||"").slice(0,10);
}
function ligCodigoDe(f){
  const dia=String(f.DATA||"").slice(0,10);
  const k=_ligKey(ligRE(f.NOME,f.RE),f.NOME,dia);
  const c=LIG_COD[k]||((typeof VG!=="undefined"&&VG.ligCodigos)?VG.ligCodigos[k]:"");
  if(c)return c;
  const raw=String(f.ABONO||"").trim().toUpperCase();
  return(raw==="A"||raw==="J"||raw==="L")?raw:"I";
}
function ligCat(cod){
  if(cod==="A"||cod==="J"||cod==="L")return"abo";
  if(cod==="T")return"trat";
  if(cod==="AF")return"af";
  if(cod==="D")return"dem";
  return"inj";
}
/* quem faltou no período do filtro do sistema (turno e área também), com cada falta já classificada.
   Afastado e desligado não entram: não há o que cobrar nem o que conversar. */
function ligFaltasRecentes(){
  const D=(typeof DASHBOARD_DATA!=="undefined"&&DASHBOARD_DATA)?DASHBOARD_DATA:{};
  const m={};
  LIG_ABANDONO_N=0;
  (D.faltas||[]).forEach(f=>{
    const nome=(f.NOME||"").trim();if(!nome)return;
    const dia=f.DATA?String(f.DATA).slice(0,10):"";if(!dia)return;
    if(typeof inR==="function"&&!inR(dia))return;
    // quem abandonou o posto não entra na fila de ligação (mesma regra do filterAll)
    if(String(f.LOCAL||"").toUpperCase().indexOf("ABANDONO")>=0){LIG_ABANDONO_N++;return;}
    if(typeof mT==="function"&&!mT(f))return;
    if(typeof mA==="function"&&!mA(f))return;
    const cod=ligCodigoDe(f),cat=ligCat(cod);
    if(cat==="af"||cat==="dem")return;
    if(!m[nome])m[nome]={colaborador:nome,re:f.RE||"",posto:(f.LOCAL||"").trim(),supervisor:(f.AREA||"").trim(),faltas:[]};
    m[nome].faltas.push({d:dia,cod,cat});
  });
  return Object.values(m).map(x=>{x.faltas.sort((a,b)=>a.d<b.d?-1:a.d>b.d?1:0);return x;});
}

/* ── mensagem padrão do WhatsApp ── */
const LIG_SAC_META=30; // dias-alvo de estabilidade pós-contato
const LIG_MODELO_PADRAO="Olá, {nome}. Aqui é o SAC do Grupo ServCamp. Registramos a sua ausência no trabalho{data} e precisamos entender o que aconteceu. Por favor, ligue para este número assim que puder, para conversarmos sobre o motivo da falta. Contamos com você.";
function ligZapTexto(nome,datas){
  const t=(LIG_MODELO&&LIG_MODELO.texto)||LIG_MODELO_PADRAO;
  const p=String(nome||"").trim().split(/\s+/)[0]||"";
  const pn=p?p.charAt(0).toUpperCase()+p.slice(1).toLowerCase():"";
  const d=(datas&&datas.length)?" em "+datas.map(x=>rhFmt(x).slice(0,5)).join(", "):"";
  return t.replace(/\{nome\}/g,pn).replace(/\{data\}/g,d);
}
function ligSomaDias(d,n){const x=new Date(String(d).slice(0,10)+"T12:00:00Z");x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10);}

/* ═════ ícones e ajudas (SVG de traço único, sem emoji) ═════ */
const FB_IC={
  phone:'<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>',
  chat:'<path d="M21 11.5a8.4 8.4 0 0 1-12.3 7.4L3 20.5l1.7-5.4A8.5 8.5 0 1 1 21 11.5z"/>',
  search:'<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  user:'<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  check:'<path d="M20 6 9 17l-5-5"/>',
  ok:'<circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 4.5-5"/>',
  alert:'<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  folder:'<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  go:'<path d="m9 6 6 6-6 6"/>',
  x:'<path d="M18 6 6 18M6 6l12 12"/>',
  undo:'<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  chart:'<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  doc:'<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  qr:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3M21 14v.01M14 21h.01M17 21h4v-3"/>',
  edit:'<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  image:'<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>',
  trash:'<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  send:'<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  cal:'<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  power:'<path d="M12 2v10M18.4 6.6a9 9 0 1 1-12.8 0"/>',
  hist:'<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
  list:'<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  up:'<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  down:'<path d="M3 7l6 6 4-4 8 8"/><path d="M15 17h6v-6"/>',
  flat:'<path d="M4 12h16"/><path d="m14 6 6 6-6 6"/>',
  eye:'<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  bulb:'<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z"/>',
  left:'<path d="m15 6-6 6 6 6"/>',
  pin:'<circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="9"/>',
  chev:'<path d="m6 9 6 6 6-6"/>',
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon:'<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  eq:'<path d="M5 9h14M5 15h14"/>',
  plus:'<path d="M12 5v14M5 12h14"/>'
};
function fbI(n,c){return '<svg class="fb-i'+(c?' '+c:'')+'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(FB_IC[n]||"")+'</svg>';}
const FB_ABO_NOME={A:"Abonada",J:"Justificada",L:"Licença",AF:"Afastamento",I:"Injustificada",T:"Fora da cobrança"};
function fbDd(d){return rhFmt(d).slice(0,5);}
function fbDias(d){
  const a=new Date(ligHojeISO()+"T12:00:00Z"),b=new Date(String(d).slice(0,10)+"T12:00:00Z");
  const n=Math.round((a-b)/86400000);
  if(n===0)return"hoje";
  if(n===1)return"ontem";
  if(n>1)return"há "+n+" dias";
  if(n===-1)return"amanhã";
  return"em "+(-n)+" dias";
}
function fbPlural(n,um,varios){return n+" "+(n===1?um:varios);}
function fbRE(nome,re){const r=ligRE(nome,re);return r?'<span class="fb-re">RE '+_esc(r)+'</span>':"";}
function fbTagCod(cod){
  const t={I:"tn-da",A:"tn-am",J:"tn-ok",L:"tn-br",AF:"tn-br",T:"tn-vi"}[cod]||"tn-gr";
  return '<span class="fb-tag '+t+'">'+_esc(FB_ABO_NOME[cod]||"Sem classificação")+'</span>';
}
function fbVazio(ic,titulo,texto,tom){return '<div class="fb-empty '+(tom||"tn-br")+'"><div class="fb-empty-i">'+fbI(ic)+'</div><h3>'+_esc(titulo)+'</h3><p>'+_esc(texto)+'</p></div>';}
function fbAjuda(texto){return '<div class="fb-help">'+fbI("info")+'<div>'+texto+'</div></div>';}
function fbBtn(label,onclick,cls,icone){return '<button type="button" class="fb-btn '+(cls||"")+'" onclick="'+onclick+'">'+(icone?fbI(icone):"")+_esc(label)+'</button>';}

/* ── estado do WhatsApp do SAC ── */
function fbZapEstado(){
  const z=LIG_ZAP;
  if(z&&z.configurado===false)return{cls:"off",txt:"programa não está ligado neste computador"};
  if(z&&!z.ok)return{cls:"err",txt:z.motivo||"indisponível"};
  if(z&&z.state==="open")return{cls:"on",txt:"conectado"+(z.numero?" · +"+z.numero:"")};
  if(z&&(z.state==="qr"||z.state==="connecting"))return{cls:"warn",txt:"aguardando a leitura do QR code"};
  return{cls:"off",txt:z?"desconectado":"sem resposta do servidor"};
}
function ligZapChipHtml(){const e=fbZapEstado();return'<i class="fb-dot '+e.cls+'" title="WhatsApp do SAC: '+_esc(e.txt)+'"></i>';}
function ligZapChip(){const e=document.getElementById("lig-zap-chip");if(e)e.innerHTML=ligZapChipHtml();const b=document.getElementById("lz-estado");if(b)b.outerHTML=fbZapLinha();const v=document.getElementById("lig-vg-zap");if(v)v.outerHTML=fbZapVG();}
/* linha de estado dentro da janela do WhatsApp: conectado ou não e, para a coordenação, conectar, desconectar e a mensagem padrão */
function fbZapLinha(){
  const z=LIG_ZAP||{},e=fbZapEstado(),pode=z.configurado!==false&&z.ok&&z.pode_conectar;
  return'<div class="fb-zl" id="lz-estado"><span class="fb-wa '+e.cls+'"><i class="fb-dot"></i><span><b>WhatsApp do SAC</b> '+_esc(e.txt)+'</span></span><span class="fb-zl-a">'
    +(pode?(z.state==="open"?'<button type="button" class="fb-btn ghost sm" onclick="ligZapDesconectar()">'+fbI("power")+'Desconectar</button>':'<button type="button" class="fb-btn sm" onclick="ligZapConectar()">'+fbI("qr")+'Conectar</button>'):"")
    +(LIG_PODE_BAIXAR&&z.configurado!==false?'<button type="button" class="fb-btn ghost sm" onclick="ligZapModeloForm()">'+fbI("edit")+'Mensagem padrão</button>':"")+'</span></div>';
}

/* ── movimento: parallax do cabeçalho e contagem dos números ── */
function fbFx(){
  const sc=document.querySelector(".cnt");if(!sc||sc._fb)return;sc._fb=1;
  let raf=0;
  const quadro=()=>{
    raf=0;
    const root=document.getElementById("lig-root");if(!root)return;
    root.style.setProperty("--fb-sy",Math.max(0,Math.round(sc.scrollTop)));
    const tabs=root.querySelector(".fb-tabs");
    if(tabs)tabs.classList.toggle("stuck",tabs.getBoundingClientRect().top<=sc.getBoundingClientRect().top+1&&sc.scrollTop>8);
  };
  sc.addEventListener("scroll",()=>{if(!raf)raf=requestAnimationFrame(quadro);},{passive:true});
}
function fbContarTudo(){
  const reduz=window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.querySelectorAll("#lig-root .fb-kv[data-n]").forEach(e=>{
    const fim=Number(e.getAttribute("data-n"))||0;
    if(reduz||fim<2){e.textContent=fim;return;}
    const t0=performance.now(),dur=700;
    const passo=t=>{const p=Math.min(1,(t-t0)/dur),k=1-Math.pow(1-p,3);e.textContent=Math.round(fim*k);if(p<1)requestAnimationFrame(passo);};
    e.textContent="0";requestAnimationFrame(passo);
  });
}

/* ═════ janelas, avisos e confirmações ═════ */
function ligHojeISO(){return LIG_HOJE||ymd(new Date());}
/* janela: fbDialog("id",{titulo,sub,corpo,rodape,tam:"sm|md|",lateral:true}) — Esc e clique fora fecham */
function fbDialog(id,o){
  fbFechar(id,true);
  const ov=document.createElement("div");
  ov.id=id;ov.className="fb-ov"+(o.lateral?" drawer":"");
  ov.setAttribute("role","dialog");ov.setAttribute("aria-modal","true");ov.setAttribute("aria-label",o.titulo||"Janela");
  ov.innerHTML='<div class="fb-dlg '+(o.tam||"")+(o.lateral?" drawer":"")+(o.tom?" "+o.tom:"")+'">'
    +'<div class="fb-dlg-h'+(o.banner?" banner":"")+'"><div><h2>'+_esc(o.titulo||"")+'</h2>'+(o.sub?'<p>'+o.sub+'</p>':"")+'</div><button type="button" class="fb-ib" onclick="fbFechar(\''+id+'\')" title="Fechar" aria-label="Fechar">'+fbI("x")+'</button></div>'
    +'<div class="fb-dlg-b">'+(o.corpo||"")+'</div>'+(o.rodape?'<div class="fb-dlg-f">'+o.rodape+'</div>':"")+'</div>';
  ov.addEventListener("mousedown",e=>{if(e.target===ov)fbFechar(id);});
  document.body.appendChild(ov);
  if(o.lateral&&fbMov()){const pf=ov.querySelector(".fb-pf");if(pf)[...pf.children].slice(0,8).forEach((x,i)=>x.animate([{opacity:0,transform:"translate3d(24px,0,0)"},{opacity:1,transform:"none"}],{duration:560,delay:120+i*45,easing:FB_EASE,fill:"backwards"}));}
  const foco=ov.querySelector("[autofocus],input:not([type=hidden]):not([type=file]),textarea,button.pri");
  if(foco&&!o.semFoco)setTimeout(()=>{try{foco.focus({preventScroll:true});}catch(e){}},60);
  return ov;
}
function fbFechar(id,agora){
  const ov=document.getElementById(id);if(!ov)return;
  if(agora||(window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches)){ov.remove();return;}
  ov.classList.add("out");setTimeout(()=>{const o=document.getElementById(id);if(o&&o.classList.contains("out"))o.remove();},170);
}
if(!window._fbEsc){window._fbEsc=1;document.addEventListener("keydown",e=>{
  if(e.key!=="Escape")return;
  const l=document.querySelectorAll(".fb-ov:not(.out)");if(l.length)fbFechar(l[l.length-1].id);
});}
function fbToast(msg,tom){
  const t=document.createElement("div");t.className="fb-toast "+(tom||"ok");t.setAttribute("role","status");
  t.innerHTML=fbI(tom==="err"?"alert":"ok")+'<span>'+_esc(msg)+'</span>';
  document.body.appendChild(t);
  setTimeout(()=>{t.style.transition="opacity .2s ease-in";t.style.opacity="0";setTimeout(()=>t.remove(),220);},tom==="err"?5200:3200);
}
/* confirmação no padrão da tela (no lugar do confirm() do navegador): devolve Promise<boolean> */
function fbConfirm(o){
  return new Promise(res=>{
    const id="fb-conf";let feito=false;
    const fim=v=>{if(feito)return;feito=true;fbFechar(id);res(v);};
    fbDialog(id,{titulo:o.titulo,tam:"sm",corpo:'<p style="margin:0;font-size:.875rem;line-height:1.6;color:var(--fb-text2)">'+o.texto+'</p>',
      rodape:'<button type="button" class="fb-btn" id="fb-conf-n">Cancelar</button><button type="button" class="fb-btn '+(o.perigo?"warn":"pri")+'" id="fb-conf-s">'+_esc(o.ok||"Confirmar")+'</button>'});
    document.getElementById("fb-conf-n").onclick=()=>fim(false);
    document.getElementById("fb-conf-s").onclick=()=>fim(true);
    const ov=document.getElementById(id);
    ov.addEventListener("mousedown",e=>{if(e.target===ov)fim(false);});
    new MutationObserver((m,ob)=>{if(!document.getElementById(id)){ob.disconnect();fim(false);}}).observe(document.body,{childList:true});
  });
}

/* ═════ apoio do registro, exclusão, baixa e combinado ═════ */
function ligMotivoSugerido(txt){
  const t=(txt||"").toLowerCase();
  if(/atestad|m[eé]dic|doen|sa[uú]de|consulta|exame|dor|hospital|gripe|covid/.test(t))return"Saúde";
  if(/filh|fam[ií]li|m[ãa]e|pai|esposa|marido|falecim|[óo]bito|luto|crian/.test(t))return"Familiar";
  if(/[oô]nibus|transporte|carro|moto|condu[çc][aã]o|greve|passagem/.test(t))return"Transporte";
  if(/dinheiro|salári|pagament|adiant|financ/.test(t))return"Financeiro";
  if(/dormiu|esqueceu|n[ãa]o quis|desin|sem justif|abandono/.test(t))return"Conduta";
  if(/pessoal|resolver|problema/.test(t))return"Pessoal";
  return"";
}
function ligApi(url,metodo,corpo){
  return fetch(url,{method:metodo||"GET",headers:{"Content-Type":"application/json"},body:corpo?JSON.stringify(corpo):undefined})
    .then(r=>r.json().catch(()=>({})).then(j=>{if(!r.ok)throw new Error((j&&j.error)||("Erro "+r.status));return j;}));
}
function ligExcluir(id){
  const c=LIG_C.find(x=>x.id===id);
  fbConfirm({titulo:"Excluir este contato?",perigo:true,ok:"Excluir",
    texto:'O contato de <b>'+_esc(c?c.colaborador:id)+'</b> será excluído.'+(c&&c.baixa?' Como ele tinha baixa, as faltas dessa pessoa <b>voltam para o painel de cobrança</b>.':"")+' O registro fica guardado na auditoria.'})
    .then(ok=>{if(ok)ligApi("/api/ligacoes?id="+encodeURIComponent(id),"DELETE").then(()=>{fbToast("Contato excluído.");ligLoad();}).catch(e=>fbToast(e.message||"Não consegui excluir.","err"));});
}
function ligBaixa(id,baixar,re){
  const c=LIG_C.find(x=>x.id===id),n=_esc(c?c.colaborador:id);
  fbConfirm(baixar
    ?{titulo:"Retirar da cobrança?",ok:"Retirar da cobrança",texto:'As faltas injustificadas de <b>'+n+'</b>, de '+LIG_SAC_META+' dias antes a '+LIG_SAC_META+' dias depois do feedback, deixam de gerar alerta no painel de cobrança e passam a ser acompanhadas só aqui. Dá para desfazer.'}
    :{titulo:"Voltar para a cobrança?",ok:"Voltar para a cobrança",texto:'As faltas de <b>'+n+'</b> voltam a aparecer no painel de cobrança.'})
    .then(ok=>{if(ok)ligApi("/api/ligacoes?acao=baixa","POST",{id,baixar,re:re||undefined}).then(()=>{fbToast(baixar?"Pessoa retirada da cobrança.":"Pessoa devolvida à cobrança.");ligLoad();}).catch(e=>fbToast(e.message||"Erro ao atualizar.","err"));});
}
function ligAcordo(id,status){
  const feito=()=>ligApi("/api/ligacoes?acao=acordo","POST",{id,status}).then(()=>{fbToast(status==="cumprido"?"Acordo marcado como cumprido.":"Acordo marcado como descumprido.");ligLoad();}).catch(e=>fbToast(e.message||"Erro.","err"));
  if(status!=="descumprido")return feito();
  const c=LIG_C.find(x=>x.id===id);
  fbConfirm({titulo:"Registrar que não cumpriu?",perigo:true,ok:"Registrar descumprimento",texto:'<b>'+_esc(c?c.colaborador:id)+'</b> não cumpriu o combinado. A baixa é desfeita e as faltas dessa pessoa voltam para o painel de cobrança.'}).then(ok=>{if(ok)feito();});
}

/* ═════ WhatsApp do SAC (serviço Baileys em wa-sac/) ═════ */
let LIG_ZAP_FOTO=null,LIG_ZAP_TIMER=null;
/* O Baileys roda neste computador (programa "Iniciar WhatsApp SAC", como o VocalTask): sem chave e sem domínio.
   A tela fala direto com ele; a API do sistema só confere se pode enviar e registra o resultado. */
const LIG_WA_LOCAL="http://127.0.0.1:3939";
async function waLocal(metodo,caminho,corpo,ms){
  const ctl=typeof AbortController!=="undefined"?new AbortController():null,t=ctl?setTimeout(()=>ctl.abort(),ms||15000):null;
  try{
    const r=await fetch(LIG_WA_LOCAL+caminho,{method:metodo,headers:corpo?{"Content-Type":"application/json"}:undefined,body:corpo?JSON.stringify(corpo):undefined,signal:ctl?ctl.signal:undefined,cache:"no-store"});
    const j=await r.json().catch(()=>null);
    return{ok:r.ok,status:r.status,json:j,motivo:(j&&(j.motivo||j.error))||(r.ok?"":"o serviço respondeu "+r.status)};
  }catch(e){return{ok:false,status:0,json:null,motivo:"O programa do WhatsApp do SAC não está ligado neste computador."};}
  finally{if(t)clearTimeout(t);}
}
function waComoZap(r){
  if(!r.ok||!r.json){
    return{configurado:false,ok:false,motivo:r.status===403?"Este endereço do sistema não está liberado no programa do WhatsApp. Feche-o e abra \"Iniciar WhatsApp SAC\" de novo informando o endereço certo.":r.motivo,pode_conectar:!!LIG_PODE_BAIXAR};
  }
  const c=r.json;return{configurado:true,ok:true,state:c.state,numero:c.numero||null,qr:c.qr||null,desde:c.desde||null,pode_conectar:!!LIG_PODE_BAIXAR};
}
function waStatus(){return waLocal("GET","/status",null,6000).then(waComoZap);}
function ligZapAtualizar(){
  return waStatus().then(j=>{LIG_ZAP=j;ligZapChip();return j;}).catch(()=>null);
}
/* envio: a API confere telefone e limites, o serviço local manda, a API registra o resultado */
async function ligEnviarWa(corpo){
  const a=await ligApi("/api/ligacoes?acao=zap_autorizar","POST",corpo);
  const r=await waLocal("POST","/send",{numero:a.numero,texto:corpo.texto||"",imagem:corpo.imagem?{base64:corpo.imagem.base64,mimetype:corpo.imagem.mimetype,nome:corpo.imagem.nome}:undefined},90000);
  const ok=!!(r.ok&&r.json&&r.json.ok),motivo=ok?"":(r.motivo||"Não consegui enviar.");
  await ligApi("/api/ligacoes?acao=zap_registrar","POST",{chave:a.chave,ok,motivo,comFoto:a.comFoto,tamanho:a.tamanho,final:a.final,contato_id:corpo.contato_id}).catch(()=>{});
  if(!ok)throw new Error(motivo);
  return a;
}
function ligZapAbrir(nome,tel,re,datas,contatoId){
  LIG_ZAP_FOTO=null;
  const z=LIG_ZAP||{};
  const ok=z.configurado!==false&&z.ok&&z.state==="open";
  const aviso=ok?"":'<div class="fb-note tn-am" style="margin-bottom:20px">'+fbI("alert")+'<div>'
    +(z.configurado===false?'<b>O programa do WhatsApp do SAC não está ligado neste computador.</b> Abra <b>Iniciar WhatsApp SAC</b> e depois conecte pelo QR code na Visão geral.':!z.ok?'<b>Não consegui falar com o WhatsApp do SAC.</b> '+_esc(z.motivo||"Serviço indisponível."):'<b>O WhatsApp do SAC está desconectado.</b> '+(z.pode_conectar?'Use <b>Conectar</b> acima para ler o QR code.':'Peça à coordenação para conectar.'))+'</div></div>';
  const escolhe=!nome; /* aberto pelo botão do topo: escolhe a pessoa aqui */
  fbDialog("lig-zap-modal",{titulo:"Enviar WhatsApp",sub:escolhe?"":'Para <b>'+_esc(nome||"")+'</b>',tam:"md",
    corpo:fbZapLinha()+aviso
      +(escolhe
        ?'<div class="fb-g"><div class="fb-f"><label class="fb-l" for="lz-nome">Colaborador <i aria-hidden="true">*</i></label><input class="fb-in" id="lz-nome" list="lz-nomes" placeholder="Digite o nome" autocomplete="off" maxlength="120" oninput="ligZapPessoa()"><datalist id="lz-nomes">'+fbNomesConhecidos().map(n=>'<option value="'+_esc(n)+'">').join("")+'</datalist></div></div>'
        :'<input type="hidden" id="lz-nome" value="'+_esc(nome||"")+'">')
      +'<input type="hidden" id="lz-re" value="'+_esc(String(re||""))+'"><input type="hidden" id="lz-contato" value="'+(contatoId?Number(contatoId):"")+'">'
      +'<div class="fb-g"><div class="fb-f"><label class="fb-l" for="lz-tel">Celular com DDD</label><input class="fb-in" id="lz-tel" value="'+_esc(tel||"")+'" placeholder="(19) 99999-8888" maxlength="25" inputmode="tel"></div></div>'
      +'<div class="fb-g"><div class="fb-f"><label class="fb-l" for="lz-msg">Mensagem <span id="lz-cont" class="fb-hint"></span></label><textarea class="fb-ta" id="lz-msg" rows="8" maxlength="1000" oninput="ligZapContar()"></textarea><span class="fb-hint">Você pode editar o texto antes de enviar. A mensagem padrão é definida pela coordenação.</span></div></div>'
      +'<div class="fb-f"><label class="fb-l">Foto (opcional)</label><div class="fb-foto" id="lz-prev"><div class="t"><b>Nenhuma foto anexada</b>JPG, PNG ou WebP. A imagem é reduzida automaticamente.</div><label class="fb-btn sm" style="cursor:pointer">'+fbI("image")+'Escolher foto<input type="file" id="lz-foto" accept="image/jpeg,image/png,image/webp" onchange="ligZapFoto(this)" style="display:none"></label></div></div>',
    rodape:'<span class="msg" id="lz-res" role="status"></span>'+(z.configurado===false?'<button type="button" class="fb-btn" onclick="ligZapWaMe()">Abrir no WhatsApp do aparelho</button>':"")
      +'<button type="button" class="fb-btn" onclick="fbFechar(\'lig-zap-modal\')">Cancelar</button><button type="button" class="fb-btn pri" id="lz-enviar" onclick="ligZapEnviar()" '+(ok?"":"disabled")+'>'+fbI("send")+'Enviar mensagem</button>'});
  document.getElementById("lz-msg").value=ligZapTexto(nome,datas);
  ligZapContar();
  ligZapAtualizar().then(j=>{
    const b=document.getElementById("lz-enviar");
    if(b&&j&&j.configurado!==false&&j.ok&&j.state==="open")b.disabled=false;
  });
}
/* nomes que o sistema conhece: a fila, o acompanhamento e todos da planilha (para o WhatsApp e o registro abertos pelo topo) */
function fbNomesConhecidos(){
  const s=new Set(LIG_P.map(x=>x.nome));
  ((LIG_IND&&LIG_IND.pessoas)||[]).forEach(x=>s.add(x[1]));
  return [...s].filter(Boolean).sort((a,b)=>a.localeCompare(b));
}
/* RE, posto, supervisor e telefone de quem foi escolhido pelo nome */
function fbPessoaPorNome(nome){
  const n=_ligNorm(nome);if(!n)return null;
  const p=LIG_P.find(x=>_ligNorm(x.nome)===n);
  if(p)return{nome:p.nome,re:p.re,posto:p.posto,supervisor:p.supervisor,telefone:fbFone(p.telefone)||ligTelefoneDe(p.nome),faltas:p.faltas||[]};
  const q=((LIG_IND&&LIG_IND.pessoas)||[]).find(x=>_ligNorm(x[1])===n);
  return q?{nome:q[1],re:q[0],posto:q[2],supervisor:q[3],telefone:ligTelefoneDe(q[1]),faltas:[]}:null;
}
function ligZapPessoa(){
  const p=fbPessoaPorNome(document.getElementById("lz-nome").value);if(!p)return;
  document.getElementById("lz-re").value=String(p.re||"");
  const t=document.getElementById("lz-tel");if(t&&!t.value&&p.telefone)t.value=p.telefone;
  document.getElementById("lz-msg").value=ligZapTexto(p.nome,p.faltas);ligZapContar();
}
function ligZapContar(){const m=document.getElementById("lz-msg"),c=document.getElementById("lz-cont");if(m&&c)c.textContent=m.value.length+" de 1000 caracteres";}
function ligZapWaMe(){
  let num=String(document.getElementById("lz-tel").value||"").replace(/\D/g,"");
  if(!num){fbToast("Informe o telefone.","err");return;}
  if(!num.startsWith("55"))num="55"+num;
  window.open("https://wa.me/"+num+"?text="+encodeURIComponent(document.getElementById("lz-msg").value),"_blank");
}
/* a foto é reduzida no navegador (1280 px, JPEG): o pedido à Vercel não passa de 4,5 MB */
function ligZapFoto(inp){
  const prev=document.getElementById("lz-prev"),f=inp.files&&inp.files[0];
  LIG_ZAP_FOTO=null;if(!f)return;
  if(!/^image\/(jpeg|png|webp)$/.test(f.type)){fbToast("Use uma foto JPG, PNG ou WebP.","err");inp.value="";return;}
  const rd=new FileReader();
  rd.onload=()=>{
    const img=new Image();
    img.onload=()=>{
      const k=Math.min(1,1280/Math.max(img.width,img.height));
      const w=Math.max(1,Math.round(img.width*k)),h=Math.max(1,Math.round(img.height*k));
      const cv=document.createElement("canvas");cv.width=w;cv.height=h;
      const cx=cv.getContext("2d");cx.fillStyle="#fff";cx.fillRect(0,0,w,h);cx.drawImage(img,0,0,w,h);
      const url=cv.toDataURL("image/jpeg",0.82);
      LIG_ZAP_FOTO={base64:url.split(",")[1],mimetype:"image/jpeg",nome:(f.name||"foto").replace(/\.[^.]+$/,"")+".jpg"};
      if(prev)prev.innerHTML='<img src="'+url+'" alt="Pré-visualização da foto"><div class="t"><b>'+_esc(LIG_ZAP_FOTO.nome)+'</b>Será enviada com a mensagem.</div><button type="button" class="fb-btn sm" onclick="LIG_ZAP_FOTO=null;this.closest(\'#lig-zap-modal\').querySelector(\'#lz-prev\').innerHTML=\'<div class=&quot;t&quot;><b>Nenhuma foto anexada</b>Escolha outra foto se quiser.</div>\'">Remover</button>';
    };
    img.onerror=()=>fbToast("Não consegui ler essa imagem.","err");
    img.src=rd.result;
  };
  rd.readAsDataURL(f);
}
function ligZapEnviar(){
  const g=x=>document.getElementById(x).value.trim();
  const res=document.getElementById("lz-res"),btn=document.getElementById("lz-enviar");
  const corpo={colaborador:g("lz-nome"),re:g("lz-re")||undefined,telefone:g("lz-tel"),texto:g("lz-msg"),contato_id:g("lz-contato")||undefined};
  if(LIG_ZAP_FOTO)corpo.imagem=LIG_ZAP_FOTO;
  if(!corpo.texto&&!corpo.imagem){res.style.color="#d92d20";res.textContent="Escreva a mensagem ou anexe uma foto.";return;}
  btn.disabled=true;res.style.color="var(--fb-muted)";res.textContent="Enviando…";
  ligEnviarWa(corpo)
    .then(()=>{fbFechar("lig-zap-modal");fbToast("Mensagem enviada.");ligLoad();})
    .catch(e=>{res.style.color="#d92d20";res.textContent=e.message||"Não consegui enviar.";btn.disabled=false;});
}
function ligZapConectar(){
  const corpoQr=j=>{
    if(!j||j.configurado===false||!j.ok)return '<div class="fb-note tn-da" style="text-align:left">'+fbI("alert")+'<div><b>Não foi possível conectar.</b> '+_esc((j&&j.motivo)||"Serviço indisponível.")+'</div></div>';
    if(j.state==="open")return '<div class="fb-empty-i tn-ok" style="margin:0 auto">'+fbI("ok")+'</div><div style="font-size:1rem;font-weight:600">Conectado'+(j.numero?" como +"+_esc(j.numero):"")+'</div>';
    if(j.state==="qr"&&/^data:image\/png;base64,[A-Za-z0-9+\/=]+$/.test(j.qr||""))return '<img src="'+j.qr+'" alt="QR code para conectar o WhatsApp"><span class="fb-hint">O código se renova sozinho.</span>';
    if(j.state==="connecting")return '<div class="fb-spin"></div><span class="fb-hint">Conectando…</span>';
    return '<div style="font-size:.875rem;color:var(--fb-text2)">O WhatsApp do SAC está desconectado.</div><button type="button" class="fb-btn pri" onclick="ligZapConectar()">Gerar novo QR code</button>';
  };
  const pinta=j=>{
    const box=document.getElementById("lq-corpo");
    if(!document.getElementById("lig-qr-modal")){clearInterval(LIG_ZAP_TIMER);LIG_ZAP_TIMER=null;return;}
    if(!box)return;
    if(j&&j.ok&&j.state==="open"){clearInterval(LIG_ZAP_TIMER);LIG_ZAP_TIMER=null;LIG_ZAP=Object.assign({},LIG_ZAP,j);ligZapChip();}
    box.innerHTML=corpoQr(j);
  };
  fbDialog("lig-qr-modal",{titulo:"Conectar o WhatsApp do SAC",tam:"sm",semFoco:true,
    corpo:'<ol class="fb-steps"><li>No celular do SAC, abra o <b>WhatsApp</b>.</li><li>Toque em <b>Aparelhos conectados</b> e depois em <b>Conectar um aparelho</b>.</li><li>Aponte a câmera para o código abaixo.</li></ol><div class="fb-qr" id="lq-corpo"><div class="fb-spin"></div><span class="fb-hint">Gerando o QR code…</span></div>',
    rodape:'<button type="button" class="fb-btn" onclick="fbFechar(\'lig-qr-modal\');ligLoad()">Fechar</button>'});
  waLocal("POST","/connect",null,20000).then(r=>pinta(waComoZap(r))).catch(e=>pinta({ok:false,motivo:e.message}));
  clearInterval(LIG_ZAP_TIMER);
  LIG_ZAP_TIMER=setInterval(()=>{waStatus().then(pinta).catch(()=>{});},3000);
}
function ligZapDesconectar(){
  fbConfirm({titulo:"Desconectar o WhatsApp do SAC?",ok:"Desconectar",perigo:true,texto:"Para voltar a enviar mensagens será preciso ler o QR code de novo."})
    .then(ok=>{if(ok)waLocal("POST","/logout",null,20000).then(r=>{if(!r.ok)throw new Error(r.motivo);fbToast("WhatsApp desconectado.");return ligZapAtualizar();}).catch(e=>fbToast(e.message||"Erro.","err"));});
}
function ligZapModeloForm(){
  fbDialog("lig-modelo-modal",{titulo:"Mensagem padrão do SAC",tam:"md",
    corpo:'<div class="fb-g"><div class="fb-f"><label class="fb-l" for="lm-texto">Texto</label><textarea class="fb-ta" id="lm-texto" rows="9" maxlength="1000"></textarea><span class="fb-hint">Use <b>{nome}</b> para o primeiro nome do colaborador e <b>{data}</b> para a data da falta.</span></div></div>',
    rodape:'<span class="msg" id="lm-res" role="status"></span><button type="button" class="fb-btn ghost" onclick="document.getElementById(\'lm-texto\').value=LIG_MODELO_PADRAO">Voltar ao texto original</button><button type="button" class="fb-btn pri" onclick="ligZapModeloSalvar()">Salvar mensagem</button>'});
  document.getElementById("lm-texto").value=(LIG_MODELO&&LIG_MODELO.texto)||LIG_MODELO_PADRAO;
}
function ligZapModeloSalvar(){
  const t=document.getElementById("lm-texto").value.trim(),r=document.getElementById("lm-res");
  r.style.color="var(--fb-muted)";r.textContent="Salvando…";
  ligApi("/api/ligacoes?acao=zap_modelo","POST",{texto:t}).then(j=>{LIG_MODELO=Object.assign({},LIG_MODELO,{texto:j.texto,padrao:false});fbFechar("lig-modelo-modal");fbToast("Mensagem padrão salva.");}).catch(e=>{r.style.color="#d92d20";r.textContent=e.message||"Erro ao salvar.";});
}

/* ═════ ajudas pequenas ═════ */
function ligEfetivo(c){const r=c&&c.resultado;if(!r)return true;const R=LIG_RES||{};return R[r]?R[r].grupo!=="tentativa":FB_TENT.indexOf(r)<0;}
function ligTelefoneDe(nome){const n=_ligNorm(nome);const c=LIG_C.find(c=>_ligNorm(c.colaborador)===n&&c.telefone);return c?c.telefone:"";}
function ligDataContato(c){return String(c.data_contato||String(c.criado_em).slice(0,10)).slice(0,10);}
function fbIni(n){return String(n||"?").trim().split(/\s+/).slice(0,2).map(x=>x.charAt(0)).join("").toUpperCase();}
/* "5519999998888" → "(19) 99999-8888" */
function fbFone(d){
  let n=String(d||"").replace(/\D/g,"");if(!n)return"";
  if(n.startsWith("55")&&n.length>=12)n=n.slice(2);
  if(n.length===11)return"("+n.slice(0,2)+") "+n.slice(2,7)+"-"+n.slice(7);
  if(n.length===10)return"("+n.slice(0,2)+") "+n.slice(2,6)+"-"+n.slice(6);
  return String(d||"");
}
/* celular brasileiro com DDD (a mesma regra do servidor: 11 dígitos, o terceiro é 9) */
function fbCelularOk(t){let n=String(t||"").replace(/\D/g,"");if(n.startsWith("55")&&n.length>=12)n=n.slice(2);return/^[1-9][1-9]9\d{8}$/.test(n);}
function fbDatas(lista,max){
  const L=(lista||[]).map(d=>fbDd(d)),m=max||4;
  if(L.length<=m)return L.length>1?L.slice(0,-1).join(", ")+" e "+L[L.length-1]:(L[0]||"");
  return L.slice(0,m).join(", ")+" e mais "+(L.length-m);
}
function fbDaPessoa(c,p){
  const re=c.baixa&&c.baixa.re?String(c.baixa.re).replace(/^0+/,""):"";
  return(re&&p.re&&re===p.re)||_ligNorm(c.colaborador)===_ligNorm(p.nome);
}
function fbTag(txt,tom){return'<span class="fb-tag '+(tom||"tn-gr")+'">'+_esc(txt)+'</span>';}
function ligPreencher(p){return{colaborador:p.nome,re:p.re,posto:p.posto,supervisor:p.supervisor,telefone:fbFone(p.telefone)||ligTelefoneDe(p.nome),ultima:p.ultima_falta||""};}

/* ═════ vocabulário (uma palavra para cada coisa, em todas as telas) ═════
   Abas: Fila do SAC (Enviar mensagem · Aguardando ligação · Com a coordenação) · Monitoramento 30 dias · Desempenho · Histórico.
   Resultado do monitoramento (faltas dos 30 dias antes do feedback × faltas depois): Piorou · Igual a antes · Em observação · Melhorou. */
const FB_VD={
  /* seta pelo significado em todo o módulo: melhorou = para cima, piorou = para baixo, observação = relógio */
  piorou:{t:"Piorou",tom:"tn-da",ic:"down",cic:"down",d:"Faltou mais vezes do que antes."},
  mesma:{t:"Igual a antes",tom:"tn-am",ic:"eq",cic:"eq",d:"Faltou o mesmo número de vezes."},
  comecando:{t:"Em observação",tom:"tn-br",ic:"clock",cic:"clock",d:"Menos de 7 dias desde o contato e nenhuma falta."},
  melhorando:{t:"Melhorou",tom:"tn-ok",ic:"up",cic:"up",d:"Faltou menos vezes do que antes."}
};
const FB_SIT=[
  {k:"mensagem",t:"Enviar mensagem",tom:"tn-br",d:"Faltaram sem justificar e ainda não receberam mensagem do SAC."},
  {k:"aguardando",t:"Aguardando ligação",tom:"tn-am",d:"Já receberam a mensagem. Falta a pessoa ligar para o SAC."},
  {k:"base",t:"Com a coordenação",tom:"tn-da",d:"Não ligaram depois de duas mensagens. A coordenação conversa com a pessoa."},
  {k:"acomp",t:"Em acompanhamento",tom:"tn-ok",d:"Ligaram e a conversa foi registrada. Por 30 dias, as faltas são comparadas com as dos 30 dias antes do feedback."}
];
const FB_FILA=["mensagem","aguardando","base"];
const FB_ABAS=[{k:"visao",t:"Visão geral",ic:"chart"},{k:"fila",t:"Fila do SAC",ic:"list"},{k:"monit",t:"Monitoramento 30 dias",ic:"eye"},{k:"desemp",t:"Desempenho",ic:"chart"},{k:"hist",t:"Histórico",ic:"hist"}];
const FB_ACOR={cumpriu:["Combinado cumprido","tn-ok"],pendente:["Combinado pendente","tn-am"],nao_cumpriu:["Combinado não cumprido","tn-da"]};
const LIG_LOTE_MAX=15; // no máximo 15 mensagens por vez: o WhatsApp bloqueia número que dispara em massa
const FB_MESES=["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
let LIG_SEL=new Set(),LIG_LIM=24,LIG_TRUNC=false,LIG_LOTE_PARAR=false,LIG_MES=0,LIG_MESES=[];

/* ═════ filtros do topo: período, turno e área ═════
   Período: os números do topo e o Histórico. Turno e área: tudo (filas, monitoramento, desempenho e histórico). */
function fbDow2(d){return(new Date(d+"T12:00:00Z").getUTCDay()+6)%7;}
function fbPeriodo(){
  const hj=ligHojeISO();
  if(LIG_F.per==="semana")return{de:ligSomaDias(hj,-fbDow2(hj)),ate:hj,rot:"Esta semana"};
  if(LIG_F.per==="folha"){const k=fbFolhaDe(hj),de=fbMesIni(k,"folha"),f=fbMesFim(k,"folha");return{de,ate:f<hj?f:hj,rot:"Folha até "+fbDd(f)};}
  if(LIG_F.per==="periodo"&&LIG_F.de&&LIG_F.ate){const de=LIG_F.de<=LIG_F.ate?LIG_F.de:LIG_F.ate,ate=LIG_F.de<=LIG_F.ate?LIG_F.ate:LIG_F.de;return{de,ate,rot:fbDd(de)+" a "+fbDd(ate)};}
  return{de:hj,ate:hj,rot:"Hoje"};
}
/* período da folha: 26 de um mês a 25 do seguinte; a chave é o mês do dia 25 */
function fbFolhaDe(d){
  let a=Number(d.slice(0,4)),m=Number(d.slice(5,7));
  if(Number(d.slice(8,10))>=26){m++;if(m>12){m=1;a++;}}
  return a+"-"+String(m).padStart(2,"0");
}
function fbMesChave(d,modo){return modo==="civil"?d.slice(0,7):fbFolhaDe(d);}
function fbMesIni(k,modo){
  if(modo==="civil")return k+"-01";
  let a=Number(k.slice(0,4)),m=Number(k.slice(5,7))-1;if(m<1){m=12;a--;}
  return a+"-"+String(m).padStart(2,"0")+"-26";
}
function fbMesFim(k,modo){
  if(modo!=="civil")return k+"-25";
  const a=Number(k.slice(0,4)),m=Number(k.slice(5,7));
  return new Date(Date.UTC(a,m,0,12)).toISOString().slice(0,10);
}
function fbMesRot(k){return FB_MESES[Number(k.slice(5,7))-1]+"/"+k.slice(0,4);}
function fbTurnoDe(sup){const t=LIG_IND&&LIG_IND.turnos;return(t&&t[sup])||"DIURNO";}
function fbSupOk(sup){
  sup=String(sup||"").trim();
  if(LIG_F.area!=="todas"&&sup!==LIG_F.area)return false;
  if(LIG_F.turno!=="todos"&&fbTurnoDe(sup)!==LIG_F.turno)return false;
  return true;
}
/* faltas (sem justificativa e abonadas) entre duas datas, com o filtro de turno e área */
function fbFaltasEntre(de,ate){
  const r={sj:0,ab:0};
  ((LIG_IND&&LIG_IND.dias)||[]).forEach(x=>{if(x[0]>=de&&x[0]<=ate&&fbSupOk(x[1])){r.sj+=x[2];r.ab+=x[3];}});
  return r;
}
function fbConversasEntre(de,ate){return((LIG_IND&&LIG_IND.conversas)||[]).filter(c=>c[0]>=de&&c[0]<=ate&&fbSupOk(c[3]));}
function fbDiasEntre(a,b){return Math.round((Date.parse(b+"T12:00:00Z")-Date.parse(a+"T12:00:00Z"))/86400000);}
function fbN(n){return Number(n||0).toLocaleString("pt-BR");}
function ligFiltro(k,v){
  LIG_F[k]=v;
  if(k==="per"&&v==="periodo"&&!LIG_F.de){LIG_F.ate=ligHojeISO();LIG_F.de=ligSomaDias(LIG_F.ate,-29);}
  LIG_LIM=24;LIG_SEL=new Set();
  if(!document.getElementById("lig-root")){ligRender();return;}
  if(k==="turno"||k==="area")fbNavContagens();
  ligPanel();
}
/* ═════ movimento: trocas suaves, sem piscar ═════
   Cada clique troca só o pedaço que mudou (a lista, os números, o corpo da sub-aba); o resto da tela fica parado.
   A altura acompanha com suavidade, os itens entram em sequência (com leve deslize na direção da aba), os números contam
   até o valor novo e os indicadores das abas deslizam até a aba escolhida. Web Animations API (nativa do navegador):
   o mesmo efeito do Framer Motion sem React e sem dependência. Movimento reduzido do sistema é respeitado. */
const FB_EASE="cubic-bezier(.22,1,.36,1)",FB_MOLA="cubic-bezier(.34,1.32,.64,1)";
let LIG_DX=0;
function fbMov(){return typeof Element!=="undefined"&&!!(Element.prototype.animate)&&!(window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches);}
const FB_ITENS=".fb-fcw,.fb-kg,.fb-pn,.fb-mini2,.fb-pc,.fb-row,.fb-empty,.fb-mais-b,.fb-cols,.fb-sub,.fb-pfun,.fb-st3,.fb-card2,.fb-pf-top";
function fbEntrada(el,dx){
  if(!el||!fbMov())return;
  const vh=window.innerHeight||900;
  [...el.querySelectorAll(FB_ITENS)].filter(x=>!x.parentElement.closest(FB_ITENS)).filter(x=>x.getBoundingClientRect().top<vh+120).slice(0,40)
    .forEach((x,i)=>x.animate([{opacity:0,transform:"translate3d("+(dx||0)+"px,18px,0) scale(.985)"},{opacity:1,transform:"none"}],{duration:620,delay:Math.min(i,16)*34,easing:FB_EASE,fill:"backwards"}));
}
function fbTroca(el,html,o){
  o=o||{};if(!el)return;
  const tok=el._fbTok=(el._fbTok||0)+1;
  if(window._fbQuieto){el.innerHTML=html;if(o.depois)o.depois();return;}
  const aplica=()=>{
    if(el._fbTok!==tok)return;
    const h0=el.offsetHeight;
    el.innerHTML=html;
    if(o.depois)o.depois();
    if(!fbMov())return;
    const h1=el.offsetHeight;
    if(Math.abs(h1-h0)>4){el.style.overflow="clip";const a=el.animate([{height:h0+"px"},{height:h1+"px"}],{duration:480,easing:FB_EASE});a.onfinish=a.oncancel=()=>{el.style.overflow="";};}
    fbEntrada(el,o.dx);
  };
  if(!fbMov()||!el.firstElementChild){aplica();return;}
  const sai=el.animate([{opacity:1,transform:"none"},{opacity:0,transform:"translate3d("+(-(o.dx||0)/2)+"px,-6px,0)"}],{duration:150,easing:"cubic-bezier(.4,0,1,1)",fill:"forwards"});
  sai.onfinish=()=>{aplica();sai.cancel();};
}
/* indicador que desliza: fundo (pílula) ou linha (sublinhado), conforme data-ind do grupo */
function fbPosOn(nav){const b=nav&&nav.querySelector(":scope > button.on");return b?{x:b.offsetLeft,y:b.offsetTop,w:b.offsetWidth,h:b.offsetHeight}:null;}
function fbIndica(nav,de){
  if(!nav)return;
  let ind=nav.querySelector(":scope > .fb-ind");
  if(!ind){ind=document.createElement("i");ind.className="fb-ind";ind.setAttribute("aria-hidden","true");nav.insertBefore(ind,nav.firstChild);}
  const p=fbPosOn(nav);if(!p){ind.style.opacity="0";return;}
  const linha=nav.dataset.ind==="linha";
  const pos=q=>{ind.style.width=q.w+"px";ind.style.height=(linha?3:q.h)+"px";ind.style.transform="translate3d("+q.x+"px,"+(linha?q.y+q.h-3:q.y)+"px,0)";ind.style.opacity="1";};
  if(de&&fbMov()){ind.style.transition="none";pos(de);void ind.offsetWidth;ind.style.transition="";}
  else if(!de){ind.style.transition="none";pos(p);void ind.offsetWidth;ind.style.transition="";return;}
  pos(p);
}
function fbIndicaTudo(el){el=el||document;if(!el.querySelectorAll)return;el.querySelectorAll("[data-ind]").forEach(n=>fbIndica(n));}
if(!window._fbIndRs&&window.addEventListener){window._fbIndRs=1;window.addEventListener("resize",()=>fbIndicaTudo(document.getElementById("lig-root")),{passive:true});}
/* números que contam do valor antigo ao novo */
function fbConta(e,de,ate){
  if(!fbMov()||de===ate){e.firstChild&&(e.firstChild.nodeValue=String(ate));return;}
  const t0=performance.now(),dur=650,no=e.firstChild;if(!no)return;
  const passo=t=>{const p=Math.min(1,(t-t0)/dur),k=1-Math.pow(1-p,3);no.nodeValue=String(Math.round(de+(ate-de)*k));if(p<1)requestAnimationFrame(passo);};
  requestAnimationFrame(passo);
}
/* atualização parcial: grupos de botões (data-nav), cards (data-cards), trechos (data-sync) e a lista (#lig-lista) */
function fbParcial(box,html){
  const t=document.createElement("div");t.innerHTML=html;
  const novo=t.querySelector("#lig-lista"),velho=box.querySelector("#lig-lista");
  if(!novo||!velho)return false;
  const navs=[...box.querySelectorAll("[data-nav]")];
  if(navs.some(n=>{const m=t.querySelector('[data-nav="'+n.dataset.nav+'"]');return!m||m.querySelectorAll(":scope > button").length!==n.querySelectorAll(":scope > button").length;}))return false;
  navs.forEach(n=>{const m=t.querySelector('[data-nav="'+n.dataset.nav+'"]'),ant=fbPosOn(n),bs=n.querySelectorAll(":scope > button"),bs2=m.querySelectorAll(":scope > button");
    bs.forEach((b,i)=>{b.className=bs2[i].className;["aria-selected","aria-pressed"].forEach(a=>{if(bs2[i].hasAttribute(a))b.setAttribute(a,bs2[i].getAttribute(a));});b.innerHTML=bs2[i].innerHTML;});
    if(n.dataset.ind)fbIndica(n,ant);});
  box.querySelectorAll("[data-cards]").forEach(c=>{const m=t.querySelector('[data-cards="'+c.dataset.cards+'"]');if(!m)return;const a=c.children,b=m.children;
    for(let i=0;i<a.length&&i<b.length;i++){const x=a[i].firstElementChild,y=b[i].firstElementChild;if(!x||!y)continue;
      const antes=[...x.querySelectorAll("[data-n]")].map(e=>Number(e.dataset.n));
      x.className=y.className;if(y.hasAttribute("aria-pressed"))x.setAttribute("aria-pressed",y.getAttribute("aria-pressed"));x.innerHTML=y.innerHTML;
      x.querySelectorAll("[data-n]").forEach((e,j)=>{if(antes[j]!==undefined)fbConta(e,antes[j],Number(e.dataset.n));});}});
  box.querySelectorAll("[data-sync]").forEach(x=>{const y=t.querySelector('[data-sync="'+x.dataset.sync+'"]');if(y&&x.innerHTML!==y.innerHTML){x.innerHTML=y.innerHTML;if(y.className!==x.className)x.className=y.className;}});
  fbTroca(velho,novo.innerHTML,{dx:LIG_DX,depois:()=>{ligFiltraPend();fbIndicaTudo(velho);}});
  return true;
}
function fbMostra(box,html){
  LIG_DX=LIG_DX||0;
  if(box.dataset.aba===LIG_ABA&&fbParcial(box,html)){LIG_DX=0;return;}
  box.dataset.aba=LIG_ABA;
  fbTroca(box,html,{dx:LIG_DX,depois:()=>{ligFiltraPend();fbIndicaTudo(box);}});
  LIG_DX=0;
}
/* parallax: cards em degradê inclinam de leve com o mouse; a faixa do topo desliza mais devagar que a rolagem */
if(!window._fbTilt&&document.addEventListener){window._fbTilt=1;
  document.addEventListener("pointermove",e=>{
    if(!fbMov())return;
    const c=e.target&&e.target.closest?e.target.closest(".fb-fc,.fb-kg"):null;
    if(window._fbTiltEl&&window._fbTiltEl!==c){window._fbTiltEl.style.removeProperty("--rx");window._fbTiltEl.style.removeProperty("--ry");window._fbTiltEl=null;}
    if(!c||!c.closest("#lig-root"))return;
    const r=c.getBoundingClientRect(),x=(e.clientX-r.left)/r.width-.5,y=(e.clientY-r.top)/r.height-.5;
    c.style.setProperty("--rx",(-y*6).toFixed(2)+"deg");c.style.setProperty("--ry",(x*8).toFixed(2)+"deg");
    c.style.setProperty("--mx",(x*26).toFixed(1)+"px");c.style.setProperty("--my",(y*20).toFixed(1)+"px");
    window._fbTiltEl=c;
  },{passive:true});
}
function fbNavContagens(){
  const P=LIG_P.filter(p=>fbSupOk(p.supervisor));
  const n={fila:P.filter(p=>FB_FILA.indexOf(p.situacao)>=0).length,monit:P.filter(p=>p.situacao==="acomp").length,hist:fbContatosFiltrados().length};
  document.querySelectorAll("#lig-root .fb-abas > button").forEach((b,i)=>{const a=FB_ABAS[i];if(!a||n[a.k]===undefined)return;const s=b.querySelector(".n");if(s){const de=Number(s.textContent)||0;s.textContent=String(n[a.k]);if(de!==n[a.k]){s.classList.remove("pulse");void s.offsetWidth;s.classList.add("pulse");}}});
}
/* estado da planilha e o tema claro/escuro (a barra branca do sistema some nesta tela, em tela cheia) */
function fbBandaDir(){
  const s=document.getElementById("dataStatusTxt"),raiz=document.documentElement,escuro=!!(raiz&&raiz.getAttribute&&raiz.getAttribute("data-theme")==="dark");
  return'<div class="fb-band-a"><span class="fb-planilha"><i></i>'+_esc(s?s.textContent.trim():"")+'</span><button type="button" class="fb-tema" onclick="toggleTheme();setTimeout(ligTema,30)" aria-label="Alternar tema claro e escuro">'+fbI(escuro?"sun":"moon")+(escuro?"Claro":"Escuro")+'</button></div>';
}
function ligTema(){const b=document.querySelector("#lig-root .fb-band-a");if(b)b.outerHTML=fbBandaDir();}


/* ═════ tela ═════ */
function ligRender(){
  const el=document.getElementById("lig-content");if(!el)return;
  if(!FB_ABAS.some(a=>a.k===LIG_ABA))LIG_ABA="visao";
  if(FB_FILA.indexOf(LIG_TAB)<0)LIG_TAB="mensagem";
  const hj=ligHojeISO();
  let h='<div class="fb" id="lig-root">';
  /* bloco do topo (referência 1): faixa azul-marinho com corte diagonal, filtros de turno e área, abas sublinhadas */
  h+='<section class="fb-topo"><header class="fb-band"><div class="fb-band-t"><svg class="fb-band-ic" viewBox="0 0 36 36" aria-hidden="true"><rect x="3" y="19" width="8" height="14" rx="2.5"/><rect x="14" y="11" width="8" height="22" rx="2.5"/><rect x="25" y="3" width="8" height="30" rx="2.5"/></svg>'
    +'<div><h1>Feedback de Faltas</h1><p>Grupo ServCamp - Hoje - '+_esc(rhFmt(hj))+'</p></div></div>'+fbBandaDir()+'</header>';
  const sups=(LIG_IND&&LIG_IND.supervisores)||[...new Set(LIG_P.map(p=>p.supervisor).filter(Boolean))].sort();
  const selp=(id,campo,ops,val,cls)=>'<span class="fb-selp'+(cls?" "+cls:"")+'"><select id="'+id+'" onchange="ligFiltro(\''+campo+'\',this.value)">'+ops.map(o=>'<option value="'+_esc(o[0])+'"'+(val===o[0]?" selected":"")+'>'+_esc(o[1])+'</option>').join("")+'</select>'+fbI("chev")+'</span>';
  h+='<div class="fb-filtros">'
    +'<div class="fb-fg"><label class="fb-fl" for="lig-turno">Turno</label>'+selp("lig-turno","turno",[["todos","Todos"],["DIURNO","Diurno"],["NOTURNO","Noturno"]],LIG_F.turno)+'</div>'
    +'<div class="fb-fg"><label class="fb-fl" for="lig-area">Área</label>'+selp("lig-area","area",[["todas","Todas as Áreas"]].concat(sups.map(s=>[s,s])),LIG_F.area,"wide")+'</div></div>';
  const P=LIG_P.filter(p=>fbSupOk(p.supervisor));
  const n={visao:null,fila:P.filter(p=>FB_FILA.indexOf(p.situacao)>=0).length,monit:P.filter(p=>p.situacao==="acomp").length,desemp:null,hist:fbContatosFiltrados().length};
  h+='<nav class="fb-abas" role="tablist" aria-label="Seções" data-ind="linha">'+FB_ABAS.map(a=>'<button type="button" role="tab" class="'+(LIG_ABA===a.k?"on":"")+'" aria-selected="'+(LIG_ABA===a.k)+'" onclick="ligAba(\''+a.k+'\')">'+a.t+(n[a.k]!==null?'<span class="n">'+n[a.k]+'</span>':"")+'</button>').join("")
    +'<div class="fb-abas-a"><div class="fb-bg"><label class="fb-search">'+fbI("search")+'<span class="fb-sr">Histórico do colaborador</span><input id="lig-bg" class="fb-in" type="search" placeholder="Histórico do colaborador" autocomplete="off" oninput="ligBuscaG(this.value)" onkeydown="ligBuscaGTecla(event)" onblur="setTimeout(ligBuscaGFecha,180)"></label><div class="fb-bg-r" id="lig-bg-r" role="listbox"></div></div>'
    +'<button type="button" class="fb-btn sm" onclick="ligZapAbrir(\'\',\'\',\'\',[],null)">'+fbI("chat")+'Enviar WhatsApp<span id="lig-zap-chip" class="fb-zp">'+ligZapChipHtml()+'</span></button>'
    +'<button type="button" class="fb-btn sm navy" onclick="ligForm()">'+fbI("phone")+'Registrar feedback</button></div></nav></section>';
  h+='<div id="lig-panel"></div></div>';
  el.innerHTML=h;
  fbTipInit();
  fbIndicaTudo(el);
  fbFx();
  if(fbMov()){const t=el.querySelector(".fb-topo");if(t)t.animate([{opacity:0,transform:"translate3d(0,-10px,0)"},{opacity:1,transform:"none"}],{duration:520,easing:FB_EASE});}
  ligPanel();
}

/* ═════ Visão geral: o funil das faltas ═════
   Faltaram → mensagem enviada → ligaram e o feedback foi registrado / não responderam (e ainda no prazo).
   Contas sobre as pessoas com falta sem justificativa no período escolhido (turno e área do topo). */
let LIG_VG="faltaram";
const FB_ETAPAS=[
  {k:"faltaram",t:"Faltaram",ic:"user",cls:"g-blue"},
  {k:"enviadas",t:"Mensagem enviada",ic:"chat",cls:"g-violet"},
  {k:"ligaram",t:"Ligaram · feedback registrado",ic:"phone",cls:"g-green"},
  {k:"naoresp",t:"Não responderam",ic:"alert",cls:"g-coral"}
];
function fbIdxFaltas(){
  if(LIG_IND&&LIG_IND._idx)return LIG_IND._idx;
  const F=(LIG_IND&&LIG_IND.funil)||{faltas:[],envios:[],feedbacks:[]},m={falt:{},env:{},fb:{}};
  F.faltas.forEach(x=>{(m.falt[x[1]]=m.falt[x[1]]||[]).push(x);});
  F.envios.forEach(x=>{(m.env[x[1]]=m.env[x[1]]||[]).push(x[0]);});
  F.feedbacks.forEach(x=>{(m.fb[x[1]]=m.fb[x[1]]||[]).push(x[0]);});
  if(LIG_IND)LIG_IND._idx=m;
  return m;
}
function fbFunil(de,ate,o){
  const hj=ligHojeISO(),pes=(LIG_IND&&LIG_IND.pessoas)||[],M=fbIdxFaltas(),gente=[],tipo=o&&o.tipo!==undefined?o.tipo:LIG_F.tipo;let abon=0,abonR=0;
  Object.keys(M.falt).forEach(i=>{
    const p=pes[i];if(!p||!fbSupOk(p[3]))return;
    /* efetivo × reserva técnica: cada falta diz de qual dos dois era (o 5º campo) */
    const fs=M.falt[i].filter(x=>x[0]>=de&&x[0]<=ate&&(tipo==="todos"||!tipo||(tipo==="reserva")===(x[4]==="R")));
    abonR+=fs.filter(x=>x[2]==="A"&&x[4]==="R").length;
    abon+=fs.filter(x=>x[2]==="A").length;
    const sj=fs.filter(x=>x[2]!=="A");if(!sj.length)return;
    const prim=sj[0][0];
    const env=(M.env[i]||[]).filter(d=>d>=prim&&d<=hj),fb=(M.fb[i]||[]).filter(d=>d>=prim&&d<=hj);
    const ult=env.length?env[env.length-1]:null;
    let st="semmsg";
    if(fb.length)st="ligou";
    else if(ult)st=hj>ligSomaDias(ult,LIG_PRAZO||1)?"naoresp":"prazo";
    const ultF=sj[sj.length-1],postoN=(LIG_IND.postos||[])[ultF[3]];
    gente.push({i:Number(i),key:String(p[0]||"")+"|"+(_ligNorm(p[1]).split(" ")[0]||""),re:String(p[0]||""),nome:p[1],posto:postoN||p[2],sup:p[3],res:ultF[4]==="R",nf:{E:sj.filter(x=>x[4]!=="R").length,R:sj.filter(x=>x[4]==="R").length},faltas:sj.map(x=>x[0]),tratadas:sj.filter(x=>x[2]==="T").length,envios:env,feedback:fb.length?fb[fb.length-1]:null,st});
  });
  gente.sort((a,b)=>b.faltas.length-a.faltas.length||a.nome.localeCompare(b.nome));
  const de2=x=>gente.filter(x);
  return{gente,abon,abonR,faltaram:gente,enviadas:de2(g=>g.envios.length),ligaram:de2(g=>g.st==="ligou"),naoresp:de2(g=>g.st==="naoresp"),prazo:de2(g=>g.st==="prazo"),semmsg:de2(g=>g.st==="semmsg")};
}
function fbAvatares(lista){
  const v=lista.slice(0,5);
  return'<span class="fb-avs">'+v.map(g=>'<i title="'+_esc(g.nome)+'">'+_esc(fbIni(g.nome))+'</i>').join("")+(lista.length>5?'<i class="mais">+'+(lista.length-5)+'</i>':"")+'</span>';
}
function ligVG(k){const o=FB_ETAPAS.map(e=>e.k);LIG_DX=o.indexOf(k)>o.indexOf(LIG_VG)?20:o.indexOf(k)<o.indexOf(LIG_VG)?-20:0;LIG_VG=k;LIG_LIM=24;ligPanel();}
function fbPnlVisao(){
  const hj=ligHojeISO(),pe=fbPeriodo(),per=[["hoje","Hoje"],["semana","Semana"],["folha","Folha"],["periodo","Período"]];
  let h='<div class="fb-vg-bar"><div class="fb-pills" role="group" aria-label="Período" data-nav="per" data-ind="fundo">'+per.map(o=>'<button type="button" class="'+(LIG_F.per===o[0]?"on":"")+'" onclick="ligFiltro(\'per\',\''+o[0]+'\')">'+o[1]+'</button>').join("")+'</div>'
    +'<span class="fb-datas" data-sync="vgdatas">'+(LIG_F.per==="periodo"?'<input class="fb-in" type="date" aria-label="De" value="'+_esc(LIG_F.de)+'" max="'+hj+'" onchange="ligFiltro(\'de\',this.value)"><span>a</span><input class="fb-in" type="date" aria-label="Até" value="'+_esc(LIG_F.ate)+'" max="'+hj+'" onchange="ligFiltro(\'ate\',this.value)">':"")+'</span>'
    +'<span class="fb-vg-per" data-sync="vgper">'+(pe.de!==pe.ate?fbDd(pe.de)+' a '+fbDd(pe.ate):rhFmt(pe.de))+'</span>'
    +'<div class="fb-pills fb-tipo" role="group" aria-label="Efetivo ou reserva técnica" data-nav="tipo" data-ind="fundo">'+[["todos","Todos"],["efetivo","Efetivo"],["reserva","Reserva técnica"]].map(o=>'<button type="button" class="'+(LIG_F.tipo===o[0]?"on":"")+'" onclick="ligFiltro(\'tipo\',\''+o[0]+'\')">'+o[1]+'</button>').join("")+'</div>'
    +'<span class="fb-vg-zap" data-sync="vgzap">'+fbZapVG()+'</span></div>';
  if(!LIG_IND)return h+fbVazio();
  const F=fbFunil(pe.de,pe.ate),tot=F.faltaram.length,pc=n=>tot?Math.round(n/tot*100)+"%":"—";
  const nR=F.faltaram.filter(g=>g.res).length,nE=tot-nR;
  const subs={faltaram:(LIG_F.tipo==="todos"&&tot?nE+" efetivo · "+nR+" reserva · ":"")+(F.semmsg.length?F.semmsg.length+" sem mensagem":"todas com mensagem"),
    enviadas:pc(F.enviadas.length)+" de quem faltou",ligaram:pc(F.ligaram.length)+" de quem faltou · fora da cobrança",naoresp:pc(F.naoresp.length)+" de quem faltou"+(F.prazo.length?" · "+F.prazo.length+" no prazo":"")};
  if(!FB_ETAPAS.some(e=>e.k===LIG_VG))LIG_VG="faltaram";
  h+='<div class="fb-funil" data-cards="funil">'+FB_ETAPAS.map((e,i)=>'<div class="fb-fcw">'
    +'<button type="button" class="fb-fc '+e.cls+(LIG_VG===e.k?" on":"")+'" aria-pressed="'+(LIG_VG===e.k)+'" onclick="ligVG(\''+e.k+'\')"><span class="top"><span class="ic">'+fbI(e.ic)+'</span><small>'+(i+1)+' · '+e.t+'</small></span>'
    +'<span class="mid"><b data-n="'+F[e.k].length+'">'+F[e.k].length+'</b>'+fbAvatares(F[e.k])+'</span><span class="sub">'+subs[e.k]+'</span></button>'
    +'<span class="fb-con" aria-hidden="true">'+fbI("go")+'</span></div>').join("");
  const cv=fbConversasEntre(pe.de,pe.ate),dur=cv.filter(c=>c[2]),med=dur.length?Math.round(dur.reduce((t,c)=>t+c[2],0)/dur.length):null;
  h+='<div class="fb-fcw"><div class="fb-fc g-amber info"><span class="top"><span class="ic">'+fbI("clock")+'</span><small>Tempo médio por feedback</small></span><span class="mid"><b'+(med===null?'>—':' data-n="'+med+'">'+med+'<em>min</em>')+'</b></span><span class="sub">'+(cv.length?fbPlural(cv.length,"conversa","conversas"):"nenhuma conversa")+'</span></div></div></div>';
  h+='<p class="fb-vg-nota" data-sync="vgnota">'+(F.abon?fbPlural(F.abon,"falta abonada","faltas abonadas")+' no período não entram no funil.':"")+'</p>';
  const lista=F[LIG_VG],et=FB_ETAPAS.find(e=>e.k===LIG_VG);
  const selv=lista.filter(fbSelecionavel);
  const tit=LIG_F.tipo==="todos"?"":LIG_F.tipo==="reserva"?" · reserva técnica":" · efetivo";
  h+='<div id="lig-lista"><div class="fb-sub"><div class="fb-sub-t"><b>'+et.t+tit+'</b><span>'+fbPlural(lista.length,"pessoa","pessoas")+(LIG_F.tipo==="todos"&&lista.length?" · "+(lista.length-lista.filter(g=>g.res).length)+" efetivo, "+lista.filter(g=>g.res).length+" reserva":"")+'</span></div><div class="fb-sub-a">'+fbBusca()
    +(selv.length?'<button type="button" class="fb-btn sm" onclick="ligSelTodos()">'+fbI("check")+'Selecionar '+Math.min(LIG_LOTE_MAX,selv.length)+(selv.length>LIG_LOTE_MAX?" primeiras":selv.length===1?" pessoa":" pessoas")+' para o envio</button>':"")+'</div></div>';
  h+='<div id="lig-lote">'+fbBarraLote()+'</div>';
  LIG_VIEW_VG=lista;LIG_VIEW=[];
  LIG_TRUNC=lista.length>LIG_LIM;
  const vis=LIG_BUSCA_P?lista:lista.slice(0,LIG_LIM);
  h+='<div id="lig-vazio-busca" style="display:none">'+fbVazio()+'</div>';
  h+=lista.length?'<div class="fb-cards">'+vis.map((g,i)=>fbCardV(g,i)).join("")+'</div>'+(vis.length<lista.length?'<div class="fb-mais-b"><button type="button" class="fb-btn" onclick="ligMais()">Mostrar mais '+Math.min(24,lista.length-vis.length)+'<span class="fb-mut"> · faltam '+(lista.length-vis.length)+'</span></button></div>':""):fbVazio();
  return h+'</div>';
}
let LIG_VIEW_VG=[];
const FB_ST={semmsg:["Sem mensagem","tn-br"],prazo:["Aguardando ligação","tn-am"],naoresp:["Não respondeu","tn-da"],ligou:["Feedback registrado","tn-ok"]};
function fbCardV(g,i){
  const s=FB_ST[g.st],nome=_esc(g.nome);
  let linha='<p class="fb-pc-l"><b>Faltou</b> em '+fbDatas(g.faltas)+'</p>';
  if(g.envios.length)linha+='<p class="fb-pc-l fb-mut">'+(g.envios.length===1?"Mensagem em ":fbPlural(g.envios.length,"mensagem","mensagens")+", a última em ")+fbDd(g.envios[g.envios.length-1])+'</p>';
  if(g.feedback)linha+=fbRegistro(fbUltRegistro(g))||'<p class="fb-pc-l fb-mut">Ligou e o feedback foi registrado em '+fbDd(g.feedback)+'</p>';
  const acoes=g.st==="ligou"?fbBtn("Ver panorama","ligVGAbrir("+i+")","sm","eye"):fbBtn("Enviar WhatsApp","ligVGEnviar("+i+")","pri sm","chat")+fbBtn("Registrar feedback","ligVGRegistrar("+i+")","sm","phone");
  const ck=fbSelecionavel(g)?'<label class="fb-ck" onclick="event.stopPropagation()" title="Selecionar para o envio em massa"><input type="checkbox" onchange="ligSelVG('+i+',this)"'+(LIG_SEL.has(g.key)?" checked":"")+' aria-label="Selecionar '+nome+'"><span></span></label>':"";
  return'<article class="fb-pc '+s[1]+(LIG_SEL.has(g.key)?" sel":"")+'" style="--i:'+Math.min(i,12)+'" tabindex="0" role="button" aria-label="Abrir o panorama de '+nome+'" onclick="ligVGAbrir('+i+')" onkeydown="if(event.key===\'Enter\'&&event.target===this)ligVGAbrir('+i+')" data-lb="'+_esc(_ligNorm(g.nome))+'" data-re="'+_esc(g.re)+'">'
    +fbCabCard({nome:g.nome,re:g.re,posto:g.posto},s[1],"",ck)
    +'<div class="fb-pc-b"><div class="fb-pc-c">'+fbTag(s[0],s[1])+fbTag(g.res?"Reserva técnica":"Efetivo",g.res?"tn-vi":"tn-gr")+'</div>'+linha+'</div><div class="fb-pc-a" onclick="event.stopPropagation()">'+acoes+'</div></article>';
}
/* envio em massa da Visão geral: quem ainda não recebeu mensagem ou não respondeu */
function fbSelecionavel(g){return g&&(g.st==="semmsg"||g.st==="naoresp");}
function fbLotePessoa(x,faltas){const p=fbPessoaDaFila(x)||{};return{key:x.key,nome:x.nome,re:x.re||"",telefone:fbFone(x.telefone||p.telefone)||ligTelefoneDe(x.nome),faltas:faltas||x.faltas||[]};}
function ligSelVG(i,cx){const g=LIG_VIEW_VG[i];if(!g)return;fbSelMarca(g.key,fbLotePessoa(g,g.faltas),cx);}
/* WhatsApp do SAC na Visão geral: estado e, para a coordenação, conectar pelo QR code */
function fbZapVG(){
  const z=LIG_ZAP||{},e=fbZapEstado(),pode=!!LIG_PODE_BAIXAR;
  return'<span class="fb-wa '+e.cls+'" id="lig-vg-zap"><i class="fb-dot"></i><span><b>WhatsApp do SAC</b> '+_esc(e.txt)+'</span>'
    +(pode&&z.state!=="open"?'<button type="button" class="fb-btn sm pri" onclick="ligZapConectar()">'+fbI("qr")+'Conectar pelo QR code</button>':"")
    +(pode&&z.state==="open"?'<button type="button" class="fb-btn ghost sm" onclick="ligZapDesconectar()">'+fbI("power")+'Desconectar</button>':"")+'</span>';
}
function fbPessoaDaFila(g){const k=String(g.re||"")+"|"+(_ligNorm(g.nome).split(" ")[0]||"");return LIG_P.find(p=>p.key===k)||LIG_P.find(p=>_ligNorm(p.nome)===_ligNorm(g.nome))||null;}
function ligVGAbrir(i){const g=LIG_VIEW_VG[i];if(!g)return;const p=fbPessoaDaFila(g);if(p)ligPanorama(p);else ligColab(g.re,g.nome);}
function ligVGEnviar(i){const g=LIG_VIEW_VG[i];if(!g)return;const p=fbPessoaDaFila(g);ligZapAbrir(g.nome,(p&&fbFone(p.telefone))||ligTelefoneDe(g.nome),g.re,g.faltas,null);}
function ligVGRegistrar(i){const g=LIG_VIEW_VG[i];if(!g)return;const p=fbPessoaDaFila(g);ligForm(null,p?ligPreencher(p):{colaborador:g.nome,re:g.re,posto:g.posto,supervisor:g.sup,ultima:g.faltas[g.faltas.length-1]});}

function ligAba(a){
  if(!FB_ABAS.some(x=>x.k===a))a="visao";
  if(a!==LIG_ABA){LIG_LIM=24;LIG_SEL=new Set();LIG_BUSCA_P="";}
  const ia=FB_ABAS.findIndex(x=>x.k===LIG_ABA),ib=FB_ABAS.findIndex(x=>x.k===a);LIG_DX=ib>ia?28:ib<ia?-28:0;
  LIG_ABA=a;try{localStorage.setItem("fbAba3",a);}catch(e){}
  const nav=document.querySelector("#lig-root .fb-abas"),ant=fbPosOn(nav);
  document.querySelectorAll("#lig-root .fb-abas > button").forEach((b,i)=>{if(!FB_ABAS[i])return;const on=FB_ABAS[i].k===a;b.classList.toggle("on",on);b.setAttribute("aria-selected",on);});
  fbIndica(nav,ant);
  ligPanel();
}
function ligTab(t){
  if(t==="hist"){ligAba("hist");return;}
  if(t==="acomp"){ligAba("monit");return;}
  if(FB_FILA.indexOf(t)<0)t="mensagem";
  if(t!==LIG_TAB){LIG_LIM=24;LIG_SEL=new Set();LIG_DX=FB_FILA.indexOf(t)>FB_FILA.indexOf(LIG_TAB)?20:-20;}
  LIG_TAB=t;try{localStorage.setItem("fbTab2",t);}catch(e){}
  if(LIG_ABA!=="fila"){ligAba("fila");return;}
  ligPanel();
}
function ligVF(v){const o=["todos","piorou","mesma","comecando","melhorando"];LIG_DX=o.indexOf(v)>o.indexOf(LIG_VF)?20:o.indexOf(v)<o.indexOf(LIG_VF)?-20:0;LIG_VF=v;LIG_LIM=24;ligPanel();}
function ligMais(){LIG_LIM+=24;ligPanel();}
function fbBusca(){return'<label class="fb-search">'+fbI("search")+'<span class="fb-sr">Buscar por nome ou RE</span><input id="lig-busca-p" class="fb-in" type="search" placeholder="Buscar por nome ou RE" autocomplete="off" value="'+_esc(LIG_BUSCA_P)+'" oninput="ligFiltraPend(this.value)"></label><span id="lig-busca-n" class="fb-count"></span>';}
function ligPanel(){
  const box=document.getElementById("lig-panel");if(!box)return;
  if(LIG_ABA==="hist"){LIG_VIEW=[];LIG_TRUNC=false;fbMostra(box,'<div class="fb-panel">'+fbPnlHist()+'</div>');return;}
  if(LIG_ABA==="desemp"){LIG_VIEW=[];LIG_TRUNC=false;fbMostra(box,'<div class="fb-panel">'+fbPnlDes()+'</div>');return;}
  if(LIG_ABA==="visao"){LIG_VIEW=[];fbMostra(box,'<div class="fb-panel">'+fbPnlVisao()+'</div>');return;}
  const P=LIG_P.filter(p=>fbSupOk(p.supervisor));
  let h='<div class="fb-panel">',lista,total;
  if(LIG_ABA==="monit"){
    const ac=P.filter(p=>p.situacao==="acomp"),V={piorou:0,mesma:0,comecando:0,melhorando:0};
    ac.forEach(p=>{V[p.acomp.veredito]=(V[p.acomp.veredito]||0)+1;});
    const op=[["todos","Todos",ac.length],["piorou","Piorou",V.piorou],["mesma","Igual a antes",V.mesma],["comecando","Em observação",V.comecando],["melhorando","Melhorou",V.melhorando]];
    h+='<div class="fb-sub"><div class="fb-tabs2" role="tablist" aria-label="Resultado do monitoramento" data-nav="sub" data-ind="linha">'+op.map(o=>'<button type="button" role="tab" class="'+(LIG_VF===o[0]?"on":"")+'" aria-selected="'+(LIG_VF===o[0])+'" title="'+_esc(o[0]==="todos"?"Todas as pessoas em acompanhamento":FB_VD[o[0]].d)+'" onclick="ligVF(\''+o[0]+'\')">'+o[1]+'<span class="n">'+o[2]+'</span></button>').join("")+'</div><div class="fb-sub-a" data-sync="suba">'+fbBusca()+'</div></div>';
    total=ac.length;lista=LIG_VF==="todos"?ac:ac.filter(p=>p.acomp.veredito===LIG_VF);
  }else{
    const cont={};FB_FILA.forEach(k=>{cont[k]=P.filter(p=>p.situacao===k).length;});
    h+='<div class="fb-sub"><div class="fb-tabs2" role="tablist" aria-label="Fila do SAC" data-nav="sub" data-ind="linha">'+FB_FILA.map(k=>{const s=FB_SIT.find(x=>x.k===k);return'<button type="button" role="tab" class="'+(LIG_TAB===k?"on":"")+'" aria-selected="'+(LIG_TAB===k)+'" title="'+_esc(s.d)+'" onclick="ligTab(\''+k+'\')">'+s.t+'<span class="n">'+cont[k]+'</span></button>';}).join("")+'</div>'
      +'<div class="fb-sub-a" data-sync="suba">'+fbBusca()+(LIG_TAB==="mensagem"&&cont.mensagem?'<button type="button" class="fb-btn sm" onclick="ligSelTodos()">Selecionar '+Math.min(LIG_LOTE_MAX,cont.mensagem)+(cont.mensagem>LIG_LOTE_MAX?" primeiras":(cont.mensagem===1?" pessoa":" pessoas"))+'</button>':"")+'</div></div>';
    h+='<div id="lig-lista">';
    if(LIG_TAB==="mensagem")h+='<div id="lig-lote">'+fbBarraLote()+'</div>';
    lista=P.filter(p=>p.situacao===LIG_TAB);total=lista.length;
  }
  if(LIG_ABA==="monit")h+='<div id="lig-lista">';
  LIG_VIEW=lista;
  LIG_TRUNC=lista.length>LIG_LIM;
  const vis=LIG_BUSCA_P?lista:lista.slice(0,LIG_LIM);
  h+='<div id="lig-vazio-busca" style="display:none">'+fbVazio()+'</div>';
  if(!lista.length)h+=fbVazio();
  else h+='<div class="fb-cards'+(LIG_ABA==="monit"?" m":"")+'">'+vis.map((p,i)=>LIG_ABA==="monit"?fbCardM(p,i):fbCard(p,i)).join("")+'</div>'
    +(vis.length<lista.length?'<div class="fb-mais-b"><button type="button" class="fb-btn" onclick="ligMais()">Mostrar mais '+Math.min(24,lista.length-vis.length)+'<span class="fb-mut"> · faltam '+(lista.length-vis.length)+'</span></button></div>':"");
  fbMostra(box,h+'</div></div>');
}
/* estado vazio (referência 2): ilustração em vez de frase genérica */
function fbVazio(){
  return'<div class="fb-empty"><svg class="fb-ilu" viewBox="0 0 220 150" aria-hidden="true">'
    +'<ellipse cx="110" cy="138" rx="78" ry="7" fill="#dfe9f7"/>'
    +'<rect x="58" y="34" width="96" height="98" rx="10" fill="#e9f1fc"/>'
    +'<rect x="48" y="22" width="96" height="104" rx="10" fill="#fff" stroke="#c9dbf3" stroke-width="2"/>'
    +'<rect x="62" y="38" width="44" height="6" rx="3" fill="#bcd3f1"/><rect x="62" y="50" width="30" height="5" rx="2.5" fill="#dbe7f7"/>'
    +'<rect x="64" y="86" width="10" height="24" rx="2" fill="#9cc0ee"/><rect x="80" y="74" width="10" height="36" rx="2" fill="#5b9be6"/><rect x="96" y="92" width="10" height="18" rx="2" fill="#bcd3f1"/><rect x="112" y="66" width="10" height="44" rx="2" fill="#2f7fd6"/>'
    +'<path d="M62 112h66" stroke="#c9dbf3" stroke-width="2" stroke-linecap="round"/>'
    +'<circle cx="150" cy="78" r="20" fill="#f4f8fe" stroke="#2f7fd6" stroke-width="5"/><path d="M164 92l16 16" stroke="#1e3a5f" stroke-width="7" stroke-linecap="round"/>'
    +'<circle cx="38" cy="44" r="3" fill="#bcd3f1"/><circle cx="178" cy="36" r="4" fill="#dbe7f7"/><path d="M176 56l4 0M178 54l0 4" stroke="#9cc0ee" stroke-width="2" stroke-linecap="round"/>'
    +'</svg><h3>Acompanhe o comportamento<br>de faltas de forma clara e organizada.</h3><p>Use os filtros acima para refinar sua busca.</p><i class="fb-empty-bar"></i></div>';
}

/* ═════ dias: a mesma regra de cor para o card e para o calendário ═════ */
function fbDia(p,d,cod,env,hj,marca){
  const c=cod[d];let k="ok",t="Sem falta registrada";
  if(d>hj){k="fut";t="Ainda não chegou";}
  else if(c==="I"||c==="T"){k="f";t=c==="T"?"Falta (já tratada pelo SAC)":"Falta sem justificar";}
  else if(c==="A"||c==="J"||c==="L"||c==="AF"){k="a";t=FB_ABO_NOME[c]||"Abonada";}
  if(marca&&d===marca){k+=" c";t="Dia do feedback";}
  if(env[d]){k+=" m";t+=" · mensagem do SAC enviada";}
  if(d===hj){k+=" h";t+=" · hoje";}
  return[k,t];
}
/* o calendário vai até o fim da semana de hoje: dias bem à frente (ou um mês com um dia só) não ajudam a analisar */
function fbDow(d){return(new Date(d+"T12:00:00Z").getUTCDay()+6)%7;}
function fbFimCal(fim,hj){const sem=ligSomaDias(hj,6-fbDow(hj));return fim<sem?fim:sem;}
function fbMapas(p){const cod={},env={};(p.hist||[]).forEach(h=>{cod[h[0]]=h[1];});(p.envios||[]).forEach(d=>{env[d]=1;});return[cod,env];}
/* meses que a janela atravessa */
function fbMesesLista(ini,fim){
  const NM=["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"],out=[];
  for(let d=ini;d<=fim;d=ligSomaDias(d,1)){const k=d.slice(0,7);if(!out.length||out[out.length-1].k!==k)out.push({k,nome:NM[Number(k.slice(5,7))-1]+" / "+k.slice(0,4),dias:[]});out[out.length-1].dias.push(d);}
  return out;
}
/* calendário do panorama: um bloco por mês, em semanas de segunda a domingo; "ativo" é o mês que aparece (sem ele, todos aparecem) */
function fbCelulas(p,ini,fim,marca,ativo){
  const[cod,env]=fbMapas(p),hj=ligHojeISO();
  return'<div class="fb-meses" aria-hidden="true">'+fbMesesLista(ini,fim).map((m,i)=>{
    let h='<section class="fb-mes" data-m="'+i+'"'+(ativo!==undefined&&i!==ativo?' style="display:none"':"")+'><div class="fb-cal">'+["Seg","Ter","Qua","Qui","Sex","Sáb","Dom"].map(x=>'<b>'+x+'</b>').join("");
    for(let k=0;k<fbDow(m.dias[0]);k++)h+='<span class="v"></span>';
    m.dias.forEach(d=>{const r=fbDia(p,d,cod,env,hj,marca);h+='<i class="'+r[0]+'" title="'+fbDd(d)+' · '+_esc(r[1])+'">'+d.slice(8,10)+'</i>';});
    return h+'</div></section>';
  }).join("")+'</div>';
}
function ligMes(delta){
  const n=LIG_MESES.length;if(!n)return;
  LIG_MES=Math.max(0,Math.min(n-1,LIG_MES+delta));
  document.querySelectorAll("#lig-perfil-modal .fb-mes").forEach(s=>{s.style.display=Number(s.dataset.m)===LIG_MES?"":"none";});
  const t=document.getElementById("lp-mes"),a=document.getElementById("lp-mes-a"),b=document.getElementById("lp-mes-b");
  if(t)t.textContent=LIG_MESES[LIG_MES];
  if(a)a.disabled=LIG_MES===0;
  if(b)b.disabled=LIG_MES===n-1;
}

/* ═════ cards ═════ */
function fbCabCard(p,tom,pill,ck){
  const nome=_esc(p.nome);
  return'<div class="fb-pc-h"><div class="fb-av2">'+_esc(fbIni(p.nome))+'</div><div class="fb-pc-t"><div class="fb-nm" title="'+nome+'">'+nome+'</div><div class="fb-sb">'+(p.re?'RE '+_esc(p.re):"")+(p.re&&p.posto?" • ":"")+_esc(fbTitulo(p.posto||""))+'</div></div>'+(pill||"")+(ck||"")+'</div>';
}
/* "COND. ALTO DA SERRA - ZELADOR" → "Cond. Alto da Serra - Zelador" */
function fbTitulo(s){return String(s||"").toLowerCase().replace(/(^|[\s(\/-])([a-zà-ú])/g,(m,a,b)=>a+b.toUpperCase()).replace(/\b(Da|De|Do|Das|Dos|E)\b/g,x=>x.toLowerCase());}
/* fila do SAC: o que aconteceu e as duas ações (Enviar WhatsApp, Registrar feedback) */
function fbCard(p,i){
  let pill="",corpo="",acoes="",tom="tn-br";
  const nome=_esc(p.nome),pl=(n,a,b)=>n+" "+(n===1?a:b);
  if(p.situacao==="mensagem"){
    tom=p.tentativas>0?"tn-am":"tn-br";
    pill=fbTag(p.tentativas>0?"1 mensagem sem resposta":pl(p.faltas.length,"falta","faltas"),tom);
    corpo='<p class="fb-pc-l"><b>Faltou</b> em '+fbDatas(p.faltas)+'</p>'
      +(p.tentativas>0?'<p class="fb-pc-l fb-mut">Última mensagem'+(p.ultima_tentativa?' em '+fbDd(p.ultima_tentativa):"")+'. A pessoa não ligou.</p>':"");
    acoes=fbBtn("Enviar WhatsApp","ligEnviarI("+i+")","pri sm","chat")+fbBtn("Registrar feedback","ligRegistrarI("+i+")","sm","phone");
  }else if(p.situacao==="aguardando"){
    const sem=p.envio==="sem_retorno",man=p.ultima_marca_manual;
    tom=sem?"tn-am":"tn-br";
    pill=fbTag(sem?"Não ligou":"Aguardando ligação",tom);
    corpo=man
      ?'<p class="fb-pc-l"><b>Tentativa registrada</b> '+fbDias(p.ultima_marca)+' ('+fbDd(p.ultima_marca)+'). Não houve conversa.</p>'
      :'<p class="fb-pc-l"><b>Mensagem enviada</b> '+fbDias(p.ultima_marca)+' ('+fbDd(p.ultima_marca)+')</p>';
    corpo+='<p class="fb-pc-l fb-mut">'+(sem?"Se faltar de novo e não responder, vai para a coordenação.":"A pessoa tem até "+fbDd(p.prazo_ate||p.ultima_marca)+" para ligar.")+'</p>';
    acoes=fbBtn("Registrar feedback","ligRegistrarI("+i+")","pri sm","phone")+fbBtn("Enviar WhatsApp","ligEnviarI("+i+")","sm","chat");
  }else{
    tom="tn-da";
    pill=fbTag(p.tentativas+" mensagens sem resposta","tn-da");
    corpo='<p class="fb-pc-l"><b>Faltou</b> em '+fbDatas(p.faltas)+'</p>';
    // com a coordenação: quem registra a conversa é a coordenação (Raphael, Jussilene, João); todos veem o resumo
    acoes=(LIG_PODE_BAIXAR?fbBtn("Registrar feedback","ligRegistrarI("+i+")","pri sm","phone"):"")+fbBtn("Enviar WhatsApp","ligEnviarI("+i+")","sm","chat")+fbBtn("Resumo","ligResumoI("+i+")","sm","doc");
  }
  const ck=p.situacao==="mensagem"?'<label class="fb-ck" onclick="event.stopPropagation()" title="Selecionar para envio em lote"><input type="checkbox" onchange="ligSel('+i+',this)"'+(LIG_SEL.has(p.key)?" checked":"")+' aria-label="Selecionar '+nome+'"><span></span></label>':"";
  return'<article class="fb-pc '+tom+(LIG_SEL.has(p.key)?" sel":"")+'" style="--i:'+Math.min(i,12)+'" tabindex="0" role="button" aria-label="Abrir o panorama de '+nome+'" onclick="ligAbrir('+i+')" onkeydown="if(event.key===\'Enter\'&&event.target===this)ligAbrir('+i+')" data-lb="'+_esc(_ligNorm(p.nome))+'" data-re="'+_esc(String(p.re||""))+'">'
    +fbCabCard(p,tom,"",ck)
    +'<div class="fb-pc-b"><div class="fb-pc-c">'+pill+'</div>'+corpo+'</div><div class="fb-pc-a" onclick="event.stopPropagation()">'+acoes+'</div></article>';
}
/* monitoramento (referência 4): fundo na cor do resultado, faltas antes × depois com as datas, ícone de tendência e seta */
function fbCardM(p,i){
  const a=p.acomp,v=FB_VD[a.veredito]||FB_VD.mesma,c=p.contato||{},hj=ligHojeISO();
  const nome=_esc(p.nome),plF=n=>n===1?"Falta":"Faltas";
  const ini=ligSomaDias(c.data,-30),fimAntes=c.data,iniDep=ligSomaDias(c.data,1),fimDep=ligSomaDias(c.data,30)<hj?ligSomaDias(c.data,30):hj;
  const col=(rot,n,dias,de,ate)=>'<div class="fb-mc" title="'+rot+'"><div><b>'+n+'</b><span>'+plF(n)+'</span></div><em>em '+fbPlural(dias,"dia","dias")+'</em><em>('+fbDd(de)+' a '+fbDd(ate)+')</em></div>';
  const extras=[];
  if(c.acordo_auto&&FB_ACOR[c.acordo_auto])extras.push(fbTag(FB_ACOR[c.acordo_auto][0],FB_ACOR[c.acordo_auto][1]));
  if(a.sem_baixa)extras.push(fbTag("Aguardando baixa da coordenação","tn-am"));
  return'<article class="fb-pc fb-pm '+v.tom+'" style="--i:'+Math.min(i,12)+'" tabindex="0" role="button" aria-label="Abrir o panorama de '+nome+'" onclick="ligAbrir('+i+')" onkeydown="if(event.key===\'Enter\'&&event.target===this)ligAbrir('+i+')" data-lb="'+_esc(_ligNorm(p.nome))+'" data-re="'+_esc(String(p.re||""))+'">'
    +fbCabCard(p,v.tom,'<span class="fb-vp">'+fbI(v.ic)+_esc(v.t)+'</span>')
    +'<div class="fb-pm-b">'+col("Antes do feedback",a.antes,30,ini,fimAntes)+(a.dia>0?col("Depois do feedback",a.depois,a.dia,iniDep,fimDep):'<div class="fb-mc" title="Depois do feedback"><div><b>'+a.depois+'</b><span>'+plF(a.depois)+'</span></div><em>feedback hoje</em><em>('+fbDd(c.data)+')</em></div>')
    +'<span class="fb-pm-ic">'+fbI(v.cic)+'</span><span class="fb-pm-go">'+fbI("go")+'</span></div>'
    +fbRegistro(LIG_C.find(x=>x.id===c.id)||null)
    +(extras.length?'<div class="fb-tags fb-pm-t">'+extras.join("")+'</div>':"")+'</article>';
}
function ligEnviarI(i){const p=LIG_VIEW[i];if(p)ligZapAbrir(p.nome,fbFone(p.telefone)||ligTelefoneDe(p.nome),p.re,p.faltas||[],null);}
function ligRegistrarI(i){const p=LIG_VIEW[i];if(p)ligForm(null,ligPreencher(p));}
function ligAbrir(i){const p=LIG_VIEW[i];if(p)ligPanorama(p);}
function ligResumoI(i){const p=LIG_VIEW[i];if(p)ligResumo(p);}
/* busca por nome ou RE: esconde cartões em vez de redesenhar (o cursor não sai do campo) */
function ligFiltraPend(termo){
  if(termo!==undefined){const antes=LIG_BUSCA_P;LIG_BUSCA_P=termo;if(LIG_TRUNC&&!!antes!==!!termo){ligPanel();const i=document.getElementById("lig-busca-p");if(i&&i.focus){i.focus();if(i.setSelectionRange)i.setSelectionRange(i.value.length,i.value.length);}return;}}
  const q=_ligNorm(LIG_BUSCA_P),qd=q.replace(/\D/g,"").replace(/^0+/,"");
  const root=document.getElementById("lig-panel"),cnt=document.getElementById("lig-busca-n"),vz=document.getElementById("lig-vazio-busca");
  if(!root)return;
  let vis=0,tot=0;
  root.querySelectorAll("[data-lb]").forEach(e=>{
    tot++;
    const ok=!q||(e.dataset.lb||"").indexOf(q)>=0||(qd&&String(e.dataset.re||"").replace(/^0+/,"").indexOf(qd)===0);
    e.style.display=ok?"":"none";if(ok)vis++;
  });
  if(cnt)cnt.textContent=q&&tot?vis+" de "+tot:"";
  if(vz)vz.style.display=q&&tot&&!vis?"block":"none";
}

/* ═════ histórico geral de qualquer colaborador (busca no topo) ═════ */
let LIG_BG=[],LIG_BG_I=-1;
function ligBuscaG(v){
  const box=document.getElementById("lig-bg-r");if(!box)return;
  const q=_ligNorm(v),qd=q.replace(/\D/g,"").replace(/^0+/,"");
  if(q.length<2&&!qd){box.innerHTML="";box.classList.remove("on");LIG_BG=[];return;}
  const m=new Map();
  ((LIG_IND&&LIG_IND.pessoas)||[]).forEach(x=>m.set(String(x[0])+"|"+_ligNorm(x[1]),{re:String(x[0]||""),nome:x[1],posto:x[2],sup:x[3]}));
  LIG_P.forEach(p=>{const k=String(p.re||"")+"|"+_ligNorm(p.nome);if(!m.has(k))m.set(k,{re:String(p.re||""),nome:p.nome,posto:p.posto,sup:p.supervisor});});
  LIG_BG=[...m.values()].filter(x=>_ligNorm(x.nome).indexOf(q)>=0||(qd&&x.re.replace(/^0+/,"").indexOf(qd)===0)).slice(0,8);
  LIG_BG_I=-1;
  box.innerHTML=LIG_BG.length?LIG_BG.map((x,i)=>'<button type="button" role="option" onmousedown="event.preventDefault()" onclick="ligBuscaGAbrir('+i+')"><span class="fb-av3">'+_esc(fbIni(x.nome))+'</span><span><b>'+_esc(x.nome)+'</b><small>'+(x.re?"RE "+_esc(x.re):"")+(x.posto?" • "+_esc(fbTitulo(x.posto)):"")+'</small></span></button>').join(""):'<div class="nada">Ninguém com esse nome ou RE.</div>';
  box.classList.add("on");
}
function ligBuscaGTecla(e){
  const box=document.getElementById("lig-bg-r");if(!box||!LIG_BG.length)return;
  if(e.key==="ArrowDown"||e.key==="ArrowUp"){e.preventDefault();LIG_BG_I=(LIG_BG_I+(e.key==="ArrowDown"?1:-1)+LIG_BG.length)%LIG_BG.length;box.querySelectorAll("button").forEach((b,i)=>b.classList.toggle("on",i===LIG_BG_I));}
  else if(e.key==="Enter"){e.preventDefault();ligBuscaGAbrir(LIG_BG_I<0?0:LIG_BG_I);}
}
function ligBuscaGFecha(){const box=document.getElementById("lig-bg-r");if(box)box.classList.remove("on");}
function ligBuscaGAbrir(i){const x=LIG_BG[i];if(!x)return;ligBuscaGFecha();const inp=document.getElementById("lig-bg");if(inp)inp.value="";ligColab(x.re,x.nome);}
/* abre o panorama de qualquer pessoa: o servidor junta faltas (até 400 dias), mensagens e contatos */
function ligColab(re,nome){
  fbToast("Abrindo o histórico de "+String(nome||"").split(" ")[0]+"…");
  return ligApi("/api/ligacoes?acao=colaborador&re="+encodeURIComponent(re||"")+"&nome="+encodeURIComponent(nome||""))
    .then(j=>{if(j&&j.pessoa)ligPanorama(j.pessoa);})
    .catch(e=>fbToast(e.message||"Não consegui abrir o histórico.","err"));
}

/* ═════ aba Desempenho: painel de diretoria ═════
   Quatro sub-abas: Resumo executivo · Efeito do feedback · Empresa e áreas · Motivos e atendimento.
   % sempre sobre as faltas SEM justificativa; abonadas só como contexto; mês em andamento marcado como parcial e projetado. */
function fbMesesDisp(modo){
  const hj=ligHojeISO(),ini=fbMesChave((LIG_IND&&LIG_IND.desde)||ligSomaDias(hj,-365),modo),fim=fbMesChave(hj,modo),out=[];
  let a=Number(ini.slice(0,4)),m=Number(ini.slice(5,7));
  for(let k=ini;k<=fim&&out.length<40;){out.push(k);m++;if(m>12){m=1;a++;}k=a+"-"+String(m).padStart(2,"0");}
  return out;
}
function fbPct(a,b){return a>0?Math.round((b-a)/a*100):null;}
function fbPctTxt(p){return p===null?"—":(p>0?"+":p<0?"−":"")+Math.abs(p)+"%";}
function fbTomVar(p){return p===null||p===0?"tn-gr":p<0?"tn-ok":"tn-da";}
function fbSoma(lista,de,ate){const r={sj:0,ab:0};lista.forEach(x=>(x.faltas||[]).forEach(f=>{if(f[0]>=de&&f[0]<=ate)r[f[1]==="S"?"sj":"ab"]++;}));return r;}
function fbMesCurto(k){return FB_MESES[Number(k.slice(5,7))-1]+"/"+k.slice(2,4);}
function fbProxMes(k,n){let a=Number(k.slice(0,4)),m=Number(k.slice(5,7))+n;while(m>12){m-=12;a++;}while(m<1){m+=12;a--;}return a+"-"+String(m).padStart(2,"0");}
function fbNum(n,d){return Number(n||0).toLocaleString("pt-BR",{maximumFractionDigits:d||0});}
let LIG_DSUB="resumo";
try{const s=localStorage.getItem("fbDesSub");if(s)LIG_DSUB=s;}catch(e){}
const FB_DSUBS=[["resumo","Resumo executivo","chart"],["efeito","Efeito do feedback","ok"],["areas","Empresa e áreas","list"],["postos","Postos e reserva","pin"],["motivos","Motivos e atendimento","doc"]];
function ligDes(k,v){
  if(k==="mot"&&LIG_DES.mot===v)v=""; /* clicar de novo no mesmo motivo fecha o detalhe */
  if(k==="ef"||k==="mot"||k==="pt"||k==="ptord")LIG_DX=0;
  if(k==="sub"){const o=FB_DSUBS.map(s=>s[0]);LIG_DX=o.indexOf(v)>o.indexOf(LIG_DSUB)?24:o.indexOf(v)<o.indexOf(LIG_DSUB)?-24:0;LIG_DSUB=v;try{localStorage.setItem("fbDesSub",v);}catch(e){}}
  else LIG_DES[k]=v;
  if(k==="modo"){LIG_DES.ini="";LIG_DES.fim="";try{localStorage.setItem("fbDesModo",v);}catch(e){}}
  if(k==="ord"){if(LIG_DES._o===v)LIG_DES.dir=-LIG_DES.dir;else LIG_DES.dir=v==="nome"?1:-1;LIG_DES._o=v;}
  ligPanel();
}

/* ── os números do painel: um mês por linha ── */
function fbDesDados(){
  const hj=ligHojeISO(),modo=LIG_DES.modo==="civil"?"civil":"folha",meses=fbMesesDisp(modo);
  let fim=meses.indexOf(LIG_DES.fim);if(fim<0)fim=meses.length-1;
  let ini=meses.indexOf(LIG_DES.ini);if(ini<0||ini>fim)ini=Math.max(0,fim-5);
  const coorte=((LIG_IND&&LIG_IND.com_feedback)||[]).filter(x=>fbSupOk(x.supervisor));
  const L=meses.map(k=>{
    const de=fbMesIni(k,modo),fimM=fbMesFim(k,modo),ate=fimM<hj?fimM:hj,parcial=fimM>hj;
    const emp=fbFaltasEntre(de,ate),cv=fbConversasEntre(de,ate),dur=cv.filter(c=>c[2]),F=fbFunil(de,ate,{tipo:"todos"});
    const passados=fbDiasEntre(de,ate)+1,total=fbDiasEntre(de,fimM)+1;
    const resp=F.enviadas.filter(g=>g.st==="ligou").length;
    return{k,de,ate,fimM,parcial,passados,total,emp,fech:parcial?Math.round(emp.sj/passados*total):emp.sj,
      conv:cv.length,min:dur.length?Math.round(dur.reduce((t,c)=>t+c[2],0)/dur.length):null,env:F.enviadas.length,ret:F.enviadas.length?Math.round(resp/F.enviadas.length*100):null,cvs:cv};
  });
  /* tendência: reta dos últimos 6 meses fechados, 3 meses à frente, faixa de ± o desvio dos resíduos */
  const fech=L.filter(x=>!x.parcial).slice(-6),n=fech.length;
  let tend=null;
  if(n>=3){
    const xs=fech.map((_,i)=>i),ys=fech.map(x=>x.emp.sj),mx=xs.reduce((a,b)=>a+b,0)/n,my=ys.reduce((a,b)=>a+b,0)/n;
    const b=xs.reduce((t,x,i)=>t+(x-mx)*(ys[i]-my),0)/(xs.reduce((t,x)=>t+(x-mx)*(x-mx),0)||1),a=my-b*mx;
    const dp=Math.sqrt(ys.reduce((t,y,i)=>t+Math.pow(y-(a+b*i),2),0)/n);
    const base=L[L.length-1].parcial?n+1:n;
    tend={meses:[1,2,3].map(j=>fbProxMes(L[L.length-1].k,j)),vals:[0,1,2].map(j=>Math.max(0,Math.round(a+b*(base+j)))),banda:Math.round(dp),incl:b};
  }
  return{hj,modo,meses,ini,fim,kI:meses[ini],kF:meses[fim],faixa:L.slice(ini,fim+1),todos:L,coorte,tend};
}
/* efeito do feedback: cada conversa registrada no intervalo, faltas 30 dias antes × depois (proporcional a 30 dias) */
function fbEfeito(D){
  const M=fbIdxFaltas(),pes=(LIG_IND&&LIG_IND.pessoas)||[],hj=D.hj,de=fbMesIni(D.kI,D.modo),ate=D.faixa[D.faixa.length-1].ate,vistos=new Set(),cont=[];
  ((LIG_IND&&LIG_IND.funil&&LIG_IND.funil.feedbacks)||[]).forEach(x=>{
    const d=x[0],i=x[1],p=pes[i];if(d<de||d>ate||!p||!fbSupOk(p[3])||vistos.has(i+"|"+d))return;vistos.add(i+"|"+d);
    const fs=(M.falt[i]||[]).filter(f=>f[2]!=="A").map(f=>f[0]);
    const dias=Math.min(30,fbDiasEntre(d,hj)),fa=fs.filter(f=>f>=ligSomaDias(d,-30)&&f<=d),fd=fs.filter(f=>f>d&&f<=ligSomaDias(d,dias)),antes=fa.length,depois=fd.length;
    cont.push({i,d,nome:p[1],re:String(p[0]||""),sup:p[3],posto:p[2],antes,depois,fa,fd,dias,norm:dias>0?depois*30/dias:0,mes:fbMesChave(d,D.modo)});
  });
  // a última conversa de cada pessoa decide o resultado dela
  const ult={};cont.forEach(c=>{if(!ult[c.i]||ult[c.i].d<c.d)ult[c.i]=c;});
  const av=Object.values(ult).filter(c=>c.dias>=7);
  const r={melh:0,igual:0,pior:0};av.forEach(c=>{if(c.depois===0||c.depois<c.antes)r.melh++;else if(c.depois===c.antes)r.igual++;else r.pior++;});
  const sa=av.reduce((t,c)=>t+c.antes,0),sd=av.reduce((t,c)=>t+c.norm,0);
  return{cont,av,r,red:sa>0?Math.round((sd-sa)/sa*100):null};
}

/* ── gráficos em SVG: área com projeção, colunas, rosca e mini-área ── */
function fbTeto(v){if(v<=4)return 4;const p=Math.pow(10,Math.floor(Math.log10(v))),f=v/p;return(f<=1?1:f<=2?2:f<=2.5?2.5:f<=5?5:10)*p;}
function fbCurva(pts){
  if(!pts.length)return"";let d="M"+pts[0][0].toFixed(1)+" "+pts[0][1].toFixed(1);
  for(let i=0;i<pts.length-1;i++){const p0=pts[i-1]||pts[i],p1=pts[i],p2=pts[i+1],p3=pts[i+2]||p2,t=.18;
    d+=" C"+(p1[0]+(p2[0]-p0[0])*t).toFixed(1)+" "+(p1[1]+(p2[1]-p0[1])*t).toFixed(1)+" "+(p2[0]-(p3[0]-p1[0])*t).toFixed(1)+" "+(p2[1]-(p3[1]-p1[1])*t).toFixed(1)+" "+p2[0].toFixed(1)+" "+p2[1].toFixed(1);}
  return d;
}
let FB_GID=0;
/* área: o realizado em linha cheia, o fechamento do mês em andamento e a tendência em tracejado, com a faixa de margem */
function fbGArea(o){
  const W=o.w||760,H=o.h||270,pl=44,pr=18,pt=22,pb=34,id="g"+(++FB_GID),n=o.vals.length,ext=o.tend?o.tend.vals.length:0,tot=n+ext;
  const topo=fbTeto(Math.max(1,...o.vals,o.fech||0,...(o.tend?o.tend.vals.map(v=>v+o.tend.banda):[]))*1.08);
  const X=i=>pl+(tot>1?i*(W-pl-pr)/(tot-1):(W-pl-pr)/2),Y=v=>pt+(H-pt-pb)*(1-v/topo);
  const ateFech=o.parcial?n-1:n,real=o.vals.slice(0,ateFech).map((v,i)=>[X(i),Y(v)]);
  let s='<svg class="fb-g" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="'+_esc(o.rot||"Gráfico")+'"><defs><linearGradient id="'+id+'" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="'+o.cor+'" stop-opacity=".32"/><stop offset="1" stop-color="'+o.cor+'" stop-opacity="0"/></linearGradient></defs>';
  for(let g=0;g<=4;g++){const v=topo*g/4,y=Y(v);s+='<line class="gl" x1="'+pl+'" x2="'+(W-pr)+'" y1="'+y+'" y2="'+y+'"/><text class="gy" x="'+(pl-8)+'" y="'+(y+4)+'">'+fbNum(v,o.dec||0)+(o.suf||"")+'</text>';}
  o.rots.concat(o.tend?o.tend.meses.map(fbMesCurto):[]).forEach((r,i)=>{s+='<text class="gx'+(i>=n?" pj":"")+'" x="'+X(i)+'" y="'+(H-10)+'">'+_esc(r)+'</text>';});
  if(real.length>1){s+='<path class="ga" d="'+fbCurva(real)+' L'+real[real.length-1][0].toFixed(1)+' '+Y(0)+' L'+real[0][0].toFixed(1)+' '+Y(0)+'Z" fill="url(#'+id+')"/><path class="gln" d="'+fbCurva(real)+'" stroke="'+o.cor+'"/>';}
  let ultimo=real[real.length-1];
  if(o.parcial){
    const xf=X(n-1),yf=Y(o.fech),yr=Y(o.vals[n-1]);
    if(ultimo)s+='<path class="gpj" d="M'+ultimo[0]+' '+ultimo[1]+' L'+xf+' '+yf+'" stroke="'+o.cor+'"/>';
    s+='<line class="gpj2" x1="'+xf+'" x2="'+xf+'" y1="'+yr+'" y2="'+yf+'" stroke="'+o.cor+'"/>'
      +'<circle class="gp oco" cx="'+xf+'" cy="'+yr+'" r="5" stroke="'+o.cor+'" data-tip="'+_esc(o.rots[n-1]+": "+fbNum(o.vals[n-1])+(o.suf||"")+" até hoje")+'"/>'
      +'<circle class="gp pj" cx="'+xf+'" cy="'+yf+'" r="6" stroke="'+o.cor+'" data-tip="'+_esc(o.rots[n-1]+": fechamento projetado de "+fbNum(o.fech)+(o.suf||""))+'"/>'
      +'<text class="gv pj" x="'+xf+'" y="'+(yf-12)+'">'+fbNum(o.fech)+'</text>';
    ultimo=[xf,yf];
  }
  if(o.tend&&ultimo){
    const tp=o.tend.vals.map((v,j)=>[X(n+j),Y(v)]),up=o.tend.vals.map((v,j)=>[X(n+j),Y(v+o.tend.banda)]),dn=o.tend.vals.map((v,j)=>[X(n+j),Y(Math.max(0,v-o.tend.banda))]);
    s+='<path class="gbd" d="M'+ultimo[0]+' '+ultimo[1]+' '+up.map(p=>"L"+p[0]+" "+p[1]).join(" ")+' '+dn.slice().reverse().map(p=>"L"+p[0]+" "+p[1]).join(" ")+'Z" fill="'+o.cor+'"/>'
      +'<path class="gpj" d="M'+ultimo[0]+' '+ultimo[1]+' '+tp.map(p=>"L"+p[0]+" "+p[1]).join(" ")+'" stroke="'+o.cor+'"/>';
    tp.forEach((p,j)=>{s+='<circle class="gp pj" cx="'+p[0]+'" cy="'+p[1]+'" r="4.5" stroke="'+o.cor+'" data-tip="'+_esc(fbMesCurto(o.tend.meses[j])+": tendência de "+fbNum(o.tend.vals[j])+" (± "+o.tend.banda+")")+'"/>';});
  }
  real.forEach((p,i)=>{s+='<circle class="gp" cx="'+p[0]+'" cy="'+p[1]+'" r="5" fill="'+o.cor+'" data-tip="'+_esc(o.rots[i]+": "+fbNum(o.vals[i],o.dec||0)+(o.suf||""))+'"/>'+(o.rotular?'<text class="gv" x="'+p[0]+'" y="'+(p[1]-12)+'">'+fbNum(o.vals[i],o.dec||0)+'</text>':"");});
  return s+'</svg>';
}
/* colunas: uma ou duas séries (lado a lado ou empilhadas); a parte projetada vem hachurada */
function fbGCols(o){
  const W=760,H=o.h||260,pl=44,pr=14,pt=24,pb=34,id="h"+(++FB_GID),n=o.rots.length,S=o.series;
  const somas=o.rots.map((_,i)=>o.empilha?S.reduce((t,s)=>t+(s.vals[i]||0)+(s.proj?s.proj[i]||0:0),0):Math.max(...S.map(s=>(s.vals[i]||0)+(s.proj?s.proj[i]||0:0))));
  const topo=fbTeto(Math.max(1,...somas)*1.1),Y=v=>pt+(H-pt-pb)*(1-v/topo),slot=(W-pl-pr)/n,larg=Math.min(46,slot*(o.empilha?.5:.32));
  let s='<svg class="fb-g" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="'+_esc(o.rot||"Gráfico")+'"><defs><pattern id="'+id+'" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="7" height="7" fill="#fff" fill-opacity=".0"/><line x1="0" y1="0" x2="0" y2="7" stroke="currentColor" stroke-width="3" stroke-opacity=".55"/></pattern></defs>';
  for(let g=0;g<=4;g++){const v=topo*g/4,y=Y(v);s+='<line class="gl" x1="'+pl+'" x2="'+(W-pr)+'" y1="'+y+'" y2="'+y+'"/><text class="gy" x="'+(pl-8)+'" y="'+(y+4)+'">'+fbNum(v)+'</text>';}
  const barra=(x,y0,v,cor,tip,proj,topoArred)=>{if(v<=0)return"";const y1=Y(y0+v),h=Y(y0)-y1,r=topoArred?Math.min(7,h,larg/2):0;
    const d="M"+x+" "+Y(y0)+" L"+x+" "+(y1+r)+" Q"+x+" "+y1+" "+(x+r)+" "+y1+" L"+(x+larg-r)+" "+y1+" Q"+(x+larg)+" "+y1+" "+(x+larg)+" "+(y1+r)+" L"+(x+larg)+" "+Y(y0)+"Z";
    return'<path class="gc'+(proj?" pj":"")+'" d="'+d+'" style="color:'+cor+'" fill="'+(proj?"url(#"+id+")":cor)+'"'+(proj?' stroke="'+cor+'"':"")+' data-tip="'+_esc(tip)+'"/>';};
  o.rots.forEach((r,i)=>{
    const cx=pl+slot*i+slot/2;
    if(o.empilha){let base=0;const x=cx-larg/2;S.forEach((se,j)=>{const v=se.vals[i]||0,pv=se.proj?se.proj[i]||0:0,ult=j===S.length-1;s+=barra(x,base,v,se.cor,r+" · "+se.nome+": "+fbNum(v),false,ult&&!pv);base+=v;if(pv){s+=barra(x,base,pv,se.cor,r+" · "+se.nome+": +"+fbNum(pv)+" projetadas",true,ult);base+=pv;}});
      s+='<text class="gv" x="'+cx+'" y="'+(Y(base)-8)+'">'+fbNum(base)+'</text>';}
    else{const gap=6,totL=S.length*larg+(S.length-1)*gap;S.forEach((se,j)=>{const x=cx-totL/2+j*(larg+gap),v=se.vals[i]||0,pv=se.proj?se.proj[i]||0:0;s+=barra(x,0,v,se.cor,r+" · "+se.nome+": "+fbNum(v),false,!pv);if(pv)s+=barra(x,v,pv,se.cor,r+" · "+se.nome+": projeção de "+fbNum(v+pv),true,true);s+='<text class="gv sm" x="'+(x+larg/2)+'" y="'+(Y(v+pv)-7)+'">'+fbNum(v+pv)+'</text>';});}
    s+='<text class="gx'+(o.pj&&o.pj[i]?" pj":"")+'" x="'+cx+'" y="'+(H-10)+'">'+_esc(r)+'</text>';
  });
  return s+'</svg>';
}
function fbGRosca(partes,centro,sub){
  const R=62,C=2*Math.PI*R,tot=partes.reduce((t,p)=>t+p.v,0)||1;let off=0;
  let s='<svg class="fb-rosca" viewBox="0 0 170 170" role="img" aria-label="'+_esc(sub||"")+'"><circle cx="85" cy="85" r="'+R+'" class="trilho"/>';
  partes.forEach(p=>{const l=p.v/tot*C;if(p.v)s+='<circle cx="85" cy="85" r="'+R+'" stroke="'+p.cor+'" stroke-dasharray="'+Math.max(0,l-3)+' '+(C-Math.max(0,l-3))+'" stroke-dashoffset="'+(-off)+'" data-tip="'+_esc(p.nome+": "+p.v+" ("+Math.round(p.v/tot*100)+"%)")+'"/>';off+=l;});
  return s+'<text x="85" y="84" class="c1">'+centro+'</text><text x="85" y="106" class="c2">'+_esc(sub||"")+'</text></svg>';
}
function fbGSpark(vals,cor){
  const W=220,H=56,id="s"+(++FB_GID),mx=Math.max(1,...vals),n=vals.length,X=i=>n>1?i*W/(n-1):W/2,Y=v=>6+(H-12)*(1-v/mx),p=vals.map((v,i)=>[X(i),Y(v)]);
  return'<svg class="fb-spark" viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="'+id+'" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="'+cor+'" stop-opacity=".45"/><stop offset="1" stop-color="'+cor+'" stop-opacity="0"/></linearGradient></defs>'
    +(n>1?'<path d="'+fbCurva(p)+' L'+W+' '+H+' L0 '+H+'Z" fill="url(#'+id+')"/><path d="'+fbCurva(p)+'" fill="none" stroke="'+cor+'" stroke-width="2.5" stroke-linecap="round"/>':"")+'</svg>';
}
/* etiqueta ao passar o mouse sobre qualquer marca com data-tip */
/* etiqueta própria do módulo no lugar da barra preta do navegador: vale para data-tip e para qualquer title dentro do módulo */
function fbTipInit(){
  if(window._fbTip)return;window._fbTip=1;
  const t=document.createElement("div");t.className="fb-tip";t.setAttribute("role","tooltip");document.body.appendChild(t);
  const esc=x=>String(x).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  document.addEventListener("mousemove",e=>{
    const a=e.target&&e.target.closest?e.target.closest("[data-tip],[title]"):null;
    if(!a||!a.closest("#lig-root,.fb-ov")){t.classList.remove("on");return;}
    if(a.hasAttribute("title")){const v=a.getAttribute("title");a.removeAttribute("title");if(v&&!a.hasAttribute("data-tip"))a.setAttribute("data-tip",v);}
    const txt=a.getAttribute("data-tip");if(!txt){t.classList.remove("on");return;}
    if(t._txt!==txt){t._txt=txt;const p=txt.split(" · ");t.innerHTML="<b>"+esc(p[0])+"</b>"+(p.length>1?"<span>"+esc(p.slice(1).join(" · "))+"</span>":"");}
    t.classList.add("on");
    const w=t.offsetWidth,h=t.offsetHeight;let y=e.clientY-h-16;if(y<8)y=e.clientY+20;
    t.style.left=Math.min(window.innerWidth-w-8,Math.max(8,e.clientX-w/2))+"px";t.style.top=y+"px";},{passive:true});
  document.addEventListener("mouseleave",()=>t.classList.remove("on"));
}

/* ── peças do painel ── */
function fbKgB(cls,ic,rot,num,sub,fn,on){return'<button type="button" class="fb-kg cli '+cls+(on?" on":"")+'" aria-pressed="'+(!!on)+'" onclick="'+fn+'"><span class="ic">'+fbI(ic)+'</span><small>'+rot+'</small><b>'+num+'</b><span class="s">'+sub+'</span></button>';}
function fbCatEf(c){return c.depois===0||c.depois<c.antes?"melh":c.depois===c.antes?"igual":"pior";}
function fbEfLista(E){
  const k=LIG_DES.ef||"todos",lst=E.av.filter(c=>k==="todos"||fbCatEf(c)===k).sort((a,b)=>(b.antes-b.depois)-(a.antes-a.depois)||a.nome.localeCompare(b.nome));
  const nome={todos:"Todas as pessoas avaliadas",melh:"Quem melhorou",igual:"Quem ficou igual a antes",pior:"Quem piorou"}[k];
  const sa=lst.reduce((t,c)=>t+c.antes,0),sd=lst.reduce((t,c)=>t+c.norm,0),red=sa>0?Math.round((sd-sa)/sa*100):null;
  LIG_DES_ROWS=lst.map(c=>({re:c.re,nome:c.nome}));
  const sit=c=>{const x=fbCatEf(c);return x==="melh"?fbTag("Melhorou","tn-ok"):x==="pior"?fbTag("Piorou","tn-da"):fbTag("Igual a antes","tn-am");};
  return fbPainel(nome,'<span class="fb-pill-s">'+fbPlural(lst.length,"pessoa","pessoas")+(E.av.length?" · "+Math.round(lst.length/E.av.length*100)+"% dos avaliados":"")+(red!==null?" · média "+(red<0?"de redução":"de aumento")+" de "+Math.abs(red)+"%":"")+'</span>',lst.length
    ?'<div class="fb-tab ind"><table><thead><tr><th>Colaborador</th><th>Contato</th><th>Faltas antes</th><th>Faltas depois</th><th>Resultado</th></tr></thead><tbody>'+lst.map((c,i)=>'<tr tabindex="0" onclick="ligDesAbrir('+i+')"><td><b>'+_esc(c.nome)+'</b><small>'+_esc(fbTitulo(c.sup||""))+'</small></td><td>'+fbDd(c.d)+'</td><td>'+c.antes+fbChipsDatas(c.fa,"f")+'</td><td>'+c.depois+fbChipsDatas(c.fd,"f")+'</td><td>'+sit(c)+'</td></tr>').join("")+'</tbody></table></div>'
    :'<p class="fb-gnota">Ninguém nesta situação.</p>');
}
function fbKg(cls,ic,rot,num,sub,var_){return'<div class="fb-kg '+cls+'"><span class="ic">'+fbI(ic)+'</span><small>'+rot+'</small><b>'+num+'</b>'+(var_?'<span class="v">'+var_+'</span>':"")+'<span class="s">'+sub+'</span></div>';}
function fbPainel(t,dir,corpo,cls){return'<section class="fb-pn'+(cls?" "+cls:"")+'"><header><h4>'+t+'</h4>'+(dir||"")+'</header>'+corpo+'</section>';}
function fbLeg(itens){return'<ul class="fb-gleg">'+itens.map(i=>'<li><i style="background:'+i[1]+'"'+(i[2]?' class="pj"':"")+'></i>'+i[0]+'</li>').join("")+'</ul>';}
/* seta pelo significado: para cima quando melhora (menos faltas), para baixo quando piora */
function fbSeta(p,inv){if(p===null)return"";const bom=inv?p>0:p<0;return'<span class="fb-var '+(p===0?"z":bom?"bom":"mau")+'">'+fbI(p===0?"flat":bom?"up":"down")+fbPctTxt(p)+'</span>';}
function fbIcVar(p){return p===null||p===0?"eq":p>0?"down":"up";} /* p = variação das faltas */

function fbPnlDes(){
  if(!LIG_IND)return fbVazio();
  fbTipInit();
  const D=fbDesDados();
  if(!D.faixa.length)return fbVazio();
  const sel=(id,val,fn)=>'<span class="fb-selp"><select id="'+id+'" onchange="'+fn+'">'+D.meses.map(k=>'<option value="'+k+'"'+(k===val?" selected":"")+'>'+fbMesRot(k)+'</option>').join("")+'</select>'+fbI("chev")+'</span>';
  if(!FB_DSUBS.some(s=>s[0]===LIG_DSUB))LIG_DSUB="resumo";
  let h='<div class="fb-dash"><div class="fb-dash-bar"><nav class="fb-dsub" role="tablist" aria-label="Desempenho" data-nav="dsub" data-ind="fundo">'+FB_DSUBS.map(s=>'<button type="button" role="tab" class="'+(LIG_DSUB===s[0]?"on":"")+'" aria-selected="'+(LIG_DSUB===s[0])+'" onclick="ligDes(\'sub\',\''+s[0]+'\')">'+fbI(s[2])+s[1]+'</button>').join("")+'</nav>'
    +'<div class="fb-dash-f"><div class="fb-pills" role="group" aria-label="Como contar o mês" data-nav="modo" data-ind="fundo"><button type="button" class="'+(D.modo==="folha"?"on":"")+'" onclick="ligDes(\'modo\',\'folha\')">Folha 26 a 25</button><button type="button" class="'+(D.modo==="civil"?"on":"")+'" onclick="ligDes(\'modo\',\'civil\')">Mês do calendário</button></div>'
    +'<span class="fb-dash-sel" data-sync="dsel"><label class="fb-fl" for="ld-ini">De</label>'+sel("ld-ini",D.kI,"ligDes('ini',this.value)")+'<label class="fb-fl" for="ld-fim">até</label>'+sel("ld-fim",D.kF,"ligDes('fim',this.value)")+'</span></div></div>';
  h+='<div id="lig-lista">'+({resumo:fbDesResumo,efeito:fbDesEfeito,areas:fbDesAreas,postos:fbDesPostos,motivos:fbDesMotivos}[LIG_DSUB])(D)+'</div>';
  return h+'</div>';
}
const FB_COR={azul:"#2563eb",azulc:"#93c5fd",verde:"#10b981",coral:"#f43f5e",ambar:"#f59e0b",violeta:"#8b5cf6",navy:"#1e3a8a"};
function fbRotM(l){return fbMesCurto(l.k)+(l.parcial?"*":"");}
function fbDesResumo(D){
  const F=D.faixa,L0=F[0],L1=F[F.length-1],E=fbEfeito(D),tot=E.av.length;
  const pEmp=fbPct(L0.emp.sj,L1.fech),pMin=L0.min&&L1.min?fbPct(L0.min,L1.min):null;
  let h='<div class="fb-kgs">'
    +fbKg(pEmp===null||pEmp===0?"g-blue":pEmp>0?"g-coral":"g-green",fbIcVar(pEmp),"Faltas da empresa",fbPctTxt(pEmp),fbMesCurto(L0.k)+" "+fbNum(L0.emp.sj)+" → "+fbMesCurto(L1.k)+" "+fbNum(L1.fech)+(L1.parcial?" (projeção)":""),"")
    +fbKg(E.red===null||E.red===0?"g-blue":E.red>0?"g-coral":"g-green",fbIcVar(E.red),"Efeito do feedback",E.red===null?"—":fbPctTxt(E.red),E.red===null?"Sem contatos para avaliar":"faltas 30 dias depois × 30 dias antes do feedback","")
    +fbKg("g-violet","ok","Taxa de melhora",tot?Math.round(E.r.melh/tot*100)+"%":"—",tot?E.r.melh+" de "+fbPlural(tot,"pessoa avaliada","pessoas avaliadas"):"Ninguém para avaliar","")
    +fbKg("g-amber","clock","Tempo médio por feedback",L1.min===null?"—":L1.min+" min",fbMesCurto(L1.k)+(pMin!==null?" · "+fbPctTxt(pMin)+" contra "+fbMesCurto(L0.k):""),"")
    +'</div>';
  const graf=fbGArea({rot:"Faltas sem justificativa por mês",rots:F.map(fbRotM),vals:F.map(l=>l.emp.sj),parcial:L1.parcial,fech:L1.fech,tend:D.fim===D.meses.length-1?D.tend:null,cor:FB_COR.azul,rotular:true,h:290});
  h+='<div class="fb-dg">'+fbPainel("Faltas sem justificativa, mês a mês",fbLeg([["Realizado",FB_COR.azul],["Projeção",FB_COR.azul,1]]),graf+(L1.parcial?'<p class="fb-gnota">* '+fbMesCurto(L1.k)+' em andamento até '+fbDd(D.hj)+'. A linha tracejada mostra o fechamento pelo ritmo atual e a tendência dos próximos meses.</p>':""),"big");
  /* fechamento projetado do mês final */
  const ant=D.todos[D.todos.indexOf(L1)-1],pAnt=ant?fbPct(ant.emp.sj,L1.fech):null,semanas=[];
  for(let d=L1.de,s=0;d<=L1.fimM;d=ligSomaDias(d,1)){const w=Math.floor(fbDiasEntre(L1.de,d)/7);semanas[w]=semanas[w]||{v:0,fut:true,ini:d};if(d<=D.hj){semanas[w].fut=false;}}
  ((LIG_IND&&LIG_IND.dias)||[]).forEach(x=>{if(x[0]>=L1.de&&x[0]<=L1.ate&&fbSupOk(x[1])){semanas[Math.floor(fbDiasEntre(L1.de,x[0])/7)].v+=x[2];}});
  const mxs=Math.max(1,...semanas.map(s=>s.v));
  h+=fbPainel(L1.parcial?"Fechamento projetado":"Fechamento do mês","",'<div class="fb-fech"><b>'+fbNum(L1.fech)+'<em>faltas</em></b><span class="l">'+fbMesRot(L1.k)+(L1.parcial?" · "+fbNum(L1.emp.sj)+" até hoje, "+String(Math.round(L1.emp.sj/L1.passados*10)/10).replace(".",",")+" por dia":"")+'</span>'
    +(pAnt!==null?'<span class="cmp">'+fbSeta(pAnt)+' contra '+fbMesRot(ant.k)+' ('+fbNum(ant.emp.sj)+')</span>':"")
    +'<div class="fb-sem">'+semanas.map((s,i)=>'<div class="'+(s.fut?"fut":"")+'" data-tip="'+_esc("Semana "+(i+1)+" (a partir de "+fbDd(s.ini)+"): "+s.v+" faltas")+'"><i style="--h:'+Math.round(s.v/mxs*100)+'%"></i><span>S'+(i+1)+'</span></div>').join("")+'</div></div>',"side")+'</div>';
  /* três mini-cards com a tendência */
  const sp=(cls,ic,rot,val,sub,vals,cor)=>'<div class="fb-mini2 '+cls+'"><div class="t"><span class="ic">'+fbI(ic)+'</span><small>'+rot+'</small></div><b>'+val+'</b><span class="s">'+sub+'</span>'+fbGSpark(vals,cor)+'</div>';
  h+='<div class="fb-minis">'
    +sp("c-violet","chat","Mensagens enviadas",fbNum(L1.env),fbMesRot(L1.k),F.map(l=>l.env),FB_COR.violeta)
    +sp("c-green","phone","Feedbacks registrados",fbNum(L1.conv),fbMesRot(L1.k),F.map(l=>l.conv),FB_COR.verde)
    +sp("c-coral","ok","Retorno das mensagens",L1.ret===null?"—":L1.ret+"%","das mensagens viraram feedback",F.map(l=>l.ret||0),FB_COR.coral)
    +'</div>';
  return h;
}
function fbDesEfeito(D){
  const E=fbEfeito(D),tot=E.av.length,F=D.faixa;
  const porMes=F.map(l=>{const cs=E.cont.filter(c=>c.mes===l.k);return{k:l.k,parcial:l.parcial,antes:cs.reduce((t,c)=>t+c.antes,0),depois:cs.reduce((t,c)=>t+c.depois,0),proj:Math.round(cs.reduce((t,c)=>t+(c.dias<30&&c.dias>0?c.norm-c.depois:0),0))};});
  let h='<div class="fb-kgs">'
    +fbKgB("g-blue","user","Pessoas avaliadas",fbNum(tot),"com 7 dias ou mais desde o contato","ligDes('ef','todos')",LIG_DES.ef==="todos")
    +fbKgB("g-green","up","Melhoraram",tot?Math.round(E.r.melh/tot*100)+"%":"—",fbPlural(E.r.melh,"pessoa","pessoas"),"ligDes('ef','melh')",LIG_DES.ef==="melh")
    +fbKgB("g-amber","eq","Igual a antes",tot?Math.round(E.r.igual/tot*100)+"%":"—",fbPlural(E.r.igual,"pessoa","pessoas"),"ligDes('ef','igual')",LIG_DES.ef==="igual")
    +fbKgB("g-coral","down","Pioraram",tot?Math.round(E.r.pior/tot*100)+"%":"—",fbPlural(E.r.pior,"pessoa","pessoas"),"ligDes('ef','pior')",LIG_DES.ef==="pior")+'</div>'+fbEfLista(E);
  h+='<div class="fb-dg r">'+fbPainel("Resultado do feedback","",'<div class="fb-rosca-w">'+fbGRosca([{nome:"Melhoraram",v:E.r.melh,cor:FB_COR.verde},{nome:"Igual a antes",v:E.r.igual,cor:FB_COR.ambar},{nome:"Pioraram",v:E.r.pior,cor:FB_COR.coral}],tot?Math.round(E.r.melh/tot*100)+"%":"—","melhoraram")
      +fbLeg([["Melhoraram",FB_COR.verde],["Igual a antes",FB_COR.ambar],["Pioraram",FB_COR.coral]])+(E.red!==null&&E.red!==0?'<p class="fb-rosca-r'+(E.red>0?' mau':'')+'">'+(E.red<0?'Redução':'Aumento')+' médio de <b>'+Math.abs(E.red)+'%</b> nas faltas depois do feedback</p>':"")+'</div>',"side")
    +fbPainel("Faltas antes × depois do feedback, por mês do contato",fbLeg([["30 dias antes",FB_COR.navy],["30 dias depois",FB_COR.verde],["Projeção",FB_COR.verde,1]]),
      fbGCols({rot:"Antes e depois do feedback",rots:porMes.map(m=>fbMesCurto(m.k)+(m.proj?"*":"")),pj:porMes.map(m=>!!m.proj),series:[{nome:"30 dias antes",cor:FB_COR.navy,vals:porMes.map(m=>m.antes)},{nome:"30 dias depois",cor:FB_COR.verde,vals:porMes.map(m=>m.depois),proj:porMes.map(m=>m.proj)}]})
      +'<p class="fb-gnota">* contatos com menos de 30 dias: a parte hachurada projeta o restante da janela pelo ritmo atual.</p>',"big")+'</div>';
  /* maiores melhoras e pioras */
  const ult={};E.cont.forEach(c=>{if(!ult[c.i]||ult[c.i].d<c.d)ult[c.i]=c;});
  const av=Object.values(ult).filter(c=>c.dias>=7).map(c=>Object.assign({dif:c.depois-c.antes},c));
  const top=(lst,cls)=>lst.length?'<ol class="fb-top">'+lst.map((c,j)=>'<li tabindex="0" onclick="ligColab(\''+_esc(c.re)+'\',\''+_esc(c.nome).replace(/'/g,"")+'\')"><span class="p">'+(j+1)+'</span><span class="n"><b>'+_esc(c.nome)+'</b><small>'+_esc(c.sup||"")+'</small></span><span class="ab">'+c.antes+' → '+c.depois+'</span><span class="fb-var '+cls+'">'+(c.dif>0?"+":c.dif<0?"−":"")+Math.abs(c.dif)+'</span></li>').join("")+'</ol>':'<p class="fb-gnota">Ninguém nesta lista.</p>';
  h+='<div class="fb-dg h">'+fbPainel("Maiores melhoras",'<span class="fb-pill-s bom">faltas antes → depois</span>',top(av.filter(c=>c.dif<0).sort((a,b)=>a.dif-b.dif).slice(0,5),"bom"))
    +fbPainel("Maiores pioras",'<span class="fb-pill-s mau">faltas antes → depois</span>',top(av.filter(c=>c.dif>0).sort((a,b)=>b.dif-a.dif).slice(0,5),"mau"))+'</div>';
  /* cada colaborador */
  const modo=D.modo,ate=k=>{const f=fbMesFim(k,modo);return f<D.hj?f:D.hj;};
  const rows=D.coorte.map(x=>{const a=fbSoma([x],fbMesIni(D.kI,modo),ate(D.kI)).sj,b=fbSoma([x],fbMesIni(D.kF,modo),ate(D.kF)).sj;return{x,a,b,p:fbPct(a,b),d:b-a};});
  const o=LIG_DES.ord,dir=LIG_DES.dir;
  rows.sort((r,s)=>o==="nome"?dir*r.x.nome.localeCompare(s.x.nome):o==="a"?dir*(r.a-s.a):o==="b"?dir*(r.b-s.b):dir*(r.d-s.d)||r.x.nome.localeCompare(s.x.nome));
  const th=(k,t)=>'<th><button type="button" class="'+(o===k?"on":"")+'" onclick="ligDes(\'ord\',\''+k+'\')">'+t+(o===k?(dir>0?" ↑":" ↓"):"")+'</button></th>';
  LIG_DES_ROWS=rows.map(r=>r.x);
  const res=r=>r.b<r.a?fbTag("Melhorou","tn-ok"):r.b>r.a?fbTag("Piorou","tn-da"):fbTag("Igual a antes","tn-am");
  h+=fbPainel("Cada colaborador",'<span class="fb-pill-s">'+fbPlural(rows.length,"pessoa","pessoas")+' com feedback</span>',rows.length
    ?'<div class="fb-tab ind"><table><thead><tr>'+th("nome","Colaborador")+'<th>Supervisor</th>'+th("a",fbMesRot(D.kI))+th("b",fbMesRot(D.kF)+(D.faixa[D.faixa.length-1].parcial?" *":""))+th("var","Variação")+'<th>Resultado</th></tr></thead><tbody>'
      +rows.slice(0,400).map((r,i)=>'<tr tabindex="0" onclick="ligDesAbrir('+i+')" onkeydown="if(event.key===\'Enter\')ligDesAbrir('+i+')"><td><b>'+_esc(r.x.nome)+'</b><small>'+(r.x.re?"RE "+_esc(r.x.re):"")+'</small></td><td>'+_esc(r.x.supervisor||"—")+'</td><td>'+r.a+'</td><td>'+r.b+'</td><td class="'+fbTomVar(r.d===0?0:r.d)+'"><b>'+(r.p===null?(r.b>0?"+"+r.b+" falta"+(r.b>1?"s":""):"—"):fbPctTxt(r.p))+'</b></td><td>'+res(r)+'</td></tr>').join("")+'</tbody></table></div>'
    :'<p class="fb-gnota">Ninguém recebeu feedback com este filtro.</p>');
  return h;
}
function fbDesAreas(D){
  const F=D.faixa,L1=F[F.length-1],L0=F[0],ultimo=D.fim===D.meses.length-1&&D.tend;
  const rots=F.map(fbRotM).concat(ultimo?D.tend.meses.map(m=>fbMesCurto(m)+" proj."):[]);
  const sj=F.map(l=>l.emp.sj).concat(ultimo?D.tend.vals.map(()=>0):[]),ab=F.map(l=>l.emp.ab).concat(ultimo?D.tend.vals.map(()=>0):[]);
  const pj=F.map(l=>l.parcial?Math.max(0,l.fech-l.emp.sj):0).concat(ultimo?D.tend.vals:[]);
  const media=Math.round(F.filter(l=>!l.parcial).reduce((t,l)=>t+l.emp.sj,0)/(F.filter(l=>!l.parcial).length||1));
  let h='<div class="fb-kgs">'
    +fbKg("g-blue","cal",L1.parcial?"Fechamento projetado":"Faltas no mês",fbNum(L1.fech),fbMesRot(L1.k)+" · sem justificativa","")
    +fbKg("g-violet","chart","Média mensal",fbNum(media),"meses fechados do intervalo","")
    +fbKg(fbPct(L0.emp.sj,L1.fech)>0?"g-coral":"g-green",fbIcVar(fbPct(L0.emp.sj,L1.fech)),"Variação no intervalo",fbPctTxt(fbPct(L0.emp.sj,L1.fech)),fbMesCurto(L0.k)+" → "+fbMesCurto(L1.k),"")
    +fbKg("g-amber","doc","Abonadas no mês",fbNum(L1.emp.ab),"atestados, justificadas e licenças","")+'</div>';
  h+=fbPainel("Faltas da empresa por mês e projeção",fbLeg([["Sem justificativa",FB_COR.azul],["Abonadas",FB_COR.azulc],["Projeção",FB_COR.azul,1]]),
    fbGCols({rot:"Faltas por mês",rots,empilha:true,pj:rots.map((_,i)=>i>=F.length||(F[i]&&F[i].parcial)),series:[{nome:"Sem justificativa",cor:FB_COR.azul,vals:sj,proj:pj},{nome:"Abonadas",cor:FB_COR.azulc,vals:ab}],h:210})
    +'<p class="fb-gnota">Hachurado: o fechamento do mês em andamento pelo ritmo atual'+(ultimo?' e a tendência dos próximos 3 meses (± '+D.tend.banda+')':"")+'.</p>',"big");
  /* ranking por área: mês final (projetado se em andamento) contra o mês inicial */
  const por=(l)=>{const m={};((LIG_IND&&LIG_IND.dias)||[]).forEach(x=>{if(x[0]>=l.de&&x[0]<=l.ate&&fbSupOk(x[1])){const s=x[1]||"Sem supervisor";m[s]=(m[s]||0)+x[2];}});return m;};
  const a0=por(L0),a1=por(L1),areas=[...new Set(Object.keys(a0).concat(Object.keys(a1)))].map(s=>{const v1=a1[s]||0,f1=L1.parcial?Math.round(v1/L1.passados*L1.total):v1,v0=a0[s]||0;return{s,v1,f1,v0,p:fbPct(v0,f1)};}).sort((a,b)=>b.f1-a.f1);
  const mx=Math.max(1,...areas.map(a=>a.f1));
  const comp=areas.filter(a=>a.v0>0&&a.p!==null),melhor=comp.slice().sort((a,b)=>a.p-b.p)[0],pior=comp.slice().sort((a,b)=>b.p-a.p)[0];
  const supsL=areas.slice().sort((x,y)=>x.s.localeCompare(y.s));
  h+=fbPainel("Cada supervisor: melhorou ou piorou",'<span class="fb-pill-s">'+fbMesRot(L1.k)+(L1.parcial?" (projeção)":"")+' contra '+fbMesRot(L0.k)+'</span>',supsL.length
    ?'<div class="fb-tab ind"><table><thead><tr><th>Supervisor</th><th>Turno</th><th>'+fbMesRot(L0.k)+'</th><th>'+fbMesRot(L1.k)+(L1.parcial?" *":"")+'</th><th>Variação</th><th>Resultado</th></tr></thead><tbody>'
      +supsL.map(a=>{const d=a.f1-a.v0;return'<tr><td><b>'+_esc(fbTitulo(a.s))+'</b></td><td>'+(fbTurnoDe(a.s)==="NOTURNO"?"Noturno":"Diurno")+'</td><td>'+a.v0+'</td><td>'+a.f1+'</td><td class="'+fbTomVar(d===0?0:d)+'"><b>'+(a.p===null?(d>0?"+"+d:"—"):fbPctTxt(a.p))+'</b> <small>('+(d>0?"+":d<0?"−":"")+Math.abs(d)+')</small></td><td>'+(d<0?fbTag("Melhorou","tn-ok"):d>0?fbTag("Piorou","tn-da"):fbTag("Igual","tn-am"))+'</td></tr>';}).join("")+'</tbody></table></div>'
      +'<div class="fb-dest">'+(melhor?fbKg("g-green","up","Área que mais melhorou",_esc(fbTitulo(melhor.s)),melhor.v0+" → "+melhor.f1+" faltas",fbPctTxt(melhor.p)):"")+(pior&&pior!==melhor?fbKg("g-coral","down","Área que mais piorou",_esc(fbTitulo(pior.s)),pior.v0+" → "+pior.f1+" faltas",fbPctTxt(pior.p)):"")+'</div>'
    :'<p class="fb-gnota">Sem faltas no intervalo.</p>',"big");
  return h;
}
function fbDesMotivos(D){
  const F=D.faixa,L1=F[F.length-1],ant=D.todos[D.todos.indexOf(L1)-1],cv=[].concat(...F.map(l=>l.cvs)),tot=cv.length;
  const conta=lst=>{const m={};lst.forEach(c=>{m[c[1]]=(m[c[1]]||0)+1;});return m;};
  const M=conta(cv),ms=Object.keys(M).sort((a,b)=>M[b]-M[a]);
  const m1=conta(L1.cvs),m0=ant?conta(ant.cvs):{},t1=L1.cvs.length||1,t0=(ant&&ant.cvs.length)||1;
  const cres=Object.keys(m1).map(k=>({k,d:Math.round((m1[k]/t1-(m0[k]||0)/t0)*100)})).sort((a,b)=>b.d-a.d)[0];
  const cores=[FB_COR.azul,FB_COR.violeta,FB_COR.verde,FB_COR.ambar,FB_COR.coral,"#06b6d4","#64748b","#ec4899"];
  const durs=cv.filter(c=>c[2]),med=durs.length?Math.round(durs.reduce((t,c)=>t+c[2],0)/durs.length):null;
  let h='<div class="fb-kgs">'
    +fbKg("g-blue","phone","Faltas tratadas",fbNum(tot),"feedbacks de "+fbMesCurto(F[0].k)+" a "+fbMesCurto(L1.k),"")
    +fbKg("g-violet","doc","Motivo principal",ms.length?_esc(ms[0]):"—",ms.length?Math.round(M[ms[0]]/tot*100)+"% das faltas tratadas":"Sem feedbacks","")
    +fbKg(cres&&cres.d>0?"g-coral":"g-green","up","Motivo que mais cresceu",cres&&cres.d>0?_esc(cres.k):"Nenhum",cres&&cres.d>0?"+"+cres.d+" pontos em "+fbMesCurto(L1.k)+(ant?" contra "+fbMesCurto(ant.k):""):"nenhum motivo ganhou espaço","")
    +fbKg("g-amber","clock","Tempo médio por feedback",med===null?"—":med+" min",fbPlural(durs.length,"conversa com tempo","conversas com tempo"),"")+'</div>';
  h+=fbMotivosCards(D,M,tot,cores)+'<div class="fb-dg h">'+fbPainel("Motivos das faltas tratadas",'<span class="fb-pill-s">'+fbPlural(tot,"feedback","feedbacks")+'</span>',ms.length?'<div class="fb-rosca-w lado">'+fbGRosca(ms.map((m,i)=>({nome:m,v:M[m],cor:cores[i%cores.length]})),ms.length?Math.round(M[ms[0]]/tot*100)+"%":"",ms[0]?ms[0].slice(0,16):"")
      +'<ul class="fb-mot2">'+ms.map((m,i)=>'<li><i style="background:'+cores[i%cores.length]+'"></i><span class="t">'+_esc(m)+'</span><b>'+String(Math.round(M[m]/tot*1000)/10).replace(".",",")+'%</b><span class="c">'+M[m]+'</span></li>').join("")+'</ul></div>':'<p class="fb-gnota">Nenhum feedback no intervalo.</p>')
    +fbPainel("Tempo médio por feedback, mês a mês","",fbGArea({rot:"Tempo médio por mês",rots:F.map(fbRotM),vals:F.map(l=>l.min||0),cor:FB_COR.ambar,suf:" min",rotular:true,w:520,h:300}))+'</div>';
  const por=i=>{const m={};cv.forEach(c=>{const k=c[i]||(i===1?"Sem motivo":"Não informado");m[k]=m[k]||{n:0,s:0,c:0};m[k].c++;if(c[2]){m[k].n++;m[k].s+=c[2];}});return Object.keys(m).map(k=>({k,v:m[k].n?Math.round(m[k].s/m[k].n):0,c:m[k].c})).sort((a,b)=>b.v-a.v);};
  const barras=(lst,cor)=>{const mx=Math.max(1,...lst.map(x=>x.v));return lst.length?'<ul class="fb-rank sm">'+lst.map(x=>'<li><span class="n"><b>'+_esc(x.k)+'</b><small>'+fbPlural(x.c,"feedback","feedbacks")+'</small></span><span class="tr"><i style="--w:'+Math.round(x.v/mx*100)+'%;background:'+cor+'"></i></span><b class="q">'+(x.v?x.v+" min":"—")+'</b></li>').join("")+'</ul>':'<p class="fb-gnota">Sem dados.</p>';};
  h+='<div class="fb-dg h">'+fbPainel("Tempo médio por motivo","",barras(por(1),"linear-gradient(90deg,#fbbf24,#ea580c)"))+fbPainel("Tempo médio por pessoa do SAC","",barras(por(4),"linear-gradient(90deg,#60a5fa,#1e3a8a)"))+'</div>';
  return h;
}
function fbMotivosCards(D,M,tot,cores){
  const F=D.faixa,de=fbMesIni(D.kI,D.modo),ate=F[F.length-1].ate;
  const nomes=(LIG_MOT||[]).filter(m=>m.ativo!==false||M[m.nome]).map(m=>m.nome);Object.keys(M).forEach(n=>{if(nomes.indexOf(n)<0&&n!=="Sem motivo")nomes.push(n);});
  if(M["Sem motivo"])nomes.push("Sem motivo");
  const cards=nomes.map((n,i)=>{const q=M[n]||0,on=LIG_DES.mot===n;return'<button type="button" class="fb-mc2'+(on?" on":"")+'" aria-pressed="'+on+'" onclick="ligDes(\'mot\',this.dataset.n)" data-n="'+_esc(n)+'"><i style="background:'+cores[i%cores.length]+'"></i><span class="t">'+_esc(n)+'</span><b>'+q+'</b><span class="p">'+(tot?String(Math.round(q/tot*1000)/10).replace(".",","):"0")+'%</span></button>';}).join("");
  let det="";
  if(LIG_DES.mot){
    const k=_ligNorm(LIG_DES.mot),lst=LIG_C.filter(c=>{const d=ligDataContato(c);if(d<de||d>ate||!ligEfetivo(c)||!fbSupOk(c.supervisor))return false;const m=c.motivo?_ligNorm(fbMotNome(c.motivo)):"sem motivo";return m===k;}).sort((a,b)=>ligDataContato(b).localeCompare(ligDataContato(a)));
    LIG_DES_ROWS=lst.map(c=>({re:c.baixa&&c.baixa.re?c.baixa.re:"",nome:c.colaborador}));
    det=fbPainel("Ligações com o motivo: "+_esc(LIG_DES.mot),'<span class="fb-pill-s">'+fbPlural(lst.length,"ligação","ligações")+'</span>',lst.length
      ?'<div class="fb-cards">'+lst.slice(0,60).map((c,i)=>'<article class="fb-pc tn-ok" tabindex="0" role="button" onclick="ligDesAbrir('+i+')"><div class="fb-pc-h"><div class="fb-av2">'+_esc(fbIni(c.colaborador))+'</div><div class="fb-pc-t"><div class="fb-nm">'+_esc(c.colaborador)+'</div><div class="fb-sb">'+_esc(fbTitulo(c.posto||""))+'</div></div></div><div class="fb-pc-b">'+fbRegistro(c)+'</div></article>').join("")+'</div>':'<p class="fb-gnota">Nenhuma ligação com este motivo no intervalo.</p>');
  }
  return fbPainel("Todos os motivos",'<span class="fb-pill-s">clique para ver as ligações</span>','<div class="fb-mcs">'+cards+'</div>')+det;
}
function fbDesPostos(D){
  const pes=(LIG_IND&&LIG_IND.pessoas)||[],nomes=(LIG_IND&&LIG_IND.postos)||[],res=LIG_DES.pt==="reserva",F=D.faixa,m={};
  ((LIG_IND&&LIG_IND.funil&&LIG_IND.funil.faltas)||[]).forEach(x=>{
    if(x[2]==="A"||(x[4]==="R")!==res)return;const p=pes[x[1]];if(!p||!fbSupOk(p[3]))return;
    const li=F.findIndex(l=>x[0]>=l.de&&x[0]<=l.ate);if(li<0)return;
    const n=nomes[x[3]]||p[2]||"Sem posto";(m[n]=m[n]||{n,v:F.map(()=>0),t:0});m[n].v[li]++;m[n].t++;
  });
  const lst=Object.values(m).sort((a,b)=>b.t-a.t||a.n.localeCompare(b.n)),tot=F.map((_,i)=>lst.reduce((t,x)=>t+x.v[i],0));
  const cel=(v,ant)=>{const d=ant===undefined?0:v-ant;return'<td class="'+(d===0?"":d<0?"tn-ok":"tn-da")+'"><b>'+v+'</b>'+(d===0?"":'<small>'+fbI(d<0?"up":"down")+(d>0?"+":"−")+Math.abs(d)+'</small>')+'</td>';};
  const sel='<div class="fb-pills" role="group" aria-label="Efetivo ou reserva" data-nav="pt" data-ind="fundo"><button type="button" class="'+(!res?"on":"")+'" onclick="ligDes(\'pt\',\'efetivo\')">Postos efetivos</button><button type="button" class="'+(res?"on":"")+'" onclick="ligDes(\'pt\',\'reserva\')">Reserva técnica</button></div>';
  const L1=F[F.length-1],pior=lst.map(x=>({n:x.n,d:x.v[F.length-1]-(x.v[F.length-2]||0)})).sort((a,b)=>b.d-a.d)[0];
  let h='<div class="fb-kgs">'+fbKg("g-blue","pin",res?"Reserva técnica":"Postos com falta",fbNum(lst.length),"no intervalo escolhido","")
    +fbKg("g-violet","chart","Faltas no último mês",fbNum(tot[tot.length-1]||0),fbMesRot(L1.k)+(L1.parcial?" até hoje":""),"")
    +fbKg(pior&&pior.d>0?"g-coral":"g-green",pior&&pior.d>0?"down":"up","Maior aumento",pior&&pior.d>0?_esc(fbTitulo(pior.n)):"Nenhum",pior&&pior.d>0?"+"+pior.d+" contra o mês anterior":"nenhum posto piorou","")+'</div>';
  h+=fbPainel(res?"Reserva técnica por supervisor, mês a mês":"Faltas por posto, mês a mês",sel,lst.length
    ?'<div class="fb-tab ind"><table><thead><tr><th>'+(res?"Reserva":"Posto")+'</th>'+F.map(l=>'<th>'+fbRotM(l)+'</th>').join("")+'<th>Total</th></tr></thead><tbody>'
      +lst.slice(0,300).map(x=>'<tr><td><b>'+_esc(fbTitulo(x.n))+'</b></td>'+x.v.map((v,i)=>cel(v,i?x.v[i-1]:undefined)).join("")+'<td><b>'+x.t+'</b></td></tr>').join("")
      +'<tr class="tot"><td><b>Total</b></td>'+tot.map(v=>'<td><b>'+v+'</b></td>').join("")+'<td><b>'+tot.reduce((a,b)=>a+b,0)+'</b></td></tr></tbody></table></div><p class="fb-gnota">Cada posto é comparado com ele mesmo no mês anterior: seta para cima verde quando faltou menos, para baixo vermelha quando faltou mais. Só faltas sem justificativa.</p>'
    :'<p class="fb-gnota">Nenhuma falta '+(res?"da reserva técnica":"em postos efetivos")+' no intervalo.</p>',"big");
  return h;
}
let LIG_DES_ROWS=[];
function ligDesAbrir(i){const x=LIG_DES_ROWS[i];if(x)ligColab(x.re,x.nome);}

/* ═════ envio em lote: marca as pessoas e manda uma por vez, no ritmo do serviço ═════ */
function fbBarraLote(){
  const n=LIG_SEL.size;
  if(!n)return"";
  return'<div class="fb-bulk" role="status"><span><b>'+n+'</b> '+(n===1?"pessoa selecionada":"pessoas selecionadas")+(n>=LIG_LOTE_MAX?' · limite de '+LIG_LOTE_MAX+' por vez':"")+'</span>'
    +'<span class="fb-bulk-a"><button type="button" class="fb-btn ghost sm" onclick="ligSelLimpa()">Limpar seleção</button><button type="button" class="fb-btn pri sm" onclick="ligLote()">'+fbI("send")+'Enviar mensagem para '+n+'</button></span></div>';
}
function ligSelAtualiza(){const e=document.getElementById("lig-lote");if(e)e.innerHTML=fbBarraLote();}
/* LIG_SEL: as chaves marcadas; LIG_SEL_P: os dados de cada uma (nome, RE, celular e faltas) para o envio */
let LIG_SEL_P=new Map(),LIG_LOTE_GENTE=[];
function fbSelMarca(key,info,cx){
  if(cx.checked){
    if(LIG_SEL.size>=LIG_LOTE_MAX){cx.checked=false;fbToast("O envio em massa vai até "+LIG_LOTE_MAX+" pessoas por vez. Envie este grupo e selecione as demais.","err");return;}
    LIG_SEL.add(key);LIG_SEL_P.set(key,info);
  }else LIG_SEL.delete(key);
  const card=cx.closest?cx.closest(".fb-pc"):null;if(card)card.classList.toggle("sel",cx.checked);
  ligSelAtualiza();
}
function ligSel(i,cx){const p=LIG_VIEW[i];if(p)fbSelMarca(p.key,fbLotePessoa(p,p.faltas),cx);}
function ligSelTodos(){
  LIG_SEL=new Set();
  if(LIG_ABA==="visao")LIG_VIEW_VG.filter(fbSelecionavel).slice(0,LIG_LOTE_MAX).forEach(g=>{LIG_SEL.add(g.key);LIG_SEL_P.set(g.key,fbLotePessoa(g,g.faltas));});
  else LIG_VIEW.slice(0,LIG_LOTE_MAX).forEach(p=>{LIG_SEL.add(p.key);LIG_SEL_P.set(p.key,fbLotePessoa(p,p.faltas));});
  ligPanel();
}
function ligSelLimpa(){LIG_SEL=new Set();ligPanel();}
function fbTextoPara(modelo,nome,datas){
  const p=String(nome||"").trim().split(/\s+/)[0]||"";
  const pn=p?p.charAt(0).toUpperCase()+p.slice(1).toLowerCase():"";
  const d=(datas&&datas.length)?" em "+datas.map(x=>rhFmt(x).slice(0,5)).join(", "):"";
  return String(modelo).replace(/\{nome\}/g,pn).replace(/\{data\}/g,d);
}
function ligLote(){
  const gente=LIG_LOTE_GENTE=[...LIG_SEL].map(k=>LIG_SEL_P.get(k)).filter(Boolean).slice(0,LIG_LOTE_MAX);
  if(!gente.length)return;
  const z=LIG_ZAP||{},ok=z.configurado!==false&&z.ok&&z.state==="open";
  const comFone=gente.filter(p=>fbCelularOk(fbFone(p.telefone)||ligTelefoneDe(p.nome)));
  const aviso=ok?"":'<div class="fb-note tn-am" style="margin-bottom:16px">'+fbI("alert")+'<div><b>O WhatsApp do SAC não está conectado.</b> '+(z.pode_conectar?"Conecte pelo QR code na Visão geral.":"Peça à coordenação para conectar.")+'</div></div>';
  fbDialog("lig-lote-modal",{titulo:"Enviar mensagem para "+gente.length+(gente.length===1?" pessoa":" pessoas"),tam:"md",
    corpo:aviso
      +'<div class="fb-f"><label class="fb-l" for="ll-msg">Mensagem <span class="fb-hint">{nome} e {data} são preenchidos para cada pessoa</span></label><textarea class="fb-ta" id="ll-msg" rows="6" maxlength="1000"></textarea></div>'
      +'<ul class="fb-lote" id="ll-lista">'+gente.map((p,k)=>{const f=fbFone(p.telefone)||ligTelefoneDe(p.nome),v=fbCelularOk(f);return'<li id="ll-'+k+'" class="'+(v?"":"sem")+'"><span class="n">'+_esc(p.nome)+'</span><span class="t">'+(v?_esc(f):"sem celular válido")+'</span><span class="s" id="lls-'+k+'">'+(v?"Aguardando":"Não será enviada")+'</span></li>';}).join("")+'</ul>'
      +'<p class="fb-hint" id="ll-res" role="status">'+(comFone.length<gente.length?(gente.length-comFone.length)+" sem celular válido: cadastre o telefone e envie depois.":"")+'</p>',
    rodape:'<button type="button" class="fb-btn" id="ll-fechar" onclick="ligLoteFechar()">Cancelar</button><button type="button" class="fb-btn pri" id="ll-enviar" onclick="ligLoteEnviar()" '+(ok&&comFone.length?"":"disabled")+'>'+fbI("send")+'Enviar para '+comFone.length+'</button>'});
  document.getElementById("ll-msg").value=(LIG_MODELO&&LIG_MODELO.texto)||LIG_MODELO_PADRAO;
}
function ligLoteFechar(){LIG_LOTE_PARAR=true;fbFechar("lig-lote-modal");if(document.getElementById("ll-feito"))ligLoad();}
async function ligLoteEnviar(){
  const gente=LIG_LOTE_GENTE;
  const modelo=String(document.getElementById("ll-msg").value||"").trim();
  const res=document.getElementById("ll-res"),btn=document.getElementById("ll-enviar"),fechar=document.getElementById("ll-fechar");
  if(modelo.length<10){res.style.color="#d92d20";res.textContent="Escreva a mensagem (mínimo de 10 caracteres).";return;}
  btn.disabled=true;document.getElementById("ll-msg").readOnly=true;LIG_LOTE_PARAR=false;
  fechar.textContent="Parar envio";res.style.color="var(--fb-muted)";
  let certo=0,erro=0,parou=false;
  for(let k=0;k<gente.length;k++){
    const p=gente[k],f=fbFone(p.telefone)||ligTelefoneDe(p.nome),cel=document.getElementById("lls-"+k);
    if(!cel)return; // a janela foi fechada
    if(!fbCelularOk(f))continue;
    if(LIG_LOTE_PARAR){parou=true;break;}
    cel.textContent="Enviando…";
    try{
      await ligEnviarWa({colaborador:p.nome,re:p.re||undefined,telefone:f,texto:fbTextoPara(modelo,p.nome,p.faltas||[])});
      certo++;cel.textContent="Enviada";cel.className="s ok";
    }catch(e){
      erro++;cel.textContent=e.message||"Falhou";cel.className="s err";
      if(/desconectad|conectar/i.test(String(e.message))){parou=true;break;} // sem WhatsApp não adianta insistir
    }
    res.textContent="Enviadas "+certo+" de "+gente.length+"…";
  }
  const lista=document.getElementById("ll-lista");if(!lista)return;
  res.style.color=erro?"#d92d20":"var(--fb-muted)";
  res.innerHTML='<b id="ll-feito">'+certo+(certo===1?" mensagem enviada":" mensagens enviadas")+'</b>'+(erro?", "+erro+" com erro":"")+(parou?". Envio interrompido.":".")+" As pessoas que receberam passam para Aguardando ligação.";
  fechar.textContent="Concluir";fechar.className="fb-btn pri";LIG_LOTE_PARAR=false;
  if(certo)LIG_SEL=new Set();
}

/* ═════ resumo para a coordenação: texto pronto para copiar ═════ */
function fbResumo(p){
  const hj=ligHojeISO(),dd=d=>fbDd(d),ln=[];
  const a=p.acomp,c=p.contato,sit=FB_SIT.find(s=>s.k===p.situacao)||FB_SIT[0];
  const contatos=LIG_C.filter(x=>fbDaPessoa(x,p)).sort((x,y)=>ligDataContato(x).localeCompare(ligDataContato(y)));
  ln.push("RESUMO PARA A COORDENAÇÃO");
  ln.push("Colaborador: "+p.nome+(p.re?" (RE "+p.re+")":""));
  if(p.posto)ln.push("Posto: "+p.posto);
  if(p.supervisor)ln.push("Supervisor: "+p.supervisor);
  ln.push("Data do resumo: "+rhFmt(hj));
  ln.push("Situação: "+sit.t+(a?" · "+(FB_VD[a.veredito]||{}).t:""));
  ln.push("");ln.push("FALTAS");
  if(a){
    ln.push("Antes do feedback (30 dias): "+a.antes+(a.antes===1?" falta":" faltas"));
    ln.push("Depois do feedback ("+dd(c.data)+"): "+a.depois+(a.depois===1?" falta":" faltas")+(a.faltas_depois&&a.faltas_depois.length?" em "+a.faltas_depois.map(dd).join(", "):""));
  }else{
    ln.push("Faltas sem justificar e sem conversa: "+p.faltas.length+" ("+p.faltas.map(dd).join(", ")+")");
  }
  const envios=(p.envios||[]).slice().sort();
  ln.push("");ln.push("MENSAGENS DO SAC");
  ln.push(envios.length?envios.length+(envios.length===1?" mensagem enviada em ":" mensagens enviadas em ")+envios.map(dd).join(", "):"Nenhuma mensagem enviada.");
  if(p.situacao==="base")ln.push("Não ligou depois de "+(p.tentativas||2)+" mensagens.");
  ln.push("");ln.push("CONTATOS REGISTRADOS");
  if(!contatos.length)ln.push("Nenhum contato registrado.");
  contatos.forEach(x=>{
    const ef=ligEfetivo(x),canal=x.canal==="PESSOAL"?"pessoalmente":x.canal==="WHATSAPP"?"pelo WhatsApp":"por ligação";
    ln.push("- "+dd(ligDataContato(x))+" · "+(ef?"conversa "+canal:"não conseguiu falar")+" · registrado por "+String(x.criado_por||"—").split(" ")[0]);
    if(x.motivo)ln.push("  Motivo: "+x.motivo);
    if(x.justificativa)ln.push("  "+(ef?"A pessoa disse: ":"Observação: ")+x.justificativa);
    if(x.acordo)ln.push("  Combinado: "+x.acordo+(x.acordo_prazo?" (prazo "+dd(x.acordo_prazo)+")":""));
    if(x.baixa)ln.push("  Retirada da cobrança por "+x.baixa.por+".");
  });
  if(c&&c.acordo_prazo&&c.acordo_auto&&FB_ACOR[c.acordo_auto])ln.push("Situação do combinado: "+FB_ACOR[c.acordo_auto][0].replace("Combinado ","").toLowerCase()+".");
  const ms=((LIG_HIST&&LIG_HIST.medidas)||[]).filter(m=>p.re&&String(m.re)===String(p.re));
  if(ms.length){ln.push("");ln.push("MEDIDAS");ms.forEach(m=>ln.push("- "+rhFmt(String(m.data).slice(0,10))+" · "+(m.tipo||"")+(m.grau&&m.grau!==m.tipo?" "+m.grau:"")+(Number(m.dias)?" · "+m.dias+" dia(s)":"")));}
  return ln.join("\n");
}
/* documento do resumo: pensado para imprimir (A4) e levar para a conversa com o colaborador */
function fbDocResumo(p){
  const hj=ligHojeISO(),a=p.acomp,c=p.contato,sit=FB_SIT.find(x=>x.k===p.situacao)||{t:"Sem pendência",tom:"tn-gr"};
  const contatos=LIG_C.filter(x=>fbDaPessoa(x,p)).sort((x,y)=>ligDataContato(y).localeCompare(ligDataContato(x))||(Number(y.id)||0)-(Number(x.id)||0));
  const hist=(p.hist||[]).slice().sort((x,y)=>y[0].localeCompare(x[0])),env=(p.envios||[]).slice().sort().reverse();
  const SJ=h=>h[1]==="I"||h[1]==="T",sj30=hist.filter(h=>SJ(h)&&h[0]>ligSomaDias(hj,-30)),ab30=hist.filter(h=>!SJ(h)&&h[1]!=="D"&&h[0]>ligSomaDias(hj,-30)),sj90=hist.filter(h=>SJ(h)&&h[0]>ligSomaDias(hj,-90));
  const ult=contatos.find(ligEfetivo)||null,dest=fbDestaque(p),ve=a?(FB_VD[a.veredito]||{}):null;
  const kp=(n,r,t)=>'<div class="k '+(t||"")+'"><b>'+n+'</b><span>'+r+'</span></div>';
  const sec=(t,h)=>'<section class="ds"><h4>'+t+'</h4>'+h+'</section>';
  const dts=l=>l&&l.length?l.slice().sort().map(fbDd).join(", "):"nenhuma";
  const ponto=[],DS=["domingo","segunda-feira","terça-feira","quarta-feira","quinta-feira","sexta-feira","sábado"],dsC={};
  sj90.forEach(h=>{const k=new Date(h[0]+"T12:00:00Z").getUTCDay();dsC[k]=(dsC[k]||0)+1;});
  const topD=Object.keys(dsC).sort((x,y)=>dsC[y]-dsC[x])[0];
  if(sj90.length)ponto.push("Faltou "+fbPlural(sj90.length,"vez","vezes")+" sem justificativa nos últimos 90 dias ("+sj30.length+" nos últimos 30).");
  if(topD!==undefined&&dsC[topD]>=2&&sj90.length>=3)ponto.push("As faltas se repetem às "+DS[topD]+"s ("+dsC[topD]+" de "+sj90.length+").");
  if(a)ponto.push("Desde o feedback de "+fbDd(c.data)+": "+fbPlural(a.depois,"falta","faltas")+" contra "+a.antes+" nos 30 dias anteriores ("+String(ve.t).toLowerCase()+"). Faltam "+Math.max(0,30-a.dia)+" dias de acompanhamento.");
  if(ult&&ult.motivo)ponto.push("Motivo informado no último feedback: "+fbMotNome(ult.motivo)+(ult.justificativa?". Disse: “"+ult.justificativa+"”.":"."));
  if(c&&c.acordo)ponto.push("Combinado: "+c.acordo+(c.acordo_prazo?" (prazo "+fbDd(c.acordo_prazo)+")":"")+(c.acordo_auto&&FB_ACOR[c.acordo_auto]?" — "+FB_ACOR[c.acordo_auto][0].toLowerCase():"")+".");
  if(p.situacao==="base")ponto.push("Não ligou depois de "+(p.tentativas||2)+" mensagens do SAC: a conversa cabe à coordenação.");
  if(!ponto.length)ponto.push("Sem pendências nos registros do SAC.");
  const reg=ult?fbRegistroCompleto(ult,c&&c.id===ult.id&&c.acordo_prazo?(FB_ACOR[c.acordo_auto]||FB_ACOR.pendente):null):"";
  const tab=(cab,lin)=>'<table class="dt"><thead><tr>'+cab.map(x=>'<th>'+x+'</th>').join("")+'</tr></thead><tbody>'+lin.map(l=>'<tr>'+l.map(x=>'<td>'+x+'</td>').join("")+'</tr>').join("")+'</tbody></table>';
  const nomeCod=h=>h[1]==="I"?"Sem justificativa":h[1]==="T"?"Sem justificativa (tratada pelo SAC)":(FB_ABO_NOME[h[1]]||"Falta");
  const f90=hist.filter(x=>x[1]!=="D"&&x[0]>ligSomaDias(hj,-90));
  const ms=((LIG_HIST&&LIG_HIST.medidas)||[]).filter(m=>p.re&&String(m.re)===String(p.re)).sort((x,y)=>String(y.data).localeCompare(String(x.data)));
  let h='<article class="fb-doc"><header class="dh"><div><small>Grupo ServCamp · Feedback de Faltas</small><h3>Resumo para a coordenação</h3></div><span>Emitido em '+rhFmt(hj)+'</span></header>';
  h+='<div class="dp"><div class="av">'+_esc(fbIni(p.nome))+'</div><div><h2>'+_esc(p.nome)+'</h2><p>'+(p.re?"RE "+_esc(p.re):"")+(p.posto?" · "+_esc(fbTitulo(p.posto)):"")+'</p><p>'+(p.supervisor?"Supervisor: <b>"+_esc(fbTitulo(p.supervisor))+"</b>":"")+(fbFone(p.telefone)?" · "+_esc(fbFone(p.telefone)):"")+'</p></div><span class="fb-vd '+(ve?ve.tom:sit.tom)+'">'+_esc(ve?ve.t:sit.t)+'</span></div>';
  h+='<div class="dk">'+kp(sj30.length,"faltas sem justificativa<br>nos últimos 30 dias","r")+kp(ab30.length,"faltas abonadas<br>nos últimos 30 dias","b")+kp(env.length,"mensagens do SAC<br>enviadas","v")+kp(contatos.filter(ligEfetivo).length,"feedbacks<br>realizados","g")+'</div>';
  h+=sec("Situação atual",'<p class="dst '+dest[2]+'"><b>'+_esc(dest[0])+'.</b> '+_esc(dest[1])+'</p>');
  if(a)h+=sec("Acompanhamento de 30 dias",'<div class="da"><div><small>Antes do feedback</small><b>'+fbPlural(a.antes,"falta","faltas")+'</b><span>'+fbDd(ligSomaDias(c.data,-30))+' a '+fbDd(c.data)+'<br>'+_esc(dts(a.faltas_antes))+'</span></div><div><small>Depois do feedback</small><b>'+fbPlural(a.depois,"falta","faltas")+'</b><span>'+fbDd(ligSomaDias(c.data,1))+' a '+fbDd(ligSomaDias(c.data,30))+' · dia '+Math.min(30,a.dia)+' de 30<br>'+_esc(dts(a.faltas_depois))+'</span></div><div class="'+(a.depois>a.antes?"r":a.depois<a.antes?"g":"")+'"><small>Resultado</small><b>'+(a.depois===a.antes?"Igual":(a.depois>a.antes?"+":"−")+Math.abs(a.depois-a.antes)+(Math.abs(a.depois-a.antes)===1?" falta":" faltas"))+'</b><span>'+_esc(ve.t)+'</span></div></div>');
  h+=sec("Último feedback",reg||'<p class="fb-gnota">Nenhum feedback registrado.</p>');
  h+=sec("Pontos para a conversa",'<ul class="dl">'+ponto.map(x=>'<li>'+_esc(x)+'</li>').join("")+'</ul>');
  h+=sec("Faltas dos últimos 90 dias",f90.length?tab(["Data","Dia da semana","Situação"],f90.slice(0,24).map(x=>[rhFmt(x[0]),DS[new Date(x[0]+"T12:00:00Z").getUTCDay()],_esc(nomeCod(x))])):'<p class="fb-gnota">Nenhuma falta no período.</p>');
  h+=sec("Mensagens do SAC",env.length?'<p>'+env.slice(0,12).map(d=>'<span class="ch">'+fbDd(d)+'</span>').join(" ")+'</p>':'<p class="fb-gnota">Nenhuma mensagem enviada.</p>');
  h+=sec("Histórico de contatos",contatos.length?tab(["Data","Como foi","Motivo","Duração","Registrado por"],contatos.slice(0,10).map(x=>[rhFmt(ligDataContato(x)),ligEfetivo(x)?"Falou com a pessoa":"Não conseguiu falar",_esc(x.motivo?fbMotNome(x.motivo):"—"),x.duracao_min?Number(x.duracao_min)+" min":"—",_esc(String(x.criado_por||"—").split(" ")[0])])):'<p class="fb-gnota">Nenhum contato registrado.</p>');
  if(ms.length)h+=sec("Medidas disciplinares",tab(["Data","Medida","Dias"],ms.slice(0,8).map(m=>[rhFmt(String(m.data).slice(0,10)),_esc((m.tipo||"")+(m.grau&&m.grau!==m.tipo?" "+m.grau:"")),Number(m.dias)?Number(m.dias):"—"])));
  h+='<footer class="df"><div><i></i>Coordenação</div><div><i></i>Colaborador</div><div><i></i>Data</div></footer></article>';
  return h;
}
function ligResumo(p){
  fbFechar("lig-perfil-modal",true);
  fbDialog("lig-resumo-modal",{titulo:"Resumo para a coordenação",tam:"lg",
    corpo:fbDocResumo(p)+'<textarea class="fb-ta fb-resumo fb-sr" id="lr-txt" readonly rows="2" tabindex="-1" aria-hidden="true"></textarea>',
    rodape:'<span class="msg" id="lr-msg" role="status"></span><button type="button" class="fb-btn" onclick="fbFechar(\'lig-resumo-modal\')">Fechar</button><button type="button" class="fb-btn" onclick="ligResumoCopiar()">'+fbI("doc")+'Copiar texto</button><button type="button" class="fb-btn pri" onclick="ligResumoImprimir()">'+fbI("doc")+'Imprimir</button>'});
  document.getElementById("lr-txt").value=fbResumo(p);
}
function ligResumoImprimir(){
  const fim=()=>document.body.classList.remove("fb-imprimindo");
  document.body.classList.add("fb-imprimindo");
  if(window.addEventListener)window.addEventListener("afterprint",fim,{once:true});
  try{window.print();}catch(e){fim();}
}
function ligResumoCopiar(){
  const t=document.getElementById("lr-txt"),m=document.getElementById("lr-msg");
  const feito=()=>{m.style.color="#067647";m.textContent="Texto copiado.";};
  const falhou=()=>{try{t.focus();t.select();if(document.execCommand&&document.execCommand("copy"))return feito();}catch(e){}m.style.color="#d92d20";m.textContent="Não consegui copiar. Selecione o texto e use Ctrl+C.";};
  try{if(navigator.clipboard&&navigator.clipboard.writeText)return navigator.clipboard.writeText(t.value).then(feito,falhou);}catch(e){}
  falhou();
}

/* ═════ panorama da pessoa (painel lateral) ═════
   Cabeçalho com o veredito · três cartões · evolução (barras e %) · calendário de um mês por vez · linha do tempo e destaque · histórico */
const FB_DEST={
  piorou:["Situação em atenção","O colaborador apresentou aumento no número de faltas após o feedback.","tn-da"],
  mesma:["Sem mudança","O número de faltas não mudou depois do feedback.","tn-am"],
  melhorando:["Evolução positiva","O colaborador faltou menos depois do feedback.","tn-ok"],
  comecando:["Em observação","O feedback foi recente. Ainda é cedo para avaliar.","tn-br"]
};
function fbDestaque(p){
  if(p.acomp)return FB_DEST[p.acomp.veredito]||FB_DEST.mesma;
  if(p.situacao==="mensagem")return["Aguardando mensagem","O SAC ainda não enviou mensagem."+(p.tentativas>0?" Uma mensagem anterior ficou sem resposta.":""),"tn-br"];
  if(p.situacao==="aguardando")return p.envio==="sem_retorno"
    ?["Não ligou","A pessoa não ligou depois "+(p.ultima_marca_manual?"da tentativa":"da mensagem")+" de "+fbDd(p.ultima_marca)+". Se faltar de novo e não responder, o caso vai para a coordenação.","tn-am"]
    :["Aguardando ligação","A pessoa tem até "+fbDd(p.prazo_ate||p.ultima_marca)+" para ligar para o SAC.","tn-br"];
  if(p.situacao==="base")return["Com a coordenação","A pessoa não ligou depois de "+p.tentativas+" mensagens do SAC. Cabe à coordenação conversar com ela.","tn-da"];
  return["Sem pendência","Nenhuma falta sem justificativa aguardando o SAC nos últimos 30 dias.","tn-gr"];
}
function fbCartao(){return'<section class="fb-card2">'+Array.prototype.join.call(arguments,"")+'</section>';}
function fbCartaoH(ic,titulo,direita){return'<header class="fb-card2-h"><span class="ic">'+fbI(ic)+'</span><h4>'+titulo+'</h4>'+(direita||"")+'</header>';}
/* faltas por mês da pessoa (sem justificativa e abonadas), para o "Ver detalhes" do panorama */
function fbMesesPessoa(p){
  const modo=LIG_DES.modo==="civil"?"civil":"folha",hj=ligHojeISO(),m={};
  (p.hist||[]).forEach(h=>{const c=h[1];if(c==="D")return;const k=fbMesChave(h[0],modo);m[k]=m[k]||{sj:0,ab:0};m[k][(c==="I"||c==="T")?"sj":"ab"]++;});
  const ks=[];let k=fbMesChave(hj,modo);
  for(let i=0;i<6;i++){ks.unshift(k);let a=Number(k.slice(0,4)),mm=Number(k.slice(5,7))-1;if(mm<1){mm=12;a--;}k=a+"-"+String(mm).padStart(2,"0");}
  return{modo,lin:ks.map(x=>({k:x,de:fbMesIni(x,modo),ate:fbMesFim(x,modo)<hj?fbMesFim(x,modo):hj,sj:(m[x]||{}).sj||0,ab:(m[x]||{}).ab||0}))};
}
function fbDetalhePessoa(p){
  const r=fbMesesPessoa(p),L=r.lin,a0=L[0].sj,b0=L[L.length-1].sj,pc=fbPct(a0,b0);
  const tot=L.reduce((t,l)=>t+l.sj,0);
  return'<div class="fb-det-h"><span>'+(r.modo==="civil"?"Mês do calendário":"Período da folha, 26 a 25")+'</span>'+(pc===null?"":'<span class="fb-tag '+fbTomVar(pc)+'">'+fbMesRot(L[0].k)+" × "+fbMesRot(L[L.length-1].k)+": "+fbPctTxt(pc)+'</span>')+'<span class="fb-pill-s">'+fbPlural(tot,"falta sem justificativa","faltas sem justificativa")+' em 6 meses</span></div>'
    +fbGCols({rot:"Faltas por mês",rots:L.map(l=>fbMesCurto(l.k)),empilha:true,h:230,series:[{nome:"Sem justificativa",cor:FB_COR.azul,vals:L.map(l=>l.sj)},{nome:"Abonadas",cor:FB_COR.azulc,vals:L.map(l=>l.ab)}]})
    +fbLeg([["Sem justificativa",FB_COR.azul],["Abonadas",FB_COR.azulc]]);
}
/* linha do tempo do acompanhamento: uma coluna por dia (30 antes, o dia do feedback e 30 depois), cada situação com a sua cor */
const FB_TL={f:["#f43f5e","Falta sem justificativa"],t:["#f59e0b","Falta tratada pelo SAC"],a:["#2563eb","Falta abonada"],ok:["#86d9a8","Sem falta"],fut:["#cbd5e1","Dia que ainda não chegou"],fb:["#0f2350","Dia do feedback realizado"],m:["#8b5cf6","Mensagem do SAC enviada"]};
function fbTlLegenda(){return'<ul class="fb-tl-leg">'+["f","t","a","ok","fut","fb","m"].map(k=>'<li><i class="k-'+k+'" style="background:'+FB_TL[k][0]+'"></i>'+FB_TL[k][1]+'</li>').join("")+'</ul>';}
function fbGLinha(o){
  const [cod,env]=fbMapas(o.p),hj=ligHojeISO(),W=680,H=176,pl=10,pr=10,pt=50,pb=32,base=H-pb,w=(W-pl-pr)/61,X=n=>pl+(n+30)*w,alto=58;
  let s='<svg class="fb-g fb-gl" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Um dia por coluna: 30 dias antes do feedback, o feedback e os 30 dias de acompanhamento"><defs><pattern id="fgl" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="8" stroke="#d3dbe8" stroke-width="3"/></pattern></defs>';
  s+='<rect x="'+X(-30)+'" y="'+pt+'" width="'+(X(0)-X(-30))+'" height="'+(base-pt)+'" rx="10" fill="#eef3fd"/>';
  s+='<rect x="'+X(0)+'" y="'+pt+'" width="'+(X(31)-X(0))+'" height="'+(base-pt)+'" rx="10" fill="#f1faf4"/>';
  s+='<text x="'+(X(-30)+8)+'" y="'+(pt-34)+'" class="gt">Antes do feedback</text><text x="'+(X(-30)+8)+'" y="'+(pt-20)+'" class="gs">'+o.fa.length+(o.fa.length===1?" falta":" faltas")+' em 30 dias</text>';
  s+='<text x="'+(X(31)-8)+'" y="'+(pt-34)+'" class="gt" text-anchor="end">Depois do feedback</text><text x="'+(X(31)-8)+'" y="'+(pt-20)+'" class="gs" text-anchor="end">'+o.fd.length+(o.fd.length===1?" falta":" faltas")+' até hoje</text>';
  for(let n=-30;n<=30;n++){
    const d=ligSomaDias(o.c,n),c=cod[d],x=X(n)+w*.15,bw=w*.7;
    let k,h2,txt;
    if(n===0){k="fb";h2=0;txt="Feedback realizado";}
    else if(d>hj){k="fut";h2=14;txt="Ainda não chegou";}
    else if(c==="I"){k="f";h2=alto;txt="Falta sem justificativa";}
    else if(c==="T"){k="t";h2=alto;txt="Falta tratada pelo SAC";}
    else if(["A","J","L","AF"].indexOf(c)>=0){k="a";h2=alto;txt=FB_ABO_NOME[c]||"Falta abonada";}
    else{k="ok";h2=14;txt="Sem falta";}
    const ms=env[d]?" · mensagem do SAC enviada":"",rel=n===0?"dia do feedback":n<0?Math.abs(n)+(n===-1?" dia antes":" dias antes"):"dia "+n+" de 30";
    if(k==="fb"){const cx=X(0)+w/2;s+='<line x1="'+cx+'" x2="'+cx+'" y1="'+(pt-4)+'" y2="'+base+'" stroke="'+FB_TL.fb[0]+'" stroke-width="2" stroke-dasharray="2 3"/><path d="M'+cx+' '+(base-9)+' l9 9 l-9 9 l-9 -9 Z" fill="'+FB_TL.fb[0]+'" stroke="#fff" stroke-width="2" data-tip="'+_esc(fbDd(d)+" · Feedback realizado · dia do feedback"+(env[d]?" · mensagem do SAC enviada":""))+'"/>';continue;}
    s+='<rect x="'+x+'" y="'+(base-h2)+'" width="'+bw+'" height="'+h2+'" rx="3" fill="'+(k==="fut"?"url(#fgl)":FB_TL[k][0])+'"'+(k==="fut"?' stroke="#d3dbe8"':"")+' data-tip="'+_esc(fbDd(d)+" · "+txt+ms+" · "+rel)+'"/>';
    if(env[d])s+='<circle cx="'+(x+bw/2)+'" cy="'+(base-h2-9)+'" r="4" fill="'+FB_TL.m[0]+'"/>';
  }
  const hh=fbDiasEntre(o.c,hj);
  if(hh>0&&hh<=30){const x=X(hh)+w/2;s+='<rect x="'+(X(hh)-1)+'" y="'+pt+'" width="'+(w+2)+'" height="'+(base-pt)+'" fill="none" stroke="#0f2350" stroke-width="1.5" stroke-dasharray="3 3" rx="3"/><g><rect x="'+(x-26)+'" y="'+(pt-20)+'" width="52" height="20" rx="10" fill="#0f2350"/><text x="'+x+'" y="'+(pt-6)+'" class="gp2" text-anchor="middle">Hoje</text></g>';}
  { const x=X(0)+w/2;s+='<g><rect x="'+(x-38)+'" y="'+(pt-20)+'" width="76" height="20" rx="10" fill="'+FB_TL.fb[0]+'"/><text x="'+x+'" y="'+(pt-6)+'" class="gp2" text-anchor="middle">Feedback</text></g>';}
  s+='<line x1="'+pl+'" x2="'+(W-pr)+'" y1="'+base+'" y2="'+base+'" stroke="#c9d3e3"/>';
  [[-30,"start"],[-15,"middle"],[0,"middle"],[15,"middle"],[30,"end"]].forEach(t=>{s+='<text class="gx" text-anchor="'+t[1]+'" x="'+(X(t[0])+(t[1]==="start"?0:t[1]==="end"?w:w/2))+'" y="'+(H-14)+'">'+fbDd(ligSomaDias(o.c,t[0]))+'</text>';});
  return s+'</svg>';
}
/* histórico completo (400 dias) para o "mês a mês": busca uma vez por pessoa */
function fbPanCompleto(p,feito){
  if(p._completo){feito();return;}
  ligApi("/api/ligacoes?acao=colaborador&re="+encodeURIComponent(p.re||"")+"&nome="+encodeURIComponent(p.nome||"")).then(j=>{if(j&&j.pessoa&&LIG_PAN===p){p.hist=j.pessoa.hist;p._completo=1;feito();}}).catch(()=>{});
}
function ligPanDetalhe(){ligPanAba("evo");}
function ligPanHist(){ligPanAba("hist");}
/* abas do panorama: uma tela por vez, sem rolar a janela inteira */
const FB_PAN_ABAS=[["resumo","Resumo","doc"],["cal","Calendário","cal"],["evo","Evolução","chart"],["hist","Histórico","hist"]];
let LIG_PAN_ABA="resumo";
function ligPanAba(k){
  const ov=document.getElementById("lig-perfil-modal");if(!ov)return;
  const nav=ov.querySelector(".fb-pan-abas"),ant=fbPosOn(nav),o=FB_PAN_ABAS.map(x=>x[0]),dx=o.indexOf(k)>o.indexOf(LIG_PAN_ABA)?18:-18;
  LIG_PAN_ABA=k;
  nav.querySelectorAll(":scope > button").forEach(b=>{const on=b.dataset.k===k;b.classList.toggle("on",on);b.setAttribute("aria-selected",on);});
  fbIndica(nav,ant);
  ov.querySelectorAll(".fb-pan-sec").forEach(s=>{const on=s.dataset.k===k;s.hidden=!on;if(on&&fbMov())s.animate([{opacity:0,transform:"translate3d("+dx+"px,0,0)"},{opacity:1,transform:"none"}],{duration:380,easing:FB_EASE});});
  if(k==="evo"&&LIG_PAN){const p=LIG_PAN,pinta=()=>{const b=document.getElementById("lp-det");if(b)b.innerHTML=fbDetalhePessoa(p);};pinta();fbPanCompleto(p,pinta);}
}
/* datas como etiquetas pequenas (até 8; o resto vira "+N") */
function fbChipsDatas(lista,tom){
  if(!lista||!lista.length)return'<span class="fb-dts vazio">nenhuma falta</span>';
  const v=lista.slice().sort();
  return'<span class="fb-dts">'+v.slice(0,8).map(d=>'<i class="'+(tom||"")+'">'+fbDd(d)+'</i>').join("")+(v.length>8?'<i class="mais">+'+(v.length-8)+'</i>':"")+'</span>';
}
/* andamento do acompanhamento: quantos dos 30 dias já passaram (o calendário completo fica na aba Calendário) */
function fbProgresso(c,a){
  const dia=Math.min(30,Math.max(0,a.dia)),pc=Math.round(dia/30*100);
  return'<div class="fb-kg g-violet fb-prog"><span class="ic">'+fbI("clock")+'</span><small>Acompanhamento de 30 dias</small><b data-n="'+dia+'">'+dia+'<em>de 30 dias</em></b>'
    +'<div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="30" aria-valuenow="'+dia+'"><i style="width:'+pc+'%"></i></div>'
    +'<span class="s">'+fbDd(ligSomaDias(c.data,1))+' a '+fbDd(ligSomaDias(c.data,30))+' · '+(dia>=30?"concluído":"faltam "+fbPlural(30-dia,"dia","dias"))+'</span></div>';
}
/* calendário do acompanhamento: o dia do contato e os 30 dias seguintes, em sequência (não pelo mês do calendário) */
function fbCalJanela(p,c){
  const [cod,env]=fbMapas(p),hj=ligHojeISO(),NM=["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
  const cruza=ligSomaDias(c.data,30).slice(0,7)!==c.data.slice(0,7);
  let h='<div class="fb-cal">'+["Seg","Ter","Qua","Qui","Sex","Sáb","Dom"].map(x=>'<b>'+x+'</b>').join(""),mes="";
  for(let n=0;n<=30;n++){
    const d=ligSomaDias(c.data,n),r=fbDia(p,d,cod,env,hj,c.data);
    if(d.slice(0,7)!==mes){
      mes=d.slice(0,7);
      if(cruza)h+='<div class="fb-cal-m m'+(mes===c.data.slice(0,7)?"1":"2")+'">'+NM[Number(mes.slice(5,7))-1]+' de '+mes.slice(0,4)+'</div>';
      for(let k=0;k<(cruza||n===0?fbDow(d):0);k++)h+='<span class="v"></span>';
    }
    h+='<i class="'+r[0]+' mm'+(mes===c.data.slice(0,7)?"1":"2")+'" data-d="'+n+'" data-tip="'+(n?"Dia "+n+" de 30":"Dia do feedback")+' · '+fbDd(d)+' · '+_esc(r[1])+'">'+d.slice(8,10)+'</i>';
  }
  return h+'</div>';
}
function ligPanorama(p){
  LIG_PAN=p;LIG_PAN_ABA="resumo";
  const hj=ligHojeISO(),sit=FB_SIT.find(s=>s.k===p.situacao)||{t:"Sem pendência",tom:"tn-gr"};
  const contatos=LIG_C.filter(c=>fbDaPessoa(c,p));
  const a=p.acomp,c=p.contato;
  const v=a?(FB_VD[a.veredito]||{}):{t:sit.t,tom:sit.tom};
  const icV=a?(FB_VD[a.veredito]||FB_VD.mesma).ic:({mensagem:"chat",aguardando:"clock",base:"alert"}[p.situacao]||"info");
  const plF=n=>n+" "+(n===1?"falta":"faltas");
  const cmp=a?(a.depois>a.antes?"pior":(a.depois<a.antes?"bom":"igual")):"";
  const fimAc=c?ligSomaDias(c.data,30):"";
  const reg=(c&&c.id?(LIG_C.find(x=>x.id===c.id)||null):fbUltRegistro(p))||(c?{id:c.id,data_contato:c.data,criado_por:c.por,canal:c.canal,motivo:c.motivo,justificativa:c.justificativa,acordo:c.acordo,acordo_prazo:c.acordo_prazo,baixa:c.baixa,colaborador:p.nome,posto:p.posto,supervisor:p.supervisor}:null);
  /* pessoa: avatar, nome, RE • posto, supervisor e o resultado */
  const topo='<div class="fb-pf-top"><div class="fb-av" aria-hidden="true">'+_esc(fbIni(p.nome))+'</div><div style="min-width:0;flex:1"><div class="fb-pf-nome">'+_esc(p.nome)+'</div>'
    +'<div class="fb-sb">'+(p.re?'RE '+_esc(p.re):"")+(p.posto?' • '+_esc(fbTitulo(p.posto)):"")+(p.supervisor?' • Supervisor: <b>'+_esc(fbTitulo(p.supervisor))+'</b>':"")+'</div></div>'
    +'<span class="fb-vd '+v.tom+'">'+fbI(icV)+_esc(v.t)+'</span></div>';
  /* a data do contato no topo, junto com os números */
  const faixa=a
    ?'<div class="fb-pan-ct">'+fbI("phone")+'<div><small>Feedback realizado</small><b>'+rhFmt(c.data)+'</b><span>'+(a.dia>0?fbDias(c.data)+" · ":"")+_esc((c.por||"—").split(" ")[0])+' · '+fbCanal(c)+'</span></div>'
      +'<div><small>Acompanhamento</small><b>até '+fbDd(fimAc)+'</b><span>'+(a.dia>=30?"concluído":"faltam "+fbPlural(30-a.dia,"dia","dias"))+'</span></div></div>'
    :(reg?'<div class="fb-pan-ct">'+fbI("phone")+'<div><small>Último feedback realizado</small><b>'+rhFmt(ligDataContato(reg))+'</b><span>'+_esc((reg.criado_por||"—").split(" ")[0])+' · '+fbCanal(reg)+'</span></div></div>':"");
  const st=(cls,ic,rot,num,sub,datas,tom)=>'<div class="'+cls+'"><small>'+fbI(ic)+rot+'</small><b>'+num+'</b><em>'+sub+'</em>'+(datas!==undefined?fbChipsDatas(datas,tom):"")+'</div>';
  let res;
  if(a){
    const fa=a.faltas_antes||(p.hist||[]).filter(h=>(h[1]==="I"||h[1]==="T")&&h[0]>=ligSomaDias(c.data,-30)&&h[0]<=c.data).map(h=>h[0]);
    /* conta simples: faltas depois menos faltas antes (o mesmo que o veredito usa) */
    const dif=a.depois-a.antes,pct=a.antes>0?Math.round(dif/a.antes*100):null;
    const pctTxt=dif===0?"Igual":(dif>0?"+":"−")+Math.abs(dif)+(Math.abs(dif)===1?" falta":" faltas");
    const subR=a.antes+" antes, "+a.depois+" depois"+(pct!==null&&dif!==0?" ("+fbPctTxt(pct)+")":"");
    res='<div class="fb-st3">'+st("t-b","cal","Antes do feedback",plF(a.antes),fbDd(ligSomaDias(c.data,-30))+" a "+fbDd(c.data),fa,"f")
      +st("t-g","cal","Depois do feedback",plF(a.depois),a.dia>0?fbDd(ligSomaDias(c.data,1))+" a "+fbDd(hj):"feedback hoje",a.faltas_depois||[],"f")
      +'<div class="t-r '+(cmp==="pior"?"tn-da":cmp==="bom"?"tn-ok":"tn-gr")+'"><small>'+fbI(cmp==="pior"?"down":cmp==="bom"?"up":"eq")+'Resultado</small><b>'+pctTxt+'</b><em>'+_esc(v.t)+' · '+subR+'</em></div></div>';
  }else{
    const sj30=(p.hist||[]).filter(h=>(h[1]==="I"||h[1]==="T")&&h[0]>ligSomaDias(hj,-30)&&h[0]<=hj).map(h=>h[0]);
    const env=(p.envios||[]).slice().sort();
    res='<div class="fb-st3">'+(p.situacao==="sem"
      ?st("t-b","cal","Sem justificativa",plF(sj30.length),"nos últimos 30 dias",sj30,"f")+st("t-g","chat","Mensagens do SAC",String(env.length),"nos últimos meses",env,"m")+st("t-vi","phone","Feedbacks",String(contatos.filter(ligEfetivo).length),contatos.length?"último em "+fbDd(ligDataContato(contatos[0])):"nenhum até hoje")
      :st("t-b","cal","Faltas sem conversa",plF(p.faltas.length),"nos últimos 30 dias",p.faltas,"f")+st("t-g","chat","Mensagens do SAC",String(p.mensagens||env.length||0),"desde a primeira falta",env,"m")+st("t-vi","alert","Sem resposta",String(p.tentativas||0),"2 levam à coordenação"))+'</div>'
      +'<p class="fb-tl-nota '+fbDestaque(p)[2]+'"><b>'+_esc(fbDestaque(p)[0])+'.</b> '+_esc(fbDestaque(p)[1])+'</p>';
  }
  /* combinado */
  let acordo="";
  if(c&&c.acordo_prazo){
    const au=c.acordo_auto&&FB_ACOR[c.acordo_auto]?FB_ACOR[c.acordo_auto]:FB_ACOR.pendente;
    acordo='<div class="fb-ac2 '+au[1]+'"><div><b>Combinado: '+_esc(c.acordo||"registrado")+'</b><span>Prazo: '+fbDd(c.acordo_prazo)+'</span></div>'+fbTag(au[0],au[1])+'</div>';
  }
  const auReg=c&&c.acordo_prazo?(c.acordo_auto&&FB_ACOR[c.acordo_auto]?FB_ACOR[c.acordo_auto]:FB_ACOR.pendente):null;
  const resumo=(a?fbProgresso(c,a):"")+fbRegistroCompleto(reg,auReg)+res+fbFunilPessoa(p,contatos,a?ligSomaDias(c.data,-30):"");
  /* calendário de um mês por vez */
  const ini=a?ligSomaDias(c.data,-30):ligSomaDias(hj,p.situacao==="sem"?-89:-30),fim=a?ligSomaDias(c.data,30):fbFimCal(hj,hj);
  const meses=fbMesesLista(ini,fim);
  LIG_MESES=meses.map(m=>m.nome);LIG_MES=Math.max(0,meses.findIndex(m=>m.k===hj.slice(0,7)));if(LIG_MES<0||meses.every(m=>m.k!==hj.slice(0,7)))LIG_MES=meses.length-1;
  const leg='<ul class="fb-leg fb-leg2"><li><i class="ok"></i>Sem falta registrada</li><li><i class="f"></i>Falta sem justificar</li><li><i class="a"></i>Abonada</li><li><i class="c"></i>Dia do feedback</li><li><i class="m"></i>Mensagem do SAC</li></ul>';
  const pager='<div class="fb-pager"><button type="button" class="fb-ib" id="lp-mes-a" onclick="ligMes(-1)" aria-label="Mês anterior"'+(LIG_MES===0?" disabled":"")+'>'+fbI("left")+'</button><span id="lp-mes">'+_esc(LIG_MESES[LIG_MES]||"")+'</span><button type="button" class="fb-ib" id="lp-mes-b" onclick="ligMes(1)" aria-label="Próximo mês"'+(LIG_MES===meses.length-1?" disabled":"")+'>'+fbI("go")+'</button></div>';
  const cal=a?'<section class="fb-card2 fb-calc">'+fbCartaoH("cal","Calendário do acompanhamento",'<span class="fb-pill-s">'+fbDd(c.data)+' (contato) a '+fbDd(ligSomaDias(c.data,30))+'</span>')+'<div class="fb-calwrap">'+fbCalJanela(p,c)+leg+'</div></section>'
    :'<section class="fb-card2 fb-calc">'+fbCartaoH("cal","Calendário de Faltas",pager)+'<div class="fb-calwrap">'+fbCelulas(p,ini,fim,null,LIG_MES)+leg+'</div></section>';
  /* evolução: antes × depois (quem está em acompanhamento) e o mês a mês */
  let evo="";
  if(a){
    const fa2=a.faltas_antes||(p.hist||[]).filter(h=>(h[1]==="I"||h[1]==="T")&&h[0]>=ligSomaDias(c.data,-30)&&h[0]<=c.data).map(h=>h[0]),fd2=a.faltas_depois||[];
    const dif=a.depois-a.antes,tomR=cmp==="pior"?"g-coral":cmp==="bom"?"g-green":"g-amber";
    evo='<div class="fb-evoc"><div class="fb-kgs pan3">'
      +fbKg("g-blue","cal","Antes do feedback",a.antes+(a.antes===1?" falta":" faltas"),fbDd(ligSomaDias(c.data,-30))+" a "+fbDd(c.data),"")
      +fbKg(a.depois>a.antes?"g-coral":"g-green","cal","Depois do feedback",a.depois+(a.depois===1?" falta":" faltas"),a.dia>0?fbDd(ligSomaDias(c.data,1))+" a "+fbDd(hj):"feedback hoje","")
      +fbKg(tomR,cmp==="pior"?"down":cmp==="bom"?"up":"eq","Resultado",dif===0?"Igual":(dif>0?"+":"−")+Math.abs(dif),(a.dia<30?"faltam "+(30-Math.max(a.dia,0))+" dias de acompanhamento":"acompanhamento concluído"),"")+'</div>'
      +fbPainel("Faltas antes e depois do feedback","",fbGLinha({c:c.data,p,fa:fa2,fd:fd2})+'<p class="fb-gnota">Uma coluna por dia: à esquerda os 30 dias antes do feedback, à direita os 30 dias de acompanhamento. Passe o mouse num dia para ver a data e a situação.</p>'+fbTlLegenda())+'</div>';
  }
  evo+=fbPainel("Faltas mês a mês","",'<div id="lp-det"></div>');
  const hist='<div id="lp-tl" class="fb-pan-tl"></div>';
  const nav='<nav class="fb-pills fb-pan-abas" role="tablist" aria-label="Panorama" data-ind="fundo">'+FB_PAN_ABAS.map(x=>'<button type="button" role="tab" data-k="'+x[0]+'" class="'+(x[0]==="resumo"?"on":"")+'" aria-selected="'+(x[0]==="resumo")+'" onclick="ligPanAba(\''+x[0]+'\')">'+fbI(x[2])+x[1]+'</button>').join("")+'</nav>';
  const sec=(k,h)=>'<section class="fb-pan-sec" data-k="'+k+'"'+(k==="resumo"?"":" hidden")+'>'+h+'</section>';
  /* ações no rodapé; Fechar à direita */
  const acoes=['<button type="button" class="fb-btn pri sm" onclick="ligPanEnviar()">'+fbI("chat")+'Enviar WhatsApp</button>','<button type="button" class="fb-btn sm" onclick="ligPanRegistrar()">'+fbI("phone")+'Registrar feedback</button>','<button type="button" class="fb-btn sm" onclick="ligPanResumo()">'+fbI("doc")+'Resumo para a coordenação</button>'];
  if(c&&c.id){
    if(LIG_PODE_BAIXAR){
      acoes.push(c.baixa?'<button type="button" class="fb-btn sm" onclick="ligBaixa('+Number(c.id)+',false)">Voltar para a cobrança</button>':'<button type="button" class="fb-btn sm" onclick="ligBaixa('+Number(c.id)+',true,\''+_esc(p.re)+'\')">Retirar da cobrança</button>');
      if(c.acordo_prazo&&c.acordo_auto!=="nao_cumpriu"&&c.acordo_status!=="descumprido")acoes.push('<button type="button" class="fb-btn warn sm" onclick="ligAcordo('+Number(c.id)+',\'descumprido\')">Não cumpriu o combinado</button>');
    }
    if(c.acordo_prazo&&c.acordo_auto!=="cumpriu")acoes.push('<button type="button" class="fb-btn sm" onclick="ligAcordo('+Number(c.id)+',\'cumprido\')">Marcar como cumprido</button>');
  }
  const ov=fbDialog("lig-perfil-modal",{titulo:"Panorama do colaborador",lateral:true,semFoco:true,tom:v.tom,banner:true,
    corpo:'<div class="fb-pf fb-pan">'+topo+faixa+nav+'<div class="fb-pan-b">'+sec("resumo",resumo)+sec("cal",cal)+sec("evo",evo)+sec("hist",hist)+'</div></div>',
    rodape:'<div class="fb-pf-foot">'+acoes.join("")+'</div><button type="button" class="fb-btn navy sm" onclick="fbFechar(\'lig-perfil-modal\')">Fechar</button>'});
  fbIndicaTudo(ov);
  const eventos=fbEventos(p,contatos);
  const pinta=ms=>{
    const box=document.getElementById("lp-tl");if(!box)return;
    box.innerHTML=fbLinha(eventos.concat((ms||[]).filter(m=>p.re&&String(m.re)===String(p.re)).map(m=>({d:String(m.data).slice(0,10),o:2,k:"tn-am",h:"Medida: "+_esc(m.tipo||"")+(m.grau&&m.grau!==m.tipo?" "+_esc(m.grau):"")+(Number(m.dias)?" · "+fbPlural(Number(m.dias),"dia","dias"):""),corpo:m.motivo?'<p>'+_esc(m.motivo)+'</p>':"",m:""}))));
  };
  pinta(null);
  if(LIG_HIST)pinta(LIG_HIST.medidas);
  else fetch("/api/rh?modulo=faltas&t=historico").then(x=>x.ok?x.json():null).then(j=>{LIG_HIST=j||{medidas:[]};pinta(LIG_HIST.medidas);}).catch(()=>{});
}
/* o funil da pessoa: faltas sem justificativa, mensagens recebidas, ligações com feedback e mensagens sem resposta */
function fbFunilPessoa(p,contatos,ini){
  const hj=ligHojeISO(),fs=(p.hist||[]).filter(h=>(h[1]==="I"||h[1]==="T")&&(!ini||h[0]>=ini)),env=(p.envios||[]).filter(d=>!ini||d>=ini).sort(),conv=contatos.filter(ligEfetivo).map(ligDataContato).filter(d=>!ini||d>=ini).sort();
  let semResp=0;
  env.forEach((d,i)=>{const prox=env[i+1]||"9999";if(!conv.some(c=>c>=d&&c<prox)&&hj>ligSomaDias(d,LIG_PRAZO||1))semResp++;});
  const desde=ini?fbDd(ini):((p.hist&&p.hist.length)?fbDd(p.hist[0][0]):"");
  const it=(cls,n,rot)=>'<div class="'+cls+'"><b>'+n+'</b><span>'+rot+'</span></div>';
  return'<section class="fb-pfun" aria-label="Funil da pessoa">'+it("f1",fs.length,fs.length===1?"falta sem justificativa":"faltas sem justificativa")+'<i>'+fbI("go")+'</i>'
    +it("f2",env.length,env.length===1?"mensagem recebida":"mensagens recebidas")+'<i>'+fbI("go")+'</i>'
    +it("f3",conv.length,conv.length===1?"ligação com feedback":"ligações com feedback")+'<i>'+fbI("go")+'</i>'
    +it("f4",semResp,semResp===1?"mensagem sem resposta":"mensagens sem resposta")+(desde?'<small>desde '+desde+'</small>':"")+'</section>';
}
function fbEventos(p,contatos){
  const ev=[];
  (p.hist||[]).forEach(h=>{
    if(h[0]<ligSomaDias(ligHojeISO(),-75))return;
    ev.push({d:h[0],o:0,k:h[1]==="I"?"tn-da":h[1]==="T"?"tn-vi":"tn-gr",h:h[1]==="I"?"Faltou sem justificar":h[1]==="T"?"Faltou (já tratada pelo SAC)":(FB_ABO_NOME[h[1]]||"Falta"),corpo:"",m:""});
  });
  (p.envios||[]).forEach(d=>ev.push({d,o:0.5,k:"tn-br",h:"Mensagem do SAC enviada",corpo:"",m:""}));
  contatos.forEach(c=>{
    const ef=ligEfetivo(c);
    ev.push({d:ligDataContato(c),o:1+(Number(c.id)||0)/1e9,k:ef?"tn-ok":"tn-gr",h:ef?"Feedback registrado "+fbCanal(c):"Não conseguiu falar com a pessoa",corpo:fbRegCampos(c),
      m:'Registrado por '+_esc((c.criado_por||"—").split(" ")[0])+(c.duracao_min?' · '+Number(c.duracao_min)+' min de conversa':"")+(c.baixa?' · fora da cobrança de '+rhFmt(c.baixa.de)+' a '+rhFmt(c.baixa.ate):"")});
  });
  return ev;
}
/* ═════ registro da ligação: cada campo com o seu rótulo (o motivo nunca fica "solto" depois do texto) ═════ */
function fbCanal(c){return c.canal==="PESSOAL"?"pessoalmente":c.canal==="WHATSAPP"?"pelo WhatsApp":"por ligação";}
function fbMotNome(n){if(!n)return"";const k=_ligNorm(n),m=(LIG_MOT||[]).find(x=>_ligNorm(x.nome)===k||(x.antigos||[]).some(a=>_ligNorm(a)===k));return m?m.nome:String(n);}
function fbRegCampos(c){
  const ef=ligEfetivo(c),it=(r,v)=>'<div><dt>'+r+'</dt><dd>'+v+'</dd></div>';
  let h="";
  if(ef)h+=it("Motivo da falta",c.motivo?'<b>'+_esc(fbMotNome(c.motivo))+'</b>':'<span class="fb-mut">não informado</span>');
  if(c.justificativa)h+=it(ef?"O que a pessoa disse":"Observação",ef?"“"+_esc(c.justificativa)+"”":_esc(c.justificativa));
  if(c.acordo)h+=it("Combinado",_esc(c.acordo)+(c.acordo_prazo?' <span class="fb-mut">(prazo '+fbDd(c.acordo_prazo)+')</span>':""));
  return h?'<dl class="fb-reg-l">'+h+'</dl>':"";
}
/* registro completo do feedback (panorama): tudo o que foi anotado na hora, cada campo com o seu rótulo */
function fbRegistroCompleto(c,au){
  if(!c)return'<section class="fb-regc vazio"><div class="fb-regc-h">'+fbI("phone")+'<b>Registro do feedback</b></div><p class="fb-gnota">Nenhum feedback registrado para esta pessoa.</p></section>';
  const ef=ligEfetivo(c),it=(r,v,larga)=>'<div class="'+(larga?"w":"")+'"><dt>'+r+'</dt><dd>'+v+'</dd></div>',vazio='<span class="fb-mut">não informado</span>';
  let hora="";try{if(c.criado_em)hora=new Date(c.criado_em).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit",timeZone:"America/Sao_Paulo"});}catch(e){}
  const canal=c.canal==="PESSOAL"?"Pessoalmente":c.canal==="WHATSAPP"?"WhatsApp":"Ligação";
  const acStat=au&&au[0]?' '+fbTag(au[0],au[1]):"";
  let g="";
  g+=it("Data do feedback",'<b>'+rhFmt(ligDataContato(c))+'</b>'+(hora?' <span class="fb-mut">às '+hora+'</span>':""));
  g+=it("Como foi",canal+(ef?"":" · não conseguiu falar"));
  g+=it("Registrado por",_esc(c.criado_por||"—"));
  g+=it("Duração",c.duracao_min?Number(c.duracao_min)+" min":vazio);
  if(c.telefone)g+=it("Telefone",_esc(c.telefone));
  if(c.data_falta)g+=it("Falta de referência",rhFmt(String(c.data_falta).slice(0,10)));
  if(ef)g+=it("Motivo da falta",c.motivo?'<span class="fb-mot">'+_esc(fbMotNome(c.motivo))+'</span>':vazio);
  g+=it("Colaborador",_esc(c.colaborador||"")+(c.posto?' <span class="fb-mut">· '+_esc(fbTitulo(c.posto))+'</span>':""));
  if(c.supervisor)g+=it("Supervisor",_esc(fbTitulo(c.supervisor)));
  g+=it(ef?"O que a pessoa disse":"Observação",c.justificativa?(ef?"“"+_esc(c.justificativa)+"”":_esc(c.justificativa)):vazio,true);
  if(ef)g+=it("Combinado",c.acordo?_esc(c.acordo)+(c.acordo_prazo?' <span class="fb-mut">· prazo '+fbDd(c.acordo_prazo)+'</span>':"")+acStat:'<span class="fb-mut">nenhum combinado</span>',true);
  if(c.impressao)g+=it("Impressão de quem atendeu",_esc(c.impressao),true);
  if(c.abono)g+=it("Abono",_esc(typeof c.abono==="string"?c.abono:JSON.stringify(c.abono)),true);
  if(ef)g+=it("Cobrança",c.baixa?fbTag("Fora da cobrança","tn-ok")+' <span class="fb-mut">por '+_esc(String(c.baixa.por||"—").split(" ")[0])+(c.baixa.em?' em '+fbDd(String(c.baixa.em).slice(0,10)):"")+(c.baixa.de?' · de '+fbDd(c.baixa.de)+' a '+fbDd(c.baixa.ate):"")+'</span>':fbTag("Na cobrança","tn-gr"),true);
  return'<section class="fb-regc"><div class="fb-regc-h">'+fbI(c.canal==="WHATSAPP"?"chat":c.canal==="PESSOAL"?"user":"phone")+'<b>Registro do feedback</b><span>'+rhFmt(ligDataContato(c))+'</span></div><dl class="fb-regc-g">'+g+'</dl></section>';
}
/* o último registro de conversa (ou tentativa) de uma pessoa */
function fbUltRegistro(p){
  const cs=LIG_C.filter(c=>fbDaPessoa(c,p)).sort((a,b)=>ligDataContato(b).localeCompare(ligDataContato(a))||(Number(b.id)||0)-(Number(a.id)||0));
  return cs.find(ligEfetivo)||cs[0]||null;
}
/* bloco "Registro da ligação" dentro de cada situação tratada */
function fbRegistro(c){
  if(!c)return"";
  const ef=ligEfetivo(c);
  return'<div class="fb-reg"><div class="fb-reg-h">'+fbI(c.canal==="WHATSAPP"?"chat":c.canal==="PESSOAL"?"user":"phone")+'<b>'+(ef?"Registro da ligação":"Tentativa registrada")+'</b><span>'+fbDd(ligDataContato(c))+' · '+_esc((c.criado_por||"—").split(" ")[0])+(c.duracao_min?' · '+Number(c.duracao_min)+' min':"")+'</span></div>'+fbRegCampos(c)+'</div>';
}
function fbLinha(lista){
  const L=lista.slice().sort((a,b)=>b.d.localeCompare(a.d)||b.o-a.o);
  return L.length?'<ol class="fb-tl">'+L.map((e,i)=>'<li class="'+e.k+'" style="--i:'+Math.min(i,12)+'"><span class="fb-tl-d">'+rhFmt(e.d)+'</span><h5>'+e.h+'</h5>'+(e.corpo||"")+(e.m?'<div class="m">'+e.m+'</div>':"")+'</li>').join("")+'</ol>':'<div class="fb-hint">Nada registrado para esta pessoa.</div>';
}
function ligPanRegistrar(){if(!LIG_PAN)return;const p=LIG_PAN;fbFechar("lig-perfil-modal",true);ligForm(null,ligPreencher(p));}
function ligPanEnviar(){if(!LIG_PAN)return;const p=LIG_PAN;fbFechar("lig-perfil-modal",true);ligZapAbrir(p.nome,fbFone(p.telefone)||ligTelefoneDe(p.nome),p.re,p.faltas||[],null);}
function ligPanResumo(){if(LIG_PAN)ligResumo(LIG_PAN);}

/* ═════ histórico de contatos ═════ */
/* contatos do período escolhido no topo, com o filtro de turno e área */
let LIG_H={de:"",ate:""};
function ligHist(k,v){LIG_H[k]=v;ligPanel();}
function fbHistPer(){const hj=ligHojeISO();let de=LIG_H.de||ligSomaDias(hj,-29),ate=LIG_H.ate||hj;if(de>ate){const t=de;de=ate;ate=t;}return{de,ate,rot:fbDd(de)+" a "+fbDd(ate)};}
function fbContatosFiltrados(){
  const pe=fbHistPer();
  return LIG_C.filter(c=>{const d=ligDataContato(c);return d>=pe.de&&d<=pe.ate&&fbSupOk(c.supervisor);});
}
function ligHistF(k,v){LIG_H[k]=LIG_H[k]===v?"":v;ligPanel();}
function fbPnlHist(){
  const base=fbContatosFiltrados(),pe=fbHistPer(),hj=ligHojeISO();
  const fr=LIG_H.r||"",fm=LIG_H.m||"";
  const nEf=base.filter(ligEfetivo).length,nNao=base.length-nEf;
  const mots=[...new Set(base.filter(ligEfetivo).map(c=>c.motivo?fbMotNome(c.motivo):"Sem motivo"))].sort();
  const rows=base.filter(c=>(!fr||(fr==="ef")===ligEfetivo(c))&&(!fm||(c.motivo?fbMotNome(c.motivo):"Sem motivo")===fm)).sort((x,y)=>ligDataContato(y).localeCompare(ligDataContato(x))||(Number(y.id)||0)-(Number(x.id)||0));
  let h='<div class="fb-sub"><div class="fb-sub-t" data-sync="hsubt"><b>Contatos registrados</b><span>'+_esc(pe.rot)+' · '+fbPlural(rows.length,"registro","registros")+'</span></div><div class="fb-sub-a"><span class="fb-datas" data-sync="hdatas"><input class="fb-in" type="date" aria-label="De" value="'+pe.de+'" max="'+hj+'" onchange="ligHist(\'de\',this.value)"><span>a</span><input class="fb-in" type="date" aria-label="Até" value="'+pe.ate+'" max="'+hj+'" onchange="ligHist(\'ate\',this.value)"></span>'+fbBusca()+'</div></div>';
  h+='<div class="fb-hf" data-sync="hf"><button type="button" class="fb-chipb'+(!fr?" on":"")+'" onclick="ligHistF(\'r\',\'\')">Todos '+base.length+'</button><button type="button" class="fb-chipb'+(fr==="ef"?" on":"")+'" onclick="ligHistF(\'r\',\'ef\')">Falou com a pessoa '+nEf+'</button><button type="button" class="fb-chipb'+(fr==="nao"?" on":"")+'" onclick="ligHistF(\'r\',\'nao\')">Não conseguiu falar '+nNao+'</button><span class="sep"></span>'
    +mots.map((m,i)=>'<button type="button" class="fb-chipb'+(fm===m?" on":"")+'" data-n="'+_esc(m)+'" onclick="ligHistF(\'m\',this.dataset.n)">'+_esc(m)+'</button>').join("")+'</div>';
  h+='<div id="lig-lista"><div id="lig-vazio-busca" style="display:none">'+fbVazio()+'</div>';
  if(!rows.length)return h+fbVazio()+'</div>';
  const canal=c=>c.canal==="PESSOAL"?"Pessoalmente":c.canal==="WHATSAPP"?"WhatsApp":"Ligação";
  let dia="";
  h+='<div class="fb-hl">';
  rows.slice(0,150).forEach((c,i)=>{
    const d=ligDataContato(c),ef=ligEfetivo(c);
    if(d!==dia){dia=d;h+='<h5 class="fb-hl-d">'+rhFmt(d)+'<span>'+fbPlural(rows.filter(x=>ligDataContato(x)===d).length,"registro","registros")+'</span></h5>';}
    h+='<article class="fb-pc '+(ef?"tn-ok":"tn-gr")+' fb-hc" tabindex="0" role="button" data-lb="'+_esc(_ligNorm(c.colaborador))+'" data-re="'+_esc(String(c.baixa?c.baixa.re:""))+'" onclick="ligForm('+Number(c.id)+')">'
      +'<div class="fb-pc-h"><div class="fb-av2">'+_esc(fbIni(c.colaborador))+'</div><div class="fb-pc-t"><div class="fb-nm">'+_esc(c.colaborador)+'</div><div class="fb-sb">'+_esc(fbTitulo(c.posto||""))+' · '+canal(c)+'</div></div>'+fbTag(ef?"Falou com a pessoa":"Não conseguiu falar",ef?"tn-ok":"tn-gr")
      +(LIG_PODE_BAIXAR?'<span onclick="event.stopPropagation()"><button type="button" class="fb-ib" onclick="ligExcluir('+Number(c.id)+')" title="Excluir contato" aria-label="Excluir contato">'+fbI("trash")+'</button></span>':"")+'</div>'
      +'<div class="fb-pc-b">'+fbRegistro(c)+'<div class="fb-tags">'+(!ef?"":c.baixa?fbTag("Retirada da cobrança em "+fbDd(String(c.baixa.em||"").slice(0,10)),"tn-br"):fbTag("Na cobrança","tn-gr"))+'</div></div></article>';
  });
  h+='</div>';
  if(rows.length>150)h+='<p class="fb-nota">Mostrando os 150 registros mais recentes de '+rows.length+'. Use a busca ou os filtros.</p>';
  return h+'</div>';
}

/* ═════ registrar contato: duas escolhas ═════ */
function ligForm(id,pre){
  const c=id?LIG_C.find(x=>x.id===id):null;
  const p=pre||{},hj=ligHojeISO();
  const nomes=fbNomesConhecidos();
  const nome=c?c.colaborador:(p.colaborador||"");
  const reIni=c&&c.baixa?String(c.baixa.re||""):String(p.re||"");
  const temBaixa=!!(c&&c.baixa);
  const modo=c?(ligEfetivo(c)?"conversa":"tentativa"):"";
  const campo=(rot,corpo,dica,obrig)=>'<div class="fb-f"><label class="fb-l">'+rot+(obrig?' <i aria-hidden="true">*</i>':"")+'</label>'+corpo+(dica?'<span class="fb-hint">'+dica+'</span>':"")+'</div>';
  const canais=[["LIGAÇÃO","Ligação"],["WHATSAPP","WhatsApp"],["PESSOAL","Pessoalmente"]];
  const corpo=
    '<input type="hidden" id="lf-re" value="'+_esc(reIni)+'"><input type="hidden" id="lf-modo" value="'+modo+'"><input type="hidden" id="lf-posto" value="'+_esc(c?c.posto:(p.posto||""))+'"><input type="hidden" id="lf-sup" value="'+_esc(c?c.supervisor:(p.supervisor||""))+'"><input type="hidden" id="lf-dtfalta" value="'+_esc(c&&c.data_falta?String(c.data_falta).slice(0,10):(p.ultima||""))+'">'
    +'<fieldset class="fb-fs"><h4>Colaborador</h4><div class="fb-g c21">'
      +campo("Nome",'<input class="fb-in" id="lf-nome" list="lf-nomes" value="'+_esc(nome)+'" placeholder="Digite para buscar" oninput="ligAutofill()" maxlength="120" autocomplete="off"><datalist id="lf-nomes">'+nomes.map(n=>'<option value="'+_esc(n)+'">').join("")+'</datalist>',"",true)
      +campo("Celular",'<input class="fb-in" id="lf-tel" value="'+_esc(c?c.telefone:(p.telefone||ligTelefoneDe(nome)))+'" placeholder="(19) 99999-0000" maxlength="25" inputmode="tel">')
    +'</div></fieldset>'
    +'<fieldset class="fb-fs" id="lf-res-box"><h4>Como foi? <i aria-hidden="true">*</i></h4><div class="fb-decs">'
      +'<button type="button" class="fb-dec'+(modo==="conversa"?" on":"")+'" data-modo="conversa" onclick="ligModo(this)"><b>Falei com a pessoa</b><span>Ela ligou, ou conversamos pessoalmente.</span></button>'
      +'<button type="button" class="fb-dec'+(modo==="tentativa"?" on":"")+'" data-modo="tentativa" onclick="ligModo(this)"><b>Não consegui falar</b><span>Tentei e não deu. Conta como tentativa sem retorno.</span></button></div>'
      +'<div class="fb-g c2 so-res" style="margin-top:16px">'
        +campo("Data do contato",'<input class="fb-in" id="lf-data" type="date" value="'+(c&&c.data_contato?String(c.data_contato).slice(0,10):hj)+'" max="'+ligSomaDias(hj,1)+'">')
        +campo("Canal",'<select class="fb-sel" id="lf-canal">'+canais.map(o=>'<option value="'+o[0]+'"'+((c?c.canal:"LIGAÇÃO")===o[0]?" selected":"")+'>'+o[1]+'</option>').join("")+'</select>')
      +'</div></fieldset>'
    +'<fieldset class="fb-fs so-tentativa"><h4>Observação</h4><div class="fb-g">'+campo("Algo a registrar? (opcional)",'<textarea class="fb-ta" id="lf-obs" rows="2" maxlength="1000" placeholder="Ex.: o número deu caixa postal">'+_esc(c&&!ligEfetivo(c)?c.justificativa:"")+'</textarea>')+'</div></fieldset>'
    +'<fieldset class="fb-fs so-conversa"><h4>A conversa</h4>'
      +'<div class="fb-g">'+campo("O que a pessoa disse",'<textarea class="fb-ta" id="lf-just" rows="3" maxlength="1000" oninput="ligSugereMotivo()" placeholder="Resuma a justificativa em poucas palavras">'+_esc(c&&ligEfetivo(c)?c.justificativa:"")+'</textarea>')+'</div>'
      +'<div class="fb-g c21">'+campo("Motivo",'<div class="fb-chips" id="lf-motivos">'+fbChipsMotivo(c?c.motivo:"")+'</div>','',true)+campo("Duração (min)",'<input class="fb-in" id="lf-dur" type="number" min="1" max="240" step="1" inputmode="numeric" placeholder="Ex.: 8" value="'+(c&&c.duracao_min?Number(c.duracao_min):"")+'">','Quanto tempo durou a conversa',true)+'</div>'
      +'<div class="fb-g c21">'
        +campo("O que ficou combinado (opcional)",'<input class="fb-in" id="lf-acordo" value="'+_esc(c?c.acordo:"")+'" placeholder="Ex.: trará o atestado na segunda" maxlength="1000">')
        +campo("Prazo",'<input class="fb-in" id="lf-prazo" type="date" value="'+(c&&c.acordo_prazo?String(c.acordo_prazo).slice(0,10):"")+'">')
      +'</div></fieldset>'
    +'<fieldset class="fb-fs so-conversa"><h4>Painel de cobrança</h4>'
    +(LIG_PODE_BAIXAR
      ?'<label class="fb-switch'+((c?temBaixa:true)?" on":"")+'" id="lf-sw"><input type="checkbox" id="lf-baixa" '+((c?temBaixa:true)?"checked":"")+' onchange="document.getElementById(\'lf-sw\').classList.toggle(\'on\',this.checked)"><span class="fb-sw" aria-hidden="true"></span><span><strong>Retirar esta pessoa da cobrança</strong><span class="d">As faltas dela, de '+LIG_SAC_META+' dias antes a '+LIG_SAC_META+' dias depois do feedback, deixam de gerar alerta no painel de cobrança e passam a ser acompanhadas só aqui. Dá para desfazer.</span></span></label>'
      :'<div class="fb-note tn-'+(temBaixa?"br":"am")+'">'+fbI("info")+'<div>'+(temBaixa?'<b>Fora da cobrança.</b> A baixa foi dada por '+_esc(c.baixa.por||"")+'.':'<b>Só a coordenação retira a falta da cobrança.</b> O contato fica registrado e a falta continua no painel de cobrança até a coordenação confirmar.')+'</div></div>')
    +'</fieldset>';
  const ov=fbDialog("lig-modal",{titulo:c?"Editar feedback":"Registrar feedback",corpo,
    rodape:'<span class="msg" id="lf-msg" role="status"></span><button type="button" class="fb-btn" onclick="fbFechar(\'lig-modal\')">Cancelar</button><button type="button" class="fb-btn pri" id="lf-salvar" onclick="ligSalvar('+(c?Number(c.id):"null")+')">Salvar feedback</button>'});
  if(modo)ov.querySelector(".fb-dlg").classList.add("m-"+modo);
}
function ligModo(btn){
  const dlg=btn.closest(".fb-dlg"),m=btn.dataset.modo;
  dlg.querySelectorAll(".fb-dec").forEach(b=>b.classList.toggle("on",b===btn));
  document.getElementById("lf-modo").value=m;
  dlg.classList.remove("m-tentativa","m-conversa");dlg.classList.add("m-"+m);
  document.getElementById("lf-res-box").classList.remove("fb-erro");
  if(m==="tentativa"){const c=document.getElementById("lf-canal");if(c&&c.value==="LIGAÇÃO")c.value="WHATSAPP";}
}
function ligAutofill(){
  const nome=document.getElementById("lf-nome").value.trim();
  const p=LIG_P.find(x=>x.nome===nome)||fbPessoaPorNome(nome);
  if(p){
    document.getElementById("lf-posto").value=p.posto||"";document.getElementById("lf-sup").value=p.supervisor||"";document.getElementById("lf-re").value=String(p.re||"");
    if(p.ultima_falta)document.getElementById("lf-dtfalta").value=p.ultima_falta;
    const t=fbFone(p.telefone)||p.telefone||ligTelefoneDe(nome);if(t&&!document.getElementById("lf-tel").value)document.getElementById("lf-tel").value=t;
  }
}
/* motivos: os ativos (padrões e criados pelo SAC), o do contato mesmo que desativado, e o botão de criar um novo */
function fbChipsMotivo(atual){
  const nomes=LIG_MOT.filter(m=>m.ativo).map(m=>m.nome);
  if(atual&&nomes.indexOf(atual)<0){const m=LIG_MOT.find(x=>x.antigos&&x.antigos.indexOf(atual)>=0);nomes.push(m?m.nome:atual);}
  const at=atual?(LIG_MOT.find(x=>x.nome===atual||(x.antigos||[]).indexOf(atual)>=0)||{nome:atual}).nome:"";
  return nomes.map(n=>'<button type="button" class="fb-chipb'+(n===at?" on":"")+'" data-mot="'+_esc(n)+'" onclick="ligPickMotivo(this)">'+_esc(n)+'</button>').join("")
    +'<span class="fb-novo" id="lf-novo"><button type="button" class="fb-chipb add" onclick="ligNovoMotivo()">'+fbI("plus")+'Novo motivo</button></span>'
    +(LIG_MOT_EDITA?'<button type="button" class="fb-btn ghost sm" onclick="ligMotivosGerir()">'+fbI("edit")+'Editar motivos</button>':"");
}
function ligPickMotivo(btn){
  const ja=btn.classList.contains("on");
  document.querySelectorAll("#lf-motivos .fb-chipb").forEach(b=>b.classList.remove("on"));
  if(!ja)btn.classList.add("on");
}
function ligNovoMotivo(){
  const s=document.getElementById("lf-novo");if(!s)return;
  s.innerHTML='<input class="fb-in" id="lf-novo-in" maxlength="40" placeholder="Nome do motivo" onkeydown="if(event.key===\'Enter\'){event.preventDefault();ligNovoMotivoSalvar();}if(event.key===\'Escape\'){event.stopPropagation();ligNovoMotivoFecha();}"><button type="button" class="fb-btn pri sm" onclick="ligNovoMotivoSalvar()">Adicionar</button><button type="button" class="fb-ib" onclick="ligNovoMotivoFecha()" aria-label="Cancelar">'+fbI("x")+'</button>';
  s.classList.add("on");
  document.getElementById("lf-novo-in").focus();
}
function ligNovoMotivoFecha(){const s=document.getElementById("lf-novo");if(!s)return;s.classList.remove("on");s.innerHTML='<button type="button" class="fb-chipb add" onclick="ligNovoMotivo()">'+fbI("plus")+'Novo motivo</button>';}
function ligNovoMotivoSalvar(){
  const i=document.getElementById("lf-novo-in");if(!i)return;
  const nome=i.value.trim();
  if(nome.length<3){fbToast("O motivo precisa ter pelo menos 3 letras.","err");i.focus();return;}
  ligApi("/api/ligacoes?acao=motivo","POST",{nome}).then(j=>{
    LIG_MOT.push(Object.assign({antigos:[]},j.motivo));
    const box=document.getElementById("lf-motivos");if(box)box.innerHTML=fbChipsMotivo(j.motivo.nome);
    fbToast("Motivo criado. Ele aparece para todo o SAC.");
  }).catch(e=>fbToast(e.message||"Não consegui criar o motivo.","err"));
}
/* coordenação: renomear ou desativar motivos */
function ligMotivosGerir(){
  fbDialog("lig-mot-modal",{titulo:"Motivos de falta",tam:"md",semFoco:true,
    corpo:'<ul class="fb-motl">'+LIG_MOT.map((m,i)=>'<li class="'+(m.ativo?"":"off")+'"><input class="fb-in" id="lm-n-'+i+'" value="'+_esc(m.nome)+'" maxlength="40" aria-label="Nome do motivo"><label class="fb-ck2"><input type="checkbox" id="lm-a-'+i+'"'+(m.ativo?" checked":"")+'> Ativo</label><button type="button" class="fb-btn sm" onclick="ligMotivoSalvar('+i+')">Salvar</button></li>').join("")+'</ul><p class="fb-hint">Motivo desativado some do registro, mas continua nos contatos antigos e nos números.</p>',
    rodape:'<button type="button" class="fb-btn" onclick="fbFechar(\'lig-mot-modal\')">Fechar</button>'});
}
function ligMotivoSalvar(i){
  const m=LIG_MOT[i];if(!m)return;
  const nome=document.getElementById("lm-n-"+i).value.trim(),ativo=document.getElementById("lm-a-"+i).checked;
  ligApi("/api/ligacoes?acao=motivo","POST",{chave:m.chave,nome,ativo}).then(j=>{
    if(j.motivo.nome!==m.nome){m.antigos=(m.antigos||[]).concat(m.nome);m.nome=j.motivo.nome;}
    m.ativo=j.motivo.ativo;
    const li=document.getElementById("lm-n-"+i).closest("li");if(li)li.classList.toggle("off",!m.ativo);
    const box=document.getElementById("lf-motivos");if(box){const on=box.querySelector(".fb-chipb.on");box.innerHTML=fbChipsMotivo(on?on.dataset.mot:"");}
    fbToast("Motivo salvo.");
  }).catch(e=>fbToast(e.message||"Não consegui salvar.","err"));
}
function ligSugereMotivo(){
  const sug=ligMotivoSugerido(document.getElementById("lf-just").value);
  if(!sug||document.querySelector("#lf-motivos .fb-chipb.on"))return;
  const b=[...document.querySelectorAll("#lf-motivos .fb-chipb")].find(x=>x.dataset.mot===sug);if(b)b.classList.add("on");
}
function ligSalvar(id){
  const v=x=>{const e=document.getElementById(x);return e?e.value.trim():"";};
  const msg=document.getElementById("lf-msg"),btn=document.getElementById("lf-salvar");
  const erro=(t,foco)=>{msg.style.color="#d92d20";msg.textContent=t;if(foco){foco.classList.remove("fb-erro");void foco.offsetWidth;foco.classList.add("fb-erro");if(foco.focus)try{foco.focus({preventScroll:false});}catch(e){}}};
  const nome=v("lf-nome");
  if(!nome)return erro("Informe o colaborador.",document.getElementById("lf-nome"));
  const modo=v("lf-modo");
  if(!modo)return erro("Escolha como foi o contato.",document.getElementById("lf-res-box"));
  const c=id?LIG_C.find(x=>x.id===id):null;
  const body={colaborador:nome,telefone:v("lf-tel"),posto:v("lf-posto"),supervisor:v("lf-sup"),data_contato:v("lf-data")||null,canal:v("lf-canal"),re:v("lf-re")};
  if(modo==="conversa"){
    const mot=document.querySelector("#lf-motivos .fb-chipb.on:not(.add)");
    if(!mot)return erro("Escolha o motivo da falta.",document.getElementById("lf-motivos"));
    const dur=Number(v("lf-dur"));
    if(!v("lf-dur")||!Number.isInteger(dur)||dur<1||dur>240)return erro("Informe quanto tempo durou a conversa (1 a 240 minutos).",document.getElementById("lf-dur"));
    Object.assign(body,{data_falta:v("lf-dtfalta")||null,justificativa:v("lf-just"),motivo:mot.dataset.mot,acordo:v("lf-acordo"),duracao_min:dur});
    if(v("lf-prazo"))body.acordo_prazo=v("lf-prazo");
    if(c&&!ligEfetivo(c)){body.resultado="EXPLICOU";body.proxima="NENHUMA";} // era tentativa e virou conversa
    const cx=document.getElementById("lf-baixa");
    if(cx){const tinha=!!(c&&c.baixa);if(cx.checked&&!tinha)body.baixar=true;else if(!cx.checked&&tinha)body.baixar=false;}
  }else{
    body.justificativa=v("lf-obs");
    body.resultado="SEM_RESPOSTA";body.proxima="NENHUMA"; // não pede próxima ação: a fila já mostra o que falta
  }
  if(id)body.id=id;
  msg.style.color="var(--fb-muted)";msg.textContent="Salvando…";if(btn)btn.disabled=true; // duplo clique não cria dois contatos
  ligApi("/api/ligacoes",id?"PATCH":"POST",body)
    .then(j=>{
      fbFechar("lig-modal");
      if(j.baixa&&j.baixa.ok===false)fbToast("Contato salvo, mas não foi possível retirar da cobrança: "+(j.baixa.motivo||"motivo desconhecido"),"err");
      else if(j.baixa&&j.baixa.aviso)fbToast(j.baixa.aviso,"err");
      else fbToast(modo==="conversa"?"Contato salvo"+(body.baixar===true?". Pessoa retirada da cobrança.":"."):"Tentativa registrada.");
      ligLoad();
    })
    .catch(e=>{erro(e.message||"Não consegui salvar.");if(btn)btn.disabled=false;});
}

