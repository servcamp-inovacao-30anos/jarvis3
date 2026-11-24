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
let LIG_F={per:"hoje",de:"",ate:"",turno:"todos",area:"todas",tipo:"todos"},LIG_DES={modo:"folha",ini:"",fim:"",mot:""};
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
  if((o.lateral||o.tam==="pan")&&fbMov()){const pf=ov.querySelector(".fb-pf");if(pf)[...pf.children].slice(0,8).forEach((x,i)=>x.animate([{opacity:0,transform:"translate3d(24px,0,0)"},{opacity:1,transform:"none"}],{duration:560,delay:120+i*45,easing:FB_EASE,fill:"backwards"}));}
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
    fbDialog(id,{titulo:o.titulo,tam:"sm",tom:o.tom,corpo:'<p style="margin:0;font-size:.875rem;line-height:1.6;color:var(--fb-text2)">'+o.texto+'</p>',
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
  fbDialog("lig-qr-modal",{titulo:"Conectar o WhatsApp do SAC",tam:"qr",semFoco:true,
    corpo:'<div class="qr-w"><div class="qr-st"><h3>Como conectar</h3><ol class="fb-steps"><li><span>No celular do SAC, abra o <b>WhatsApp</b>.</span></li><li><span>Toque em <b>Aparelhos conectados</b> e depois em <b>Conectar um aparelho</b>.</span></li><li><span>Aponte a câmera para o QR code.</span></li></ol></div><div class="fb-qr" id="lq-corpo"><div class="fb-spin"></div><span class="fb-hint">Gerando o QR code…</span></div></div>',
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
   Resultado do monitoramento (o servidor decide: _lig_painel.antesDepois; a tela só lê o veredito), nesta ordem:
   Melhorou · Igual a antes · Continuou sem faltas · Piorou · Em observação. */
const FB_VD={
  /* seta pelo significado em todo o módulo: melhorou = para cima, piorou = para baixo, observação = relógio */
  melhorando:{t:"Melhorou",tom:"tn-ok",ic:"up",cic:"up",d:"Terminou os 30 dias com menos faltas do que nos 30 dias antes do feedback."},
  mesma:{t:"Igual a antes",tom:"tn-am",ic:"eq",cic:"eq",d:"Chegou ao mesmo número de faltas dos 30 dias antes do feedback."},
  sem_faltas:{t:"Continuou sem faltas",tom:"tn-gr",ic:"ok",cic:"ok",d:"Nenhuma falta nos 30 dias antes nem nos 30 dias depois do feedback."},
  piorou:{t:"Piorou",tom:"tn-da",ic:"down",cic:"down",d:"Passou do número de faltas dos 30 dias antes do feedback."},
  comecando:{t:"Em observação",tom:"tn-br",ic:"clock",cic:"clock",d:"Dentro dos 30 dias após o feedback e abaixo do número de faltas de antes."}
};
const FB_VD_ORDEM=Object.keys(FB_VD);
const FB_SIT=[
  {k:"mensagem",t:"Enviar mensagem",tom:"tn-br",d:"Faltaram sem justificar e ainda não receberam mensagem do SAC."},
  {k:"aguardando",t:"Aguardando ligação",tom:"tn-am",d:"Já receberam a mensagem. Falta a pessoa ligar para o SAC."},
  {k:"base",t:"Com a coordenação",tom:"tn-da",d:"Não ligaram depois de duas mensagens, ou faltaram de novo nos 30 dias depois do feedback. A coordenação decide."},
  {k:"pasta",t:"Pastas",tom:"tn-gr",d:"INSS, Abandono e Demitido: fora da cobrança do SAC. Dá para devolver à fila."},
  {k:"acomp",t:"Em acompanhamento",tom:"tn-ok",d:"Ligaram e a conversa foi registrada. Por 30 dias, as faltas são comparadas com as dos 30 dias antes do feedback."}
];
const FB_FILA=["mensagem","aguardando","base"];
const FB_FILA_TABS=FB_FILA.concat("pasta"); // "pasta": INSS, Abandono, Demitido (fora da cobrança)
const FB_FILA_IC={mensagem:"send",aguardando:"clock",base:"user",pasta:"folder"};
const FB_PASTAS={inss:"INSS",abandono:"Abandono",demitido:"Demitido"};
let LIG_PASTA="todas";
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
/* área = supervisor registrado no fato: no acompanhamento, o gravado no feedback; na fila, o das faltas */
function fbSupDe(p){return(p.situacao==="acomp"&&p.contato&&p.contato.supervisor)||p.supervisor;}
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
  // os botões podem mudar de largura/linha logo depois (contagens novas, quebra de linha): confere no quadro seguinte
  if(window.requestAnimationFrame)requestAnimationFrame(()=>{const q=fbPosOn(nav);if(q&&(q.x!==p.x||q.y!==p.y||q.w!==p.w))pos(q);});
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
  const P=LIG_P.filter(p=>fbSupOk(fbSupDe(p)));
  const n={monit:P.filter(p=>p.situacao==="acomp").length,hist:fbContatosFiltrados().length};
  document.querySelectorAll("#lig-root .fb-abas-t > button").forEach((b,i)=>{const a=FB_ABAS[i];if(!a||n[a.k]===undefined)return;const s=b.querySelector(".n");if(s){const de=Number(s.textContent)||0;s.textContent=String(n[a.k]);if(de!==n[a.k]){s.classList.remove("pulse");void s.offsetWidth;s.classList.add("pulse");}}});
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
  if(FB_FILA_TABS.indexOf(LIG_TAB)<0)LIG_TAB="mensagem";
  const hj=ligHojeISO();
  let h='<div class="fb" id="lig-root">';
  /* bloco do topo (referência 1): faixa azul-marinho com corte diagonal, filtros de turno e área, abas sublinhadas */
  h+='<section class="fb-topo"><header class="fb-band"><div class="fb-band-t"><svg class="fb-band-ic" viewBox="0 0 36 36" aria-hidden="true"><rect x="3" y="19" width="8" height="14" rx="2.5"/><rect x="14" y="11" width="8" height="22" rx="2.5"/><rect x="25" y="3" width="8" height="30" rx="2.5"/></svg>'
    +'<div><h1>Feedback de Faltas</h1><p>Grupo ServCamp - Hoje - '+_esc(rhFmt(hj))+'</p></div></div>@@FILTROS@@'+fbBandaDir()+'</header>';
  const sups=(LIG_IND&&LIG_IND.supervisores)||[...new Set(LIG_P.map(p=>p.supervisor).filter(Boolean))].sort();
  const selp=(id,campo,ops,val,cls)=>'<span class="fb-selp'+(cls?" "+cls:"")+'"><select id="'+id+'" onchange="ligFiltro(\''+campo+'\',this.value)">'+ops.map(o=>'<option value="'+_esc(o[0])+'"'+(val===o[0]?" selected":"")+'>'+_esc(o[1])+'</option>').join("")+'</select>'+fbI("chev")+'</span>';
  const filtros='<div class="fb-filtros">'
    +'<div class="fb-fg"><label class="fb-fl" for="lig-turno">Turno</label>'+selp("lig-turno","turno",[["todos","Todos"],["DIURNO","Diurno"],["NOTURNO","Noturno"]],LIG_F.turno)+'</div>'
    +'<div class="fb-fg"><label class="fb-fl" for="lig-area">Área</label>'+selp("lig-area","area",[["todas","Todas as Áreas"]].concat(sups.map(s=>[s,s])),LIG_F.area,"wide")+'</div></div>';
  h=h.replace("@@FILTROS@@",filtros);
  const P=LIG_P.filter(p=>fbSupOk(fbSupDe(p)));
  const n={visao:null,fila:null,monit:P.filter(p=>p.situacao==="acomp").length,desemp:null,hist:fbContatosFiltrados().length};
  h+='<nav class="fb-abas" aria-label="Seções"><div class="fb-dsub fb-abas-t" role="tablist" aria-label="Seções" data-ind="fundo">'+FB_ABAS.map(a=>'<button type="button" role="tab" class="'+(LIG_ABA===a.k?"on":"")+'" aria-selected="'+(LIG_ABA===a.k)+'" onclick="ligAba(\''+a.k+'\')">'+fbI(a.ic)+a.t+(n[a.k]!==null?'<span class="n">'+n[a.k]+'</span>':"")+'</button>').join("")+'</div>'
    +'<div class="fb-abas-a">'+blBotao()+'<div class="fb-bg"><label class="fb-search">'+fbI("search")+'<span class="fb-sr">Histórico do colaborador</span><input id="lig-bg" class="fb-in" type="search" placeholder="Histórico do colaborador" autocomplete="off" oninput="ligBuscaG(this.value)" onkeydown="ligBuscaGTecla(event)" onblur="setTimeout(ligBuscaGFecha,180)"></label><div class="fb-bg-r" id="lig-bg-r" role="listbox"></div></div>'
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
let LIG_VG="todas";
/* "todas" é o total; as quatro etapas dividem esse total sem repetir ninguém: a pessoa anda de card conforme o fluxo */
const FB_ETAPAS=[
  {k:"todas",t:"Todas as faltas",ic:"list",cls:"g-slate"},
  {k:"semmsg",t:"Sem mensagem",ic:"user",cls:"g-blue"},
  {k:"enviadas",t:"Mensagem enviada",ic:"chat",cls:"g-violet"},
  {k:"ligaram",t:"Feedback registrado",ic:"phone",cls:"g-green"},
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
  const hj=ligHojeISO(),pes=(LIG_IND&&LIG_IND.pessoas)||[],S=(LIG_IND&&LIG_IND.supervisores)||[],M=fbIdxFaltas(),gente=[],soAbo=[],tipo=o&&o.tipo!==undefined?o.tipo:LIG_F.tipo;let abon=0,abonR=0;
  Object.keys(M.falt).forEach(i=>{
    const p=pes[i];if(!p)return;
    /* efetivo × reserva técnica: cada falta diz de qual dos dois era (o 5º campo); área = supervisor da falta (o 6º) */
    const fs=M.falt[i].filter(x=>x[0]>=de&&x[0]<=ate&&fbSupOk(S[x[5]])&&(tipo==="todos"||!tipo||(tipo==="reserva")===(x[4]==="R")));
    abonR+=fs.filter(x=>x[2]==="A"&&x[4]==="R").length;
    abon+=fs.filter(x=>x[2]==="A").length;
    const sj=fs.filter(x=>x[2]!=="A"),abo=fs.filter(x=>x[2]==="A").map(x=>x[0]);
    if(!sj.length){if(abo.length){const u=fs[fs.length-1];soAbo.push({i:Number(i),key:String(p[0]||"")+"|"+(_ligNorm(p[1]).split(" ")[0]||""),re:String(p[0]||""),nome:p[1],posto:(LIG_IND.postos||[])[u[3]]||p[2],sup:S[u[5]]||p[3],res:u[4]==="R",nf:{E:0,R:0},faltas:[],abo,tratadas:0,envios:[],feedback:null,st:"abonada"});}return;}
    /* com feedback: falta nova nos 30 dias seguintes vai para a coordenação (não gera cobrança nova);
       falta depois desses 30 dias abre um ciclo novo (sem mensagem → mensagem enviada → …) */
    const datas=sj.map(x=>x[0]),fbs=(M.fb[i]||[]).filter(d=>d<=hj),ultFb=fbs.length?fbs[fbs.length-1]:null;
    const reinc=ultFb?datas.filter(d=>d>ultFb&&d<=ligSomaDias(ultFb,30)):[],novas=ultFb?datas.filter(d=>d>ligSomaDias(ultFb,30)):datas;
    let st="semmsg",env=[];
    if(reinc.length)st="coord";
    else if(!novas.length)st="ligou";
    else{
      env=(M.env[i]||[]).filter(d=>d>=novas[0]&&d<=hj);
      const ult=env.length?env[env.length-1]:null;
      if(ult)st=hj>ligSomaDias(ult,LIG_PRAZO||1)?"naoresp":"prazo";
    }
    const fb=st==="ligou"||st==="coord"?[ultFb]:[];
    const ultF=sj[sj.length-1],postoN=(LIG_IND.postos||[])[ultF[3]];
    gente.push({i:Number(i),key:String(p[0]||"")+"|"+(_ligNorm(p[1]).split(" ")[0]||""),re:String(p[0]||""),nome:p[1],posto:postoN||p[2],sup:S[ultF[5]]||p[3],res:ultF[4]==="R",nf:{E:sj.filter(x=>x[4]!=="R").length,R:sj.filter(x=>x[4]==="R").length},faltas:sj.map(x=>x[0]),abo,tratadas:sj.filter(x=>x[2]==="T").length,envios:env,feedback:fb.length?fb[fb.length-1]:null,st});
  });
  gente.sort((a,b)=>b.faltas.length-a.faltas.length||a.nome.localeCompare(b.nome));
  const de2=x=>gente.filter(x);
  soAbo.sort((a,b)=>b.abo.length-a.abo.length||a.nome.localeCompare(b.nome));
  const prazo=de2(g=>g.st==="prazo");
  return{gente,abon,abonR,soAbo,todas:gente.concat(soAbo),semmsg:de2(g=>g.st==="semmsg"),enviadas:prazo,prazo,ligaram:de2(g=>g.st==="ligou"),naoresp:de2(g=>g.st==="naoresp"||g.st==="coord"),coord:de2(g=>g.st==="coord")};
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
  /* número grande = pessoas; embaixo, a soma das faltas delas. tot = pessoas com falta sem justificativa (base da taxa) */
  const F=fbFunil(pe.de,pe.ate),tot=F.gente.length,nf=l=>fbPlural(l.reduce((t,g)=>t+g.faltas.length,0),"falta","faltas");
  const subs={todas:F.todas.length?nf(F.gente)+(F.abon?" · "+fbPlural(F.abon,"abonada","abonadas"):""):"nenhuma falta",
    semmsg:nf(F.semmsg),enviadas:nf(F.enviadas)+" · no prazo para ligar",ligaram:nf(F.ligaram),naoresp:nf(F.naoresp)+(F.coord.length?" · "+F.coord.length+" após feedback":"")};
  if(!FB_ETAPAS.some(e=>e.k===LIG_VG))LIG_VG="todas";
  h+='<div class="fb-funil" data-cards="funil">'+FB_ETAPAS.map((e,i)=>'<div class="fb-fcw">'
    +'<button type="button" class="fb-fc '+e.cls+(LIG_VG===e.k?" on":"")+'" aria-pressed="'+(LIG_VG===e.k)+'" onclick="ligVG(\''+e.k+'\')"><span class="top"><span class="ic">'+fbI(e.ic)+'</span><small>'+(i?i+' · ':"")+e.t+'</small></span>'
    +'<span class="mid"><b data-n="'+F[e.k].length+'">'+F[e.k].length+'</b></span><span class="sub">'+subs[e.k]+'</span></button>'
    +'<span class="fb-con" aria-hidden="true">'+fbI("go")+'</span></div>').join("");
  const cv=fbConversasEntre(pe.de,pe.ate),dur=cv.filter(c=>c[2]),med=dur.length?Math.round(dur.reduce((t,c)=>t+c[2],0)/dur.length):null;
  h+='<div class="fb-fcw"><div class="fb-fc g-amber info"><span class="top"><span class="ic">'+fbI("clock")+'</span><small>Tempo médio por feedback</small></span><span class="mid"><b'+(med===null?'>—':' data-n="'+med+'">'+med+'<em>min</em>')+'</b></span><span class="sub">'+(cv.length?fbPlural(cv.length,"conversa","conversas"):"nenhuma conversa")+'</span></div></div>'
    +'<div class="fb-fcw"><div class="fb-fc g-navy info" title="Pessoas que ligaram e tiveram o feedback registrado, sobre as pessoas que faltaram"><span class="top"><span class="ic">'+fbI("check")+'</span><small>Taxa de feedback</small></span><span class="mid"><b>'+(tot?Math.round(F.ligaram.length/tot*100)+'<em>%</em>':"—")+'</b></span><span class="sub">'+(tot?F.ligaram.length+" de "+fbPlural(tot,"pessoa","pessoas"):"ninguém faltou sem justificativa")+'</span></div></div></div>';
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
const FB_ST={abonada:["Falta abonada","tn-gr"],coord:["Faltou de novo após feedback","tn-da"],semmsg:["Sem mensagem","tn-br"],prazo:["Aguardando ligação","tn-am"],naoresp:["Não respondeu","tn-da"],ligou:["Feedback registrado","tn-ok"]};
function fbCardV(g,i){
  const s=FB_ST[g.st],nome=_esc(g.nome);
  let linha=g.faltas.length?'<p class="fb-pc-l"><b>'+fbPlural(g.faltas.length,"falta","faltas")+'</b> em '+fbDatas(g.faltas)+'</p>':'<p class="fb-pc-l"><b>'+fbPlural((g.abo||[]).length,"abonada","abonadas")+'</b> em '+fbDatas(g.abo||[])+'</p>';
  /* todos os cards com a mesma estrutura: etiqueta da situação (com a data, quando houver) e uma linha com as faltas */
  const ue=g.envios.length?fbDd(g.envios[g.envios.length-1]):"";
  const rot={prazo:ue?"Mensagem em "+ue:s[0],ligou:"Feedback em "+fbDd(g.feedback),coord:"Faltou após feedback de "+fbDd(g.feedback)}[g.st]||s[0];
  const pa=fbPastaDe(g);
  const acoes=g.st==="ligou"||g.st==="coord"||g.st==="abonada"||pa?fbBtn("Ver panorama","ligVGAbrir("+i+")","sm","eye"):fbBtn("Enviar WhatsApp","ligVGEnviar("+i+")","pri sm","chat")+fbBtn("Registrar feedback","ligVGRegistrar("+i+")","sm","phone");
  const ck=fbSelecionavel(g)?'<label class="fb-ck" onclick="event.stopPropagation()" title="Selecionar para o envio em massa"><input type="checkbox" onchange="ligSelVG('+i+',this)"'+(LIG_SEL.has(g.key)?" checked":"")+' aria-label="Selecionar '+nome+'"><span></span></label>':"";
  return'<article class="fb-pc '+s[1]+(LIG_SEL.has(g.key)?" sel":"")+'" style="--i:'+Math.min(i,12)+'" tabindex="0" role="button" aria-label="Abrir o panorama de '+nome+'" onclick="ligVGAbrir('+i+')" onkeydown="if(event.key===\'Enter\'&&event.target===this)ligVGAbrir('+i+')" data-lb="'+_esc(_ligNorm(g.nome))+'" data-re="'+_esc(g.re)+'">'
    +fbCabCard({nome:g.nome,re:g.re,posto:g.posto},s[1],"",ck)
    +'<div class="fb-pc-b"><div class="fb-pc-c">'+fbTag(rot,s[1])+(g.faltas.length?fbAboTag(g.abo):"")+fbTag(g.res?"Reserva técnica":"Efetivo",g.res?"tn-vi":"tn-gr")+'</div>'+linha+'</div><div class="fb-pc-a" onclick="event.stopPropagation()">'+acoes+'</div></article>';
}
/* envio em massa da Visão geral: quem ainda não recebeu mensagem ou não respondeu */
/* quem está numa pasta (INSS, Abandono, Demitido) não recebe cobrança */
function fbPastaDe(g){const p=g&&LIG_P.find(x=>x.key===g.key);return p&&p.situacao==="pasta"?p.pasta:"";}
function fbSelecionavel(g){return g&&(g.st==="semmsg"||g.st==="naoresp")&&!fbPastaDe(g);}
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
  const nav=document.querySelector("#lig-root .fb-abas-t"),ant=fbPosOn(nav);
  document.querySelectorAll("#lig-root .fb-abas-t > button").forEach((b,i)=>{if(!FB_ABAS[i])return;const on=FB_ABAS[i].k===a;b.classList.toggle("on",on);b.setAttribute("aria-selected",on);});
  fbIndica(nav,ant);
  ligPanel();
}
function ligTab(t){
  if(t==="hist"){ligAba("hist");return;}
  if(t==="acomp"){ligAba("monit");return;}
  if(FB_FILA_TABS.indexOf(t)<0)t="mensagem";
  if(t!==LIG_TAB){LIG_LIM=24;LIG_SEL=new Set();LIG_DX=FB_FILA_TABS.indexOf(t)>FB_FILA_TABS.indexOf(LIG_TAB)?20:-20;}
  LIG_TAB=t;try{localStorage.setItem("fbTab2",t);}catch(e){}
  if(LIG_ABA!=="fila"){ligAba("fila");return;}
  ligPanel();
}
function ligVF(v){const o=["todos"].concat(FB_VD_ORDEM);LIG_DX=o.indexOf(v)>o.indexOf(LIG_VF)?20:o.indexOf(v)<o.indexOf(LIG_VF)?-20:0;LIG_VF=v;LIG_LIM=24;ligPanel();}
function ligMais(){LIG_LIM+=24;ligPanel();}
/* período da fila: as faltas pendentes são dos últimos 30 dias; Hoje, Semana ou datas escolhidas dentro deles */
function fbFilaPer(){
  const hj=ligHojeISO(),f=LIG_F.fper||"todas";
  if(f==="hoje")return{k:f,de:hj,ate:hj};
  if(f==="semana")return{k:f,de:ligSomaDias(hj,-fbDow2(hj)),ate:hj};
  if(f==="periodo"&&LIG_F.fde&&LIG_F.fate){const a=LIG_F.fde<=LIG_F.fate;return{k:f,de:a?LIG_F.fde:LIG_F.fate,ate:a?LIG_F.fate:LIG_F.fde};}
  return{k:"todas",de:ligSomaDias(hj,-30),ate:hj};
}
/* com feedback e falta nova nos 30 dias seguintes: não gera cobrança nova, a coordenação decide */
function fbReinc(p){return p.situacao==="acomp"&&!!(p.acomp&&p.acomp.faltas_depois&&p.acomp.faltas_depois.length);}
function fbSitFila(p){return fbReinc(p)?"base":p.situacao;}
function fbFilaNoPer(p,fp){return fp.k==="todas"||(p.faltas||(p.acomp&&p.acomp.faltas_depois)||[]).some(d=>d>=fp.de&&d<=fp.ate);}
function fbFilaTopo(fp){
  const hj=ligHojeISO(),min=ligSomaDias(hj,-30),c=fbFaltasEntre(fp.de,fp.ate),rot=fp.de===fp.ate?fbDd(fp.de):fbDd(fp.de)+" a "+fbDd(fp.ate);
  const op=[["todas","Últimos 30 dias"],["hoje","Hoje"],["semana","Semana"],["periodo","Período"]];
  return'<div data-sync="filaper"><div class="fb-fper"><div class="fb-pills" role="group" aria-label="Período das faltas">'+op.map(o=>'<button type="button" class="'+(fp.k===o[0]?"on":"")+'" aria-pressed="'+(fp.k===o[0])+'" onclick="ligFilaPer(\''+o[0]+'\')">'+o[1]+'</button>').join("")+'</div>'
    +(LIG_F.fper==="periodo"?'<span class="fb-datas"><input class="fb-in" type="date" aria-label="De" value="'+_esc(LIG_F.fde)+'" min="'+min+'" max="'+hj+'" onchange="ligFilaData(\'fde\',this.value)"><span>a</span><input class="fb-in" type="date" aria-label="Até" value="'+_esc(LIG_F.fate)+'" min="'+min+'" max="'+hj+'" onchange="ligFilaData(\'fate\',this.value)"></span>':"")
    +'<span class="fb-vg-per">'+rot+'</span></div>'
    +'<div class="fb-dcs c3 fb-fcards">'
    +fbDc("tn-br","Faltas no período",fbN(c.sj+c.ab),rot,"")
    +fbDc("tn-da","Sem justificativa",fbN(c.sj),"entram na cobrança do SAC","")
    +fbDc("tn-gr","Abonadas",fbN(c.ab),"atestado, licença ou afastamento","")+'</div></div>'; // data-sync: a troca parcial da tela também atualiza a barra e os cards
}
function ligFilaPer(v){LIG_F.fper=v;if(v==="periodo"&&!LIG_F.fde){LIG_F.fate=ligHojeISO();LIG_F.fde=ligSomaDias(LIG_F.fate,-6);}LIG_LIM=24;LIG_SEL=new Set();ligPanel();}
function ligFilaData(k,v){LIG_F[k]=v;LIG_LIM=24;ligPanel();}
function ligPastaVer(k){LIG_PASTA=k;LIG_LIM=24;ligPanel();}
function fbPastaPost(pessoas,pasta){return ligApi("/api/ligacoes?acao=pasta","POST",{pessoas:pessoas.map(p=>({key:p.key,re:p.re||"",nome:p.nome})),pasta});}
function ligPastaMover(k){
  if(!FB_PASTAS[k])return;
  const gente=[...LIG_SEL].map(x=>LIG_P.find(p=>p.key===x)).filter(Boolean);if(!gente.length)return;
  const um=gente.length===1,n=um?"<b>"+_esc(gente[0].nome)+"</b>":"<b>"+gente.length+" pessoas</b>";
  fbConfirm({titulo:"Mover para a pasta "+FB_PASTAS[k]+"?",ok:"Mover para "+FB_PASTAS[k],texto:n+(um?" sai":" saem")+" da fila do SAC e não "+(um?"recebe":"recebem")+" mais cobrança das faltas. Dá para devolver à fila depois, na aba Pastas."})
    .then(ok=>{if(ok)fbPastaPost(gente,k).then(()=>{fbToast(um?"Pessoa movida para "+FB_PASTAS[k]+".":gente.length+" pessoas movidas para "+FB_PASTAS[k]+".");LIG_SEL=new Set();ligLoad();}).catch(e=>fbToast(e.message||"Não consegui mover.","err"));});
}
/* escolher a pasta: a partir do card (ligPastaEscolher) ou procurando a pessoa (ligPastaNova) */
let LIG_PASTA_ALVO=[];
function fbPastaOps(){return'<div class="fb-pasta-ops">'+Object.keys(FB_PASTAS).map(k=>'<button type="button" class="fb-btn" onclick="ligPastaFazer(\''+k+'\')">'+fbI("folder")+FB_PASTAS[k]+'</button>').join("")+'</div>';}
function ligPastaEscolher(i){
  const p=LIG_VIEW[i];if(!p)return;LIG_PASTA_ALVO=[p];
  fbDialog("lig-pasta-modal",{titulo:"Mover para uma pasta",tam:"sm",
    corpo:'<p class="fb-pasta-q"><b>'+_esc(p.nome)+'</b>'+(p.re?' · RE '+_esc(p.re):"")+'<br>sai da fila do SAC e não recebe mais cobrança das faltas. Dá para devolver depois, na aba Pastas.</p>'+fbPastaOps(),
    rodape:'<button type="button" class="fb-btn" onclick="fbFechar(\'lig-pasta-modal\')">Cancelar</button>'});
}
function fbPastaCands(){
  const m=new Map(),naPasta=new Set(LIG_P.filter(p=>p.situacao==="pasta").map(p=>p.key));
  LIG_P.forEach(p=>{if(!naPasta.has(p.key))m.set(p.key,{key:p.key,re:String(p.re||""),nome:p.nome,posto:p.posto||""});});
  ((LIG_IND&&LIG_IND.pessoas)||[]).forEach(x=>{const k=String(x[0]||"")+"|"+(_ligNorm(x[1]).split(" ")[0]||"");if(x[1]&&!m.has(k)&&!naPasta.has(k))m.set(k,{key:k,re:String(x[0]||""),nome:x[1],posto:x[2]||""});});
  return[...m.values()];
}
function ligPastaNova(){
  LIG_PASTA_ALVO=[];
  fbDialog("lig-pasta-modal",{titulo:"Colocar pessoa numa pasta",tam:"sm",
    corpo:'<label class="fb-l" for="lpn-q">Nome ou RE</label><input id="lpn-q" class="fb-in" type="search" autocomplete="off" placeholder="Digite o nome ou o RE" oninput="ligPastaBusca(this.value)"><ul class="fb-pasta-res" id="lpn-r"></ul><div id="lpn-esc"></div>',
    rodape:'<button type="button" class="fb-btn" onclick="fbFechar(\'lig-pasta-modal\')">Cancelar</button>'});
  const q=document.getElementById("lpn-q");if(q&&q.focus)q.focus();
}
let LIG_PASTA_RES=[];
function ligPastaBusca(v){
  const q=_ligNorm(v),qd=String(v||"").replace(/\D/g,"").replace(/^0+/,""),ul=document.getElementById("lpn-r");if(!ul)return;
  LIG_PASTA_RES=q.length<2&&!qd?[]:fbPastaCands().filter(c=>(q.length>=2&&_ligNorm(c.nome).indexOf(q)>=0)||(qd&&c.re.replace(/^0+/,"").indexOf(qd)===0)).slice(0,8);
  ul.innerHTML=LIG_PASTA_RES.map((c,i)=>'<li><button type="button" onclick="ligPastaPega('+i+')"><b>'+_esc(c.nome)+'</b><span>'+(c.re?"RE "+_esc(c.re):"")+(c.re&&c.posto?" · ":"")+_esc(fbTitulo(c.posto))+'</span></button></li>').join("")
    +(q.length>=2||qd?(LIG_PASTA_RES.length?"":'<li class="vz">Ninguém encontrado com faltas no sistema.</li>'):"");
}
function ligPastaPega(i){
  const c=LIG_PASTA_RES[i];if(!c)return;LIG_PASTA_ALVO=[c];
  const e=document.getElementById("lpn-esc");if(e)e.innerHTML='<p class="fb-pasta-q">Mover <b>'+_esc(c.nome)+'</b>'+(c.re?' · RE '+_esc(c.re):"")+' para:</p>'+fbPastaOps();
  document.querySelectorAll("#lpn-r button").forEach((b,k)=>b.classList.toggle("on",k===i));
}
function ligPastaFazer(k){
  const g=LIG_PASTA_ALVO;if(!g.length||!FB_PASTAS[k])return;
  fbPastaPost(g,k).then(()=>{fbFechar("lig-pasta-modal");fbToast(g[0].nome+" movido para "+FB_PASTAS[k]+".");LIG_SEL.delete(g[0].key);ligLoad();}).catch(e=>fbToast(e.message||"Não consegui mover.","err"));
}
function ligPastaDevolver(i){
  const p=LIG_VIEW[i];if(!p)return;
  fbConfirm({titulo:"Devolver à fila do SAC?",ok:"Devolver à fila",texto:"<b>"+_esc(p.nome)+"</b> sai da pasta "+(FB_PASTAS[p.pasta]||"")+" e as faltas sem justificativa voltam a ser cobradas."})
    .then(ok=>{if(ok)fbPastaPost([p],null).then(()=>{fbToast("Pessoa devolvida à fila.");ligLoad();}).catch(e=>fbToast(e.message||"Não consegui devolver.","err"));});
}
function fbBusca(){return'<label class="fb-search">'+fbI("search")+'<span class="fb-sr">Buscar por nome ou RE</span><input id="lig-busca-p" class="fb-in" type="search" placeholder="Buscar por nome ou RE" autocomplete="off" value="'+_esc(LIG_BUSCA_P)+'" oninput="ligFiltraPend(this.value)"></label><span id="lig-busca-n" class="fb-count"></span>';}
function ligPanel(){
  const box=document.getElementById("lig-panel");if(!box)return;
  if(LIG_ABA==="hist"){LIG_VIEW=[];LIG_TRUNC=false;fbMostra(box,'<div class="fb-panel">'+fbPnlHist()+'</div>');return;}
  if(LIG_ABA==="desemp"){LIG_VIEW=[];LIG_TRUNC=false;fbMostra(box,'<div class="fb-panel">'+fbPnlDes()+'</div>');return;}
  if(LIG_ABA==="visao"){LIG_VIEW=[];fbMostra(box,'<div class="fb-panel">'+fbPnlVisao()+'</div>');return;}
  const P=LIG_P.filter(p=>fbSupOk(fbSupDe(p)));
  let h='<div class="fb-panel">',lista,total;
  if(LIG_ABA==="monit"){
    const ac=P.filter(p=>p.situacao==="acomp"),V={};
    ac.forEach(p=>{V[p.acomp.veredito]=(V[p.acomp.veredito]||0)+1;});
    const op=[["todos","Todos",ac.length]].concat(FB_VD_ORDEM.map(k=>[k,FB_VD[k].t,V[k]||0]));
    h+='<div class="fb-sub"><div class="fb-dsub" role="tablist" aria-label="Resultado do monitoramento" data-nav="sub" data-ind="fundo">'+op.map(o=>'<button type="button" role="tab" class="'+(LIG_VF===o[0]?"on":"")+'" aria-selected="'+(LIG_VF===o[0])+'" title="'+_esc(o[0]==="todos"?"Todas as pessoas em acompanhamento":FB_VD[o[0]].d)+'" onclick="ligVF(\''+o[0]+'\')">'+fbI(o[0]==="todos"?"list":FB_VD[o[0]].ic)+o[1]+'<span class="n">'+o[2]+'</span></button>').join("")+'</div><div class="fb-sub-a" data-sync="suba">'+fbBusca()+'</div></div>';
    total=ac.length;lista=LIG_VF==="todos"?ac:ac.filter(p=>p.acomp.veredito===LIG_VF);
  }else{
    const fp=fbFilaPer(),Pp=P.filter(p=>p.situacao==="pasta"||fbFilaNoPer(p,fp));
    const cont={};FB_FILA_TABS.forEach(k=>{cont[k]=Pp.filter(p=>fbSitFila(p)===k).length;});
    h+=fbFilaTopo(fp);
    h+='<div class="fb-sub"><div class="fb-dsub" role="tablist" aria-label="Fila do SAC" data-nav="sub" data-ind="fundo">'+FB_FILA_TABS.map(k=>{const s=FB_SIT.find(x=>x.k===k);return'<button type="button" role="tab" class="'+(LIG_TAB===k?"on":"")+'" aria-selected="'+(LIG_TAB===k)+'" title="'+_esc(s.d)+'" onclick="ligTab(\''+k+'\')">'+fbI(FB_FILA_IC[k]||"list")+s.t+'<span class="n">'+cont[k]+'</span></button>';}).join("")+'</div>'
      +'<div class="fb-sub-a" data-sync="suba">'+fbBusca()+(LIG_TAB==="mensagem"&&cont.mensagem?'<button type="button" class="fb-btn sm" onclick="ligSelTodos()">Selecionar '+Math.min(LIG_LOTE_MAX,cont.mensagem)+(cont.mensagem>LIG_LOTE_MAX?" primeiras":(cont.mensagem===1?" pessoa":" pessoas"))+'</button>':"")+'</div></div>';
    h+='<div id="lig-lista">';
    if(LIG_TAB==="pasta"){
      const np=k=>Pp.filter(p=>p.situacao==="pasta"&&(k==="todas"||p.pasta===k)).length;
      h+='<div class="fb-pills fb-pastas" role="group" aria-label="Pasta">'+[["todas","Todas"]].concat(Object.keys(FB_PASTAS).map(k=>[k,FB_PASTAS[k]])).map(o=>'<button type="button" class="'+(LIG_PASTA===o[0]?"on":"")+'" aria-pressed="'+(LIG_PASTA===o[0])+'" onclick="ligPastaVer(\''+o[0]+'\')">'+o[1]+'<span class="n">'+np(o[0])+'</span></button>').join("")+'</div>'
        +(LIG_PODE_BAIXAR?fbBtn("Colocar pessoa numa pasta","ligPastaNova()","pri sm fb-pasta-nova","plus"):"");
    }else h+='<div id="lig-lote">'+fbBarraLote()+'</div>';
    lista=Pp.filter(p=>fbSitFila(p)===LIG_TAB&&(LIG_TAB!=="pasta"||LIG_PASTA==="todas"||p.pasta===LIG_PASTA));total=lista.length;
  }
  if(LIG_ABA==="monit")h+='<div id="lig-lista">';
  LIG_VIEW=lista;
  LIG_TRUNC=lista.length>LIG_LIM;
  const vis=LIG_BUSCA_P?lista:lista.slice(0,LIG_LIM);
  h+='<div id="lig-vazio-busca" style="display:none">'+fbVazio()+'</div>';
  if(!lista.length)h+=fbVazio();
  else h+='<div class="fb-cards'+(LIG_ABA==="monit"?" m":"")+'">'+vis.map((p,i)=>LIG_ABA==="monit"?fbCardM(p,i):p.situacao==="pasta"?fbCardPasta(p,i):fbCard(p,i)).join("")+'</div>'
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
  else if(c==="I"||c==="T"){k="f";t="Falta sem justificar";}
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
/* abonadas dos últimos 30 dias (a fila só cobra as sem justificativa; as abonadas aparecem separadas) */
function fbAboRecentes(p){const de=ligSomaDias(ligHojeISO(),-30);return(p.hist||[]).filter(h=>FB_ABONADAS.indexOf(h[1])>=0&&h[0]>=de).map(h=>h[0]);}
function fbAboTag(ab){return ab&&ab.length?fbTag(ab.length+(ab.length===1?" abonada":" abonadas"),"tn-gr").replace('<span ','<span title="Abonada em '+fbDatas(ab)+'" '):"";}
function fbFaltasCard(p){return p.faltas&&p.faltas.length?'<p class="fb-pc-l"><b>Faltou</b> em '+fbDatas(p.faltas)+'</p>':"";}
function fbCard(p,i){
  let pill="",corpo="",acoes="",tom="tn-br";
  const nome=_esc(p.nome),pl=(n,a,b)=>n+" "+(n===1?a:b),abo=fbAboTag(fbAboRecentes(p));
  if(p.situacao==="mensagem"){
    tom=p.tentativas>0?"tn-am":"tn-br";
    pill=fbTag(p.tentativas>0?"1 mensagem sem resposta":pl(p.faltas.length,"falta","faltas"),tom)+abo;
    corpo=fbFaltasCard(p)
      +(p.tentativas>0?'<p class="fb-pc-l fb-mut">Última mensagem'+(p.ultima_tentativa?' em '+fbDd(p.ultima_tentativa):"")+'. A pessoa não ligou.</p>':"");
    acoes=fbBtn("Enviar WhatsApp","ligEnviarI("+i+")","pri sm","chat")+fbBtn("Registrar feedback","ligRegistrarI("+i+")","sm","phone");
  }else if(p.situacao==="aguardando"){
    const sem=p.envio==="sem_retorno",man=p.ultima_marca_manual;
    tom=sem?"tn-am":"tn-br";
    pill=fbTag(sem?"Não ligou":"Aguardando ligação",tom)+abo;
    corpo=(man
      ?'<p class="fb-pc-l"><b>Tentativa registrada</b> '+fbDias(p.ultima_marca)+' ('+fbDd(p.ultima_marca)+'). Não houve conversa.</p>'
      :'<p class="fb-pc-l"><b>Mensagem enviada</b> '+fbDias(p.ultima_marca)+' ('+fbDd(p.ultima_marca)+')</p>');
    corpo+='<p class="fb-pc-l fb-mut">'+(sem?"Se faltar de novo e não responder, vai para a coordenação.":"A pessoa tem até "+fbDd(p.prazo_ate||p.ultima_marca)+" para ligar.")+'</p>';
    acoes=fbBtn("Registrar feedback","ligRegistrarI("+i+")","pri sm","phone")+fbBtn("Enviar WhatsApp","ligEnviarI("+i+")","sm","chat");
  }else if(p.situacao==="acomp"){
    tom="tn-da";
    pill=fbTag("Faltou de novo após feedback","tn-da")+abo;
    corpo='<p class="fb-pc-l"><b>Faltou</b> em '+fbDatas(p.acomp.faltas_depois)+'</p><p class="fb-pc-l fb-mut">Feedback em '+fbDd(p.contato&&p.contato.data)+'. Cabe à coordenação decidir.</p>';
    acoes=(LIG_PODE_BAIXAR?fbBtn("Registrar feedback","ligRegistrarI("+i+")","pri sm","phone"):"")+fbBtn("Resumo","ligResumoI("+i+")","sm","doc");
  }else{
    tom="tn-da";
    pill=fbTag(p.tentativas+" mensagens sem resposta","tn-da")+abo;
    corpo=fbFaltasCard(p);
    // com a coordenação: quem registra a conversa é a coordenação (Raphael, Jussilene, João); todos veem o resumo
    acoes=(LIG_PODE_BAIXAR?fbBtn("Registrar feedback","ligRegistrarI("+i+")","pri sm","phone"):"")+fbBtn("Enviar WhatsApp","ligEnviarI("+i+")","sm","chat")+fbBtn("Resumo","ligResumoI("+i+")","sm","doc");
  }
  const pb=LIG_PODE_BAIXAR?'<button type="button" class="fb-pasta-b" title="Mover para uma pasta (INSS, Abandono, Demitido)" aria-label="Mover '+nome+' para uma pasta" onclick="event.stopPropagation();ligPastaEscolher('+i+')">'+fbI("folder")+'</button>':"";
  const ck=pb+(p.situacao==="mensagem"||LIG_PODE_BAIXAR?'<label class="fb-ck" onclick="event.stopPropagation()" title="Selecionar"><input type="checkbox" onchange="ligSel('+i+',this)"'+(LIG_SEL.has(p.key)?" checked":"")+' aria-label="Selecionar '+nome+'"><span></span></label>':"");
  return'<article class="fb-pc '+tom+(LIG_SEL.has(p.key)?" sel":"")+'" style="--i:'+Math.min(i,12)+'" tabindex="0" role="button" aria-label="Abrir o panorama de '+nome+'" onclick="ligAbrir('+i+')" onkeydown="if(event.key===\'Enter\'&&event.target===this)ligAbrir('+i+')" data-lb="'+_esc(_ligNorm(p.nome))+'" data-re="'+_esc(String(p.re||""))+'">'
    +fbCabCard(p,tom,"",ck)
    +'<div class="fb-pc-b"><div class="fb-pc-c">'+pill+'</div>'+corpo+'</div><div class="fb-pc-a" onclick="event.stopPropagation()">'+acoes+'</div></article>';
}
function fbCardPasta(p,i){
  const nome=_esc(p.nome);
  return'<article class="fb-pc tn-gr" style="--i:'+Math.min(i,12)+'" tabindex="0" role="button" aria-label="Abrir o panorama de '+nome+'" onclick="ligAbrir('+i+')" onkeydown="if(event.key===\'Enter\'&&event.target===this)ligAbrir('+i+')" data-lb="'+_esc(_ligNorm(p.nome))+'" data-re="'+_esc(String(p.re||""))+'">'
    +fbCabCard(p,"tn-gr","")
    +'<div class="fb-pc-b"><div class="fb-pc-c">'+fbTag("Pasta "+(FB_PASTAS[p.pasta]||p.pasta),"tn-vi")+'</div>'
    +'<p class="fb-pc-l"><b>Fora da cobrança</b> desde '+(p.pasta_em?fbDd(String(p.pasta_em).slice(0,10)):"—")+(p.pasta_auto?' · automático':p.pasta_por?' · por '+_esc(p.pasta_por):"")+'</p>'+(p.pasta_auto&&p.pasta_motivo?'<p class="fb-pc-l fb-mut">'+_esc(p.pasta_motivo)+'</p>':"")+fbFaltasCard(p)+'</div>'
    +(LIG_PODE_BAIXAR?'<div class="fb-pc-a" onclick="event.stopPropagation()">'+fbBtn("Devolver à fila","ligPastaDevolver("+i+")","sm","undo")+'</div>':"")+'</article>';
}
/* Monitoramento: o que decide numa olhada. Resultado (selo), faltas antes → depois, quantos dos 30 dias já passaram, motivo e combinado.
   Datas, mensagens e o registro completo ficam no panorama (clique no card). */
function fbCardM(p,i){
  const a=p.acomp,v=FB_VD[a.veredito]||FB_VD.mesma,c=p.contato||{},nome=_esc(p.nome);
  const dia=Math.min(30,Math.max(0,a.dia)),reg=LIG_C.find(x=>x.id===c.id)||null;
  const mot=reg&&reg.motivo?fbMotNome(reg.motivo):"",diz=reg&&reg.justificativa?String(reg.justificativa):"";
  const extras=[];
  if(c.acordo_auto&&FB_ACOR[c.acordo_auto])extras.push(fbTag(FB_ACOR[c.acordo_auto][0],FB_ACOR[c.acordo_auto][1]));
  if(a.sem_baixa)extras.push(fbTag("Aguardando baixa da coordenação","tn-am"));
  const falta=n=>n===1?"falta":"faltas";
  return'<article class="fb-pc fb-pm '+v.tom+'" style="--i:'+Math.min(i,12)+'" tabindex="0" role="button" aria-label="Abrir o panorama de '+nome+'" onclick="ligAbrir('+i+')" onkeydown="if(event.key===\'Enter\'&&event.target===this)ligAbrir('+i+')" data-lb="'+_esc(_ligNorm(p.nome))+'" data-re="'+_esc(String(p.re||""))+'">'
    +fbCabCard(p,v.tom,'<span class="fb-vp">'+fbI(v.ic)+_esc(v.t)+'</span>')
    +'<div class="fb-pm-b"><div class="fb-pm-n" title="Faltas sem justificativa: 30 dias antes do feedback → depois dele"><b>'+a.antes+'</b><i aria-hidden="true">→</i><b class="d">'+a.depois+'</b><span>faltas antes → depois</span></div>'
    +'<div class="fb-pm-pg"><div class="fb-pm-prog" role="progressbar" aria-valuemin="0" aria-valuemax="30" aria-valuenow="'+dia+'" title="Acompanhamento de 30 dias"><i style="width:'+Math.round(dia/30*100)+'%"></i></div>'
    +'<span class="fb-pm-d">'+(dia>=30?"Concluído":dia>0?"Dia "+dia+" de 30":"Feedback hoje")+'</span></div></div>'
    +(mot||diz||extras.length?'<div class="fb-pm-m">'+(mot||diz?'<p>'+(mot?'<b>'+_esc(mot)+'</b>':"")+(diz?'<span>'+(mot?" · ":"")+"“"+_esc(diz)+"”"+'</span>':"")+'</p>':"")+extras.join("")+'</div>':"")+'</article>';
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
    .then(j=>{if(j&&j.pessoa){j.pessoa._completo=1;ligPanorama(j.pessoa);}})
    .catch(e=>fbToast(e.message||"Não consegui abrir o histórico.","err"));
}

/* ═════ aba Desempenho: painel de diretoria ═════
   Cinco sub-abas: Resumo executivo · Efeito do feedback · Empresa e áreas · Postos e reserva · Motivos e atendimento.
   Só meses fechados nas comparações; % só com base de 20 ou mais; o mês em andamento aparece à parte, como estimativa. */
/* mês fechado (regra do Raphael): a planilha sobe de segunda a sexta (sábado e domingo entram na de segunda).
   O período que termina em "fim" está fechado quando já chegou uma planilha com data depois de "fim" (a data da última
   planilha é a mesma do "Última planilha" do painel geral). Sem essa data: a partir do 1º dia útil depois de "fim". */
function fbMesFechado(fim){
  let pl="";
  try{const m=typeof _uploadInfo==="function"?_uploadInfo():null;if(m&&m.ts)pl=new Date(Number(m.ts)-3*3600000).toISOString().slice(0,10);}catch(e){}
  if(pl)return pl>fim;
  let d=ligSomaDias(fim,1);
  while([0,6].indexOf(new Date(d+"T12:00:00Z").getUTCDay())>=0)d=ligSomaDias(d,1);
  return ligHojeISO()>=d;
}
/* só meses fechados e completos: sai o 1º mês (se os dados começam no meio dele) e o mês em andamento */
function fbMesesDisp(modo){
  const hj=ligHojeISO(),desde=(LIG_IND&&LIG_IND.desde)||ligSomaDias(hj,-365),out=[];
  let k=fbMesChave(desde,modo);
  if(fbMesIni(k,modo)<desde)k=fbProxMes(k,1);
  for(;fbMesFechado(fbMesFim(k,modo))&&out.length<40;k=fbProxMes(k,1))out.push(k);
  return out;
}
function fbTomVar(p){return p===null||p===0?"tn-gr":p<0?"tn-ok":"tn-da";}
function fbMesCurto(k){return FB_MESES[Number(k.slice(5,7))-1]+"/"+k.slice(2,4);}
function fbProxMes(k,n){let a=Number(k.slice(0,4)),m=Number(k.slice(5,7))+n;while(m>12){m-=12;a++;}while(m<1){m+=12;a--;}return a+"-"+String(m).padStart(2,"0");}
function fbNum(n,d){return Number(n||0).toLocaleString("pt-BR",{maximumFractionDigits:d||0});}
let LIG_DSUB="resumo";
try{const s=localStorage.getItem("fbDesSub");if(s)LIG_DSUB=s;}catch(e){}
const FB_DSUBS=[["resumo","Resumo executivo","chart"],["efeito","Efeito do feedback","ok"],["areas","Empresa e áreas","list"],["postos","Postos e reserva","pin"],["motivos","Motivos e atendimento","doc"]];
function ligDes(k,v){
  if(k==="mot"&&LIG_DES.mot===v)v=""; /* clicar de novo no mesmo motivo fecha o detalhe */
  if(k==="mot")LIG_DX=0;
  if(k==="sub"){const o=FB_DSUBS.map(s=>s[0]);LIG_DX=o.indexOf(v)>o.indexOf(LIG_DSUB)?24:o.indexOf(v)<o.indexOf(LIG_DSUB)?-24:0;LIG_DSUB=v;try{localStorage.setItem("fbDesSub",v);}catch(e){}}
  else LIG_DES[k]=v;
  if(k==="modo"){LIG_DES.ini="";LIG_DES.fim="";try{localStorage.setItem("fbDesModo",v);}catch(e){}}
  ligPanel();
}

/* ── Desempenho: só meses FECHADOS entram nas comparações; o mês em andamento aparece à parte, como estimativa ── */
function fbDesDados(){
  const hj=ligHojeISO(),modo=LIG_DES.modo==="civil"?"civil":"folha",meses=fbMesesDisp(modo);
  let fim=meses.indexOf(LIG_DES.fim);if(fim<0)fim=meses.length-1;
  let ini=meses.indexOf(LIG_DES.ini);if(ini<0||ini>fim)ini=Math.max(0,fim-5);
  const L=meses.map(k=>{
    const de=fbMesIni(k,modo),fimM=fbMesFim(k,modo),ate=fimM<hj?fimM:hj,cv=fbConversasEntre(de,ate),dur=cv.filter(c=>c[2]);
    return{k,de,ate,fimM,parcial:fimM>hj,emp:fbFaltasEntre(de,ate),conv:cv.length,min:dur.length?Math.round(dur.reduce((t,c)=>t+c[2],0)/dur.length):null,cvs:cv};
  });
  return{hj,modo,meses,ini,fim,kI:meses[ini],kF:meses[fim],faixa:L.slice(ini,fim+1),todos:L};
}
/* efeito do feedback: lê as avaliações do servidor (antes × depois e veredito já decididos lá, a mesma regra do Monitoramento).
   Área = supervisor gravado no feedback. Desligado depois do feedback fica fora das contas (contado à parte). */
const FB_CAT={melhorando:"melh",mesma:"igual",piorou:"pior"};
function fbEfeito(D){
  const de=fbMesIni(D.kI,D.modo),ate=D.faixa[D.faixa.length-1].ate,cont=[],desl=new Set();
  ((LIG_IND&&LIG_IND.avaliacoes)||[]).forEach(x=>{
    if(x.d<de||x.d>ate||!fbSupOk(x.sup))return;
    if(x.desligado){desl.add(x.i!==null&&x.i!==undefined?x.i:"?"+x.nome);return;}
    cont.push(Object.assign({},x,{re:String(x.re||"")}));
  });
  /* a última conversa de cada pessoa decide o resultado dela; avaliados = melhorou, igual a antes ou piorou */
  const ult={};cont.forEach(c=>{const k=c.i!==null&&c.i!==undefined?c.i:"?"+c.nome;if(!ult[k]||ult[k].d<c.d)ult[k]=c;});
  const pessoas=Object.values(ult),av=pessoas.filter(c=>FB_CAT[c.veredito]);
  const r={melh:0,igual:0,pior:0,sem:0,obs:0};pessoas.forEach(c=>{r[FB_CAT[c.veredito]||(c.veredito==="sem_faltas"?"sem":"obs")]++;});
  return{cont,pessoas,av,r,deslig:desl.size};
}

/* ── gráficos em SVG: área com projeção, colunas, rosca e mini-área ── */
function fbTeto(v){if(v<=40)return Math.max(4,Math.ceil(v/4)*4); /* eixo com 4 intervalos inteiros: 0, 2, 4, 6, 8 */const p=Math.pow(10,Math.floor(Math.log10(v))),f=v/p;return(f<=1?1:f<=2?2:f<=2.5?2.5:f<=5?5:10)*p;}
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
/* etiqueta ao passar o mouse sobre qualquer marca com data-tip */
/* etiqueta própria do módulo no lugar da barra preta do navegador: vale para data-tip e para qualquer title dentro do módulo */
/* etiqueta desenhada do mapa de calor: posto e mês no topo, o número grande, o selo do resultado com a % e quem faltou */
function fbTipRico(o,esc){
  const k=o.c&&o.c.k==="up"?"up":o.c&&o.c.k==="dn"?"dn":"eq";
  let h='<div class="tx-h"><b>'+esc(o.h)+'</b><span>'+esc(o.s)+'</span></div><div class="tx-n"><b>'+esc(o.n)+'</b><span>'+esc(o.u)+'</span></div>';
  if(o.c)h+='<div class="tx-c '+k+'"><em>'+esc(o.c.p)+(o.c.g?' <b>'+esc(o.c.g)+'</b>':"")+'</em><span>'+esc(o.c.t)+'</span></div>';
  if(o.q&&o.q.length)h+='<div class="tx-q"><small>Quem faltou</small><ul>'+o.q.map(p=>'<li><span>'+esc(p[0])+'</span><b>'+esc(p[1])+'</b></li>').join("")+'</ul>'+(o.m?'<small class="m">e mais '+esc(o.m)+(o.m===1?" pessoa":" pessoas")+'</small>':"")+'</div>';
  if(o.x)h+='<div class="tx-x">'+esc(o.x)+'</div>';
  return h;
}
function fbTipInit(){
  if(window._fbTip)return;window._fbTip=1;
  const t=document.createElement("div");t.className="fb-tip";t.setAttribute("role","tooltip");document.body.appendChild(t);
  const esc=x=>String(x).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  document.addEventListener("mousemove",e=>{
    const a=e.target&&e.target.closest?e.target.closest("[data-tipj],[data-tip],[title]"):null;
    if(!a||!a.closest("#lig-root,.fb-ov")){t.classList.remove("on");return;}
    if(a.hasAttribute("title")){const v=a.getAttribute("title");a.removeAttribute("title");if(v&&!a.hasAttribute("data-tip"))a.setAttribute("data-tip",v);}
    const rj=a.getAttribute("data-tipj"),txt=rj||a.getAttribute("data-tip");if(!txt){t.classList.remove("on");return;}
    if(t._txt!==txt){t._txt=txt;let o=null;if(rj){try{o=JSON.parse(rj);}catch(er){o=null;}}t.classList.toggle("rx",!!o);
      if(o){t.classList.remove("lg");t.innerHTML=fbTipRico(o,esc);}else{const n=txt.indexOf("\n")>=0,p=n?txt.split("\n"):txt.split(" · ");t.classList.toggle("lg",n);t.innerHTML="<b>"+esc(p[0])+"</b>"+(p.length>1?(n?p.slice(1).map(x=>"<span>"+esc(x)+"</span>").join(""):"<span>"+esc(p.slice(1).join(" · "))+"</span>"):"");}}
    t.classList.add("on");
    const w=t.offsetWidth,h=t.offsetHeight;let y=e.clientY-h-16;if(y<8)y=e.clientY+20;
    t.style.left=Math.min(window.innerWidth-w-8,Math.max(8,e.clientX-w/2))+"px";t.style.top=y+"px";},{passive:true});
  document.addEventListener("mouseleave",()=>t.classList.remove("on"));
}

/* ── peças do painel ── */
function fbKg(cls,ic,rot,num,sub,var_){return'<div class="fb-kg '+cls+'"><span class="ic">'+fbI(ic)+'</span><small>'+rot+'</small><b>'+num+'</b>'+(var_?'<span class="v">'+var_+'</span>':"")+'<span class="s">'+sub+'</span></div>';}
function fbPainel(t,dir,corpo,cls){return'<section class="fb-pn'+(cls?" "+cls:"")+'"><header><h4>'+t+'</h4>'+(dir||"")+'</header>'+corpo+'</section>';}
function fbLeg(itens){return'<ul class="fb-gleg">'+itens.map(i=>'<li><i style="background:'+i[1]+'"'+(i[2]?' class="pj"':"")+'></i>'+i[0]+'</li>').join("")+'</ul>';}

function fbPnlDes(){
  if(!LIG_IND)return fbVazio();
  fbTipInit();
  const D=fbDesDados();
  if(!D.faixa.length)return'<div class="fb-dash"><p class="fb-per">Ainda não há mês fechado para comparar. Um mês entra aqui quando chega a planilha do dia seguinte ao fim dele.</p>'+fbVazio()+'</div>';
  const sel=(id,val,fn)=>'<span class="fb-selp"><select id="'+id+'" onchange="'+fn+'">'+D.meses.map(k=>'<option value="'+k+'"'+(k===val?" selected":"")+'>'+fbMesRot(k)+'</option>').join("")+'</select>'+fbI("chev")+'</span>';
  if(!FB_DSUBS.some(s=>s[0]===LIG_DSUB))LIG_DSUB="resumo";
  let h='<div class="fb-dash"><div class="fb-dash-bar"><nav class="fb-dsub" role="tablist" aria-label="Desempenho" data-nav="dsub" data-ind="fundo">'+FB_DSUBS.map(s=>'<button type="button" role="tab" class="'+(LIG_DSUB===s[0]?"on":"")+'" aria-selected="'+(LIG_DSUB===s[0])+'" onclick="ligDes(\'sub\',\''+s[0]+'\')">'+fbI(s[2])+s[1]+'</button>').join("")+'</nav>'
    +'<div class="fb-dash-f"><div class="fb-pills" role="group" aria-label="Como contar o mês" data-nav="modo" data-ind="fundo"><button type="button" class="'+(D.modo==="folha"?"on":"")+'" onclick="ligDes(\'modo\',\'folha\')">Folha 26 a 25</button><button type="button" class="'+(D.modo==="civil"?"on":"")+'" onclick="ligDes(\'modo\',\'civil\')">Mês do calendário</button></div>'
    +'<span class="fb-dash-sel" data-sync="dsel"><label class="fb-fl" for="ld-ini">De</label>'+sel("ld-ini",D.kI,"ligDes('ini',this.value)")+'<label class="fb-fl" for="ld-fim">até</label>'+sel("ld-fim",D.kF,"ligDes('fim',this.value)")+'</span></div></div>';
  h+='<div id="lig-lista">'+(LIG_DSUB==="postos"?fbLinhaPostos(D):fbLinhaPer(D))+({resumo:fbDesResumo,efeito:fbDesEfeito,areas:fbDesAreas,postos:fbDesPostos,motivos:fbDesMotivos}[LIG_DSUB])(D)+'</div>';
  return h+'</div>';
}
const FB_COR={azul:"#2563eb",azulc:"#93c5fd",verde:"#10b981",coral:"#f43f5e",ambar:"#f59e0b",violeta:"#8b5cf6",navy:"#1e3a8a"};
function fbRotM(l){return fbMesCurto(l.k)+(l.parcial?"*":"");}
/* ── peças do Desempenho: card compacto (rótulo, número, uma linha), diferença em número, linha de período ── */
function fbDif(n){return(n>0?"+":n<0?"−":"")+Math.abs(n);}
function fbDc(cor,rot,num,linha,tom){return'<div class="fb-dc '+cor+'"><small>'+rot+'</small><b'+(tom?' class="'+tom+'"':"")+'>'+num+'</b><span>'+linha+'</span></div>';}
function fbMesMud(d){return d>0?"Aumentou":d<0?"Diminuiu":"Sem mudança";}
function fbTagMud(d){return fbTag(fbMesMud(d),d>0?"tn-da":d<0?"tn-ok":"tn-gr");}
/* porcentagem só quando a base (o mês anterior) tem 20 faltas ou mais; abaixo disso, só a diferença em número */
function fbPctB(d,base){return base>=20?" · "+(d>0?"+":d<0?"−":"")+Math.abs(Math.round(d/base*100))+"%":"";}
function fbFaixaRot(D){return D.kI===D.kF?fbMesCurto(D.kF):fbMesCurto(D.kI)+" a "+fbMesCurto(D.kF);}
function fbArea(s){return s==="Sem supervisor"?s:fbTitulo(s);}
function fbDesAnt(D){const i=D.todos.indexOf(D.faixa[D.faixa.length-1]);return i>0?D.todos[i-1]:null;}
function fbLinhaPer(D){
  const L1=D.faixa[D.faixa.length-1],a=fbDesAnt(D),per=l=>fbMesCurto(l.k)+" ("+fbDd(l.de)+"–"+fbDd(l.fimM)+")",f=[];
  if(LIG_F.area&&LIG_F.area!=="todas")f.push("Área: "+fbTitulo(LIG_F.area));
  if(LIG_F.turno&&LIG_F.turno!=="todos")f.push("Turno: "+(LIG_F.turno==="NOTURNO"?"Noturno":"Diurno"));
  return'<p class="fb-per">'+(a?"Comparação: <b>"+per(L1)+"</b> × "+per(a):"Sem mês anterior para comparar")+" · meses fechados · hoje "+fbDd(D.hj)+(f.length?" · "+_esc(f.join(" · "))+'<br>Com filtro, as faltas contam pela área da falta e os feedbacks pela área registrada no feedback.':"")+'</p>';
}
/* faltas sem justificativa por área (supervisor da falta) em um mês */
function fbAreasMes(l){const m={};((LIG_IND&&LIG_IND.dias)||[]).forEach(x=>{if(x[0]>=l.de&&x[0]<=l.ate&&x[2]&&fbSupOk(x[1])){const s=x[1]||"Sem supervisor";m[s]=(m[s]||0)+x[2];}});return m;}
function fbAreasComp(D){
  const L1=D.faixa[D.faixa.length-1],a=fbDesAnt(D);if(!a)return[];
  const m1=fbAreasMes(L1),m0=fbAreasMes(a);
  return[...new Set(Object.keys(m0).concat(Object.keys(m1)))].map(s=>({s,v0:m0[s]||0,v1:m1[s]||0,d:(m1[s]||0)-(m0[s]||0)})).sort((x,y)=>y.d-x.d||x.s.localeCompare(y.s));
}
/* linha de lista: nome, de → para, diferença e botão Ver */
function fbDLinha(nome,de,para,d,fn){return'<li><span class="n">'+_esc(nome)+'</span><span class="ab">'+de+' → '+para+'</span><b class="'+fbTomVar(d)+'">'+fbDif(d)+'</b><button type="button" class="fb-btn ghost sm" onclick="'+fn+'">Ver</button></li>';}

function fbDesResumo(D){
  const F=D.faixa,L1=F[F.length-1],a=fbDesAnt(D),E=fbEfeito(D),tot=E.av.length,rot=fbFaixaRot(D);
  const d1=a?L1.emp.sj-a.emp.sj:0,areas=fbAreasComp(D),aum=areas.filter(x=>x.d>0),piorou=E.av.filter(c=>c.veredito==="piorou").sort((x,y)=>(y.depois-y.antes)-(x.depois-x.antes)||x.nome.localeCompare(y.nome));
  const pct=n=>tot>=20?Math.round(n/tot*100)+"% dos avaliados · "+rot:"dos "+tot+" avaliados · feedbacks de "+rot;
  let h='<div class="fb-dcs">'
    +fbDc("tn-br","Faltas sem justificativa em "+fbMesCurto(L1.k),fbNum(L1.emp.sj),a?fbMesMud(d1)+" "+fbDif(d1)+" vs "+fbMesCurto(a.k)+" ("+fbNum(a.emp.sj)+")"+fbPctB(d1,a.emp.sj):"Sem mês anterior",a?fbTomVar(d1):"")
    +fbDc("tn-ok","Pessoas que melhoraram depois do feedback",tot?E.r.melh+" de "+tot:"—",(tot?pct(E.r.melh):"Ninguém avaliado em "+rot)+(E.r.obs?" · "+E.r.obs+" em observação":""),"")
    +fbDc("tn-da","Pessoas que pioraram depois do feedback",tot?E.r.pior+" de "+tot:"—",tot?pct(E.r.pior):"Ninguém avaliado em "+rot,E.r.pior?"tn-da":"")
    +fbDc("tn-am","Áreas com mais faltas que no mês anterior",a?aum.length+" de "+areas.length:"—",a?(aum.length?"Maior: "+_esc(fbArea(aum[0].s))+" "+fbDif(aum[0].d):"Nenhuma área aumentou"):"Sem mês anterior",aum.length?"tn-da":"")
    +'</div>';
  h+='<div class="fb-dg2">'
    +fbPainel("Áreas com aumento de faltas",'<span class="fb-pill-s">'+(a?fbMesCurto(a.k)+" → "+fbMesCurto(L1.k):"")+'</span>',aum.length
      ?'<ul class="fb-dl">'+aum.slice(0,5).map(x=>fbDLinha(fbArea(x.s),x.v0,x.v1,x.d,"ligDes('sub','areas')")).join("")+'</ul>'
      :'<p class="fb-gnota">'+(a?"Nenhuma área teve aumento em "+fbMesCurto(L1.k)+".":"Sem mês anterior para comparar.")+'</p>')
    +fbPainel("Pioraram após o feedback",'<span class="fb-pill-s">antes → depois</span>',piorou.length
      ?'<ul class="fb-dl">'+piorou.slice(0,5).map((c,i)=>{LIG_DES_ROWS[i]={re:c.re,nome:c.nome};return fbDLinha(c.nome,c.antes,c.depois,c.depois-c.antes,"ligDesAbrir("+i+")");}).join("")+'</ul>'
      :'<p class="fb-gnota">Ninguém piorou após o feedback de '+rot+'.</p>')
    +'</div>';
  return h;
}

function fbDesEfeito(D){
  const E=fbEfeito(D),tot=E.av.length,pessoas=E.pessoas,rot=fbFaixaRot(D);
  const de=fbMesIni(D.kI,D.modo),ate=D.faixa[D.faixa.length-1].ate;
  const cont={};FB_VD_ORDEM.forEach(k=>{cont[k]=pessoas.filter(c=>c.veredito===k);});
  const sit=FB_VD_ORDEM.indexOf(LIG_DES.sit)>=0?LIG_DES.sit:"piorou",tom=FB_VD[sit].tom;
  const resp=tot?E.r.melh+" de "+tot+" melhoraram"+(tot>=20?" ("+Math.round(E.r.melh/tot*100)+"%)":"")+"; "+E.r.pior+" "+(E.r.pior===1?"piorou":"pioraram")+".":"Ninguém avaliado neste período.";
  const hero=fbPainel("Como ficaram as "+pessoas.length+" pessoas?",'<span class="fb-pill-s">Feedbacks de '+fbDd(de)+' a '+fbDd(ate)+'</span>',
    '<p class="fb-resp ef-resp">'+resp+'</p>'
    +'<div class="fb-sit5">'+FB_VD_ORDEM.map(k=>'<button type="button" class="'+FB_VD[k].tom+(k===sit?" on":"")+'" aria-pressed="'+(k===sit)+'" onclick="ligDesSit(\''+k+'\')">'+fbTag(FB_VD[k].t,FB_VD[k].tom)+'<b>'+cont[k].length+'</b><span>'+(k===sit?"Lista abaixo":cont[k].length?"Ver lista":"Ninguém")+'</span></button>').join("")+'</div>'
);
  /* a lista da situação escolhida */
  LIG_DES_ROWS=[];
  const ordem={piorou:(x,y)=>(y.depois-y.antes)-(x.depois-x.antes),melhorando:(x,y)=>(x.depois-x.antes)-(y.depois-y.antes)};
  const lst=cont[sit].slice().sort((x,y)=>((ordem[sit]&&ordem[sit](x,y))||0)||x.nome.localeCompare(y.nome));
  const linhas=lst.map((c,i)=>{LIG_DES_ROWS[i]={re:c.re,nome:c.nome};const d=c.depois-c.antes,dia=Math.min(30,c.dias);
    return'<tr tabindex="0" title="Abrir o panorama de '+_esc(fbTitulo(c.nome))+'" onclick="ligDesAbrir('+i+')" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();ligDesAbrir('+i+')}">'
      +'<td><span class="ef-p"><span class="av">'+_esc(fbIni(c.nome))+'</span><span class="nm"><b>'+_esc(c.nome)+'</b><small>'+_esc(fbTitulo(c.sup||"Sem supervisor"))+'</small></span></span></td>'
      +'<td><b class="dt">'+fbDd(c.d)+'</b></td>'
      +'<td><span class="ef-pg"><span class="pg"><i style="width:'+Math.round(dia/30*100)+'%"></i></span><small>'+(c.dias>=30?"Concluído (30 dias)":"Dia "+c.dias+" de 30")+'</small></span></td>'
      +'<td class="n">'+c.antes+'</td><td class="n">'+c.depois+'</td><td class="n"><span class="df '+fbTomVar(d)+'">'+fbDif(d)+'</span></td></tr>';}).join("");
  const tab=lst.length?'<div class="ef-tw"><table class="ef-tb"><thead><tr><th>Colaborador</th><th>Feedback em</th><th>Acompanhamento</th><th class="n">Antes</th><th class="n">Depois</th><th class="n">Diferença</th></tr></thead><tbody>'+linhas+'</tbody></table></div>'
    :'<div class="ef-vz"><b>Ninguém nesta situação no período.</b><span>Escolha outro card acima para ver as outras situações.</span></div>';
  const lista='<section class="fb-pn ef-lista '+tom+'"><header class="ef-lh"><div class="ef-lt">'+fbTag(FB_VD[sit].t,tom)+'<b>'+fbPlural(lst.length,"pessoa","pessoas")+'</b></div></header>'+tab
    +(lst.length?'<footer class="ef-lf">Clique numa linha para abrir o panorama da pessoa'+(ordem[sit]?" · ordenado "+(sit==="piorou"?"da maior piora para a menor":"da maior melhora para a menor"):" · ordem alfabética")+'</footer>':"")+'</section>';
  return hero+lista;
}

function fbDesAreas(D){
  const F=D.faixa,L1=F[F.length-1],a=fbDesAnt(D),E=fbEfeito(D),areas=fbAreasComp(D),aum=areas.filter(x=>x.d>0);
  const dj=a?L1.emp.sj-a.emp.sj:0,da=a?L1.emp.ab-a.emp.ab:0,dt=a?(L1.emp.sj+L1.emp.ab)-(a.emp.sj+a.emp.ab):0;
  const lin=(d,base,ant)=>a?fbMesMud(d)+" "+fbDif(d)+" vs "+fbMesCurto(a.k)+" ("+fbNum(ant)+")"+fbPctB(d,base):"Sem mês anterior";
  let h='<div class="fb-dcs">'
    +fbDc("tn-br","Sem justificativa em "+fbMesCurto(L1.k),fbNum(L1.emp.sj),lin(dj,a&&a.emp.sj,a&&a.emp.sj),a?fbTomVar(dj):"")
    +fbDc("tn-vi","Abonadas em "+fbMesCurto(L1.k),fbNum(L1.emp.ab),lin(da,a&&a.emp.ab,a&&a.emp.ab),a?fbTomVar(da):"")
    +fbDc("tn-gr","As duas juntas em "+fbMesCurto(L1.k),fbNum(L1.emp.sj+L1.emp.ab),lin(dt,a&&(a.emp.sj+a.emp.ab),a&&(a.emp.sj+a.emp.ab)),a?fbTomVar(dt):"")
    +fbDc("tn-am","Áreas com mais faltas que no mês anterior",a?aum.length+" de "+areas.length:"—",a?(aum.length?"Maior: "+_esc(fbArea(aum[0].s))+" "+fbDif(aum[0].d):"Nenhuma área aumentou"):"Sem mês anterior",aum.length?"tn-da":"")
    +'</div>';
  /* gráfico: só meses fechados; o número sobre a coluna é a soma das duas séries (sem justificativa + abonadas) */
  const rots=F.map(l=>fbMesCurto(l.k)),sj=F.map(l=>l.emp.sj),ab=F.map(l=>l.emp.ab);
  const resp=a?(dj>0?"Aumentaram":dj<0?"Diminuíram":"Ficaram iguais")+": "+fbNum(L1.emp.sj)+" sem justificativa em "+fbMesCurto(L1.k)+", "+fbDif(dj)+" vs "+fbMesCurto(a.k)+".":"Sem mês anterior para comparar.";
  const graf=fbPainel("As faltas aumentaram ou diminuíram?",fbLeg([["Sem justificativa",FB_COR.azul],["Abonadas",FB_COR.azulc]]),
    '<p class="fb-resp">'+resp+'</p>'+fbGCols({rot:"Faltas por mês fechado",rots,empilha:true,series:[{nome:"Sem justificativa",cor:FB_COR.azul,vals:sj},{nome:"Abonadas",cor:FB_COR.azulc,vals:ab}],h:220})
    +'<p class="fb-gnota">Número sobre a coluna: sem justificativa + abonadas. '+(D.modo==="folha"?"Mês = dia 26 ao 25.":"Mês = dia 1 ao último dia.")+'</p>');
  /* estimativa do mês em andamento: fica fora de qualquer comparação */
  const kc=fbMesChave(D.hj,D.modo),dc=fbMesIni(kc,D.modo),fc=fbMesFim(kc,D.modo),pass=fbDiasEntre(dc,D.hj)+1,total=fbDiasEntre(dc,fc)+1,fc1=fbFaltasEntre(dc,D.hj);
  const est=fbPainel(fbMesCurto(kc)+" em andamento",fbTag("Estimativa","tn-gr"),
    '<ul class="fb-est"><li><span>Até '+fbDd(D.hj)+' ('+pass+' de '+total+' dias)</span><b>'+fbNum(fc1.sj)+'</b></li><li><span>'+(pass>=7?"No ritmo atual, fecha em":"Estimativa a partir de "+fbDd(ligSomaDias(dc,6)))+'</span><b>'+(pass>=7?"~"+fbNum(Math.round(fc1.sj/pass*total)):"—")+'</b></li></ul><p class="fb-gnota">Não entra nas comparações. Sem justificativa.</p>');
  h+='<div class="fb-dg3">'+graf+est+'</div>';
  /* tabela por área: diferença em número, quem piorou depois do feedback e o resultado em palavras */
  const pior={};E.av.filter(c=>c.veredito==="piorou").forEach(c=>{const n=c.sup||"Sem supervisor",k=_ligNorm(n);(pior[k]=pior[k]||{n,c:0}).c++;});
  const linhas=areas.concat(Object.keys(pior).filter(k=>!areas.some(x=>_ligNorm(x.s)===k)).map(k=>({s:pior[k].n,v0:0,v1:0,d:0})));
  const tab=a&&linhas.length?'<div class="fb-tab"><table><thead><tr><th>Área</th><th>Turno</th><th>'+fbMesCurto(a.k)+'<small>'+fbDd(a.de)+'–'+fbDd(a.fimM)+'</small></th><th>'+fbMesCurto(L1.k)+'<small>'+fbDd(L1.de)+'–'+fbDd(L1.fimM)+'</small></th><th>Diferença</th><th>Pioraram após o feedback<small>'+fbFaixaRot(D)+'</small></th><th>Resultado</th></tr></thead><tbody>'
    +linhas.map(x=>'<tr><td><b>'+_esc(fbArea(x.s))+'</b></td><td>'+(fbTurnoDe(x.s)==="NOTURNO"?"Noturno":"Diurno")+'</td><td>'+x.v0+'</td><td>'+x.v1+'</td><td class="'+fbTomVar(x.d)+'"><b>'+fbDif(x.d)+'</b></td><td>'+((pior[_ligNorm(x.s)]||{}).c||0)+'</td><td>'+fbTagMud(x.d)+'</td></tr>').join("")
    +'<tr class="tot"><td><b>'+(LIG_F.area!=="todas"||LIG_F.turno!=="todos"?"Total do filtro":"Empresa")+'</b></td><td></td><td><b>'+a.emp.sj+'</b></td><td><b>'+L1.emp.sj+'</b></td><td class="'+fbTomVar(dj)+'"><b>'+fbDif(dj)+'</b></td><td><b>'+E.r.pior+'</b></td><td>'+fbTagMud(dj)+'</td></tr></tbody></table></div>'
    :'<p class="fb-gnota">'+(a?"Sem faltas sem justificativa nos dois meses.":"Sem mês anterior para comparar.")+'</p>';
  h+=fbPainel("Qual área teve aumento?",'<span class="fb-pill-s">Faltas sem justificativa</span>',(a?'<p class="fb-resp">'+aum.length+" de "+areas.length+(areas.length===1?" área teve":" áreas tiveram")+" aumento"+(aum.length?"; "+_esc(fbArea(aum[0].s))+" o maior ("+fbDif(aum[0].d)+")":"")+".</p>":"")+tab);
  return h;
}
function fbDesMotivos(D){
  const F=D.faixa,L1=F[F.length-1],ant=D.todos[D.todos.indexOf(L1)-1],cv=[].concat(...F.map(l=>l.cvs)),tot=cv.length;
  const conta=lst=>{const m={};lst.forEach(c=>{m[c[1]]=(m[c[1]]||0)+1;});return m;};
  const M=conta(cv),ms=Object.keys(M).sort((a,b)=>M[b]-M[a]);
  const m1=conta(L1.cvs),m0=ant?conta(ant.cvs):{};
  const cres=Object.keys(m1).map(k=>({k,d:m1[k]-(m0[k]||0)})).sort((a,b)=>b.d-a.d)[0];
  const cores=[FB_COR.azul,FB_COR.violeta,FB_COR.verde,FB_COR.ambar,FB_COR.coral,"#06b6d4","#64748b","#ec4899"];
  const Fm=F.filter(l=>l.min!==null),durs=cv.filter(c=>c[2]),med=durs.length?Math.round(durs.reduce((t,c)=>t+c[2],0)/durs.length):null;
  let h='<div class="fb-dcs">'
    +fbDc("tn-br","Feedbacks registrados",fbNum(tot),fbFaixaRot(D),"")
    +fbDc("tn-vi","Motivo principal",ms.length?_esc(ms[0]):"—",ms.length?(tot>=20?Math.round(M[ms[0]]/tot*100)+"% dos feedbacks":M[ms[0]]+" de "+fbPlural(tot,"feedback","feedbacks")):"Sem feedbacks","")
    +fbDc("tn-am","Motivo que mais aumentou no último mês",cres&&cres.d>0?_esc(cres.k):"Nenhum",cres&&cres.d>0?fbDif(cres.d)+" feedbacks em "+fbMesCurto(L1.k)+(ant?" vs "+fbMesCurto(ant.k):""):"Nenhum motivo cresceu",cres&&cres.d>0?"tn-da":"")
    +fbDc("tn-gr","Tempo médio por feedback",med===null?"—":med+" min",fbPlural(durs.length,"conversa com tempo","conversas com tempo"),"")+'</div>';
  h+=fbMotivosCards(M,tot,cores,cv)+'<div class="fb-dg h">'+fbPainel("Motivos informados nos feedbacks",'<span class="fb-pill-s">'+fbPlural(tot,"feedback","feedbacks")+'</span>',ms.length?'<div class="fb-rosca-w lado"><ul class="fb-mot2">'+ms.map((m,i)=>'<li><i style="background:'+cores[i%cores.length]+'"></i><span class="t">'+_esc(m)+'</span><b>'+(tot>=20?String(Math.round(M[m]/tot*1000)/10).replace(".",",")+"%":M[m])+'</b>'+(tot>=20?'<span class="c">'+M[m]+'</span>':"")+'</li>').join("")+'</ul></div>':'<p class="fb-gnota">Nenhum feedback no intervalo.</p>')
    +fbPainel("Tempo médio por feedback, mês a mês","",Fm.length?fbGArea({rot:"Tempo médio por mês",rots:Fm.map(fbRotM),vals:Fm.map(l=>l.min),cor:FB_COR.ambar,suf:" min",rotular:true,w:520,h:220}):'<p class="fb-gnota">Nenhum feedback com tempo registrado no intervalo.</p>')+'</div>';
  const por=i=>{const m={};cv.forEach(c=>{const k=c[i]||(i===1?"Sem motivo":"Não informado");m[k]=m[k]||{n:0,s:0,c:0};m[k].c++;if(c[2]){m[k].n++;m[k].s+=c[2];}});return Object.keys(m).map(k=>({k,v:m[k].n?Math.round(m[k].s/m[k].n):0,c:m[k].c})).sort((a,b)=>b.v-a.v);};
  const barras=(lst,cor)=>{const mx=Math.max(1,...lst.map(x=>x.v));return lst.length?'<ul class="fb-rank sm">'+lst.map(x=>'<li><span class="n"><b>'+_esc(x.k)+'</b><small>'+fbPlural(x.c,"feedback","feedbacks")+'</small></span><span class="tr"><i style="--w:'+Math.round(x.v/mx*100)+'%;background:'+cor+'"></i></span><b class="q">'+(x.v?x.v+" min":"—")+'</b></li>').join("")+'</ul>':'<p class="fb-gnota">Sem dados.</p>';};
  h+='<div class="fb-dg h">'+fbPainel("Tempo médio por motivo","",barras(por(1),FB_COR.ambar))+fbPainel("Tempo médio por pessoa do SAC","",barras(por(4),FB_COR.azul))+'</div>';
  return h;
}
function fbMotivosCards(M,tot,cores,cv){
  const nomes=(LIG_MOT||[]).filter(m=>m.ativo!==false||M[m.nome]).map(m=>m.nome);Object.keys(M).forEach(n=>{if(nomes.indexOf(n)<0&&n!=="Sem motivo")nomes.push(n);});
  if(M["Sem motivo"])nomes.push("Sem motivo");
  const cards=nomes.map((n,i)=>{const q=M[n]||0,on=LIG_DES.mot===n;return'<button type="button" class="fb-mc2'+(on?" on":"")+'" aria-pressed="'+on+'" onclick="ligDes(\'mot\',this.dataset.n)" data-n="'+_esc(n)+'"><i style="background:'+cores[i%cores.length]+'"></i><span class="t">'+_esc(n)+'</span><b>'+q+'</b>'+(tot>=20?'<span class="p">'+String(Math.round(q/tot*1000)/10).replace(".",",")+'%</span>':"")+'</button>';}).join("");
  let det="";
  if(LIG_DES.mot){
    const ids=new Set(cv.filter(c=>c[1]===LIG_DES.mot).map(c=>c[5])),lst=LIG_C.filter(c=>ids.has(c.id)).sort((a,b)=>ligDataContato(b).localeCompare(ligDataContato(a)));
    LIG_DES_ROWS=lst.map(c=>({re:c.baixa&&c.baixa.re?c.baixa.re:"",nome:c.colaborador}));
    det=fbPainel("Feedbacks com o motivo: "+_esc(LIG_DES.mot),'<span class="fb-pill-s">'+fbPlural(lst.length,"feedback","feedbacks")+'</span>',lst.length
      ?'<div class="fb-cards">'+lst.slice(0,60).map((c,i)=>'<article class="fb-pc tn-ok" tabindex="0" role="button" onclick="ligDesAbrir('+i+')"><div class="fb-pc-h"><div class="fb-av2">'+_esc(fbIni(c.colaborador))+'</div><div class="fb-pc-t"><div class="fb-nm">'+_esc(c.colaborador)+'</div><div class="fb-sb">'+_esc(fbTitulo(c.posto||""))+'</div></div></div><div class="fb-pc-b">'+fbRegistro(c)+'</div></article>').join("")+'</div>':'<p class="fb-gnota">Nenhum feedback com este motivo no intervalo.</p>');
  }
  return fbPainel("Todos os motivos",'<span class="fb-pill-s">clique para ver os feedbacks</span>','<div class="fb-mcs">'+cards+'</div>')+det;
}
/* Postos e reserva, no período escolhido (De / até). Responde: onde estão as faltas, cada posto ou área melhorou ou piorou
   (último mês × primeiro mês, em faltas e em %), e quem faltou em cada mês (clique na linha).
   Posto = cliente; reserva técnica = equipe de cobertura, agrupada por área (supervisor). Só faltas sem justificativa. */
let LIG_DES_PA="",LIG_DES_PL=[];
/* Postos: o quadro não some e reaparece. O conteúdo troca na hora e o movimento acontece DENTRO dele:
   a lista de pessoas abre e fecha deslizando, as linhas entram em sequência e as células se ajustam com leve escala (nada fica invisível). */
function fbPostosAgora(){const y=window.scrollY;window._fbQuieto=1;try{ligPanel();}finally{window._fbQuieto=0;}if(window.scrollTo)window.scrollTo(0,y);}
function fbPostosMov(abriu){
  if(!fbMov())return;
  const box=document.getElementById("lig-panel");if(!box)return;
  if(abriu){
    const w=box.querySelector(".pd-w"),h=w?w.offsetHeight:0;if(!w)return;
    w.style.overflow="hidden";const a=w.animate([{height:"0px",opacity:0,transform:"translate3d(0,-8px,0)"},{height:h+"px",opacity:1,transform:"none"}],{duration:420,easing:FB_EASE});
    a.onfinish=a.oncancel=()=>{w.style.overflow="";};
    w.querySelectorAll("tr.pp").forEach((r,i)=>{if(i<14)r.animate([{opacity:0,transform:"translate3d(0,8px,0)"},{opacity:1,transform:"none"}],{duration:380,delay:120+i*28,easing:FB_EASE,fill:"backwards"});});
  }else{
    box.querySelectorAll(".fb-heat td.hm,.fb-heat td.tt").forEach(c=>{const col=c.cellIndex,lin=c.parentElement.rowIndex;
      c.animate([{opacity:.55,transform:"scale(.93)"},{opacity:1,transform:"none"}],{duration:420,delay:Math.min(260,col*28+lin*18),easing:FB_EASE,fill:"backwards"});});
  }
}
function ligDesPa(i){
  const k=LIG_DES_PL[i],abre=LIG_DES_PA!==k,w=document.querySelector("#lig-panel .pd-w");
  const troca=()=>{LIG_DES_PA=abre?k:"";fbPostosAgora();if(abre)fbPostosMov(true);};
  if(!abre&&w&&fbMov()){w.style.overflow="hidden";const a=w.animate([{height:w.offsetHeight+"px",opacity:1},{height:"0px",opacity:0}],{duration:260,easing:"cubic-bezier(.4,0,.2,1)",fill:"forwards"});a.onfinish=troca;return;}
  troca();
}
function ligDesPr(v){LIG_DES.pr=v;LIG_DES_PA="";fbPostosAgora();fbPostosMov(false);}
/* resultado de uma linha: último mês × primeiro mês. Devolve {k: tom, p: palavra, g: número grande, s: linha pequena} */
function fbPostoRes(v){
  if(v.length<2)return null;
  const a=v[0],b=v[v.length-1],d=b-a,fl=n=>(n>0?"+":"−")+Math.abs(n)+(Math.abs(n)===1?" falta":" faltas");
  if(d===0)return{k:"tn-gr",p:"Estável",g:"0%",s:"mesmo número de faltas"};
  if(a===0)return{k:"tn-da",p:"Piorou",g:fl(d),s:"sem base para % (começou em 0)"};
  return{k:d>0?"tn-da":"tn-ok",p:d>0?"Piorou":"Melhorou",g:(d>0?"+":"−")+Math.abs(Math.round(d/a*100))+"%",s:fl(d)};
}
function fbLinhaPostos(D){
  const F=D.faixa,n=F.length,rot=fbFaixaRot(D),f=[];
  if(LIG_F.area&&LIG_F.area!=="todas")f.push("Área: "+fbTitulo(LIG_F.area));
  if(LIG_F.turno&&LIG_F.turno!=="todos")f.push("Turno: "+(LIG_F.turno==="NOTURNO"?"Noturno":"Diurno"));
  return'<p class="fb-per">Período analisado: <b>'+rot+'</b> ('+fbPlural(n,"mês fechado","meses fechados")+')'+(n>1?' · comparação: <b>'+fbMesCurto(F[n-1].k)+'</b> contra <b>'+fbMesCurto(F[0].k)+'</b>':"")+(f.length?" · "+_esc(f.join(" · ")):"")+'</p>';
}
/* filtro "Quais faltas contar" da aba Postos. ab: inclui abonadas; fb: 1 só com feedback, -1 só sem feedback, 0 com ou sem.
   d: como a falta é chamada no texto do mouse; leg: a primeira linha da legenda */
const FB_PF={
  sj:{t:"Todas as faltas sem justificativa (com ou sem feedback)",d:"sem justificativa",leg:"todas as faltas sem justificativa do mês, com ou sem feedback",ab:false,fb:0},
  sj_fb:{t:"Sem justificativa, com feedback",d:"sem justificativa com feedback",leg:"faltas sem justificativa do mês que tiveram feedback",ab:false,fb:1},
  sj_sem:{t:"Sem justificativa, sem feedback",d:"sem justificativa sem feedback",leg:"faltas sem justificativa do mês que não tiveram feedback",ab:false,fb:-1},
  ab_fb:{t:"Sem justificativa + abonadas, com feedback",d:"sem justificativa ou abonadas, com feedback",leg:"faltas sem justificativa e abonadas do mês que tiveram feedback",ab:true,fb:1},
  ab_sem:{t:"Sem justificativa + abonadas, sem feedback",d:"sem justificativa ou abonadas, sem feedback",leg:"faltas sem justificativa e abonadas do mês que não tiveram feedback",ab:true,fb:-1}};
function ligDesPf(v){LIG_DES.pf=FB_PF[v]?v:"sj";LIG_DES_PA="";fbPostosAgora();fbPostosMov(false);}
/* busca do posto pelo nome: esconde as linhas na hora, sem redesenhar (o cursor fica no campo) */
function ligDesPq(v){
  LIG_DES.pq=v;const q=_ligNorm(v),t=document.querySelector("#lig-panel .fb-heat");if(!t)return;let n=0;
  t.querySelectorAll("tbody tr.pl").forEach(r=>{const ok=!q||String(r.dataset.n||"").indexOf(q)>=0;r.hidden=!ok;const d=r.nextElementSibling;if(d&&d.classList.contains("pd"))d.hidden=!ok;if(ok)n++;});
  const tot=t.querySelector("tbody tr.tot");if(tot)tot.hidden=!!q;const z=document.getElementById("ld-pq-vazio");if(z)z.hidden=n>0;
}
/* Quadro único, mapa de calor (referência do Raphael): cada mês é uma célula colorida pela quantidade de faltas, com a
   diferença para o mês anterior embaixo (▲ mais, ▼ menos). A porcentagem aparece ao passar o mouse na célula. */
function fbDesPostos(D){
  const pes=(LIG_IND&&LIG_IND.pessoas)||[],nomes=(LIG_IND&&LIG_IND.postos)||[],S=(LIG_IND&&LIG_IND.supervisores)||[],CG=(LIG_IND&&LIG_IND.cargos)||[],F=D.faixa,nM=F.length;
  const PF=FB_PF[LIG_DES.pf]||FB_PF.sj,FBD={},G={P:{},R:{}};
  ((LIG_IND&&LIG_IND.funil&&LIG_IND.funil.feedbacks)||[]).forEach(y=>{(FBD[y[1]]=FBD[y[1]]||[]).push(y[0]);});
  /* falta com feedback: a pessoa teve feedback registrado no dia da falta ou em até 29 dias depois (a mesma janela do "antes" do veredito) */
  const teveFb=(i,dt)=>{const ds=FBD[i];if(!ds)return false;const lim=ligSomaDias(dt,29);return ds.some(d=>d>=dt&&d<=lim);};
  ((LIG_IND&&LIG_IND.funil&&LIG_IND.funil.faltas)||[]).forEach(x=>{
    if(x[2]==="A"&&!PF.ab)return;const p=pes[x[1]];if(!p||!fbSupOk(S[x[5]]))return;
    if(PF.fb&&(teveFb(x[1],x[0])?1:-1)!==PF.fb)return;
    const li=F.findIndex(l=>x[0]>=l.de&&x[0]<=l.ate);if(li<0)return;
    const res=x[4]==="R",nome=res?(S[x[5]]||"Sem supervisor"):(nomes[x[3]]||p[2]||"Sem posto"),g=res?G.R:G.P;
    const o=g[nome]=g[nome]||{n:nome,k:(res?"R|":"P|")+nome,v:F.map(()=>0),t:0,ps:{}};
    o.v[li]++;o.t++;
    const q=o.ps[x[1]]=o.ps[x[1]]||{re:p[0],nome:p[1],cg:"",v:F.map(()=>0),t:0};q.v[li]++;q.t++;
    if(x[6]!==null&&x[6]!==undefined&&CG[x[6]])q.cg=CG[x[6]];
  });
  const lista=g=>Object.values(g).sort((a,b)=>b.t-a.t||a.n.localeCompare(b.n));
  const LP=lista(G.P),LR=lista(G.R),rot=fbFaixaRot(D),totR=LR.reduce((t,x)=>t+x.t,0);
  const nm=n=>n==="Sem supervisor"?n:fbTitulo(n),fl=n=>fbPlural(n,"falta","faltas");
  /* texto do mouse, explicado linha a linha (\n): de onde vem o número, a comparação com o mês anterior e quem faltou */
  const pct=(d,a)=>Math.abs(Math.round(d/a*100))+"%";
  const compara=(v,i,a)=>{
    if(i===0)return"É o primeiro mês do período: não há mês anterior para comparar.";
    const m0=fbMesCurto(F[i-1].k),d=v-a;
    if(d===0)return"Em "+m0+" também foram "+fl(a)+". Resultado: estável, sem mudança.";
    if(a===0)return"Em "+m0+" não houve falta. Resultado: piorou, "+fl(d)+" a mais. Como o mês anterior foi 0, não dá para calcular a %.";
    return"Em "+m0+" foram "+fl(a)+". Resultado: "+(d>0?"piorou, "+fl(d)+" a mais, um aumento de "+pct(d,a)+".":"melhorou, "+fl(-d)+" a menos, uma queda de "+pct(d,a)+".");
  };
  const quem=(x,i)=>{const ps=Object.values(x.ps).filter(q=>q.v[i]).sort((a,b)=>b.v[i]-a.v[i]||a.nome.localeCompare(b.nome));
    if(!ps.length)return"Nenhuma falta "+PF.d+" neste mês.";
    return"Quem faltou: "+ps.slice(0,5).map(q=>fbTitulo(q.nome)+" ("+q.v[i]+")").join(", ")+(ps.length>5?" e mais "+(ps.length-5):"")+".";};
  const dica=(x,i)=>{const v=x.v[i],a=i?x.v[i-1]:0;
    return nm(x.n)+" · "+fbMesCurto(F[i].k)+"\n"+fl(v)+" "+PF.d+" neste mês.\n"+compara(v,i,a)+"\n"+quem(x,i);};
  const dicaTot=(tv,i)=>"Todos os "+(res?"supervisores":"postos")+" · "+fbMesCurto(F[i].k)+"\n"+fl(tv[i])+" "+PF.d+" somando "+(res?"a reserva técnica":"todos os postos")+".\n"+compara(tv[i],i,i?tv[i-1]:0);
  const dicaPer=(nome,v,nP)=>{const r=fbPostoRes(v),pico=v.indexOf(Math.max(...v)),t=v.reduce((a,b)=>a+b,0);
    let l=nome+" · "+rot+"\n"+fl(t)+" "+PF.d+" no período"+(nP!==null?", de "+fbPlural(nP,"pessoa","pessoas"):"")+".";
    if(nM>1){l+="\nPrimeiro mês ("+fbMesCurto(F[0].k)+"): "+fl(v[0])+". Último mês ("+fbMesCurto(F[nM-1].k)+"): "+fl(v[nM-1])+".";
      const d=v[nM-1]-v[0];
      l+="\nResultado do período: "+(d===0?"estável, o mesmo número do primeiro ao último mês.":v[0]===0?"piorou, "+fl(d)+" a mais. Como o primeiro mês foi 0, não dá para calcular a %.":d>0?"piorou, "+fl(d)+" a mais, um aumento de "+pct(d,v[0])+".":"melhorou, "+fl(-d)+" a menos, uma queda de "+pct(d,v[0])+".");}
    if(t)l+="\nMês com mais faltas: "+fbMesCurto(F[pico].k)+" ("+v[pico]+").";
    return r||!t?l:l;};
  const cmpJ=(v,i,a)=>{if(i===0)return{k:"eq",p:"Primeiro mês",g:"",t:"Não há mês anterior no período para comparar."};
    const m0=fbMesCurto(F[i-1].k),d=v-a;
    if(d===0)return{k:"eq",p:"Estável",g:"0%",t:"Mesmo número de "+m0+" ("+a+")."};
    if(a===0)return{k:"up",p:"Piorou",g:"",t:fl(d)+" a mais que em "+m0+", que não teve falta. Sem base para %."};
    return{k:d>0?"up":"dn",p:d>0?"Piorou":"Melhorou",g:pct(d,a),t:fl(Math.abs(d))+(d>0?" a mais":" a menos")+" que em "+m0+" ("+a+")."};};
  const unid=(n,resto)=>(n===1?"falta ":"faltas ")+PF.d+" "+resto;
  const dicaJ=(x,i)=>{const ps=Object.values(x.ps).filter(q=>q.v[i]).sort((a,b)=>b.v[i]-a.v[i]||a.nome.localeCompare(b.nome));
    return JSON.stringify({h:nm(x.n),s:fbMesCurto(F[i].k),n:x.v[i],u:unid(x.v[i],"neste mês"),c:cmpJ(x.v[i],i,i?x.v[i-1]:0),q:ps.slice(0,6).map(q=>[fbTitulo(q.nome),q.v[i]]),m:Math.max(0,ps.length-6)});};
  const totJ=(tv,i)=>JSON.stringify({h:"Todos os "+(res?"supervisores":"postos"),s:fbMesCurto(F[i].k),n:tv[i],u:unid(tv[i],"somando "+(res?"a reserva técnica":"todos os postos")),c:cmpJ(tv[i],i,i?tv[i-1]:0)});
  const perJ=(nome,v,nP)=>{const t=v.reduce((a,b)=>a+b,0),pico=v.indexOf(Math.max(...v));let c=null;
    if(nM>1){const a=v[0],b=v[nM-1],d=b-a,de=fbMesCurto(F[0].k)+" ("+a+") → "+fbMesCurto(F[nM-1].k)+" ("+b+")";
      c=d===0?{k:"eq",p:"Estável no período",g:"0%",t:de+"."}:a===0?{k:"up",p:"Piorou no período",g:"",t:de+": "+fl(d)+" a mais. Sem base para % (começou em 0)."}
        :{k:d>0?"up":"dn",p:d>0?"Piorou no período":"Melhorou no período",g:pct(d,a),t:de+": "+fl(Math.abs(d))+(d>0?" a mais.":" a menos.")};}
    return JSON.stringify({h:nome,s:rot,n:t,u:unid(t,"no período"+(nP!==null?", de "+fbPlural(nP,"pessoa","pessoas"):"")),c,x:t?"Mês com mais faltas: "+fbMesCurto(F[pico].k)+" ("+v[pico]+")":""});};
  LIG_DES_PL=[];LIG_DES_ROWS=[];
  const res=LIG_DES.pr==="reserva",L=res?LR:LP,mx=Math.max(1,...L.map(x=>Math.max(...x.v))),mt=Math.max(1,...L.map(x=>x.t));
  const cel=(x,i)=>{const v=x.v[i],a=i>0?x.v[i-1]:null,d=a===null?0:v-a,lv=v?Math.min(4,Math.ceil(v/mx*4)):0;
    return'<td class="hm h'+lv+'" data-tip="'+_esc(dica(x,i))+'" data-tipj="'+_esc(dicaJ(x,i))+'"><b>'+v+'</b>'+(d===0?"":'<small class="'+(d<0?"dn":"up")+'">'+(d>0?"▲ ":"▼ ")+Math.abs(d)+'</small>')+'</td>';};
  const pq=_ligNorm(LIG_DES.pq||"");let vis=0;
  const linhas=L.map((x,ix)=>{
    const i=LIG_DES_PL.push(x.k)-1,ab=LIG_DES_PA===x.k,nn=_ligNorm(nm(x.n)),esc_=pq&&nn.indexOf(pq)<0;if(!esc_)vis++;
    let h='<tr class="pl'+(ab?" on":"")+'" data-n="'+_esc(nn)+'"'+(esc_?" hidden":"")+' tabindex="0" role="button" aria-expanded="'+ab+'" onclick="ligDesPa('+i+')" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();ligDesPa('+i+')}"><td><span class="rk'+(ix<3?" top":"")+'">'+(ix+1)+'</span><span class="nm"><b>'+_esc(nm(x.n))+'</b><small>'+fbPlural(Object.keys(x.ps).length,"pessoa","pessoas")+' com falta</small></span></td>'+x.v.map((_,k)=>cel(x,k)).join("")+'<td class="tt" data-tip="'+_esc(dicaPer(nm(x.n),x.v,Object.keys(x.ps).length))+'" data-tipj="'+_esc(perJ(nm(x.n),x.v,Object.keys(x.ps).length))+'"><b>'+x.t+'</b><i style="width:'+Math.round(x.t/mt*100)+'%"></i></td></tr>';
    if(ab){
      const ps=Object.values(x.ps).sort((a,b)=>b.t-a.t||a.nome.localeCompare(b.nome));
      const pmx=Math.max(1,...ps.map(q=>Math.max(...q.v)));
      h+='<tr class="pd"'+(esc_?" hidden":"")+'><td colspan="'+(nM+2)+'"><div class="pd-w"><div class="pd-h"><div><b>'+fbPlural(ps.length,"pessoa faltou","pessoas faltaram")+'</b> em '+_esc(nm(x.n))+'</div><span>'+rot+' · '+fl(x.t)+' · clique na pessoa para abrir o panorama</span></div><table><thead><tr><th>Colaborador</th>'+F.map(l=>'<th>'+fbMesCurto(l.k)+'</th>').join("")+'<th>Total</th></tr></thead><tbody>'
        +ps.map(q=>{const j=LIG_DES_ROWS.push({re:q.re,nome:q.nome})-1;return'<tr class="pp" tabindex="0" role="button" aria-label="Abrir o panorama de '+_esc(fbTitulo(q.nome))+'" onclick="ligDesAbrir('+j+')" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();ligDesAbrir('+j+')}"><td><span class="av">'+_esc(fbIni(q.nome))+'</span><span class="nm"><b>'+_esc(fbTitulo(q.nome))+'</b><small>'+(q.re?"RE "+_esc(q.re):"")+(q.cg?(q.re?" · ":"")+_esc(fbTitulo(q.cg)):"")+'</small></span></td>'
          +q.v.map((v,k)=>'<td class="n"><span class="mb '+(v?"h"+Math.min(4,Math.ceil(v/pmx*4)):"z")+'" title="'+fbMesCurto(F[k].k)+': '+fl(v)+'"><b>'+(v||"")+'</b><i style="height:'+(v?8+Math.round(v/pmx*20):3)+'px"></i></span></td>').join("")+'<td class="n t"><b>'+q.t+'</b><small>'+(q.t===1?"falta":"faltas")+'</small></td></tr>';}).join("")
        +'</tbody></table></div></td></tr>';
    }
    return h;}).join("");
  const tv=F.map((_,i)=>L.reduce((t,x)=>t+x.v[i],0)),tt=tv.reduce((a,b)=>a+b,0);
  const sel='<div class="fb-pills" role="group" aria-label="Postos efetivos ou reserva técnica" data-nav="pr" data-ind="fundo"><button type="button" class="'+(!res?"on":"")+'" onclick="ligDesPr(\'postos\')">Postos efetivos</button><button type="button" class="'+(res?"on":"")+'" onclick="ligDesPr(\'reserva\')">Reserva técnica</button></div>';
  const tab=L.length?'<div class="fb-tab ind fb-heat"><table><thead><tr><th>'+(res?"Reserva":"Posto")+'</th>'+F.map(l=>'<th>'+fbMesCurto(l.k)+'</th>').join("")+'<th>Total</th></tr></thead><tbody>'+linhas
      +'<tr class="tot"'+(pq?" hidden":"")+'><td><b>Total</b></td>'+tv.map((v,i)=>'<td data-tip="'+_esc(dicaTot(tv,i))+'" data-tipj="'+_esc(totJ(tv,i))+'"><b>'+v+'</b></td>').join("")+'<td class="tt" data-tip="'+_esc(dicaPer(res?"Toda a reserva técnica":"Todos os postos",tv,null))+'" data-tipj="'+_esc(perJ(res?"Toda a reserva técnica":"Todos os postos",tv,null))+'"><b>'+tt+'</b></td></tr></tbody></table></div>'
      +'<p class="fb-gnota" id="ld-pq-vazio"'+(vis?" hidden":"")+'>Nenhum'+(res?"a área":" posto")+' com esse nome.</p>'
      +'<div class="hm-leg"><div class="hm-esc"><span>Menos faltas</span><i class="h0"></i><i class="h1"></i><i class="h2"></i><i class="h3"></i><i class="h4"></i><span>Mais faltas</span></div>'
      +'<div class="hm-sig"><span><em class="up">▲ 2</em>faltou mais que no mês anterior</span><span><em class="dn">▼ 2</em>faltou menos que no mês anterior</span></div>'
      +'<ul class="hm-txt"><li>Número: '+_esc(PF.leg)+'</li>'+(PF.fb?'<li>Com feedback: a pessoa teve feedback registrado em até 30 dias depois da falta</li>':"")+'<li>Passe o mouse num número para ver a explicação e a %</li><li>Clique na linha para ver quem faltou</li></ul></div>'
    :'<p class="fb-gnota">Nenhuma falta '+_esc(PF.d)+' '+(res?"na reserva técnica":"nos postos")+' entre '+fbMesCurto(F[0].k)+' e '+fbMesCurto(F[nM-1].k)+'.</p>';
  const mais=LP[0],menos=LP.length>1?LP[LP.length-1]:null,fp=n=>fl(n)+" no período";
  const bar='<div class="fb-pst-f"><label class="fb-fl" for="ld-pf">Quais faltas contar</label><span class="fb-selp wide"><select id="ld-pf" onchange="ligDesPf(this.value)">'
    +Object.keys(FB_PF).map(k=>'<option value="'+k+'"'+(FB_PF[k]===PF?" selected":"")+'>'+FB_PF[k].t+'</option>').join("")+'</select>'+fbI("chev")+'</span>'
    +'<label class="fb-search fb-pq">'+fbI("search")+'<span class="fb-sr">Buscar '+(res?"área":"posto")+' pelo nome</span><input id="ld-pq" class="fb-in" type="search" placeholder="Buscar '+(res?"área":"posto")+' pelo nome" autocomplete="off" value="'+_esc(LIG_DES.pq||"")+'" oninput="ligDesPq(this.value)"></label></div>';
  return bar+'<div class="fb-dcs c3">'
    +fbDc("tn-da","Condomínio com mais faltas · "+rot,mais?_esc(fbTitulo(mais.n)):"Nenhum",mais?fp(mais.t):"Nenhuma falta nos postos","")
    +fbDc("tn-ok","Condomínio com menos faltas · "+rot,menos?_esc(fbTitulo(menos.n)):"—",menos?fp(menos.t)+" · entre os que tiveram falta":"Só um condomínio teve falta","")
    +fbDc("tn-gr","Faltas da reserva técnica · "+rot,fbNum(totR),LR.length?"em "+fbPlural(LR.length,"área","áreas")+" · no período":"Nenhuma área com falta","")
    +'</div>'+fbPainel((res?"Reserva técnica por supervisor, mês a mês":"Faltas por posto, mês a mês")+'<small>'+rot+' · '+_esc(PF.t)+'</small>',sel,tab,"big fb-hm-pn");
}
let LIG_DES_ROWS=[];
/* Efeito: o card escolhe a situação; a lista dela troca na hora e as linhas entram em sequência */
function ligDesSit(k){LIG_DES.sit=k;fbPostosAgora();
  if(!fbMov())return;const box=document.getElementById("lig-panel");if(!box)return;
  box.querySelectorAll(".ef-tb tbody tr").forEach((r,i)=>{if(i<16)r.animate([{opacity:.25,transform:"translate3d(0,8px,0)"},{opacity:1,transform:"none"}],{duration:380,delay:i*30,easing:FB_EASE,fill:"backwards"});});
  const bar=box.querySelector(".ef-bar");if(bar)bar.querySelectorAll("i").forEach(x=>x.animate([{opacity:.7},{opacity:1}],{duration:300}));}
function ligDesAbrir(i){const x=LIG_DES_ROWS[i];if(x)ligColab(x.re,x.nome);}

/* ═════ envio em lote: marca as pessoas e manda uma por vez, no ritmo do serviço ═════ */
function fbBarraLote(){
  const n=LIG_SEL.size;
  if(!n)return"";
  const envia=n<=LIG_LOTE_MAX;
  return'<div class="fb-bulk" role="status"><span><b>'+n+'</b> '+(n===1?"pessoa selecionada":"pessoas selecionadas")+(n>LIG_LOTE_MAX?' · o WhatsApp vai até '+LIG_LOTE_MAX+' por vez':"")+'</span>'
    +'<span class="fb-bulk-a"><button type="button" class="fb-btn ghost sm" onclick="ligSelLimpa()">Limpar seleção</button>'
    +(LIG_ABA==="fila"&&LIG_PODE_BAIXAR?'<span class="fb-selp"><select aria-label="Mover para a pasta" onchange="ligPastaMover(this.value);this.value=\'\'"><option value="">Mover para pasta…</option>'+Object.keys(FB_PASTAS).map(k=>'<option value="'+k+'">'+FB_PASTAS[k]+'</option>').join("")+'</select>'+fbI("chev")+'</span>':"")
    +'<button type="button" class="fb-btn pri sm" onclick="ligLote()"'+(envia?"":" disabled")+'>'+fbI("send")+'Enviar mensagem para '+n+'</button></span></div>';
}
function ligSelAtualiza(){const e=document.getElementById("lig-lote");if(e)e.innerHTML=fbBarraLote();}
/* LIG_SEL: as chaves marcadas; LIG_SEL_P: os dados de cada uma (nome, RE, celular e faltas) para o envio */
let LIG_SEL_P=new Map(),LIG_LOTE_GENTE=[];
function fbSelMarca(key,info,cx){
  if(cx.checked){
    if(LIG_SEL.size>=LIG_LOTE_MAX&&!(LIG_ABA==="fila"&&LIG_PODE_BAIXAR)){cx.checked=false;fbToast("O envio em massa vai até "+LIG_LOTE_MAX+" pessoas por vez. Envie este grupo e selecione as demais.","err");return;}
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
    if(p.fb_fim)ln.push(fbFimTxt(p.fb_fim));
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
  const ult=contatos.find(ligEfetivo)||null,dest=fbDestaque(p),ve=a?(FB_VD[a.veredito]||FB_VD.comecando):null;
  const kp=(n,r,t)=>'<div class="k '+(t||"")+'"><b>'+n+'</b><span>'+r+'</span></div>';
  const sec=(t,h)=>'<section class="ds"><h4>'+t+'</h4>'+h+'</section>';
  const dts=l=>l&&l.length?l.slice().sort().map(fbDd).join(", "):"nenhuma";
  const ponto=[],DS=["domingo","segunda-feira","terça-feira","quarta-feira","quinta-feira","sexta-feira","sábado"],dsC={};
  sj90.forEach(h=>{const k=new Date(h[0]+"T12:00:00Z").getUTCDay();dsC[k]=(dsC[k]||0)+1;});
  const topD=Object.keys(dsC).sort((x,y)=>dsC[y]-dsC[x])[0];
  if(sj90.length)ponto.push("Faltou "+fbPlural(sj90.length,"vez","vezes")+" sem justificativa nos últimos 90 dias ("+sj30.length+" nos últimos 30).");
  if(topD!==undefined&&dsC[topD]>=2&&sj90.length>=3)ponto.push("As faltas se repetem às "+DS[topD]+"s ("+dsC[topD]+" de "+sj90.length+").");
  if(a)ponto.push("Desde o feedback de "+fbDd(c.data)+": "+fbPlural(a.depois,"falta","faltas")+" contra "+a.antes+" nos 30 dias anteriores ("+String(ve.t).toLowerCase()+"). Faltam "+Math.max(0,30-a.dia)+" dias de acompanhamento.");
  if(!a&&p.fb_fim)ponto.push(fbFimTxt(p.fb_fim)+".");
  if(ult&&ult.motivo)ponto.push("Motivo informado no último feedback: "+fbMotNome(ult.motivo)+(ult.justificativa?". Disse: “"+ult.justificativa+"”.":"."));
  if(c&&c.acordo)ponto.push("Combinado: "+c.acordo+(c.acordo_prazo?" (prazo "+fbDd(c.acordo_prazo)+")":"")+(c.acordo_auto&&FB_ACOR[c.acordo_auto]?" — "+FB_ACOR[c.acordo_auto][0].toLowerCase():"")+".");
  if(p.situacao==="base")ponto.push("Não ligou depois de "+(p.tentativas||2)+" mensagens do SAC: a conversa cabe à coordenação.");
  if(!ponto.length)ponto.push("Sem pendências nos registros do SAC.");
  const reg=ult?fbRegistroCompleto(ult,c&&c.id===ult.id&&c.acordo_prazo?(FB_ACOR[c.acordo_auto]||FB_ACOR.pendente):null):"";
  const tab=(cab,lin)=>'<table class="dt"><thead><tr>'+cab.map(x=>'<th>'+x+'</th>').join("")+'</tr></thead><tbody>'+lin.map(l=>'<tr>'+l.map(x=>'<td>'+x+'</td>').join("")+'</tr>').join("")+'</tbody></table>';
  const nomeCod=h=>h[1]==="I"?"Sem justificativa":h[1]==="T"?"Sem justificativa":(FB_ABO_NOME[h[1]]||"Falta");
  const f90=hist.filter(x=>x[1]!=="D"&&x[0]>ligSomaDias(hj,-90));
  const ms=((LIG_HIST&&LIG_HIST.medidas)||[]).filter(m=>p.re&&String(m.re)===String(p.re)).sort((x,y)=>String(y.data).localeCompare(String(x.data)));
  let h='<article class="fb-doc"><header class="dh"><div><small>Grupo ServCamp · Feedback de Faltas</small><h3>Resumo para a coordenação</h3></div><span>Emitido em '+rhFmt(hj)+'</span></header>';
  h+='<div class="dp"><div class="av">'+_esc(fbIni(p.nome))+'</div><div><h2>'+_esc(p.nome)+'</h2><p>'+(p.re?"RE "+_esc(p.re):"")+(p.posto?" · "+_esc(fbTitulo(p.posto)):"")+'</p><p>'+(p.supervisor?"Supervisor: <b>"+_esc(fbTitulo(p.supervisor))+"</b>":"")+(fbFone(p.telefone)?" · "+_esc(fbFone(p.telefone)):"")+'</p></div><span class="fb-vd '+(ve?ve.tom:sit.tom)+'">'+_esc(ve?ve.t:sit.t)+'</span></div>';
  h+='<div class="dk">'+kp(sj30.length,"faltas sem justificativa<br>nos últimos 30 dias","r")+kp(ab30.length,"faltas abonadas<br>nos últimos 30 dias","b")+kp(env.length,"mensagens do SAC<br>enviadas","v")+kp(contatos.filter(ligEfetivo).length,"feedbacks<br>realizados","g")+'</div>';
  h+=sec("Situação atual",'<p class="dst '+dest[2]+'"><b>'+_esc(dest[0])+'.</b> '+_esc(dest[1])+'</p>');
  if(a)h+=sec("Acompanhamento de 30 dias",'<div class="da"><div><small>Antes do feedback</small><b>'+fbPlural(a.antes,"falta","faltas")+'</b><span>'+fbDd(ligSomaDias(c.data,-29))+' a '+fbDd(c.data)+'<br>'+_esc(dts(a.faltas_antes))+'</span></div><div><small>Depois do feedback</small><b>'+fbPlural(a.depois,"falta","faltas")+'</b><span>'+fbDd(ligSomaDias(c.data,1))+' a '+fbDd(ligSomaDias(c.data,30))+' · dia '+Math.min(30,a.dia)+' de 30<br>'+_esc(dts(a.faltas_depois))+'</span></div><div class="'+({"tn-da":"r","tn-ok":"g"}[ve.tom]||"")+'"><small>Resultado</small><b>'+_esc(ve.t)+'</b><span>'+a.antes+' antes, '+a.depois+' depois</span></div></div>');
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
const FB_DEST={};FB_VD_ORDEM.forEach(k=>{FB_DEST[k]=[FB_VD[k].t,FB_VD[k].d,FB_VD[k].tom];});
function fbDestaque(p){
  if(p.acomp)return FB_DEST[p.acomp.veredito]||FB_DEST.mesma;
  if(p.situacao==="mensagem")return["Aguardando mensagem","O SAC ainda não enviou mensagem."+(p.tentativas>0?" Uma mensagem anterior ficou sem resposta.":""),"tn-br"];
  if(p.situacao==="aguardando")return p.envio==="sem_retorno"
    ?["Não ligou","A pessoa não ligou depois "+(p.ultima_marca_manual?"da tentativa":"da mensagem")+" de "+fbDd(p.ultima_marca)+". Se faltar de novo e não responder, o caso vai para a coordenação.","tn-am"]
    :["Aguardando ligação","A pessoa tem até "+fbDd(p.prazo_ate||p.ultima_marca)+" para ligar para o SAC.","tn-br"];
  if(p.situacao==="base")return["Com a coordenação","A pessoa não ligou depois de "+p.tentativas+" mensagens do SAC. Cabe à coordenação conversar com ela.","tn-da"];
  return["Sem pendência","Nenhuma falta sem justificativa aguardando o SAC nos últimos 30 dias.","tn-gr"];
}
/* feedback com mais de 30 dias (vem do servidor): o mesmo resultado do Desempenho */
function fbFimTxt(f){const v=FB_VD[f.veredito]||FB_VD.mesma;return"Resultado do feedback de "+fbDd(f.data)+": "+v.t+" ("+f.antes+" antes, "+f.depois+" depois)";}
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
  const r=fbMesesPessoa(p),L=r.lin,hj=ligHojeISO(),kc=fbMesChave(hj,r.modo),tot=L.reduce((t,l)=>t+l.sj,0);
  return'<div class="fb-det-h"><span>'+(r.modo==="civil"?"Mês do calendário":"Período da folha, 26 a 25")+'</span><span class="fb-pill-s">'+fbPlural(tot,"falta sem justificativa","faltas sem justificativa")+' em 6 meses</span></div>'
    +fbGCols({rot:"Faltas por mês",rots:L.map(l=>fbMesCurto(l.k)+(l.k===kc?"*":"")),empilha:true,h:230,series:[{nome:"Sem justificativa",cor:FB_COR.azul,vals:L.map(l=>l.sj)},{nome:"Abonadas",cor:FB_COR.azulc,vals:L.map(l=>l.ab)}]})
    +fbLeg([["Sem justificativa",FB_COR.azul],["Abonadas",FB_COR.azulc]])+'<p class="fb-gnota">* '+fbMesCurto(kc)+' em andamento, até '+fbDd(hj)+'.</p>';
}
/* linha do tempo do acompanhamento: uma coluna por dia (30 antes, o dia do feedback e 30 depois), cada situação com a sua cor */
const FB_TL={f:["#f43f5e","Falta sem justificativa"],a:["#2563eb","Falta abonada"],ok:["#86d9a8","Sem falta"],fut:["#cbd5e1","Dia que ainda não chegou"],fb:["#0f2350","Dia do feedback realizado"],m:["#8b5cf6","Mensagem do SAC enviada"]};
function fbTlLegenda(){return'<ul class="fb-tl-leg">'+["f","a","ok","fut","fb","m"].map(k=>'<li><i class="k-'+k+'" style="background:'+FB_TL[k][0]+'"></i>'+FB_TL[k][1]+'</li>').join("")+'</ul>';}
function fbGLinha(o){
  const [cod,env]=fbMapas(o.p),hj=ligHojeISO(),W=680,H=192,pl=10,pr=10,pt=70,pb=32,base=H-pb,w=(W-pl-pr)/60,X=n=>pl+(n+29)*w,alto=58;
  let s='<svg class="fb-g fb-gl" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Um dia por coluna: 30 dias antes do feedback, o feedback e os 30 dias de acompanhamento"><defs><pattern id="fgl" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="8" stroke="#d3dbe8" stroke-width="3"/></pattern></defs>';
  s+='<rect x="'+X(-29)+'" y="'+pt+'" width="'+(X(1)-X(-29))+'" height="'+(base-pt)+'" rx="10" fill="#eef3fd"/>';
  s+='<rect x="'+X(1)+'" y="'+pt+'" width="'+(X(31)-X(1))+'" height="'+(base-pt)+'" rx="10" fill="#f1faf4"/>';
  s+='<text x="'+(X(-29)+8)+'" y="18" class="gt">Antes do feedback</text><text x="'+(X(-29)+8)+'" y="38" class="gs">'+o.fa.length+(o.fa.length===1?" falta":" faltas")+' em 30 dias</text>';
  s+='<text x="'+(X(31)-8)+'" y="18" class="gt" text-anchor="end">Depois do feedback</text><text x="'+(X(31)-8)+'" y="38" class="gs" text-anchor="end">'+o.fd.length+(o.fd.length===1?" falta":" faltas")+' até hoje</text>';
  for(let n=-29;n<=30;n++){
    const d=ligSomaDias(o.c,n),c=cod[d],x=X(n)+w*.15,bw=w*.7;
    let k,h2,txt;
    if(d>hj){k="fut";h2=14;txt="Ainda não chegou";}
    else if(c==="I"||c==="T"){k="f";h2=alto;txt="Falta sem justificativa";}
    else if(["A","J","L","AF"].indexOf(c)>=0){k="a";h2=alto;txt=FB_ABO_NOME[c]||"Falta abonada";}
    else{k="ok";h2=14;txt="Sem falta";}
    const ms=env[d]?" · mensagem do SAC enviada":"",rel=n===0?"dia do feedback":n<0?Math.abs(n)+(n===-1?" dia antes":" dias antes"):"dia "+n+" de 30";
    s+='<rect x="'+x+'" y="'+(base-h2)+'" width="'+bw+'" height="'+h2+'" rx="3" fill="'+(k==="fut"?"url(#fgl)":FB_TL[k][0])+'"'+(k==="fut"?' stroke="#d3dbe8"':"")+' data-tip="'+_esc(fbDd(d)+" · "+txt+ms+" · "+rel)+'"/>';
    if(env[d])s+='<circle cx="'+(x+bw/2)+'" cy="'+(base-h2-9)+'" r="4" fill="'+FB_TL.m[0]+'"/>';
    /* o dia do feedback é o último dia do "antes": a coluna dele mostra a situação do dia e leva a marca do feedback */
    if(n===0){const cx=X(0)+w/2;s+='<line x1="'+cx+'" x2="'+cx+'" y1="'+(pt-4)+'" y2="'+base+'" stroke="'+FB_TL.fb[0]+'" stroke-width="2" stroke-dasharray="2 3"/><path d="M'+cx+' '+(base-9)+' l9 9 l-9 9 l-9 -9 Z" fill="'+FB_TL.fb[0]+'" stroke="#fff" stroke-width="2" data-tip="'+_esc(fbDd(d)+" · Feedback realizado · "+txt+" · dia do feedback"+(env[d]?" · mensagem do SAC enviada":""))+'"/>';}
  }
  const hh=fbDiasEntre(o.c,hj);
  if(hh>0&&hh<=30){const x=X(hh)+w/2,perto=Math.abs(x-(X(0)+w/2))<72,dy=perto?-24:0;s+='<rect x="'+(X(hh)-1)+'" y="'+pt+'" width="'+(w+2)+'" height="'+(base-pt)+'" fill="none" stroke="#0f2350" stroke-width="1.5" stroke-dasharray="3 3" rx="3"/>'+(perto?'<line x1="'+x+'" x2="'+x+'" y1="'+(pt-4+dy+20)+'" y2="'+pt+'" stroke="#0f2350" stroke-width="1.5"/>':"")+'<g><rect x="'+(x-26)+'" y="'+(pt-22+dy)+'" width="52" height="20" rx="10" fill="#0f2350"/><text x="'+x+'" y="'+(pt-8+dy)+'" class="gp2" text-anchor="middle">Hoje</text></g>';}
  { const x=X(0)+w/2;s+='<g><rect x="'+(x-38)+'" y="'+(pt-22)+'" width="76" height="20" rx="10" fill="'+FB_TL.fb[0]+'"/><text x="'+x+'" y="'+(pt-8)+'" class="gp2" text-anchor="middle">Feedback</text></g>';}
  s+='<line x1="'+pl+'" x2="'+(W-pr)+'" y1="'+base+'" y2="'+base+'" stroke="#c9d3e3"/>';
  [[-29,"start"],[-15,"middle"],[0,"middle"],[15,"middle"],[30,"end"]].forEach(t=>{s+='<text class="gx" text-anchor="'+t[1]+'" x="'+(X(t[0])+(t[1]==="start"?0:t[1]==="end"?w:w/2))+'" y="'+(H-14)+'">'+fbDd(ligSomaDias(o.c,t[0]))+'</text>';});
  return s+'</svg>';
}
/* histórico completo (400 dias) para o "mês a mês": busca uma vez por pessoa */
function fbPanCompleto(p,feito){
  if(p._completo){feito();return;}
  ligApi("/api/ligacoes?acao=colaborador&re="+encodeURIComponent(p.re||"")+"&nome="+encodeURIComponent(p.nome||"")).then(j=>{if(j&&j.pessoa&&LIG_PAN===p){p.hist=j.pessoa.hist;p._completo=1;feito();}}).catch(()=>{});
}
/* Histórico disciplinar do ano (de 01/01 até hoje): faltas sem justificativa, abonadas e as medidas aplicadas.
   As medidas vêm da mesma lista do painel Faltas x Medidas (/api/rh?modulo=faltas&t=historico); as faltas, do histórico completo da pessoa. */
const FB_ABONADAS=["A","J","L","AF"];
function fbMedTxt(m){const t=String(m.tipo||"").toUpperCase(),g=String(m.grau||"").toUpperCase();
  if(t.indexOf("SUSPENS")===0)return"Suspensão"+(Number(m.dias)?" de "+Number(m.dias)+(Number(m.dias)===1?" dia":" dias"):"");
  return"Advertência"+(g==="VERBAL"?" verbal":g==="ESCRITA"?" escrita":"");}
function fbMedidasDe(p){
  const pn=_ligNorm(String(p.nome||"").split(" ")[0]);
  return((LIG_HIST&&LIG_HIST.medidas)||[]).filter(m=>p.re&&String(m.re)===String(p.re)&&(!m.nome||m.nome==="—"||!pn||_ligNorm(String(m.nome).split(" ")[0])===pn))
    .sort((a,b)=>String(b.data).localeCompare(String(a.data)));
}
/* dados do ano da pessoa (01/01 até hoje) */
function fbDiscDados(p){
  const hj=ligHojeISO(),ano=hj.slice(0,4),ini=ano+"-01-01",fOk=!!p._completo,mOk=!!LIG_HIST,sj=[],ab=[];
  (p.hist||[]).forEach(h=>{if(h[0]<ini||h[0]>hj)return;if(h[1]==="I"||h[1]==="T")sj.push(h[0]);else if(FB_ABONADAS.indexOf(h[1])>=0)ab.push([h[0],h[1]]);});
  sj.sort();ab.sort((x,y)=>(x[0]<y[0]?-1:x[0]>y[0]?1:0));
  const canc=m=>/CANCEL/i.test(m.fase||""),med=mOk?fbMedidasDe(p):[],val=med.filter(m=>!canc(m));
  return{hj,ano,ini,fOk,mOk,sj,ab,canc,med,val,rein:val.length>=2};
}
/* no panorama: uma linha sóbria com os totais e o botão. O histórico completo abre numa janela à parte. */
function fbDiscHtml(p){
  const D=fbDiscDados(p),n=(ok,v)=>ok?String(v):'<i class="ld">…</i>';
  return'<section class="fb-disc dcc" aria-label="Histórico disciplinar do ano"><div class="dt"><b>Histórico disciplinar · '+D.ano+'</b><span>'+rhFmt(D.ini)+' a '+rhFmt(D.hj)+'</span></div>'
    +'<dl class="dn"><div><dd>'+n(D.fOk,D.sj.length)+'</dd><dt>Sem justificativa</dt></div><div><dd>'+n(D.fOk,D.ab.length)+'</dd><dt>'+(D.ab.length===1?"Abonada":"Abonadas")+'</dt></div><div><dd>'+n(D.mOk,D.val.length)+'</dd><dt>'+(D.val.length===1?"Medida":"Medidas")+'</dt></div></dl>'
    +(D.rein?'<span class="rnc">Reincidente</span>':"")
    +'<button type="button" class="fb-btn sm" onclick="ligDiscAbrir()">'+fbI("hist")+'Ver histórico</button></section>';
}
/* a janela do histórico: ficha com os totais, duas abas (Medidas e Faltas do ano) e tabelas */
let LIG_DISC_ABA="med";
function fbDiscCorpo(p){
  const D=fbDiscDados(p),{ano,ini,fOk,mOk,sj,ab,canc,med,val}=D;
  const dw=["dom","seg","ter","qua","qui","sex","sáb"],dia=d=>rhFmt(d)+" ("+dw[new Date(d+"T12:00:00Z").getUTCDay()]+")";
  const n=(ok,v)=>ok?String(v):"…";
  const linhas=!mOk?'<p class="bv">Carregando as medidas…</p>'
    :!med.length?'<p class="bv"><b>Nenhuma medida disciplinar em '+ano+'.</b> Esta é a primeira ocorrência da pessoa no ano.</p>'
    :'<table class="tb"><thead><tr><th>Data</th><th>Medida</th><th>Motivo</th><th>Situação</th></tr></thead><tbody>'+med.map(m=>{const c=canc(m),su=String(m.tipo||"").toUpperCase().indexOf("SUSPENS")===0;
      return'<tr'+(c?' class="canc"':"")+'><td class="d">'+rhFmt(String(m.data).slice(0,10))+'</td><td><span class="md '+(su?"sus":"adv")+'">'+_esc(fbMedTxt(m))+'</span></td><td>'+_esc(m.motivo||"Sem motivo informado")+'</td><td class="st '+(c?"no":"ok")+'">'+(c?"Cancelada · não conta":"Válida")+'</td></tr>';}).join("")+'</tbody></table>';
  const boxMed='<div class="bx"><div class="bh"><h5>Medidas disciplinares aplicadas</h5><span>'+(mOk?(med.length?fbPlural(val.length,"válida","válidas")+(med.length>val.length?" · "+fbPlural(med.length-val.length,"cancelada","canceladas"):""):"nenhuma"):"…")+'</span></div>'
    +'<p class="bd">Mesma lista do painel Faltas x Medidas, da mais recente para a mais antiga. Medida cancelada não conta.</p>'+linhas+'</div>';
  const mes=Array.from({length:12},()=>({sj:0,ab:0}));
  sj.forEach(d=>{mes[Number(d.slice(5,7))-1].sj++;});ab.forEach(a=>{mes[Number(a[0].slice(5,7))-1].ab++;});
  const mc=Number(D.hj.slice(5,7))-1,z=v=>v?v:"–";
  const grade=fOk?'<table class="tb ano"><thead><tr><th></th>'+FB_MESES.map((m,i)=>'<th'+(i===mc?' class="at"':"")+'>'+m+'</th>').join("")+'<th class="tt">Total</th></tr></thead><tbody>'
      +'<tr><td class="rt">Sem justificativa</td>'+mes.map((x,i)=>'<td class="'+(i>mc?"fut":x.sj?"v":"z")+(i===mc?" at":"")+'">'+(i>mc?"":z(x.sj))+'</td>').join("")+'<td class="tt">'+sj.length+'</td></tr>'
      +'<tr><td class="rt">Abonadas</td>'+mes.map((x,i)=>'<td class="'+(i>mc?"fut":x.ab?"v":"z")+(i===mc?" at":"")+'">'+(i>mc?"":z(x.ab))+'</td>').join("")+'<td class="tt">'+ab.length+'</td></tr></tbody></table>'
    :'<p class="bv">Carregando as faltas do ano…</p>';
  const boxMes='<div class="bx"><div class="bh"><h5>Faltas mês a mês em '+ano+'</h5><span>'+(fOk?fbPlural(sj.length+ab.length,"falta no total","faltas no total"):"…")+'</span></div>'+grade+'</div>';
  const caixa=(tit,desc,l,fmt,vazio)=>'<div class="bx"><div class="bh"><h5>'+tit+'</h5><span>'+(fOk?fbPlural(l.length,"registro","registros"):"…")+'</span></div><p class="bd">'+desc+'</p>'
    +(!fOk?'<p class="bv">Carregando…</p>':l.length?'<ol class="dl">'+l.map(fmt).join("")+'</ol>':'<p class="bv"><b>Nenhuma</b> '+vazio+' em '+ano+'.</p>')+'</div>';
  const datas='<div class="dg">'+caixa("Faltas sem justificativa","Datas em que a pessoa faltou sem justificar.",sj,d=>'<li>'+dia(d)+'</li>',"falta sem justificativa")
    +caixa("Faltas abonadas","Datas das faltas com atestado, licença ou afastamento.",ab,a=>'<li>'+dia(a[0])+'<em>'+_esc(FB_ABO_NOME[a[1]]||"Abonada")+'</em></li>',"falta abonada")+'</div>';
  const ab_=LIG_DISC_ABA==="fal"?"fal":"med";
  const nav='<nav class="dtab" role="tablist" aria-label="Histórico disciplinar"><button type="button" role="tab" class="'+(ab_==="med"?"on":"")+'" aria-selected="'+(ab_==="med")+'" onclick="ligDiscAba(\'med\')">Medidas disciplinares<span>'+n(mOk,val.length)+'</span></button>'
    +'<button type="button" role="tab" class="'+(ab_==="fal"?"on":"")+'" aria-selected="'+(ab_==="fal")+'" onclick="ligDiscAba(\'fal\')">Faltas do ano<span>'+n(fOk,sj.length+ab.length)+'</span></button></nav>';
  const ficha='<div class="kp"><div><small>Faltas sem justificativa</small><b class="neg">'+n(fOk,sj.length)+'</b></div><div><small>Faltas abonadas</small><b>'+n(fOk,ab.length)+'</b></div>'
    +'<div><small>Medidas disciplinares válidas</small><b>'+n(mOk,val.length)+'</b>'+(D.rein?'<em>Reincidente</em>':"")+'</div><div class="per"><small>Período</small><b>'+rhFmt(ini)+' a '+rhFmt(D.hj)+'</b></div></div>';
  return'<section class="fb-disc dsc">'+ficha+nav+'<div class="dsc-s" data-k="med"'+(ab_==="med"?"":" hidden")+'>'+boxMed+'</div><div class="dsc-s" data-k="fal"'+(ab_==="fal"?"":" hidden")+'>'+boxMes+datas+'</div></section>';
}
function ligDiscAbrir(){
  const p=LIG_PAN;if(!p)return;
  fbDialog("lig-disc-modal",{titulo:"Histórico disciplinar de "+ligHojeISO().slice(0,4),sub:_esc(fbTitulo(p.nome))+(p.re?" · RE "+_esc(p.re):"")+(p.posto?" · "+_esc(fbTitulo(p.posto)):""),tam:"dsc",semFoco:true,
    corpo:'<div id="ld-disc-corpo">'+fbDiscCorpo(p)+'</div>',rodape:'<button type="button" class="fb-btn navy sm" onclick="fbFechar(\'lig-disc-modal\')">Fechar</button>'});
}
function ligDiscAba(k){
  LIG_DISC_ABA=k;const m=document.getElementById("lig-disc-modal");if(!m)return;
  m.querySelectorAll(".dtab>button").forEach((b,i)=>{const on=(i===0)===(k==="med");b.classList.toggle("on",on);b.setAttribute("aria-selected",on);});
  m.querySelectorAll(".dsc-s").forEach(x=>{x.hidden=x.dataset.k!==k;});
}
function fbDiscPintar(){const b=document.getElementById("lp-disc");if(b&&LIG_PAN)b.innerHTML=fbDiscHtml(LIG_PAN);const c=document.getElementById("ld-disc-corpo");if(c&&LIG_PAN)c.innerHTML=fbDiscCorpo(LIG_PAN);}
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
    +'<span class="s">'+(dia>=30?"Concluído em ":"Termina em ")+fbDd(ligSomaDias(c.data,30))+(dia>=30?"":" · faltam "+fbPlural(30-dia,"dia","dias"))+'</span></div>';
}
/* calendário do acompanhamento: o dia do contato e os 30 dias seguintes, em sequência (não pelo mês do calendário) */
/* Calendário do acompanhamento: resumo em números, um quadro por mês e a legenda. O dia do feedback e os 30 dias seguintes. */
function fbCalJanela(p,c){
  const [cod,env]=fbMapas(p),hj=ligHojeISO(),NM=["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
  const fim=ligSomaDias(c.data,30),meses={},ordem=[];let sj=0,ab=0,ok=0,pass=0,msg=0;
  for(let n=0;n<=30;n++){
    const d=ligSomaDias(c.data,n),r=fbDia(p,d,cod,env,hj,c.data),k=d.slice(0,7);
    if(!meses[k]){meses[k]={k,dias:[],sj:0,ab:0};ordem.push(k);}
    const cls=r[0].split(" ")[0];
    if(d<=hj&&n>0){pass++;if(cls==="f")sj++;else if(cls==="a")ab++;else ok++;}
    if(d<=hj&&n>0&&cls==="f")meses[k].sj++;
    if(d<=hj&&n>0&&cls==="a")meses[k].ab++;
    if(env[d]&&n>0&&d<=hj)msg++;
    meses[k].dias.push({n,d,r,cls});
  }
  const nDia=Math.min(30,Math.max(0,fbDiasEntre(c.data,hj)));
  const rot={f:"Falta",a:"Abono",ok:"",fut:""},cap=(x)=>x.r[0].indexOf(" c")>=0||x.r[0].split(" ").indexOf("c")>=0?"Feedback":x.d===hj?"Hoje":rot[x.cls]||"";
  const quadro=m=>{
    const ini=m.dias[0].d,off=fbDow(ini);let h='<div class="mb"><div class="mh"><b>'+NM[Number(m.k.slice(5,7))-1]+' de '+m.k.slice(0,4)+'</b><span>'+(m.sj||m.ab?(m.sj?fbPlural(m.sj,"falta","faltas")+" sem justificativa":"")+(m.sj&&m.ab?" · ":"")+(m.ab?fbPlural(m.ab,"abonada","abonadas"):""):"nenhuma falta no mês")+'</span></div>'
      +'<div class="cj">'+["Seg","Ter","Qua","Qui","Sex","Sáb","Dom"].map(x=>'<small>'+x+'</small>').join("");
    for(let k=0;k<off;k++)h+='<span class="v"></span>';
    m.dias.forEach(x=>{const cp=cap(x);
      h+='<i class="'+x.r[0]+'" data-d="'+x.n+'" data-tip="'+(x.n?"Dia "+x.n+" de 30":"Dia do feedback")+' · '+fbDd(x.d)+' · '+_esc(x.r[1])+'"><b>'+x.d.slice(8,10)+'</b>'+(cp?'<em>'+cp+'</em>':"")+'</i>';});
    return h+'</div></div>';
  };
  const kp=(rt,v,sub)=>'<div><small>'+rt+'</small><b>'+v+'</b>'+(sub?'<span>'+sub+'</span>':"")+'</div>';
  const resumo='<div class="ck">'+kp("Acompanhamento",nDia>=30?"Concluído":"Dia "+nDia+" de 30",nDia>=30?"terminou em "+fbDd(fim):"termina em "+fbDd(fim))
    +kp("Faltas sem justificativa","<i class=\"neg\">"+sj+"</i>","depois do feedback")+kp("Faltas abonadas",String(ab),"depois do feedback")+kp("Dias sem falta",String(ok),"de "+pass+(pass===1?" dia":" dias")+" já passados")+kp("Mensagens do SAC",String(msg),"enviadas no período")+'</div>';
  const leg='<ul class="cl"><li><i class="ok"></i>Sem falta registrada</li><li><i class="f"></i>Falta sem justificar</li><li><i class="a"></i>Abonada</li><li><i class="c"></i>Dia do feedback</li><li><i class="h"></i>Hoje</li><li><i class="fut"></i>Ainda não chegou</li><li><i class="m"></i>Mensagem do SAC enviada</li></ul>';
  return'<section class="fb-card2 fb-calc fb-cj"><header class="ch"><div class="t">'+fbI("cal")+'<b>Calendário do acompanhamento</b></div><span>Feedback '+fbDd(c.data)+' · termina '+fbDd(fim)+'</span></header>'+resumo+'<div class="cm">'+ordem.map(k=>quadro(meses[k])).join("")+'</div>'+leg+'</section>';
}
function ligPanorama(p){
  LIG_PAN=p;LIG_PAN_ABA="resumo";
  const hj=ligHojeISO(),sit=FB_SIT.find(s=>s.k===p.situacao)||{t:"Sem pendência",tom:"tn-gr"};
  const contatos=LIG_C.filter(c=>fbDaPessoa(c,p));
  const a=p.acomp,c=p.contato;
  const v=a?(FB_VD[a.veredito]||FB_VD.comecando):{t:sit.t,tom:sit.tom};
  const icV=a?v.ic:({mensagem:"chat",aguardando:"clock",base:"alert"}[p.situacao]||"info");
  const plF=n=>n+" "+(n===1?"falta":"faltas");
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
  const st=(cls,ic,rot,num,sub,datas,tom)=>'<div class="'+cls+'"><small>'+fbI(ic)+rot+'</small><b>'+num+'</b><em>'+sub+'</em>'+(datas!==undefined?(datas.length?'<span class="fb-dts-r">Faltou em</span>':"")+fbChipsDatas(datas,tom):"")+'</div>';
  let res;
  if(a){
    /* o resultado é o veredito do servidor; aqui só o que ele contou: faltas antes, faltas depois, em que dia do acompanhamento está */
    const dia=Math.min(30,Math.max(0,a.dia));
    res='<section class="fb-res '+v.tom+'"><div class="fb-res-n"><div><b>'+a.antes+'</b><span>'+(a.antes===1?"falta":"faltas")+' antes</span></div><i aria-hidden="true">→</i><div class="d"><b>'+a.depois+'</b><span>'+(a.depois===1?"falta":"faltas")+' depois</span></div><div class="r"><b>'+fbI(v.ic)+_esc(v.t)+'</b><span>'+(dia>=30?"Acompanhamento concluído":dia>0?"Dia "+dia+" de 30 · termina em "+fbDd(ligSomaDias(c.data,30)):"Feedback hoje")+'</span></div></div>'
      +'<div class="fb-pm-prog" role="progressbar" aria-valuemin="0" aria-valuemax="30" aria-valuenow="'+dia+'"><i style="width:'+Math.round(dia/30*100)+'%"></i></div>'
      +'<dl class="fb-res-d"><div><dt>Faltou antes em</dt><dd>'+fbChipsDatas(a.faltas_antes||[],"f")+'</dd></div><div><dt>Faltou depois em</dt><dd>'+fbChipsDatas(a.faltas_depois||[],"f")+'</dd></div></dl></section>';
  }else{
    const sj30=(p.hist||[]).filter(h=>(h[1]==="I"||h[1]==="T")&&h[0]>ligSomaDias(hj,-30)&&h[0]<=hj).map(h=>h[0]);
    const env=(p.envios||[]).slice().sort();
    res='<div class="fb-st3">'+(p.situacao==="sem"
      ?st("t-b","cal","Sem justificativa",plF(sj30.length),"nos últimos 30 dias",sj30,"f")+st("t-g","chat","Mensagens do SAC",String(env.length),"nos últimos meses",env,"m")+st("t-vi","phone","Feedbacks",String(contatos.filter(ligEfetivo).length),contatos.length?"último em "+fbDd(ligDataContato(contatos[0])):"nenhum até hoje")
      :st("t-b","cal","Faltas sem conversa",plF(p.faltas.length),"nos últimos 30 dias",p.faltas,"f")+st("t-g","chat","Mensagens do SAC",String(p.mensagens||env.length||0),"desde a primeira falta",env,"m")+st("t-vi","alert","Sem resposta",String(p.tentativas||0),"2 levam à coordenação"))+'</div>'
      +'<p class="fb-tl-nota '+fbDestaque(p)[2]+'"><b>'+_esc(fbDestaque(p)[0])+'.</b> '+_esc(fbDestaque(p)[1])+'</p>'
      +(p.fb_fim?'<p class="fb-tl-nota '+(FB_VD[p.fb_fim.veredito]||FB_VD.mesma).tom+'"><b>'+_esc(fbFimTxt(p.fb_fim))+'.</b></p>':"");
  }
  /* combinado */
  let acordo="";
  if(c&&c.acordo_prazo){
    const au=c.acordo_auto&&FB_ACOR[c.acordo_auto]?FB_ACOR[c.acordo_auto]:FB_ACOR.pendente;
    acordo='<div class="fb-ac2 '+au[1]+'"><div><b>Combinado: '+_esc(c.acordo||"registrado")+'</b><span>Prazo: '+fbDd(c.acordo_prazo)+'</span></div>'+fbTag(au[0],au[1])+'</div>';
  }
  const auReg=c&&c.acordo_prazo?(c.acordo_auto&&FB_ACOR[c.acordo_auto]?FB_ACOR[c.acordo_auto]:FB_ACOR.pendente):null;
  const disc='<div id="lp-disc">'+fbDiscHtml(p)+'</div>';
  const resumo=a?res+disc+fbFicha(reg,auReg):disc+fbFicha(reg,auReg)+res+fbFunilPessoa(p,contatos,"");
  /* calendário de um mês por vez */
  const ini=a?ligSomaDias(c.data,-29):ligSomaDias(hj,p.situacao==="sem"?-89:-30),fim=a?ligSomaDias(c.data,30):fbFimCal(hj,hj);
  const meses=fbMesesLista(ini,fim);
  LIG_MESES=meses.map(m=>m.nome);LIG_MES=Math.max(0,meses.findIndex(m=>m.k===hj.slice(0,7)));if(LIG_MES<0||meses.every(m=>m.k!==hj.slice(0,7)))LIG_MES=meses.length-1;
  const leg='<ul class="fb-leg fb-leg2"><li><i class="ok"></i>Sem falta registrada</li><li><i class="f"></i>Falta sem justificar</li><li><i class="a"></i>Abonada</li><li><i class="c"></i>Dia do feedback</li><li><i class="h"></i>Hoje</li><li><i class="m"></i>Mensagem do SAC</li></ul>';
  const pager='<div class="fb-pager"><button type="button" class="fb-ib" id="lp-mes-a" onclick="ligMes(-1)" aria-label="Mês anterior"'+(LIG_MES===0?" disabled":"")+'>'+fbI("left")+'</button><span id="lp-mes">'+_esc(LIG_MESES[LIG_MES]||"")+'</span><button type="button" class="fb-ib" id="lp-mes-b" onclick="ligMes(1)" aria-label="Próximo mês"'+(LIG_MES===meses.length-1?" disabled":"")+'>'+fbI("go")+'</button></div>';
  const cal=a?fbCalJanela(p,c)
    :'<section class="fb-card2 fb-calc">'+fbCartaoH("cal","Calendário de Faltas",pager)+'<div class="fb-calwrap">'+fbCelulas(p,ini,fim,null,LIG_MES)+leg+'</div></section>';
  /* evolução: antes × depois (quem está em acompanhamento) e o mês a mês */
  let evo="";
  if(a){
    const fa2=a.faltas_antes||[],fd2=a.faltas_depois||[];
    evo='<div class="fb-evoc">'
      +fbPainel("Faltas antes e depois do feedback","",fbGLinha({c:c.data,p,fa:fa2,fd:fd2})+'<p class="fb-gnota">Uma coluna por dia. Passe o mouse para ver a data.</p>'+fbTlLegenda())+'</div>';
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
  const ov=fbDialog("lig-perfil-modal",{titulo:"Panorama do colaborador",tam:"pan",semFoco:true,tom:v.tom,banner:true,
    corpo:'<div class="fb-pf fb-pan">'+topo+faixa+nav+'<div class="fb-pan-b">'+sec("resumo",resumo)+sec("cal",cal)+sec("evo",evo)+sec("hist",hist)+'</div></div>',
    rodape:'<div class="fb-pf-foot">'+acoes.join("")+'</div><button type="button" class="fb-btn navy sm" onclick="fbFechar(\'lig-perfil-modal\')">Fechar</button>'});
  fbIndicaTudo(ov);
  const eventos=fbEventos(p,contatos);
  const pinta=ms=>{
    const box=document.getElementById("lp-tl");if(!box)return;
    box.innerHTML=fbLinha(eventos.concat((ms||[]).filter(m=>p.re&&String(m.re)===String(p.re)).map(m=>({d:String(m.data).slice(0,10),o:2,k:"tn-am",h:"Medida: "+_esc(m.tipo||"")+(m.grau&&m.grau!==m.tipo?" "+_esc(m.grau):"")+(Number(m.dias)?" · "+fbPlural(Number(m.dias),"dia","dias"):""),corpo:m.motivo?'<p>'+_esc(m.motivo)+'</p>':"",m:""}))));
  };
  pinta(null);
  fbPanCompleto(p,fbDiscPintar);
  if(LIG_HIST)pinta(LIG_HIST.medidas);
  else fetch("/api/rh?modulo=faltas&t=historico").then(x=>x.ok?x.json():null).then(j=>{LIG_HIST=j||{medidas:[]};pinta(LIG_HIST.medidas);fbDiscPintar();}).catch(()=>{LIG_HIST=LIG_HIST||{medidas:[]};fbDiscPintar();});
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
    ev.push({d:h[0],o:0,k:h[1]==="I"||h[1]==="T"?"tn-da":"tn-gr",h:h[1]==="I"||h[1]==="T"?"Faltou sem justificar":(FB_ABO_NOME[h[1]]||"Falta"),corpo:"",m:""});
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
/* Ficha do atendimento (panorama): o que importa primeiro (motivo, o que a pessoa disse, o combinado), os dados do atendimento numa faixa e o resto no rodapé */
function fbFicha(c,au){
  if(!c)return'<section class="fb-fic vazio"><header><div class="t">'+fbI("phone")+'<b>Registro do feedback</b></div></header><p class="vz">Nenhum feedback registrado para esta pessoa.</p></section>';
  const ef=ligEfetivo(c),vz='<span class="fnd">não informado</span>',campo=(r,v)=>'<div><small>'+r+'</small><b>'+v+'</b></div>';
  let hora="";try{if(c.criado_em)hora=new Date(c.criado_em).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit",timeZone:"America/Sao_Paulo"});}catch(e){}
  const canal=c.canal==="PESSOAL"?"Pessoalmente":c.canal==="WHATSAPP"?"WhatsApp":"Ligação",acStat=au&&au[0]?fbTag(au[0],au[1]):"";
  const faixa='<div class="mt">'+campo("Canal",canal+(ef?"":' <span class="fnd">· não conseguiu falar</span>'))+campo("Duração",c.duracao_min?Number(c.duracao_min)+" min":vz)+campo("Registrado por",_esc(c.criado_por||"—"))+campo("Falta de referência",c.data_falta?rhFmt(String(c.data_falta).slice(0,10)):vz)+'</div>';
  let corpo="";
  if(ef)corpo+='<div class="bl"><small>Motivo da falta</small>'+(c.motivo?'<span class="mot">'+_esc(fbMotNome(c.motivo))+'</span>':vz)+'</div>';
  corpo+='<div class="bl q"><small>'+(ef?"O que a pessoa disse":"Observação")+'</small>'+(c.justificativa?'<blockquote>'+(ef?"“"+_esc(c.justificativa)+"”":_esc(c.justificativa))+'</blockquote>':vz)+'</div>';
  if(ef)corpo+='<div class="bl"><small>Combinado</small>'+(c.acordo?'<p>'+_esc(c.acordo)+'</p><div class="cb">'+(c.acordo_prazo?'<span>Prazo: <b>'+rhFmt(String(c.acordo_prazo).slice(0,10))+'</b></span>':"")+acStat+'</div>':'<span class="fnd">Nenhum combinado</span>')+'</div>';
  if(c.impressao)corpo+='<div class="bl"><small>Impressão de quem atendeu</small><p>'+_esc(c.impressao)+'</p></div>';
  if(c.abono)corpo+='<div class="bl"><small>Abono</small><p>'+_esc(typeof c.abono==="string"?c.abono:JSON.stringify(c.abono))+'</p></div>';
  const baixa=ef?(c.baixa?fbTag("Fora da cobrança","tn-ok")+'<span class="fnd">por '+_esc(String(c.baixa.por||"—").split(" ")[0])+(c.baixa.em?' em '+fbDd(String(c.baixa.em).slice(0,10)):"")+(c.baixa.de?' · de '+fbDd(c.baixa.de)+' a '+fbDd(c.baixa.ate):"")+'</span>':fbTag("Na cobrança","tn-gr")):"";
  const rod='<footer>'+(ef?'<div><small>Cobrança</small><span class="cob">'+baixa+'</span></div>':"")+'<div><small>Colaborador</small><b>'+_esc(c.colaborador||"—")+'</b>'+(c.posto?'<span class="fnd">'+_esc(fbTitulo(c.posto))+'</span>':"")+'</div>'
    +(c.supervisor?'<div><small>Supervisor</small><b>'+_esc(fbTitulo(c.supervisor))+'</b></div>':"")+(c.telefone?'<div><small>Telefone</small><b>'+_esc(c.telefone)+'</b></div>':"")+'</footer>';
  return'<section class="fb-fic"><header><div class="t">'+fbI(c.canal==="WHATSAPP"?"chat":c.canal==="PESSOAL"?"user":"phone")+'<b>Registro do feedback</b></div><span>'+rhFmt(ligDataContato(c))+(hora?" às "+hora:"")+'</span></header>'+faixa+'<div class="bd">'+corpo+'</div>'+rod+'</section>';
}
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
  if(c.supervisor)g+=it("Supervisor",_esc(fbTitulo(c.supervisor)),true);
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
/* bloco "Registro do feedback" dentro de cada situação tratada */
function fbRegistro(c){
  if(!c)return"";
  const ef=ligEfetivo(c);
  return'<div class="fb-reg"><div class="fb-reg-h">'+fbI(c.canal==="WHATSAPP"?"chat":c.canal==="PESSOAL"?"user":"phone")+'<b>'+(ef?"Registro do feedback":"Tentativa registrada")+'</b><span>'+fbDd(ligDataContato(c))+' · '+_esc((c.criado_por||"—").split(" ")[0])+(c.duracao_min?' · '+Number(c.duracao_min)+' min':"")+'</span></div>'+fbRegCampos(c)+'</div>';
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
  const pa=LIG_P.filter(p=>p.situacao==="pasta"),fora=c=>pa.some(p=>_ligNorm(p.nome)===_ligNorm(c.colaborador)||(c.baixa&&c.baixa.re&&p.re&&String(c.baixa.re).replace(/^0+/,"")===String(p.re).replace(/^0+/,"")));
  return LIG_C.filter(c=>{const d=ligDataContato(c);return d>=pe.de&&d<=pe.ate&&fbSupOk(c.supervisor)&&!fora(c);});
}
/* um filtro por vez: escolher resultado ou motivo limpa o outro; "Todos" limpa os dois */
function ligHistF(k,v){const novo=LIG_H[k]===v?"":v;LIG_H.r="";LIG_H.m="";LIG_H[k]=novo;ligPanel();}
function fbPnlHist(){
  const base=fbContatosFiltrados(),pe=fbHistPer(),hj=ligHojeISO();
  const fr=LIG_H.r||"",fm=LIG_H.m||"";
  const nEf=base.filter(ligEfetivo).length,nNao=base.length-nEf;
  const mots=[...new Set(base.filter(ligEfetivo).map(c=>c.motivo?fbMotNome(c.motivo):"Sem motivo"))].sort();
  const rows=base.filter(c=>(!fr||(fr==="ef")===ligEfetivo(c))&&(!fm||(c.motivo?fbMotNome(c.motivo):"Sem motivo")===fm)).sort((x,y)=>ligDataContato(y).localeCompare(ligDataContato(x))||(Number(y.id)||0)-(Number(x.id)||0));
  let h='<div class="fb-sub"><div class="fb-sub-t" data-sync="hsubt"><b>Contatos registrados</b><span>'+_esc(pe.rot)+' · '+fbPlural(rows.length,"registro","registros")+'</span></div><div class="fb-sub-a"><span class="fb-datas" data-sync="hdatas"><input class="fb-in" type="date" aria-label="De" value="'+pe.de+'" max="'+hj+'" onchange="ligHist(\'de\',this.value)"><span>a</span><input class="fb-in" type="date" aria-label="Até" value="'+pe.ate+'" max="'+hj+'" onchange="ligHist(\'ate\',this.value)"></span>'+fbBusca()+'</div></div>';
  h+='<div class="fb-hf" data-sync="hf"><button type="button" class="fb-chipb'+(!fr&&!fm?" on":"")+'" onclick="ligHistF(\'r\',\'\')">Todos '+base.length+'</button><button type="button" class="fb-chipb'+(fr==="ef"?" on":"")+'" onclick="ligHistF(\'r\',\'ef\')">Falou com a pessoa '+nEf+'</button><button type="button" class="fb-chipb'+(fr==="nao"?" on":"")+'" onclick="ligHistF(\'r\',\'nao\')">Não conseguiu falar '+nNao+'</button><span class="sep"></span>'
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


/* ═════ Black List da coordenação ═════
   Lista interna de quem está no radar de desligamento. Inclusão sempre manual (nada automático), só a coordenação
   vê; o servidor guarda cada inclusão, anotação, ocorrência e retirada com quem fez e quando. Retirar não mexe no
   histórico do RH. Visual "Arquivo Oculto": página de fichas (papel envelhecido) e perfil em dossiê.
   Imagens em assets/ligacoes/bx-*.webp: preto irregular, papel com a borda gasta, lacre e as silhuetas de arquivo
   (homem e mulher reais, contorno tirado das fotos da referência). No hover só mudam transform e opacity. */
let LIG_BL={pessoas:[],historico:[]},LIG_BL_Q="",LIG_BL_F="todos",LIG_BL_C="",LIG_BL_SEL="",LIG_BL_MODO="",LIG_BL_PASTA="inj",LIG_BL_RES=[],LIG_BL_NOVO=null,LIG_BL_T=0;
const BL_IC={
  mais:'<path d="M12 5v14M5 12h14"/>',
  busca:'<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.3-4.3"/>',
  funil:'<path d="M3 4.5h18l-7 8.2v6.3l-4 2v-8.3z"/>',
  ordem:'<path d="M7 4v16M4 17l3 3 3-3M14 6h7M14 11h5M14 16h3"/>',
  x:'<path d="M6 6l12 12M18 6L6 18"/>',
  cadeado:'<rect x="5" y="10.5" width="14" height="10" rx="1.6" fill="currentColor" stroke="none"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/><circle cx="12" cy="15.2" r="1.4" fill="#000" fill-opacity=".55" stroke="none"/>',
  pdf:'<path d="M6 2.5h8.5l4 4V21a.5.5 0 0 1-.5.5H6a.5.5 0 0 1-.5-.5V3a.5.5 0 0 1 .5-.5z" fill="#f4f4f5" stroke="none"/><path d="M14.5 2.5v4h4" fill="none" stroke="#9aa0a8"/><rect x="4" y="12" width="12" height="6" rx="1" fill="#c62a2a" stroke="none"/><path d="M6 16.6v-3h1.1a.9.9 0 0 1 0 1.8H6M9.5 13.6v3h.9a1.5 1.5 0 0 0 0-3zM13.4 16.6v-3h1.8M13.4 15.1h1.4" stroke="#fff" stroke-width="1"/>',
  img:'<path d="M6 2.5h8.5l4 4V21a.5.5 0 0 1-.5.5H6a.5.5 0 0 1-.5-.5V3a.5.5 0 0 1 .5-.5z" fill="#f4f4f5" stroke="none"/><path d="M14.5 2.5v4h4" fill="none" stroke="#9aa0a8"/><rect x="4" y="11.5" width="12" height="7" rx="1" fill="#2f7d4f" stroke="none"/><path d="M5.5 17.2l2.6-3 1.9 2 1.3-1.3 2.2 2.3" stroke="#fff" stroke-width="1"/>',
  hist:'<path d="M3.5 12a8.5 8.5 0 1 0 2.5-6"/><path d="M3 4v4.5h4.5"/><path d="M12 7.5V12l3 2"/>',
  pena:'<path d="M20 4c-6 .5-10.5 4-12.5 10.5L6 19"/><path d="M20 4c-.5 6-4 10-10 11.5"/><path d="M4 21l2-2"/>',
  lapis:'<path d="M4 20l1-4.5L15.5 5a2 2 0 0 1 2.8 0l.7.7a2 2 0 0 1 0 2.8L8.5 19 4 20z"/><path d="M13.5 7l3.5 3.5"/>',
  sair:'<path d="M15 4h3.5a1.5 1.5 0 0 1 1.5 1.5v13a1.5 1.5 0 0 1-1.5 1.5H15"/><path d="M10 8l-4 4 4 4M6 12h10"/>',
  gente:'<circle cx="9" cy="8" r="3.2"/><path d="M3 20c.5-4 3-6 6-6s5.5 2 6 6"/><circle cx="17" cy="9" r="2.4"/><path d="M15.5 14.2c2.6-.3 4.7 1.4 5.5 4.8"/>'
};
function blI(n,c){return'<svg class="bl-i'+(c?" "+c:"")+'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(BL_IC[n]||"")+'</svg>';}

/* ── silhuetas de arquivo: imagens prontas de um homem e de uma mulher (preto sobre fundo de estúdio, com granulado) ── */
/* o sistema não tem o sexo do colaborador: deduz pelo primeiro nome; a coordenação corrige no perfil (fica gravado) */
const BL_FEM=new Set("RAQUEL ISABEL MIRIAM CARMEM CARMEN ESTER ESTHER ELIZABETH ELISABETH LUZ INES BEATRIZ LIZ IRIS NAIR MARLI ROSELI SUELI ARACELI NATALI RUTH RUTE JUDITH EDITH LOURDES DOLORES MERCEDES ABIGAIL MABEL RACHEL YASMIN JASMIN KAREN KELLEN ELLEN HELEN MARIANGEL LUCIMAR DEISIMAR ROSIMAR SOLANGE IRANI".split(" "));
const BL_MASC=new Set("LUCA NIKOLA JOSHUA JOSUA ISAIA ZACARIA TOBIA".split(" "));
function blSexo(p){
  if(p&&(p.silhueta==="m"||p.silhueta==="f"))return p.silhueta;
  const n=_ligNorm(p&&p.nome).split(" ")[0]||"";
  if(BL_MASC.has(n))return"m";
  if(BL_FEM.has(n)||/(A|ANE|INE|ENE|ETE|ELE|ELLE|IDE|ICE|ISE|ESE|UTE|ILDE|EIRE|EIDE|Y)$/.test(n))return"f";
  return"m";
}
/* 4 homens e 2 mulheres diferentes: a variante sai do RE, então cada pessoa fica sempre com a mesma */
function blFoto(p){const f=blSexo(p)==="f",n=Number(String((p&&p.re)||"").replace(/\D/g,""))||0;return'<img class="bx-foto-s" src="/assets/ligacoes/bx-sil-'+(f?"f"+(n%2+1):"h"+(n%4+1))+'.webp" alt="" width="360" height="420" decoding="async">';}
/* emblema da Black List: selo escuro com cadeado prateado e a inscrição girando no anel; "id" separa os gradientes de cada cópia.
   Sem a inscrição (anel=false) para tamanhos pequenos, como o botão de entrada. */
function blEmblema(id,anel){
  const a=id+"-a",d=id+"-d",c=id+"-c";
  return'<svg class="bx-emb" viewBox="0 0 100 100" aria-hidden="true"><defs>'
    +'<linearGradient id="'+a+'" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f4f4f5"/><stop offset=".48" stop-color="#b3b3b9"/><stop offset=".52" stop-color="#707077"/><stop offset="1" stop-color="#cfcfd4"/></linearGradient>'
    +'<radialGradient id="'+d+'" cx=".5" cy=".32" r=".75"><stop offset="0" stop-color="#2a2a2e"/><stop offset="1" stop-color="#040405"/></radialGradient>'
    +'<path id="'+c+'" d="M50 50m-39 0a39 39 0 1 1 78 0a39 39 0 1 1-78 0"/></defs>'
    +'<circle cx="50" cy="50" r="48" fill="#08080a" stroke="url(#'+a+')" stroke-width="1.8"/><circle cx="50" cy="50" r="44.6" fill="none" stroke="#3a3a3f" stroke-width=".7"/>'
    +(anel?'<g class="bx-emb-anel"><text font-family="Oswald,Roboto Condensed,sans-serif" font-size="7" font-weight="500" fill="#a9a9b0"><textPath href="#'+c+'" textLength="242" lengthAdjust="spacing">ACESSO RESTRITO • COORDENAÇÃO •</textPath></text></g>'
      :'<g stroke="#4a4a50" stroke-width="1.2">'+[0,45,90,135,180,225,270,315].map(g=>'<path d="M50 6.5v4" transform="rotate('+g+' 50 50)"/>').join("")+'</g>')
    +'<circle cx="50" cy="50" r="31" fill="url(#'+d+')" stroke="url(#'+a+')" stroke-width="1.3"/>'
    +'<path class="bx-emb-arco" d="M40.5 47V39.5a9.5 9.5 0 0 1 19 0V47" fill="none" stroke="url(#'+a+')" stroke-width="4.2" stroke-linecap="round"/>'
    +'<rect x="34.5" y="45" width="31" height="24" rx="3.5" fill="url(#'+a+')"/><rect x="34.5" y="45" width="31" height="24" rx="3.5" fill="none" stroke="#000" stroke-opacity=".35"/>'
    +'<path d="M50 50.6a3.4 3.4 0 0 1 1.7 6.3l1.1 6.4h-5.6l1.1-6.4A3.4 3.4 0 0 1 50 50.6z" fill="#09090a"/><circle class="bx-emb-luz" cx="50" cy="54" r="1.2" fill="#e04848"/></svg>';
}
const BL_CAMADAS='<i class="bx-sombra" aria-hidden="true"></i><i class="bx-luz" aria-hidden="true"></i>';
const BL_CARIMBO='<span class="bx-carimbo" aria-label="Confidencial, restrito"><b>CONFIDENCIAL</b><small>RESTRITO</small></span>';
function blD(d){d=String(d||"");return d.length>=10?d.slice(8,10)+"/"+d.slice(5,7)+"/"+d.slice(0,4):"—";}
function blDH(t){if(!t)return"—";const x=new Date(t);return isNaN(x)?"—":x.toLocaleDateString("pt-BR")+" "+x.toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"});}
function blT(s){return fbTitulo(s)||"—";}
function blAtual(){return LIG_BL.pessoas.find(p=>p.chave===LIG_BL_SEL)||null;}
function blBotao(){return LIG_PODE_BAIXAR?'<button type="button" class="fb-blb" id="lig-blb" onclick="ligBL(this)" aria-label="Black List: arquivo restrito da coordenação">'+blEmblema("bxe-b",false)+'<span>BLACK <em>LIST</em></span></button>':"";}

/* ── página de fichas ── */
/* ── central de acompanhamento: indicadores, fila de prioridade e o dossiê de quem foi clicado ── */
function ligBL(btn){
  const r=btn&&btn.getBoundingClientRect?btn.getBoundingClientRect():null;
  ligApi("/api/ligacoes?acao=blacklist").then(j=>{
    LIG_BL={pessoas:j.pessoas||[],historico:j.historico||[]};LIG_BL_Q="";LIG_BL_F="todos";LIG_BL_C="";LIG_BL_SEL="";LIG_BL_MODO="";LIG_BL_PASTA="inj";
    const ov=fbDialog("lig-bl",{titulo:"Black List",tam:"bx",tom:"blx",semFoco:true,corpo:''
      +'<header class="bx-top"><div class="bx-marca">'+blEmblema("bxe-g",true)+'<div class="bx-tit"><h2><span>Black</span> <em>List</em></h2><p>Módulo: Feedback de Faltas e Ligações — acesso restrito à coordenação</p></div></div>'
      +'<div class="bx-ferr"><label class="bx-busca">'+blI("busca")+'<span class="fb-sr">Pesquisar arquivo</span><input type="search" placeholder="Pesquisar Arquivo" autocomplete="off" oninput="LIG_BL_Q=this.value;blCentral()"></label>'
      +'<label class="bx-btn bx-sel">'+blI("funil")+'<span class="fb-sr">Filtros</span><select id="bx-f" onchange="LIG_BL_F=this.value;blCentral()" aria-label="Filtros"><option value="todos">Filtros</option><option value="rec">Entraram em 30 dias</option><option value="f7">Faltaram em 7 dias</option><option value="med">Com medida disciplinar</option><option value="lig">Com ligações sem retorno</option><option value="fora">Fora dos ativos</option></select></label>'
      +'<button type="button" class="bx-btn bx-pri" onclick="ligBLAdd()">Adicionar Novo Registro</button></div></header>'
      +'<div class="bx-kpis" id="bx-kpis"></div>'
      +'<div class="bx-central"><aside class="bx-painel bx-fila" aria-label="Fila de prioridade">'
      +'<div class="bx-ph"><h3>Fila de prioridade</h3><button type="button" class="bx-upd" id="bx-upd" onclick="ligBLHist()"></button></div>'
      +'<div class="bx-cbar" id="bx-cargos" role="group" aria-label="Filtrar por cargo"></div><div class="bx-lista" id="bx-lista" role="listbox" aria-label="Colaboradores na Black List"></div>'
      +'<p class="bx-atalho"><kbd>↑</kbd> <kbd>↓</kbd> trocam de pessoa</p></aside>'
      +'<section class="bx-painel bx-dos" id="bx-dos" aria-live="polite"></section></div>'});
    const fx=ov.querySelector(".fb-dlg-h .fb-ib");if(fx)fx.innerHTML=blI("x");
    blCentral(true);
    /* enquanto rola, nada reage ao mouse: sem efeitos de hover disparando nos cartões que passam sob o cursor */
    const sc=ov.querySelector(".fb-dlg-b");let rt=0;
    if(sc)sc.addEventListener("scroll",()=>{if(!rt)sc.classList.add("bx-rola");clearTimeout(rt);rt=setTimeout(()=>{rt=0;sc.classList.remove("bx-rola");},160);},{passive:true});
    const d=ov.querySelector(".fb-dlg"),anel=ov.querySelector(".bx-emb-anel"),arco=ov.querySelector(".bx-emb-arco");
    if(fbMov()){
      /* a página sai do botão, devagar, como um arquivo sendo aberto; o anel do emblema gira e o cadeado destrava */
      if(r&&d){const f=d.getBoundingClientRect(),sx=r.width/f.width,sy=r.height/f.height,tx=r.left+r.width/2-(f.left+f.width/2),ty=r.top+r.height/2-(f.top+f.height/2);
        d.animate([{transform:"translate("+tx+"px,"+ty+"px) scale("+sx+","+sy+")",opacity:.2},{transform:"none",opacity:1}],{duration:480,easing:"cubic-bezier(.65,0,.35,1)"});}
      if(anel)anel.animate([{transform:"rotate(-120deg)",opacity:0},{transform:"rotate(0)",opacity:1}],{duration:1200,delay:300,easing:"cubic-bezier(.2,.8,.2,1)",fill:"backwards"});
      if(arco)arco.animate([{transform:"translateY(0)"},{transform:"translateY(-5px)",offset:.45},{transform:"translateY(0)"}],{duration:700,delay:900,easing:"cubic-bezier(.3,0,.2,1)"});
    }
  }).catch(e=>fbToast(e.message||"Não consegui abrir a Black List.","err"));
}
function blCargo(p){return blT(p.cargo);}
/* o histórico mostrado é o do ano: de 1º de janeiro até hoje */
function blHoje(){return ligHojeISO();}
function blIni(){return blHoje().slice(0,4)+"-01-01";}
function blAno(p){
  const i=blIni(),no=d=>String(d||"").slice(0,10)>=i;
  return{...p,injustificadas:(p.injustificadas||[]).filter(no),abonadas:(p.abonadas||[]).filter(a=>no(a[0])),medidas:(p.medidas||[]).filter(m=>no(m.data)),
    semRetorno:(p.semRetorno||[]).filter(x=>no(x.data)),ocorrenciasAno:(p.ocorrencias||[]).filter(o=>no(o.em))};
}
const blDias=(a,b)=>Math.round((Date.parse(String(b).slice(0,10)+"T12:00:00Z")-Date.parse(String(a).slice(0,10)+"T12:00:00Z"))/864e5);
/* sinais tirados só dos dados (ninguém escolhe nível): vermelho pede ação, âmbar pede conferência, verde é bom sinal */
function blSinais(p){
  const h=blHoje(),f=p.injustificadas||[],ult=f.length?f[f.length-1]:"",f30=f.filter(d=>blDias(d,h)<=30).length,f60=f.filter(d=>{const n=blDias(d,h);return n>30&&n<=60;}).length,s=[];
  if(ult&&blDias(ult,h)<=7)s.push(["v","Faltou nos últimos 7 dias"]);
  if(f30>f60&&f30>=2)s.push(["v","Faltas subindo"]);
  if(p.pendentesSar2g)s.push(["a",p.pendentesSar2g===1?"Medida a lançar no SAR2G":p.pendentesSar2g+" medidas a lançar no SAR2G"]);
  if((p.semRetorno||[]).filter(x=>blDias(x.data,h)<=30).length>=2)s.push(["a","SAC sem retorno"]);
  const desde=ult||String(p.incluidoEm||"").slice(0,10);
  if(desde&&blDias(desde,h)>45)s.push(["g","Sem faltas há "+blDias(desde,h)+" dias"]);
  return{s,f30,f60};
}
function blPrio(p){const x=blSinais(p);return x.s.reduce((t,s)=>t+(s[0]==="v"?100:s[0]==="a"?40:-20),0)+x.f30*5+(p.injustificadas||[]).length;}
/* filtros da fila; os cartões de resumo contam com os mesmos */
const BL_FK={rec:p=>!!p.incluidoEm&&blDias(p.incluidoEm,blHoje())<=30,f7:p=>p.injustificadas.some(d=>blDias(d,blHoje())<=7),med:p=>p.medidas.length>0,lig:p=>p.semRetorno.length>0,fora:p=>!p.ativo};
function blFiltrados(){
  const q=_ligNorm(LIG_BL_Q),qd=String(LIG_BL_Q||"").replace(/\D/g,"");
  return LIG_BL.pessoas.map(blAno).filter(p=>(!q||_ligNorm(p.nome).indexOf(q)>=0||(qd&&String(p.re).indexOf(qd)===0))&&(!LIG_BL_C||blCargo(p)===LIG_BL_C)
    &&(!BL_FK[LIG_BL_F]||BL_FK[LIG_BL_F](p)))
    .sort((a,b)=>blPrio(b)-blPrio(a)||String(a.nome).localeCompare(String(b.nome),"pt-BR"));
}
function blChips(p){const s=blSinais(p).s;return s.length?s.map(x=>'<span class="bx-chip '+x[0]+'"><i></i>'+_esc(x[1])+'</span>').join(""):'<span class="bx-chip"><i></i>Sem alerta</span>';}
function blKpis(){
  const P=LIG_BL.pessoas.map(blAno),t=P.length;
  /* cada cartão filtra a fila; clicar de novo (ou no Total) volta a mostrar todos */
  const k=(f,r,s,al)=>{const on=LIG_BL_F===f||(f==="todos"&&!BL_FK[LIG_BL_F]);
    return'<button type="button" class="bx-kpi'+(al?" al":"")+(on?" on":"")+'" aria-pressed="'+on+'" onclick="ligBLKpi(\''+f+'\')"><small>'+r+'</small><b>'+(BL_FK[f]?P.filter(BL_FK[f]).length:t)+'</b><span>'+s+'</span></button>';};
  return k("todos","Total no arquivo",t===1?"colaborador":"colaboradores")
    +k("rec","Entraram em 30 dias","inclusões recentes")
    +k("f7","Faltaram em 7 dias","pedem atenção agora",true)
    +k("med","Com medida no ano","de "+t+" no arquivo")
    +k("lig","Sem retorno do SAC","no ano");
}
function ligBLKpi(f){LIG_BL_F=LIG_BL_F===f?"todos":f;blCentral();}
function blCargos(){
  const m=new Map();LIG_BL.pessoas.forEach(p=>{const c=blCargo(p);m.set(c,(m.get(c)||0)+1);});
  const cs=[...m.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],"pt-BR")),mx=cs.length?cs[0][1]:1;
  return'<p class="bx-h4">Distribuição por cargo</p>'+cs.map(c=>'<button type="button" class="bx-bar'+(LIG_BL_C===c[0]?" on":"")+'" aria-pressed="'+(LIG_BL_C===c[0])+'" data-c="'+_esc(c[0])+'" onclick="LIG_BL_C=LIG_BL_C===this.dataset.c?\'\':this.dataset.c;blCentral()" title="Filtrar: '+_esc(c[0])+'"><span>'+_esc(c[0])+'</span><i style="--p:'+Math.round(c[1]/mx*100)+'%"></i><b>'+c[1]+'</b></button>').join("");
}
function blCentral(entra){
  const box=document.getElementById("bx-lista");if(!box)return;
  const k=document.getElementById("bx-kpis");if(k)k.innerHTML=blKpis();
  const fs=document.getElementById("bx-f");if(fs)fs.value=LIG_BL_F;
  const c=document.getElementById("bx-cargos");if(c)c.innerHTML=blCargos();
  const up=document.getElementById("bx-upd"),h=LIG_BL.historico[0];if(up)up.innerHTML=blI("hist")+(h?"Atualizado "+blDH(h.em):"Histórico de alterações");
  const l=blFiltrados();
  if(!l.some(p=>p.chave===LIG_BL_SEL))LIG_BL_SEL=l.length?l[0].chave:"";
  box.innerHTML=l.length?l.map((p,i)=>{const s=blSinais(p).s[0],on=p.chave===LIG_BL_SEL;
    return'<button type="button" class="bx-it'+(on?" on":"")+'" role="option" aria-selected="'+on+'" tabindex="'+(on?0:-1)+'" data-k="'+_esc(p.chave)+'" onclick="ligBLSel(this.dataset.k)"><span class="bx-rank">'+(i+1)+'</span>'
      +'<span class="bx-itx"><b>'+_esc(blT(p.nome))+'</b><small class="'+(s?s[0]:"")+'">'+_esc(s?s[1]:blCargo(p))+'</small></span>'+blFoto(p).replace('class="bx-foto-s"','class="bx-av"')+'</button>';}).join("")
    :'<p class="bx-tvz">'+(LIG_BL.pessoas.length?"Ninguém com esse filtro.":"Nenhuma ficha no arquivo.")+'</p>';
  blDossie(false);
  if(entra)setTimeout(()=>blFolhaSobe(document.getElementById("bx-hist")),350);
  if(entra&&fbMov())[...box.children].slice(0,10).forEach((x,i)=>x.animate([{opacity:0,transform:"translate3d(-12px,0,0)"},{opacity:1,transform:"none"}],{duration:380,delay:240+i*45,easing:"cubic-bezier(.2,.8,.2,1)",fill:"backwards"}));
}
function ligBLSel(k){if(k===LIG_BL_SEL)return;LIG_BL_SEL=k;LIG_BL_MODO="";
  document.querySelectorAll("#bx-lista .bx-it").forEach(b=>{const on=b.dataset.k===k;b.classList.toggle("on",on);b.setAttribute("aria-selected",on);b.tabIndex=on?0:-1;});
  blDossie(true);}
/* ↑ ↓ trocam de pessoa na fila (fora de campos de texto) */
if(!window._blTecla){window._blTecla=1;document.addEventListener("keydown",e=>{
  if(e.key!=="ArrowDown"&&e.key!=="ArrowUp")return;
  const ovs=document.querySelectorAll(".fb-ov:not(.out)");if(!ovs.length||ovs[ovs.length-1].id!=="lig-bl")return;
  if(e.target&&/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))return;
  const bs=[...document.querySelectorAll("#bx-lista .bx-it")];if(!bs.length)return;
  e.preventDefault();const i=bs.findIndex(b=>b.dataset.k===LIG_BL_SEL),n=bs[Math.max(0,Math.min(bs.length-1,i+(e.key==="ArrowDown"?1:-1)))];
  ligBLSel(n.dataset.k);n.focus();if(n.scrollIntoView)n.scrollIntoView({block:"nearest"});
});}

/* ── dossiê ── */
/* linha do tempo do ano: cada falta, medida, mensagem sem retorno, ocorrência e a entrada na lista vira um marcador */
const BL_MES=["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];
/* todos os marcadores ficam na linha: o que está colado no anterior anda um pouco para o lado (no fim do ano, para a
   esquerda) até ficar a "g" % de distância. Na tela, blTlAjusta refaz com a largura real da linha (16px entre centros). */
function blAfasta(xs,g){const x=xs.slice();for(let k=1;k<x.length;k++)x[k]=Math.max(x[k],x[k-1]+g);
  for(let k=x.length-1;k>=0;k--)x[k]=Math.max(0,Math.min(x[k],k===x.length-1?100:x[k+1]-g));return x;}
function blTlAjusta(tl){const w=tl&&tl.offsetWidth;if(!w)return;const ms=[...tl.querySelectorAll(".bx-mk")],x=blAfasta(ms.map(m=>Number(m.dataset.p)),1600/w);
  ms.forEach((m,k)=>{m.style.left=x[k].toFixed(2)+"%";});}
function blLinha(p){
  const i=blIni(),h=blHoje(),tot=Math.max(1,blDias(i,h)),pos=d=>Math.max(0,Math.min(100,blDias(i,d)/tot*100));
  const inc=String(p.incluidoEm||"").slice(0,10),L=[].concat(
    p.semRetorno.map(x=>[x.data,"s",x.tipo]),p.abonadas.map(a=>[a[0],"ab","Falta abonada"]),p.injustificadas.map(d=>[d,"f","Falta injustificada"]),
    p.medidas.map(m=>[m.data,"m","Medida: "+fbTitulo([m.tipo,m.grau].filter(Boolean).join(" "))]),p.ocorrenciasAno.map(o=>[String(o.em).slice(0,10),"o","Ocorrência"]),
    inc>=i?[[inc,"i","Entrou na Black List"]]:[]).map(m=>[pos(m[0]),m[1],blD(m[0])+" · "+m[2]]).sort((a,b)=>a[0]-b[0]);
  const x=blAfasta(L.map(m=>m[0]),1.8),mks=L.map((m,k)=>'<i class="bx-mk '+m[1]+'" data-p="'+m[0].toFixed(2)+'" style="left:'+x[k].toFixed(2)+'%" title="'+_esc(m[2])+'"></i>').join("");
  const meses=[];for(let m=0;m<=Number(h.slice(5,7))-1;m++){const d=h.slice(0,4)+"-"+String(m+1).padStart(2,"0")+"-01";meses.push('<span class="bx-ms" style="left:'+pos(d).toFixed(2)+'%">'+BL_MES[m]+'</span>');}
  return'<div class="bx-tl" role="img" aria-label="Linha do tempo do ano: '+p.injustificadas.length+' faltas, '+p.medidas.length+' medidas, '+p.semRetorno.length+' mensagens sem retorno">'+meses.join("")+mks+'</div>'
    +'<div class="bx-leg"><span><i class="f"></i>Falta</span><span><i class="ab"></i>Abonada</span><span><i class="m"></i>Medida</span><span><i class="s"></i>SAC sem retorno</span><span><i class="o"></i>Ocorrência</span><span><i class="i"></i>Entrou na lista</span></div>';
}
/* histórico do ano em pastas, como um fichário: cada tipo é uma pasta com a quantidade; uma aberta por vez */
const BL_PASTAS=[{k:"inj",t:"Faltas injustificadas"},{k:"med",t:"Medidas disciplinares"},{k:"abo",t:"Faltas abonadas"},{k:"sr",t:"Ligações sem retorno"}];
const BL_SEM=["Domingo","Segunda","Terça","Quarta","Quinta","Sexta","Sábado"];
function blSemana(d){const x=new Date(String(d).slice(0,10)+"T12:00:00Z");return isNaN(x)?"":BL_SEM[x.getUTCDay()];}
function blItensPasta(p,k){
  if(k==="inj")return p.injustificadas.slice().reverse().map(d=>[d,blSemana(d),"Sem justificativa"]);
  if(k==="med")return p.medidas.slice().reverse().map(m=>[m.data,fbTitulo([m.tipo,m.grau].filter(Boolean).join(" "))+(m.dias?" · "+m.dias+(m.dias===1?" dia":" dias"):""),m.motivo?fbTitulo(m.motivo):""]);
  if(k==="abo")return p.abonadas.slice().reverse().map(a=>[a[0],blSemana(a[0]),FB_ABO_NOME[a[1]]||"Abonada"]);
  return p.semRetorno.slice().reverse().map(x=>[x.data,x.tipo,x.detalhe||""]);
}
/* histórico do ano como fichário de índice: divisórias com abas, uma atrás da outra, dentro da gaveta. Clicou na
   aba, aquela divisória é puxada para cima, para fora da gaveta, e os acontecimentos aparecem escritos nela mesma
   (do mais recente ao mais antigo). A de antes desce de volta. */
const BL_FI_COR={inj:"#d14848",med:"#e6e6e9",abo:"#6c8f74",sr:"#8c8c93"};
function blPastas(p,novo){
  if(LIG_BL_PASTA&&!BL_PASTAS.some(x=>x.k===LIG_BL_PASTA))LIG_BL_PASTA="inj";
  const n=k=>blItensPasta(p,k).length,ab=LIG_BL_PASTA,fn=novo?"blPastaNovo":"blPasta";
  /* sem divisória puxada (fechou no X) a gaveta encolhe e mostra só as abas */
  return'<div class="bx-fi"><div class="bx-fi-gav'+(ab?"":" fechada")+'" role="tablist" aria-label="Histórico do ano por situação">'
    +BL_PASTAS.map((x,i)=>{const on=x.k===ab,it=on?blItensPasta(p,x.k):[];
      return'<div class="bx-fi-div'+(on?" on":"")+'" style="--i:'+i+'" data-k="'+x.k+'"'+(on?"":' onclick="'+fn+'(\''+x.k+'\')"')+'>'
        +'<button type="button" role="tab" class="bx-fi-tab" aria-selected="'+on+'" style="left:'+(3+i*24)+'%" onclick="event.stopPropagation();'+fn+'(\''+x.k+'\')"><i style="background:'+BL_FI_COR[x.k]+'"></i>'+x.t+'<b>'+n(x.k)+'</b></button>'
        +(on?'<div class="bx-fi-cont" role="tabpanel" aria-label="'+x.t+'"><h5>'+x.t+' · '+blIni().slice(0,4)+'<span>'+n(x.k)+(n(x.k)===1?" registro":" registros")+'</span><button type="button" class="bx-fi-x" aria-label="Fechar '+x.t+' e guardar na gaveta" title="Guardar na gaveta" onclick="'+fn+'(\'\')">'+blI("x")+'</button></h5>'
          +(it.length?'<ol class="bx-fi-lst">'+it.map(c=>'<li><time>'+blD(c[0])+'</time><span>'+_esc(c[1])+'</span><em>'+_esc(c[2]||"")+'</em></li>').join("")+'</ol>':'<p class="bx-fi-vz">Nenhum registro no ano.</p>')+'</div>':"")
        +'</div>';}).join("")+'</div>'
    +'<div class="bx-fi-frente"><span class="bx-fi-et">Histórico '+blIni().slice(0,4)+'</span><span class="bx-fi-pux" aria-hidden="true"></span></div></div>';
}
/* a divisória sai da gaveta: sobe devagar, passa um pouco e assenta. "desce" faz o caminho de volta antes de trocar */
/* a divisória puxada cresce até caber tudo: sem barra de rolagem dentro dela, a roda do mouse rola a página sem "prender" no meio */
function blFiMede(b){const g=b&&b.querySelector(".bx-fi-gav:not(.fechada)"),c=g&&g.querySelector(".bx-fi-cont");if(!c||!c.offsetHeight)return;
  const l=c.querySelector(".bx-fi-lst,.bx-fi-vz"),h5=c.querySelector("h5");g.style.setProperty("--bx-fi-h",Math.max(200,Math.ceil((h5?h5.offsetHeight+8:0)+(l?l.scrollHeight:0)+48))+"px");}
function blFiAltura(b){const g=b&&b.querySelector(".bx-fi-gav");return g?parseFloat(getComputedStyle(g).getPropertyValue("--bx-fi-h"))||320:320;}
function blFolhaSobe(b){const d=b&&b.querySelector(".bx-fi-div.on");if(!d||!fbMov()||!d.animate)return;
  d.animate([{transform:"translate3d(0,"+blFiAltura(b)+"px,0)"},{transform:"translate3d(0,-6px,0)",offset:.8},{transform:"none"}],{duration:720,easing:"cubic-bezier(.2,.8,.2,1)"});}
function blTrocaPasta(b,k,monta){
  const d=b&&b.querySelector(".bx-fi-div.on");
  if(!d||!fbMov()||!d.animate){LIG_BL_PASTA=k;monta();return;}
  d.animate([{transform:"none"},{transform:"translate3d(0,"+blFiAltura(b)+"px,0)"}],{duration:300,easing:"cubic-bezier(.4,0,1,1)",fill:"forwards"}).onfinish=()=>{LIG_BL_PASTA=k;monta();blFolhaSobe(b);};
}
function blPasta(k){const b=document.getElementById("bx-hist"),p=blAtual();if(!b||!p||k===LIG_BL_PASTA)return;blTrocaPasta(b,k,()=>{b.innerHTML=blPastas(blAno(p));blFiMede(b);});}
function blPastaNovo(k){const b=document.getElementById("bl-prev-h");if(!b||!LIG_BL_NOVO||k===LIG_BL_PASTA)return;blTrocaPasta(b,k,()=>{b.innerHTML=blPastas(blAno(LIG_BL_NOVO),true);});}
/* cada registro numa ficha pautada, a mais nova em cima; a anotação geral fica presa por um clipe no topo.
   Na tela, texto longo vem recolhido (3 linhas) com "Ler tudo"; na janela ampliada (inteiro=true) tudo aparece aberto. */
function blNotas(p,inteiro){
  const nota=(tipo,cls,quando,texto,quem)=>{const longo=!inteiro&&(String(texto).length>180||String(texto).split("\n").length>3);
    return'<article class="bx-nt'+cls+(longo?" longa":"")+'">'+(cls?'<i class="bx-clip" aria-hidden="true"></i>':"")+'<header><span class="bx-ntag'+(cls?"":" oc")+'">'+tipo+'</span><time>'+quando+'</time></header><p>'+_esc(texto)+'</p>'
      +(longo?'<button type="button" class="bx-ler" aria-expanded="false" onclick="blLer(this)">Ler tudo</button>':"")+(quem?'<footer>'+_esc(quem)+'</footer>':"")+'</article>';};
  return(p.obs?[nota("Anotação geral"," fixa",blD(String(p.alteradoEm||p.incluidoEm||"").slice(0,10)),p.obs,p.alteradoPorNome||p.incluidoPorNome)]:[])
    .concat((p.ocorrencias||[]).slice().reverse().map(o=>nota("Ocorrência","",blDH(o.em),o.texto,o.por))).join("");
}
function blLer(b){const a=b.closest(".bx-nt");if(!a)return;const ab=a.classList.toggle("aberta");b.textContent=ab?"Recolher":"Ler tudo";b.setAttribute("aria-expanded",ab);}
function ligBLNotas(){
  const p=blAtual();if(!p)return;const l=blNotas(p,true);
  const ov=fbDialog("lig-bl-notas",{titulo:"Anotações internas · "+blT(p.nome),tam:"bxj",tom:"blx",sub:"Da mais recente para a mais antiga. "+((p.obs?1:0)+(p.ocorrencias||[]).length)+" registro(s).",
    corpo:l?'<div class="bx-nts grande">'+l+'</div>':'<p class="bx-tvz">Nenhuma anotação ainda.</p>',
    rodape:'<button type="button" class="bx-btn" onclick="fbFechar(\'lig-bl-notas\');LIG_BL_MODO=\'oc\';blDossie();blFoca(\'bx-oc\')">'+blI("pena")+'Registrar ocorrência</button><button type="button" class="bx-btn bx-pri" onclick="fbFechar(\'lig-bl-notas\')">Fechar</button>'});
  blMoldura(ov);
}
function blAnotacoes(p){
  if(LIG_BL_MODO==="nota")return'<label class="fb-sr" for="bx-obs">Anotação da coordenação</label><textarea id="bx-obs" class="bx-papel-t" maxlength="2000" placeholder="Anotação geral sobre o acompanhamento">'+_esc(p.obs)+'</textarea>'
    +'<div class="bx-ed"><button type="button" class="bx-btn" onclick="LIG_BL_MODO=\'\';blDossie()">Cancelar</button><button type="button" class="bx-btn bx-pri" onclick="ligBLNota()">Salvar anotação</button></div>';
  if(LIG_BL_MODO==="oc")return'<label class="fb-sr" for="bx-oc">Nova ocorrência</label><textarea id="bx-oc" class="bx-papel-t" maxlength="1000" placeholder="O que aconteceu (a data e o seu nome entram sozinhos)"></textarea>'
    +'<div class="bx-ed"><button type="button" class="bx-btn" onclick="LIG_BL_MODO=\'\';blDossie()">Cancelar</button><button type="button" class="bx-btn bx-pri" onclick="ligBLOcorrencia()">Registrar ocorrência</button></div>';
  const l=blNotas(p,false);
  return l?'<div class="bx-nts">'+l+'</div>'
    :'<p class="bx-tvz">Nenhuma anotação ainda. Use "Registrar ocorrência" para começar o registro.</p>';
}
function blDossie(anima){
  const box=document.getElementById("bx-dos");if(!box)return;
  const p0=blAtual();
  if(!p0){box.innerHTML='<div class="bx-vazio"><p>'+(LIG_BL.pessoas.length?"Escolha alguém na fila.":"Nenhuma ficha no arquivo.")+'</p><button type="button" class="bx-btn bx-pri" onclick="ligBLAdd()">Adicionar Novo Registro</button></div>';return;}
  const p=blAno(p0),sx=blSexo(p),dado=(r,v)=>'<div><dt>'+r+'</dt><dd>'+v+'</dd></div>';
  const docs=(p.documentos||[]).map(d=>'<li><button type="button" onclick="ligBLDoc(\''+_esc(d.chave)+'\')">'+blI(d.tipo==="application/pdf"?"pdf":"img","bx-arq")+'<span><b>'+_esc(d.arquivo||((d.numero||"Medida")+" assinada"))+'</b><small>'+_esc(fbTitulo(d.medida))+' · '+blD(d.data)+(d.digital?" · assinada no celular":"")+'</small></span>'+blI("cadeado","bx-cad")+'</button></li>').join("");
  box.innerHTML='<div class="bx-dtopo"><div class="bx-ficha bx-estatica">'+BL_CAMADAS+blCarta(p)+'</div>'
    +'<div class="bx-dinfo"><div class="bx-dcab"><div class="bx-chips">'+blChips(p)+'</div></div>'
    +'<dl class="bx-dl">'+dado("RE",_esc(p.re))+dado("Nome",_esc(blT(p.nome)))+dado("Cargo",_esc(blT(p.cargo)))+dado("Supervisor",_esc(blT(p.supervisor)))
    +dado("Admissão",blD(p.admissao))+dado("Último posto efetivo",_esc(blT(p.posto)))+dado("Situação",p.ativo===false?"Fora dos ativos":"Ativo")
    +dado("Na Black List desde",blD(String(p.incluidoEm||"").slice(0,10))+(p.incluidoPorNome?" · "+_esc(p.incluidoPorNome):""))+'</dl>'
    +'<span class="bx-sx" role="group" aria-label="Silhueta da ficha"><small>Silhueta</small><button type="button" aria-pressed="'+(sx==="m")+'" onclick="ligBLSilhueta(\'m\')">Masculina</button><button type="button" aria-pressed="'+(sx==="f")+'" onclick="ligBLSilhueta(\'f\')">Feminina</button></span></div></div>'
    +'<section class="bx-sec"><p class="bx-h4">Linha do tempo · '+blIni().slice(0,4)+'</p>'+blLinha(p)+'</section>'
    +'<section class="bx-sec"><p class="bx-h4">Histórico do ano</p><div id="bx-hist">'+blPastas(p)+'</div></section>'
    +'<div class="bx-baixo"><section class="bx-sec"><div class="bx-nhead"><p class="bx-h4">Anotações internas da coordenação <span class="bx-cont">'+((p0.obs?1:0)+(p0.ocorrencias||[]).length)+'</span></p>'+((p0.obs||(p0.ocorrencias||[]).length)&&!LIG_BL_MODO?'<button type="button" class="bx-btn bx-amp" onclick="ligBLNotas()">'+blI("busca")+'Ampliar</button>':"")+'</div>'+blAnotacoes(p0)+'</section>'
    +'<section class="bx-sec"><p class="bx-h4">Documentos anexados</p>'+(docs?'<ul class="bx-arqs">'+docs+'</ul>':'<p class="bx-tvz">Nenhuma medida assinada anexada no sistema.</p>')
    +'<p class="bx-h4" style="margin-top:14px">Ações administrativas</p><div class="bx-acoes"><button type="button" class="bx-btn" onclick="LIG_BL_MODO=\'oc\';blDossie();blFoca(\'bx-oc\')">'+blI("pena")+'Registrar ocorrência</button>'
    +'<button type="button" class="bx-btn" onclick="LIG_BL_MODO=\'nota\';blDossie();blFoca(\'bx-obs\')">'+blI("lapis")+'Editar anotação</button>'
    +'<button type="button" class="bx-btn bx-perigo" onclick="ligBLTirar()">'+blI("sair")+'Remover da Black List</button></div>'
    +'<button type="button" class="bx-upd bx-acesso" onclick="ligBLHist()">Última atualização: '+_esc(p.alteradoPorNome||p.incluidoPorNome||"Coordenação")+' — '+blDH(p.alteradoEm||p.incluidoEm)+'</button></section></div>';
  blTlAjusta(box.querySelector(".bx-tl"));blFiMede(document.getElementById("bx-hist"));
  if(anima)blFolhaSobe(document.getElementById("bx-hist"));
  if(!anima||!fbMov())return;
  box.animate([{opacity:.25,transform:"translate3d(14px,0,0)"},{opacity:1,transform:"none"}],{duration:380,easing:"cubic-bezier(.2,.8,.2,1)"});
  /* o carimbo bate no papel */
  const s=box.querySelector(".bx-carimbo");if(s&&s.animate)s.animate([{opacity:0,transform:"rotate(-24deg) scale(1.6)"},{opacity:.9,transform:"rotate(-11deg) scale(.95)",offset:.7},{transform:"rotate(-12deg) scale(1)"}],{duration:460,delay:160,easing:"cubic-bezier(.3,0,.2,1)",fill:"backwards"});
}
function blCarta(p,prev){
  const linha=(r,v)=>'<span class="bx-ln"><span>'+r+':</span> '+_esc(v)+'</span>';
  return'<span class="bx-papel"><span class="bx-foto">'+blFoto(p)+'</span>'
    +'<span class="bx-dados"><b class="bx-nome">'+_esc(String(p.nome||"").toUpperCase())+'</b>'+linha("RE","#"+p.re)+linha("Cargo",blT(p.cargo))+linha("Posto",blT(p.posto))+'</span>'
    +'<span class="bx-oc"><b>Histórico de ocorrências</b><span>Medidas: '+p.medidas.length+'</span><span>Faltas injustificadas: '+p.injustificadas.length+'</span><span>Ligações sem retorno: '+(p.semRetorno||[]).length+'</span></span>'
    +BL_CARIMBO+(prev?"":'<span class="bx-rub" title="Incluído por '+_esc(p.incluidoPorNome||"")+'">'+_esc(p.incluidoPorNome||"")+'<svg viewBox="0 0 120 10" preserveAspectRatio="none" aria-hidden="true"><path d="M2 7C18 2.5 34 9 52 5.5S88 1.5 118 6.5"/></svg></span>')
    +(p.ativo===false?'<span class="bx-fora">Fora dos ativos</span>':"")+'</span>';
}
/* janela do arquivo: o X no padrão da Black List */
function blMoldura(ov){const fx=ov.querySelector(".fb-dlg-h .fb-ib");if(fx)fx.innerHTML=blI("x");}
function blFoca(id){const t=document.getElementById(id);if(t&&t.focus)t.focus();}
function ligBLDoc(ch){
  if(typeof window.mdVerAssinado!=="function"){fbToast("O visualizador de documentos não carregou.","err");return;}
  window.mdVerAssinado(ch);
  const o=document.getElementById("md-anexo");if(o)o.style.zIndex="100001"; // acima do perfil
}

/* ── gravar ── */
function blRecarrega(msg){return ligApi("/api/ligacoes?acao=blacklist").then(j=>{LIG_BL={pessoas:j.pessoas||[],historico:j.historico||[]};blCentral();if(msg)fbToast(msg);});}
function ligBLNota(){
  const p=blAtual(),t=document.getElementById("bx-obs");if(!p||!t)return;
  ligApi("/api/ligacoes?acao=blacklist","POST",{chave:p.chave,obs:t.value}).then(()=>{LIG_BL_MODO="";return blRecarrega("Anotação salva.");}).catch(e=>fbToast(e.message||"Não consegui salvar.","err"));
}
function ligBLSilhueta(s){
  const p=blAtual();if(!p||blSexo(p)===s)return;
  ligApi("/api/ligacoes?acao=blacklist","POST",{chave:p.chave,silhueta:s}).then(()=>blRecarrega("Silhueta alterada.")).catch(e=>fbToast(e.message||"Não consegui alterar.","err"));
}
function ligBLOcorrencia(){
  const p=blAtual(),t=document.getElementById("bx-oc");if(!p||!t)return;
  ligApi("/api/ligacoes?acao=blacklist","POST",{chave:p.chave,ocorrencia:t.value}).then(()=>{LIG_BL_MODO="";return blRecarrega("Ocorrência registrada.");}).catch(e=>fbToast(e.message||"Não consegui registrar.","err"));
}
function ligBLTirar(){
  const p=blAtual();if(!p)return;
  fbConfirm({titulo:"Remover da Black List?",perigo:true,tom:"blx",ok:"Remover",texto:"<b>"+_esc(blT(p.nome))+"</b> sai do acompanhamento da coordenação. O histórico de faltas e medidas não muda, e a retirada fica registrada."})
    .then(ok=>{if(ok)ligApi("/api/ligacoes?acao=blacklist","POST",{chave:p.chave,remover:true}).then(()=>{LIG_BL_SEL="";return blRecarrega(blT(p.nome)+" removido da Black List.");}).catch(e=>fbToast(e.message||"Não consegui remover.","err"));});
}
/* ── incluir ── */
function ligBLAdd(){
  LIG_BL_RES=[];LIG_BL_NOVO=null;
  const ov=fbDialog("lig-bl-add",{titulo:"Adicionar Novo Registro",tam:"bxj",tom:"blx",sub:"Procure na lista de ativos pelo nome ou pelo RE.",
    corpo:'<label class="bx-busca">'+blI("busca")+'<span class="fb-sr">Nome ou RE</span><input id="bl-q" type="search" autocomplete="off" placeholder="Digite o nome ou o RE" oninput="ligBLBusca(this.value)"></label><div class="bx-res" id="bl-res" aria-live="polite"></div><div id="bl-prev"></div>',
    rodape:'<button type="button" class="bx-btn" onclick="fbFechar(\'lig-bl-add\')">Cancelar</button><button type="button" class="bx-btn bx-pri" id="bl-ok" disabled onclick="ligBLIncluir()">Adicionar à Black List</button>'});
  blMoldura(ov);
}
function ligBLBusca(v){
  clearTimeout(LIG_BL_T);
  LIG_BL_T=setTimeout(()=>{
    const ul=document.getElementById("bl-res");if(!ul)return;
    if(String(v||"").trim().length<2&&!/\d/.test(v)){ul.innerHTML="";return;}
    ligApi("/api/ligacoes?acao=blacklist_busca&q="+encodeURIComponent(v)).then(j=>{
      LIG_BL_RES=j.pessoas||[];const ja=new Set(LIG_BL.pessoas.map(p=>p.chave));
      ul.innerHTML=LIG_BL_RES.map((c,i)=>{const k=c.re+"|"+_ligNorm(c.nome).split(" ")[0];return'<button type="button"'+(ja.has(k)?' disabled':"")+' onclick="ligBLPega('+i+')"><b>'+_esc(blT(c.nome))+'</b><span>RE '+_esc(c.re)+(c.cargo?" · "+_esc(blT(c.cargo)):"")+(ja.has(k)?" · já está na Black List":"")+'</span></button>';}).join("")||'<p class="bx-tvz">Ninguém encontrado na lista de ativos.</p>';
    }).catch(e=>{ul.innerHTML='<p class="bx-tvz">'+_esc(e.message||"Não consegui buscar.")+'</p>';});
  },250);
}
function ligBLPega(i){
  const c=LIG_BL_RES[i],box=document.getElementById("bl-prev"),ok=document.getElementById("bl-ok");if(!c||!box)return;
  document.querySelectorAll("#bl-res button").forEach((b,k)=>b.classList.toggle("on",k===i));
  box.innerHTML='<p class="bx-tvz">Carregando o histórico…</p>';if(ok)ok.disabled=true;
  ligApi("/api/ligacoes?acao=blacklist&re="+encodeURIComponent(c.re)+"&nome="+encodeURIComponent(c.nome)).then(j=>{
    LIG_BL_NOVO=j.pessoa;LIG_BL_PASTA="inj";
    box.innerHTML='<div class="bx-prev"><div class="bx-ficha bx-estatica">'+BL_CAMADAS+blCarta(blAno(j.pessoa),true)+'</div><div class="bx-prev-r"><h4>Histórico do ano</h4><div id="bl-prev-h">'+blPastas(blAno(j.pessoa),true)+'</div>'
      +'<h4>Anotação da coordenação</h4><label class="fb-sr" for="bl-obs-n">Anotação da coordenação</label><textarea id="bl-obs-n" class="bx-papel-t" maxlength="2000" placeholder="Opcional: o motivo do acompanhamento"></textarea></div></div>';
    if(ok)ok.disabled=false;
  }).catch(e=>{box.innerHTML='<p class="bx-tvz">'+_esc(e.message||"Não consegui carregar.")+'</p>';});
}
function ligBLIncluir(){
  const p=LIG_BL_NOVO,t=document.getElementById("bl-obs-n"),ok=document.getElementById("bl-ok");if(!p)return;if(ok)ok.disabled=true;
  ligApi("/api/ligacoes?acao=blacklist","POST",{re:p.re,nome:p.nome,obs:t?t.value:""}).then(()=>{fbFechar("lig-bl-add");return blRecarrega(blT(p.nome)+" incluído na Black List.");})
    .catch(e=>{fbToast(e.message||"Não consegui incluir.","err");if(ok)ok.disabled=false;});
}
function ligBLHist(){
  const T={incluiu:"incluiu",editou:"alterou a anotação de",silhueta:"corrigiu a silhueta de",removeu:"removeu",ocorrencia:"registrou ocorrência para"};
  const ov=fbDialog("lig-bl-hist",{titulo:"Histórico de Alterações",tam:"bxj",tom:"blx",sub:"Quem incluiu, alterou, registrou ou removeu, com data e horário.",
    corpo:LIG_BL.historico.length?'<ol class="bx-hist">'+LIG_BL.historico.map(h=>'<li><time>'+blDH(h.em)+'</time><span><b>'+_esc(h.por)+'</b> '+(T[h.tipo]||"alterou")+' <b>'+_esc(blT(h.nome))+'</b> · RE '+_esc(h.re)+'</span></li>').join("")+'</ol>':'<p class="bx-tvz">Nenhuma alteração registrada.</p>',
    rodape:'<button type="button" class="bx-btn bx-pri" onclick="fbFechar(\'lig-bl-hist\')">Fechar</button>'});
  blMoldura(ov);
}
