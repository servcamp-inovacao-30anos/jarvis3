/* Agenda Comercial — a guia da administradora (Gabriela) no painel.
   Fica fora do index.html porque ele já está perto do limite de tamanho (test/auth_exigencia).
   O servidor é o api/_agenda.js (/api/rh?modulo=agenda); quem decide quem administra é ele.
   • Links para enviar: um por tipo de reunião (agendar.html?s=…), para copiar ou mandar por WhatsApp.
   • Calendário como o do iPhone: Semana (padrão), Dia, Mês e Lista. Tocar num horário vazio marca uma
     reunião ali; tocar numa reunião abre os detalhes (remarcar, cancelar, ligar, WhatsApp).
   • Bloqueios, horário de atendimento, tipos e a assinatura do iPhone (.ics).
   • Diretores: o calendário público do iCloud de cada diretor (iPhone) é lido pelo servidor; os horários em que
     ele está ocupado saem do link dos tipos de reunião que exigem esse diretor, e aparecem em cinza no calendário.
   • 🎨 Sua página: quem atende (nome, cargo, foto) e a mensagem de boas-vindas, na página do cliente e nos e-mails.
   • Resultado: depois que a reunião começa, registrar se aconteceu ou se a pessoa não veio e o próximo passo.
     Isso alimenta os números da agenda no Painel Comercial (agPainelComercial, chamado pelo index.html).
   Reunião em cima de reunião nunca: o banco recusa, e a tela mostra a mensagem do servidor. */
(function(raiz){
"use strict";
const esc=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const uk=()=>sessionStorage.getItem("userKey")||"";
const toast=t=>{if(typeof hqToast==="function")hqToast(t);};
const SEM=["Domingo","Segunda","Terça","Quarta","Quinta","Sexta","Sábado"];
const SEMC=["dom","seg","ter","qua","qui","sex","sáb"];
const MES=["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];
const AG={dados:null,erro:null,carregando:false,dono:null,verPassadas:false,vista:null,ref:null};
const MESL=["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];

// horário de Brasília (UTC-3) a partir do ISO do banco
const br=iso=>{const d=new Date(+new Date(iso)-3*3600000).toISOString();return{dia:d.slice(0,10),hora:d.slice(11,16)};};
const hojeBR=()=>br(new Date().toISOString()).dia;
const diaLongo=d=>{const x=new Date(d+"T12:00:00Z");return SEM[x.getUTCDay()]+", "+x.getUTCDate()+" de "+MES[x.getUTCMonth()];};
const durTxt=m=>m<60?m+" min":(m%60?Math.floor(m/60)+"h"+String(m%60).padStart(2,"0"):m/60+"h");
const telTxt=t=>{const d=String(t||"").replace(/\D/g,"");return d.length===11?"("+d.slice(0,2)+") "+d.slice(2,7)+"-"+d.slice(7):d.length===10?"("+d.slice(0,2)+") "+d.slice(2,6)+"-"+d.slice(6):d;};
const zap=t=>{let d=String(t||"").replace(/\D/g,"");if(d.length<=11)d="55"+d;return"https://wa.me/"+d;};
const linkDe=t=>location.origin+"/agendar.html?s="+encodeURIComponent(t.slug);
const RESULTADOS={realizada:"Realizada",faltou:"Não compareceu"};
const PROXIMOS={proposta:"Enviar proposta",visita:"Agendar visita",nova_reuniao:"Nova reunião",fechou:"Fechou negócio",sem_interesse:"Sem interesse",remarcar:"Remarcar",outro:"Outro"};
const comecou=r=>+new Date(r.inicio)<=Date.now();
// reuniões que já começaram e ainda não têm resultado (as dos últimos 30 dias)
const semResultado=D=>D.reunioes.filter(r=>r.status==="ativa"&&!r.resultado&&comecou(r)&&Date.now()-+new Date(r.inicio)<30*86400000).sort((a,b)=>+new Date(b.inicio)-+new Date(a.inicio));

async function api(t,metodo,corpo,qs){
  const r=await fetch("/api/rh?modulo=agenda"+(t?"&t="+t:"")+(qs||""),{method:metodo||"GET",headers:corpo?{"Content-Type":"application/json"}:{},body:corpo?JSON.stringify(corpo):undefined});
  const j=await r.json().catch(()=>({}));
  if(!r.ok||j.ok===false){const e=new Error(j.error||("Falha ("+r.status+")"));e.codigo=j.codigo;e.status=r.status;throw e;}
  return j;
}
const conteudo=()=>document.getElementById("ag-content");

/* ── carregar ──────────────────────────────────────────────────────────── */
raiz.agLoad=function(){
  const fb=document.querySelector(".fb");if(fb)fb.style.display="none"; // período/turno/área não valem aqui
  const sub=document.getElementById("pgSub");if(sub)sub.textContent="Reuniões com clientes e captação";
  if(AG.dono!==uk()){AG.dados=null;AG.erro=null;AG.dono=uk();}
  render();recarregar();
};
function recarregar(){
  if(AG.carregando)return;AG.carregando=true;const dono=uk();
  api("").then(j=>{if(dono===uk()){AG.dados=j;AG.erro=null;}}).catch(e=>{if(dono===uk()){AG.erro=e;if(e.status!==403&&AG.dados)toast("⚠️ "+e.message);}})
    .then(()=>{AG.carregando=false;if(typeof ST==="undefined"||ST.pg==="agenda")render();});
}

/* ── tela ──────────────────────────────────────────────────────────────── */
function render(){
  const el=conteudo();if(!el)return;
  ligar(el);
  if(AG.erro&&(!AG.dados||AG.erro.status===403)){
    el.innerHTML='<div class="agd-vazio">'+(AG.erro.status===403?'🔒 Esta guia é só da administradora da agenda.':AG.erro.codigo==="SEM_TABELA"?'As tabelas da agenda ainda não foram criadas no banco.':'Não consegui carregar a agenda: '+esc(AG.erro.message)+'<br><button type="button" class="rh-btn rh-btn-sec" data-ag="recarregar" style="margin-top:10px">Tentar de novo</button>')+'</div>';
    return;
  }
  if(!AG.dados){el.innerHTML='<div class="agd-vazio">Carregando a agenda…</div>';return;}
  const D=AG.dados,hoje=hojeBR(),agora=Date.now();
  const tipos=D.tipos.filter(t=>t.ativo);
  const ativas=D.reunioes.filter(r=>r.status==="ativa"&&+new Date(r.fim)>=agora);
  const outras=D.reunioes.filter(r=>!(r.status==="ativa"&&+new Date(r.fim)>=agora)).reverse();
  const semana=ativas.filter(r=>br(r.inicio).dia<=somaDias(hoje,6)).length;
  let h='<div class="agd-barra">'+
    '<button type="button" class="rh-btn" data-ag="marcar">➕ Marcar reunião</button>'+
    '<button type="button" class="rh-btn rh-btn-sec" data-ag="bloquear">⛔ Bloquear horário</button>'+
    '<button type="button" class="rh-btn rh-btn-sec" data-ag="config">⚙️ Horários e tipos</button>'+
    '<button type="button" class="rh-btn rh-btn-sec" data-ag="marca">🎨 Sua página</button>'+
    '<button type="button" class="rh-btn rh-btn-sec" data-ag="diretores">👔 Diretores'+(semLeitura(D)?' ⚠️':'')+'</button>'+
    '<button type="button" class="rh-btn rh-btn-sec" data-ag="iphone">📱 Ver no iPhone</button></div>';
  h+='<div class="agd-kpis"><div><b>'+ativas.filter(r=>br(r.inicio).dia===hoje).length+'</b><span>hoje</span></div><div><b>'+semana+'</b><span>nos próximos 7 dias</span></div><div><b>'+ativas.length+'</b><span>marcadas no total</span></div><div><b>'+ativas.filter(r=>r.origem==="link").length+'</b><span>marcadas pelo link</span></div>'+
    (()=>{const n=semResultado(D).length;return'<div class="'+(n?"agd-kpi-alerta":"")+'"><b>'+n+'</b><span>aguardando resultado</span></div>';})()+'</div>';
  // reuniões que já aconteceram e esperam o resultado
  {const pend=semResultado(D);
  if(pend.length)h+='<div class="agd-card agd-pend"><div class="agd-h">📝 Como foram estas reuniões? <small>(registre o resultado: ele vai para os números do Painel Comercial)</small></div>'+
    pend.map(r=>{const a=br(r.inicio);return'<div class="agd-pr"><span class="agd-cor" style="background:'+esc(corTipo(r))+'"></span><div class="agd-pr-n"><b>'+esc(r.nome)+'</b><span>'+esc(r.tipo_nome||"Reunião")+' · '+esc(diaLongo(a.dia))+' às '+a.hora+'</span></div>'+
      '<button type="button" class="rh-btn agd-ok" data-ag="res" data-r="realizada" data-id="'+r.id+'">✅ Aconteceu</button><button type="button" class="rh-btn rh-btn-sec" data-ag="res" data-r="faltou" data-id="'+r.id+'">🚫 Não veio</button></div>';}).join("")+'</div>';}
  // links
  h+='<div class="agd-card"><div class="agd-h">🔗 Links para enviar ao cliente</div>'+
    (tipos.length?tipos.map(t=>'<div class="agd-link"><span class="agd-cor" style="background:'+esc(t.cor||"#1e4d8c")+'"></span><div class="agd-link-n"><b>'+esc(t.nome)+'</b><span>'+esc(durTxt(t.duracao_min))+(t.local?' · '+esc(t.local):'')+'</span></div>'+
      '<input class="agd-url" readonly value="'+esc(linkDe(t))+'" aria-label="Link de '+esc(t.nome)+'">'+
      '<button type="button" class="rh-btn" data-ag="copiar" data-id="'+t.id+'">Copiar</button>'+
      '<a class="rh-btn rh-btn-sec" href="https://wa.me/?text='+encodeURIComponent("Olá! Escolha o melhor dia e horário para a nossa reunião: "+linkDe(t))+'" target="_blank" rel="noopener">WhatsApp</a>'+
      '<a class="agd-lk" href="'+esc(linkDe(t))+'" target="_blank" rel="noopener">abrir</a></div>').join(""):'<div class="agd-vazio">Nenhum tipo de reunião ativo. Crie um em ⚙️ Horários e tipos.</div>')+'</div>';
  // calendário (semana, dia, mês) ou a lista das próximas
  h+='<div class="agd-card agc">'+calendario(D.reunioes.filter(r=>r.status==="ativa"))+'</div>';
  // bloqueios
  const bls=D.bloqueios.filter(b=>+new Date(b.fim)>=agora);
  h+='<div class="agd-card"><div class="agd-h">⛔ Bloqueios <small>(horários que não aparecem no link)</small></div>'+
    (bls.length?bls.map(b=>'<div class="agd-bl"><span>'+esc(txtFaixa(b.inicio,b.fim))+(b.motivo?' · <i>'+esc(b.motivo)+'</i>':'')+'</span><button type="button" class="agd-lk" data-ag="tirarbl" data-id="'+b.id+'">tirar</button></div>').join(""):'<div class="agd-vazio">Nenhum bloqueio. Use ⛔ para férias, feriados ou um compromisso fora do painel.</div>')+'</div>';
  // passadas e canceladas
  h+='<div class="agd-card"><button type="button" class="agd-toggle" data-ag="passadas">'+(AG.verPassadas?"▾":"▸")+' Passadas e canceladas (últimos 30 dias) · '+outras.length+'</button>'+
    (AG.verPassadas?(outras.length?outras.map(linhaReuniao).join(""):'<div class="agd-vazio">Nada por aqui.</div>'):"")+'</div>';
  el.innerHTML=h;
}
function somaDias(dia,n){const d=new Date(dia+"T12:00:00Z");d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);}
function txtFaixa(ini,fim){
  const a=br(ini),b=br(fim);
  const inteiro=a.hora==="00:00"&&b.hora==="00:00";
  if(inteiro){const ult=somaDias(b.dia,-1);return ult===a.dia?diaLongo(a.dia)+" (dia inteiro)":diaLongo(a.dia)+" até "+diaLongo(ult)+" (dias inteiros)";}
  return a.dia===b.dia?diaLongo(a.dia)+", "+a.hora+"–"+b.hora:diaLongo(a.dia)+" "+a.hora+" até "+diaLongo(b.dia)+" "+b.hora;
}
function linhaReuniao(r){
  const a=br(r.inicio),b=br(r.fim),canc=r.status!=="ativa",passou=+new Date(r.fim)<Date.now();
  const tipo=AG.dados.tipos.find(t=>String(t.id)===String(r.tipo_id));
  return'<div class="agd-r'+(canc?" canc":"")+'" style="border-left-color:'+esc((tipo&&tipo.cor)||"#1e4d8c")+'">'+
    '<div class="agd-r-h"><b>'+a.hora+'–'+b.hora+'</b>'+(passou||canc?'<span class="agd-r-d">'+esc(diaLongo(a.dia))+'</span>':'')+'</div>'+
    '<div class="agd-r-c"><div class="agd-r-t"><b>'+esc(r.nome)+'</b> · '+esc(r.tipo_nome||"Reunião")+
      (canc?' <span class="agd-tag agd-tag-c">cancelada</span>':'')+(r.origem==="link"?' <span class="agd-tag">pelo link</span>':' <span class="agd-tag agd-tag-m">cadastrada aqui</span>')+tagResultado(r)+'</div>'+
      '<div class="agd-r-x">'+(r.telefone?'<a href="tel:'+esc(r.telefone)+'">'+esc(telTxt(r.telefone))+'</a> · <a href="'+esc(zap(r.telefone))+'" target="_blank" rel="noopener">WhatsApp</a>':'')+
      (r.email?(r.telefone?' · ':'')+'<a href="mailto:'+esc(r.email)+'">'+esc(r.email)+'</a>':'')+'</div>'+
      (r.obs?'<div class="agd-r-o">“'+esc(r.obs)+'”</div>':'')+'</div>'+
    (!canc&&comecou(r)?'<div class="agd-r-a"><button type="button" class="agd-lk" data-ag="res" data-id="'+r.id+'">'+(r.resultado?"mudar resultado":"registrar resultado")+'</button></div>':'')+
    (canc||passou?'':'<div class="agd-r-a"><button type="button" class="agd-lk" data-ag="remarcar" data-id="'+r.id+'">remarcar</button><button type="button" class="agd-lk agd-lk-v" data-ag="cancelar" data-id="'+r.id+'">cancelar</button></div>')+'</div>';
}

function tagResultado(r){
  if(r.status!=="ativa"||!r.resultado)return"";
  return' <span class="agd-tag '+(r.resultado==="realizada"?"agd-tag-ok":"agd-tag-c")+'">'+(r.resultado==="realizada"?"✅ realizada":"🚫 não compareceu")+'</span>'+(r.proximo_passo?' <span class="agd-tag">→ '+esc(PROXIMOS[r.proximo_passo]||r.proximo_passo)+'</span>':'');
}

/* ── calendário ────────────────────────────────────────────────────────── */
const VISTAS=[["mes","Mês"],["semana","Semana"],["dia","Dia"],["lista","Lista"]];
const H=56; // altura de 1 hora na grade (px)
const minDe=h=>Number(h.slice(0,2))*60+Number(h.slice(3,5));
const hhmm=m=>String(Math.floor(m/60)).padStart(2,"0")+":"+String(m%60).padStart(2,"0");
const dowDe=d=>new Date(d+"T12:00:00Z").getUTCDay();
const segDe=d=>somaDias(d,-((dowDe(d)+6)%7)); // segunda-feira da semana
const dur=r=>Math.round((+new Date(r.fim)-+new Date(r.inicio))/60000);
const temAtend=w=>!!(((AG.dados.config||{}).semana||{})[String(w)]||[]).length;
const corTipo=r=>{const t=AG.dados.tipos.find(x=>String(x.id)===String(r.tipo_id));return(t&&t.cor)||"#1e4d8c";};
const rgba=(hex,a)=>{const n=parseInt(String(/^#[0-9a-f]{6}$/i.test(hex)?hex:"#1e4d8c").slice(1),16);return"rgba("+(n>>16&255)+","+(n>>8&255)+","+(n&255)+","+a+")";};
function lerVista(){try{const v=localStorage.getItem("agd_vista");return VISTAS.some(x=>x[0]===v)?v:"semana";}catch(e){return"semana";}}
function guardarVista(v){try{localStorage.setItem("agd_vista",v);}catch(e){}}

function calendario(ativas){
  if(!AG.vista)AG.vista=lerVista();
  if(!AG.ref)AG.ref=hojeBR();
  const v=AG.vista,ref=AG.ref;
  let titulo;
  if(v==="mes"){const x=new Date(ref+"T12:00:00Z");titulo=MESL[x.getUTCMonth()].charAt(0).toUpperCase()+MESL[x.getUTCMonth()].slice(1)+" de "+x.getUTCFullYear();}
  else if(v==="semana"){
    const s=segDe(ref),f=somaDias(s,6),a=new Date(s+"T12:00:00Z"),b=new Date(f+"T12:00:00Z");
    titulo=a.getUTCMonth()===b.getUTCMonth()?a.getUTCDate()+" a "+b.getUTCDate()+" de "+MESL[b.getUTCMonth()]:a.getUTCDate()+" de "+MES[a.getUTCMonth()]+" a "+b.getUTCDate()+" de "+MES[b.getUTCMonth()];
  }
  else if(v==="dia")titulo=diaLongo(ref);
  else titulo="Próximas reuniões";
  let h='<div class="agc-bar">'+
    (v!=="lista"?'<div class="agc-navs"><button type="button" class="agc-nav" data-ag="nav" data-d="-1" aria-label="Anterior">‹</button><button type="button" class="agc-nav" data-ag="nav" data-d="1" aria-label="Próximo">›</button><button type="button" class="agc-hoje" data-ag="hoje">Hoje</button></div>':'')+
    '<b class="agc-tit">'+esc(titulo)+'</b>'+
    '<div class="agc-seg" role="tablist" aria-label="Visão do calendário">'+VISTAS.map(([k,t])=>'<button type="button" role="tab" aria-selected="'+(k===v)+'"'+(k===v?' class="on"':'')+' data-ag="vista" data-v="'+k+'">'+t+'</button>').join("")+'</div></div>';
  if(v==="mes")h+=vistaMes(ativas);
  else if(v==="semana"){
    const s=segDe(ref);
    const dias=[0,1,2,3,4,5,6].map(i=>somaDias(s,i)).filter(d=>{const w=dowDe(d);return(w>=1&&w<=5)||temAtend(w)||ativas.some(r=>br(r.inicio).dia===d);});
    h+=vistaGrade(dias,ativas);
  }
  else if(v==="dia")h+=vistaGrade([ref],ativas);
  else h+=vistaLista(ativas);
  return h;
}

// Semana e Dia: colunas com as horas, como o calendário do iPhone. Faixa clara = horário de atendimento;
// hachurado = bloqueio; bloco colorido = reunião (do tamanho da duração); linha vermelha = agora.
function vistaGrade(dias,ativas){
  const D=AG.dados,cfg=D.config||{},hoje=hojeBR();
  const doDia=d=>ativas.filter(r=>br(r.inicio).dia===d);
  let ini=24*60,fim=0;
  dias.forEach(d=>{((cfg.semana||{})[String(dowDe(d))]||[]).forEach(f=>{ini=Math.min(ini,minDe(f[0]));fim=Math.max(fim,minDe(f[1]));});});
  dias.forEach(d=>doDia(d).forEach(r=>{const a=minDe(br(r.inicio).hora);ini=Math.min(ini,a);fim=Math.max(fim,a+dur(r));}));
  if(ini>=fim){ini=8*60;fim=18*60;}
  ini=Math.max(0,Math.floor(ini/60)*60-60);fim=Math.min(24*60,Math.ceil(fim/60)*60+60);
  const alt=(fim-ini)/60*H,y=m=>(m-ini)/60*H;
  let h='<div class="agc-rola"><div class="agc-grade" style="--cols:'+dias.length+'"><div class="agc-cab"><div></div>'+dias.map(d=>{
    const x=new Date(d+"T12:00:00Z");
    return'<button type="button" class="agc-cd'+(d===hoje?" hoje":"")+'" data-ag="dia" data-dia="'+d+'" title="Ver o dia"><span>'+SEMC[x.getUTCDay()]+'</span><b>'+x.getUTCDate()+'</b></button>';
  }).join("")+'</div><div class="agc-corpo"><div class="agc-horas" style="height:'+alt+'px">';
  for(let m=ini+60;m<fim;m+=60)h+='<span style="top:'+y(m)+'px">'+hhmm(m)+'</span>';
  h+='</div>';
  dias.forEach(d=>{
    h+='<div class="agc-col'+(d<hoje?" passado":"")+'" data-dia="'+d+'" data-ini="'+ini+'" style="height:'+alt+'px">';
    for(let m=ini+60;m<fim;m+=60)h+='<div class="agc-linha" style="top:'+y(m)+'px"></div>';
    ((cfg.semana||{})[String(dowDe(d))]||[]).forEach(f=>{h+='<div class="agc-atend" style="top:'+y(minDe(f[0]))+'px;height:'+((minDe(f[1])-minDe(f[0]))/60*H)+'px"></div>';});
    const d0=Date.parse(d+"T00:00:00-03:00"),d1=d0+86400000;
    D.bloqueios.forEach(b=>{
      const a=Math.max(+new Date(b.inicio),d0),z=Math.min(+new Date(b.fim),d1);if(z<=a)return;
      const ta=Math.max((a-d0)/60000,ini),tz=Math.min((z-d0)/60000,fim);if(tz<=ta)return;
      h+='<div class="agc-bl" style="top:'+y(ta)+'px;height:'+((tz-ta)/60*H)+'px"><span>⛔ '+esc(b.motivo||"Bloqueado")+'</span></div>';
    });
    (D.ocupados||[]).forEach(o=>{
      const a=Math.max(+new Date(o.inicio),d0),z=Math.min(+new Date(o.fim),d1);if(z<=a)return;
      const ta=Math.max((a-d0)/60000,ini),tz=Math.min((z-d0)/60000,fim);if(tz<=ta)return;
      h+='<div class="agc-dir" style="top:'+y(ta)+'px;height:'+((tz-ta)/60*H)+'px" title="'+esc(o.nome)+' ocupado"><span>👔 '+esc(o.nome)+'</span></div>';
    });
    doDia(d).forEach(r=>{
      const a=minDe(br(r.inicio).hora),dd=dur(r),c=corTipo(r);
      h+='<button type="button" class="agc-ev'+(dd<=30?" curto":"")+(r.resultado==="faltou"?" faltou":r.resultado==="realizada"?" feita":"")+'" data-ag="ver" data-id="'+r.id+'" style="top:'+y(a)+'px;height:'+Math.max(18,dd/60*H-2)+'px;background:'+rgba(c,.16)+';border-left-color:'+esc(c)+'" title="'+esc(br(r.inicio).hora+"–"+br(r.fim).hora+" · "+r.nome+" · "+(r.tipo_nome||""))+'">'+
        '<b>'+(r.resultado==="realizada"?"✅ ":r.resultado==="faltou"?"🚫 ":"")+br(r.inicio).hora+' · '+esc(r.nome)+'</b><span>'+esc(r.tipo_nome||"")+'</span></button>';
    });
    if(d===hoje){const n=minDe(br(new Date().toISOString()).hora);if(n>=ini&&n<=fim)h+='<div class="agc-agora" style="top:'+y(n)+'px"></div>';}
    h+='</div>';
  });
  h+='</div></div></div><p class="agc-dica">Toque num horário vazio para marcar uma reunião ali · toque numa reunião para ver os detalhes.</p>';
  return h;
}

// Mês: a grade do mês com bolinhas na cor do tipo de reunião. Tocar no dia abre o Dia.
function vistaMes(ativas){
  const D=AG.dados,ref=AG.ref,hoje=hojeBR(),mes=ref.slice(0,7);
  const p1=mes+"-01",ini=somaDias(p1,-dowDe(p1)); // começa no domingo, como o iPhone
  let h='<div class="agc-mes"><div class="agc-mes-cab">'+SEMC.map(s=>'<span>'+s+'</span>').join("")+'</div><div class="agc-mes-g">';
  for(let i=0;i<42;i++){
    const d=somaDias(ini,i);
    if(i===35&&d.slice(0,7)!==mes)break; // 6ª linha só quando o mês precisa
    const rs=ativas.filter(r=>br(r.inicio).dia===d);
    const d0=Date.parse(d+"T00:00:00-03:00");
    const bloq=D.bloqueios.some(b=>+new Date(b.inicio)<=d0&&+new Date(b.fim)>=d0+86400000);
    h+='<button type="button" class="agc-dm'+(d.slice(0,7)!==mes?" fora":"")+(d===hoje?" hoje":"")+(bloq?" bloq":"")+(!temAtend(dowDe(d))?" fds":"")+'" data-ag="dia" data-dia="'+d+'"><b>'+Number(d.slice(8))+'</b>'+
      (rs.length?'<span class="agc-pts">'+rs.slice(0,4).map(r=>'<i style="background:'+esc(corTipo(r))+'"></i>').join("")+(rs.length>4?'<em>+'+(rs.length-4)+'</em>':'')+'</span><span class="agc-n">'+rs.length+' reuni'+(rs.length===1?"ão":"ões")+'</span>':(bloq?'<span class="agc-n">bloqueado</span>':''))+'</button>';
  }
  h+='</div></div>';
  return h;
}

function vistaLista(ativas){
  const hoje=hojeBR(),agora=Date.now(),porDia={};
  ativas.filter(r=>+new Date(r.fim)>=agora).forEach(r=>{const d=br(r.inicio).dia;(porDia[d]=porDia[d]||[]).push(r);});
  const dias=Object.keys(porDia).sort();
  return dias.length?dias.map(d=>'<div class="agd-dia"><div class="agd-dia-t">'+(d===hoje?"Hoje · ":d===somaDias(hoje,1)?"Amanhã · ":"")+esc(diaLongo(d))+'</div>'+porDia[d].map(linhaReuniao).join("")+'</div>').join(""):
    '<div class="agd-vazio">Nenhuma reunião marcada. Mande um dos links acima para o cliente escolher o horário.</div>';
}

function navegar(passo){
  const v=AG.vista,ref=AG.ref;
  if(v==="mes"){const x=new Date(ref.slice(0,7)+"-15T12:00:00Z");x.setUTCMonth(x.getUTCMonth()+passo);AG.ref=x.toISOString().slice(0,10);}
  else AG.ref=somaDias(ref,(v==="semana"?7:1)*passo);
  render();
}

// Detalhes de uma reunião (tocar no bloco do calendário)
function abrirReuniao(r){
  if(!r)return;
  const a=br(r.inicio),b=br(r.fim),passou=+new Date(r.fim)<Date.now(),c=corTipo(r);
  const ov=janela(r.tipo_nome||"Reunião",
    '<div class="agc-det" style="border-left-color:'+esc(c)+'"><b>'+esc(r.nome)+'</b><span>'+esc(diaLongo(a.dia))+' · '+a.hora+'–'+b.hora+'</span>'+
      (r.local?'<span>📍 '+esc(r.local)+'</span>':'')+
      '<span>'+(r.origem==="link"?"Marcada pelo link":"Cadastrada aqui")+(r.cancelado_por==="cliente"?" · cancelada pelo cliente":"")+(r.remarcacoes?" · remarcada "+r.remarcacoes+"x pelo cliente":"")+'</span>'+
      (r.email_status?'<span>✉️ Confirmação: '+(/^enviado/.test(r.email_status)?"enviada":/^falhou/.test(r.email_status)?"não saiu ("+esc(r.email_status.split(" · ")[0].replace(/^falhou:\s*/,""))+")":esc(r.email_status.split(" · ")[0]))+'</span>'+(/aviso à Comercial falhou/.test(r.email_status)?'<span>⚠️ O aviso para a Comercial não saiu: confira esta reunião na agenda</span>':''):'')+
      (r.resultado?'<span>'+(r.resultado==="realizada"?"✅ Realizada":"🚫 Não compareceu")+(r.proximo_passo?" · próximo passo: "+esc(PROXIMOS[r.proximo_passo]||r.proximo_passo):"")+'</span>'+(r.resultado_obs?'<span>📝 '+esc(r.resultado_obs)+'</span>':''):'')+
      (r.whatsapp_status?'<span>💬 WhatsApp: '+(/^enviado/.test(r.whatsapp_status)?"enviado":/^falhou/.test(r.whatsapp_status)?"não saiu ("+esc(r.whatsapp_status.replace(/^falhou:\s*/,""))+")":esc(r.whatsapp_status))+'</span>':'')+'</div>'+
    (r.telefone?'<div class="agc-det-l">📞 <a href="tel:'+esc(r.telefone)+'">'+esc(telTxt(r.telefone))+'</a> · <a href="'+esc(zap(r.telefone))+'" target="_blank" rel="noopener">WhatsApp</a></div>':'')+
    (r.email?'<div class="agc-det-l">✉️ <a href="mailto:'+esc(r.email)+'">'+esc(r.email)+'</a></div>':'')+
    (r.obs?'<div class="agc-det-o">“'+esc(r.obs)+'”</div>':'')+
    '<div class="agd-acoes">'+(passou?'':'<button type="button" class="rh-btn rh-btn-sec agd-lk-v" id="agv-cancelar">Cancelar reunião</button><button type="button" class="rh-btn rh-btn-sec" id="agv-remarcar">Remarcar</button>')+(comecou(r)?'<button type="button" class="rh-btn rh-btn-sec" id="agv-res">📝 '+(r.resultado?"Mudar resultado":"Registrar resultado")+'</button>':'')+'<button type="button" class="rh-btn" data-fechar="1">Fechar</button></div>');
  const bc=ov.querySelector("#agv-cancelar"),bm=ov.querySelector("#agv-remarcar"),br2=ov.querySelector("#agv-res");
  if(br2)br2.addEventListener("click",()=>abrirResultado(r));
  if(bc)bc.addEventListener("click",()=>{fechar();cancelar(r,null);});
  if(bm)bm.addEventListener("click",()=>abrirRemarcar(r));
}

/* ── eventos ───────────────────────────────────────────────────────────── */
function ligar(el){
  if(el.__ag)return;el.__ag=true;
  el.addEventListener("click",e=>{
    // horário vazio na grade (Semana/Dia): marcar uma reunião ali, no passo de horários da configuração
    const col=e.target.closest(".agc-col");
    if(col&&!e.target.closest("[data-ag]")&&el.contains(col)){
      const passo=(AG.dados&&AG.dados.config&&AG.dados.config.passo_min)||30;
      const m=Number(col.dataset.ini)+(e.clientY-col.getBoundingClientRect().top)/H*60;
      abrirMarcar({dia:col.dataset.dia,hora:hhmm(Math.max(0,Math.min(23*60+55,Math.floor(m/passo)*passo)))});
      return;
    }
    const b=e.target.closest("[data-ag]");if(!b||!el.contains(b))return;
    const a=b.dataset.ag,id=b.dataset.id;
    if(a==="recarregar")recarregar();
    else if(a==="marcar")abrirMarcar();
    else if(a==="bloquear")abrirBloqueio();
    else if(a==="config")abrirConfig();
    else if(a==="marca")abrirMarca();
    else if(a==="res")abrirResultado(AG.dados.reunioes.find(r=>String(r.id)===id),b.dataset.r);
    else if(a==="diretores")abrirDiretores();
    else if(a==="iphone")abrirIphone();
    else if(a==="passadas"){AG.verPassadas=!AG.verPassadas;render();}
    else if(a==="vista"){AG.vista=b.dataset.v;guardarVista(AG.vista);render();}
    else if(a==="nav")navegar(Number(b.dataset.d)||0);
    else if(a==="hoje"){AG.ref=hojeBR();render();}
    else if(a==="dia"){AG.ref=b.dataset.dia;AG.vista="dia";render();}
    else if(a==="ver")abrirReuniao(AG.dados.reunioes.find(r=>String(r.id)===id));
    else if(a==="copiar"){const t=AG.dados.tipos.find(x=>String(x.id)===id);if(t)copiar(linkDe(t),"🔗 Link copiado: é só colar para o cliente");}
    else if(a==="remarcar")abrirRemarcar(AG.dados.reunioes.find(r=>String(r.id)===id));
    else if(a==="cancelar")cancelar(AG.dados.reunioes.find(r=>String(r.id)===id),b);
    else if(a==="tirarbl"){if(confirm("Tirar este bloqueio? O horário volta a aparecer no link."))acao(()=>api("bloqueio","DELETE",null,"&id="+id),"Bloqueio tirado",b);}
  });
}
function copiar(t,msg){
  (navigator.clipboard&&navigator.clipboard.writeText?navigator.clipboard.writeText(t):Promise.reject()).then(()=>toast(msg)).catch(()=>{prompt("Copie o link:",t);});
}
async function acao(fn,msg,b){
  if(b)b.disabled=true;
  try{await fn();toast("✅ "+msg);recarregar();}catch(e){toast("⚠️ "+e.message);}finally{if(b)b.disabled=false;}
}
function cancelar(r,b){
  if(!r)return;const a=br(r.inicio);
  if(!confirm("Cancelar a reunião de "+r.nome+" em "+diaLongo(a.dia)+" às "+a.hora+"?\n\nO horário volta a ficar livre no link."+((r.email||r.telefone)?"\nA pessoa recebe o aviso do cancelamento por "+[r.telefone?"WhatsApp":"",r.email?"e-mail":""].filter(Boolean).join(" e ")+".":"\nA pessoa não deixou contato: avise de outro jeito.")))return;
  acao(()=>api("cancelar","POST",{},"&id="+r.id),"Reunião cancelada",b);
}

/* ── janelas ───────────────────────────────────────────────────────────── */
function janela(titulo,html,larga){
  fechar();
  const ov=document.createElement("div");ov.className="agd-ov";ov.id="agd-ov";
  ov.innerHTML='<div class="agd-box'+(larga?" larga":"")+'" role="dialog" aria-modal="true" aria-label="'+esc(titulo)+'"><div class="agd-bh"><b>'+esc(titulo)+'</b><button type="button" class="agd-x" data-fechar="1" aria-label="Fechar">✕</button></div><div class="agd-bc">'+html+'<p class="agd-msg"></p></div></div>';
  let baixou=null;
  ov.addEventListener("mousedown",e=>{baixou=e.target;});
  ov.addEventListener("click",e=>{if((e.target===ov&&baixou===ov)||e.target.closest("[data-fechar]"))fechar();});
  document.body.appendChild(ov);return ov;
}
function fechar(){const o=document.getElementById("agd-ov");if(o)o.remove();}
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&document.getElementById("agd-ov"))fechar();});
const msg=(ov,t,erro)=>{const m=ov.querySelector(".agd-msg");if(m){m.textContent=t||"";m.className="agd-msg"+(erro?" erro":"");}};
async function enviar(ov,b,fn,ok){
  b.disabled=true;msg(ov,"Salvando…");
  try{await fn();if(document.getElementById("agd-ov")===ov)fechar();toast("✅ "+ok);recarregar();}
  catch(e){b.disabled=false;msg(ov,e.message,true);}
}
const campo=(rot,html)=>'<label class="agd-f"><span>'+rot+'</span>'+html+'</label>';

function abrirMarcar(pre){
  const D=AG.dados,tipos=D.tipos.filter(t=>t.ativo);
  if(!tipos.length){toast("Crie um tipo de reunião primeiro (⚙️ Horários e tipos).");return;}
  const ov=janela("➕ Marcar reunião",
    '<p class="agd-dica">Para reuniões combinadas por telefone ou pessoalmente. Pode ser fora do horário de atendimento, mas nunca em cima de outra reunião.</p>'+
    campo("Tipo",'<select id="agm-tipo">'+tipos.map(t=>'<option value="'+t.id+'">'+esc(t.nome)+' ('+esc(durTxt(t.duracao_min))+')</option>').join("")+'</select>')+
    '<div class="agd-2">'+campo("Dia",'<input type="date" id="agm-dia" min="'+hojeBR()+'" value="'+esc((pre&&pre.dia)||hojeBR())+'">')+campo("Horário",'<input type="time" id="agm-hora" step="300" value="'+esc((pre&&pre.hora)||"09:00")+'">')+'</div>'+
    campo("Nome",'<input id="agm-nome" maxlength="80">')+
    '<div class="agd-2">'+campo("Telefone <small>(opcional)</small>",'<input id="agm-tel" type="tel" maxlength="20">')+campo("E-mail <small>(opcional)</small>",'<input id="agm-email" type="email" maxlength="120">')+'</div>'+
    campo("Observação <small>(opcional)</small>",'<textarea id="agm-obs" maxlength="500" rows="2"></textarea>')+
    '<label class="agd-ck"><input type="checkbox" id="agm-avisar" checked> Enviar a confirmação por WhatsApp e e-mail para a pessoa (o que ela tiver)</label>'+
    '<div class="agd-acoes"><button type="button" class="rh-btn rh-btn-sec" data-fechar="1">Voltar</button><button type="button" class="rh-btn" id="agm-ok">Marcar</button></div>');
  const v=id=>ov.querySelector(id).value;
  ov.querySelector("#agm-ok").addEventListener("click",e=>enviar(ov,e.currentTarget,()=>api("reuniao","POST",{tipo_id:v("#agm-tipo"),dia:v("#agm-dia"),hora:v("#agm-hora"),nome:v("#agm-nome"),telefone:v("#agm-tel"),email:v("#agm-email"),obs:v("#agm-obs"),avisar:ov.querySelector("#agm-avisar").checked}),"Reunião marcada"));
  ov.querySelector("#agm-nome").focus();
}
function abrirRemarcar(r){
  if(!r)return;const a=br(r.inicio);
  const ov=janela("Remarcar · "+r.nome,
    '<p class="agd-dica">Hoje está em <b>'+esc(diaLongo(a.dia))+' às '+a.hora+'</b>. '+((r.email||r.telefone)?'A pessoa recebe o novo horário por '+[r.telefone?"WhatsApp":"",r.email?"e-mail":""].filter(Boolean).join(" e ")+'.':'Ela não deixou contato: avise de outro jeito.')+'</p>'+
    '<div class="agd-2">'+campo("Novo dia",'<input type="date" id="agr-dia" min="'+hojeBR()+'" value="'+a.dia+'">')+campo("Novo horário",'<input type="time" id="agr-hora" step="300" value="'+a.hora+'">')+'</div>'+
    '<div class="agd-acoes"><button type="button" class="rh-btn rh-btn-sec" data-fechar="1">Voltar</button><button type="button" class="rh-btn" id="agr-ok">Remarcar</button></div>');
  ov.querySelector("#agr-ok").addEventListener("click",e=>enviar(ov,e.currentTarget,()=>api("reuniao","PATCH",{dia:ov.querySelector("#agr-dia").value,hora:ov.querySelector("#agr-hora").value},"&id="+r.id),"Reunião remarcada"));
}
function abrirBloqueio(){
  const ov=janela("⛔ Bloquear horário",
    '<p class="agd-dica">O horário bloqueado some do link. Reuniões já marcadas nele continuam: remarque ou cancele se precisar.</p>'+
    '<div class="agd-2">'+campo("De",'<input type="date" id="agb-dia" min="'+hojeBR()+'" value="'+hojeBR()+'">')+campo("Até",'<input type="date" id="agb-ate" min="'+hojeBR()+'" value="'+hojeBR()+'">')+'</div>'+
    '<label class="agd-ck"><input type="checkbox" id="agb-inteiro" checked> Dia(s) inteiro(s)</label>'+
    '<div class="agd-2" id="agb-horas" hidden>'+campo("Das",'<input type="time" id="agb-de" step="300" value="12:00">')+campo("Até as",'<input type="time" id="agb-ateh" step="300" value="14:00">')+'</div>'+
    campo("Motivo <small>(opcional, só você vê)</small>",'<input id="agb-motivo" maxlength="120" placeholder="Ex.: férias, feriado, visita">')+
    '<div class="agd-acoes"><button type="button" class="rh-btn rh-btn-sec" data-fechar="1">Voltar</button><button type="button" class="rh-btn" id="agb-ok">Bloquear</button></div>');
  const q=s=>ov.querySelector(s);
  q("#agb-dia").addEventListener("change",()=>{if(q("#agb-ate").value<q("#agb-dia").value)q("#agb-ate").value=q("#agb-dia").value;});
  q("#agb-inteiro").addEventListener("change",()=>{q("#agb-horas").hidden=q("#agb-inteiro").checked;});
  q("#agb-ok").addEventListener("click",e=>{
    const inteiro=q("#agb-inteiro").checked;
    enviar(ov,e.currentTarget,()=>api("bloqueio","POST",{dia:q("#agb-dia").value,ateDia:q("#agb-ate").value,de:inteiro?null:q("#agb-de").value,ate:inteiro?null:q("#agb-ateh").value,motivo:q("#agb-motivo").value}),"Horário bloqueado");
  });
}
function abrirConfig(){
  const D=AG.dados,c=D.config;
  const linhaDia=i=>{
    const f=(c.semana||{})[String(i)]||[],on=f.length>0,f1=f[0]||["09:00","12:00"],f2=f[1]||null;
    return'<div class="agd-sem" data-d="'+i+'"><label class="agd-ck"><input type="checkbox" class="s-on"'+(on?" checked":"")+'> '+SEM[i]+'</label>'+
      '<span class="s-f"><input type="time" class="s-a1" step="300" value="'+f1[0]+'">–<input type="time" class="s-b1" step="300" value="'+f1[1]+'"></span>'+
      '<label class="agd-ck s-2l"><input type="checkbox" class="s-2"'+(f2?" checked":"")+'> 2ª faixa</label>'+
      '<span class="s-f s-f2"'+(f2?"":" hidden")+'><input type="time" class="s-a2" step="300" value="'+(f2?f2[0]:"14:00")+'">–<input type="time" class="s-b2" step="300" value="'+(f2?f2[1]:"17:00")+'"></span></div>';
  };
  const tipoLinha=t=>'<div class="agd-tipo" data-id="'+(t?t.id:"")+'"><input type="color" class="t-cor" value="'+esc((t&&t.cor)||"#1e4d8c")+'" aria-label="Cor">'+
    '<input class="t-nome" maxlength="60" placeholder="Nome (ex.: Captação)" value="'+esc(t?t.nome:"")+'">'+
    '<select class="t-dur">'+[15,20,30,40,45,60,75,90,120].map(m=>'<option value="'+m+'"'+((t?t.duracao_min:30)===m?" selected":"")+'>'+durTxt(m)+'</option>').join("")+'</select>'+
    '<input class="t-local" maxlength="300" placeholder="Local ou link da videochamada" value="'+esc((t&&t.local)||"")+'">'+
    '<label class="agd-ck"><input type="checkbox" class="t-ativo"'+(!t||t.ativo?" checked":"")+'> ativo</label>'+
    ((D.diretores||[]).filter(x=>x.ativo).length?'<div class="t-dir"><span>Exige livre:</span>'+(D.diretores||[]).filter(x=>x.ativo).map(x=>'<label class="agd-ck"><input type="checkbox" class="t-d" value="'+x.id+'"'+((t&&(t.diretores||[]).map(Number).includes(Number(x.id)))?" checked":"")+'> '+esc(x.nome)+'</label>').join("")+'</div>':'')+'</div>';
  const ov=janela("⚙️ Horários e tipos de reunião",
    '<div class="agd-sub">Horário de atendimento <small>(o que aparece no link)</small></div>'+[1,2,3,4,5,6,0].map(linhaDia).join("")+
    '<div class="agd-3">'+
      campo("Intervalo entre reuniões",'<select id="agc-int">'+[0,5,10,15,20,30,45,60].map(m=>'<option value="'+m+'"'+(c.intervalo_min===m?" selected":"")+'>'+(m?m+" min":"sem intervalo")+'</option>').join("")+'</select>')+
      campo("Antecedência mínima",'<select id="agc-ant">'+[0,1,2,4,8,12,24,48].map(h=>'<option value="'+h+'"'+(c.antecedencia_h===h?" selected":"")+'>'+(h?h+" h":"nenhuma")+'</option>').join("")+'</select>')+
      campo("Agenda aberta por",'<select id="agc-jan">'+[7,14,21,30,45,60,90].map(d=>'<option value="'+d+'"'+(c.janela_dias===d?" selected":"")+'>'+d+' dias</option>').join("")+'</select>')+
      campo("Horários a cada",'<select id="agc-passo">'+[15,20,30,45,60].map(m=>'<option value="'+m+'"'+(c.passo_min===m?" selected":"")+'>'+m+' min</option>').join("")+'</select>')+
    '</div>'+
    campo("E-mail que recebe os avisos de reunião <small>(nova, remarcada ou cancelada pelo cliente; vazio = a caixa do Comercial)</small>",'<input id="agc-aviso" type="email" maxlength="120" placeholder="comercial@…" value="'+esc(c.email_aviso||"")+'">')+
    '<div class="agd-sub">Tipos de reunião <small>(cada um tem o seu link)</small></div><div id="agc-tipos">'+D.tipos.map(tipoLinha).join("")+'</div>'+
    '<button type="button" class="agd-lk" id="agc-novo">+ novo tipo</button>'+
    '<div class="agd-acoes"><button type="button" class="rh-btn rh-btn-sec" data-fechar="1">Voltar</button><button type="button" class="rh-btn" id="agc-ok">Salvar</button></div>',true);
  const q=s=>ov.querySelector(s);
  ov.addEventListener("change",e=>{if(e.target.classList.contains("s-2"))e.target.closest(".agd-sem").querySelector(".s-f2").hidden=!e.target.checked;});
  q("#agc-novo").addEventListener("click",()=>{q("#agc-tipos").insertAdjacentHTML("beforeend",tipoLinha(null));});
  q("#agc-ok").addEventListener("click",e=>{
    const semana={};
    ov.querySelectorAll(".agd-sem").forEach(l=>{
      if(!l.querySelector(".s-on").checked)return;
      const f=[[l.querySelector(".s-a1").value,l.querySelector(".s-b1").value]];
      if(l.querySelector(".s-2").checked)f.push([l.querySelector(".s-a2").value,l.querySelector(".s-b2").value]);
      semana[l.dataset.d]=f;
    });
    const cfg={semana,intervalo_min:+q("#agc-int").value,antecedencia_h:+q("#agc-ant").value,janela_dias:+q("#agc-jan").value,passo_min:+q("#agc-passo").value,email_aviso:q("#agc-aviso").value};
    const tipos=[...ov.querySelectorAll(".agd-tipo")].map(l=>({id:l.dataset.id||null,nome:l.querySelector(".t-nome").value,duracao_min:+l.querySelector(".t-dur").value,local:l.querySelector(".t-local").value,cor:l.querySelector(".t-cor").value,ativo:l.querySelector(".t-ativo").checked,diretores:[...l.querySelectorAll(".t-d:checked")].map(i=>Number(i.value))}))
      .filter(t=>t.id||t.nome.trim()); // linha nova em branco é ignorada
    enviar(ov,e.currentTarget,async()=>{
      await api("config","POST",cfg);
      for(const t of tipos){
        const antes=t.id&&D.tipos.find(x=>String(x.id)===String(t.id));
        if(antes&&antes.nome===t.nome&&antes.duracao_min===t.duracao_min&&(antes.local||"")===t.local&&antes.cor===t.cor&&antes.ativo===t.ativo&&((l=>l.length===t.diretores.length&&l.every((x,i)=>x===t.diretores[i]))((antes.diretores||[]).map(Number).sort((a,b)=>a-b))))continue;
        await api("tipo","POST",t);
      }
    },"Configuração salva");
  });
}
/* ── resultado da reunião ──────────────────────────────────────────────── */
function abrirResultado(r,pre){
  if(!r)return;const a=br(r.inicio),sel=pre||r.resultado||"";
  const ov=janela("📝 Resultado · "+r.nome,
    '<p class="agd-dica">'+esc(r.tipo_nome||"Reunião")+' de <b>'+esc(diaLongo(a.dia))+' às '+a.hora+'</b>. O resultado entra nos números da agenda no Painel Comercial.</p>'+
    '<div class="agd-res">'+Object.keys(RESULTADOS).map(k=>'<label class="agd-res-op'+(k==="faltou"?" falta":"")+'"><input type="radio" name="agres" value="'+k+'"'+(sel===k?" checked":"")+'><span>'+(k==="realizada"?"✅ ":"🚫 ")+RESULTADOS[k]+'</span></label>').join("")+'</div>'+
    campo("Próximo passo",'<select id="agres-prox"><option value="">—</option>'+Object.keys(PROXIMOS).map(k=>'<option value="'+k+'"'+(r.proximo_passo===k?" selected":"")+'>'+PROXIMOS[k]+'</option>').join("")+'</select>')+
    campo("Anotação <small>(opcional, só a equipe vê)</small>",'<textarea id="agres-obs" maxlength="1000" rows="3" placeholder="O que foi conversado, objeções, combinados…">'+esc(r.resultado_obs||"")+'</textarea>')+
    '<div class="agd-acoes">'+(r.resultado?'<button type="button" class="rh-btn rh-btn-sec" id="agres-limpar">Desfazer</button>':'')+'<button type="button" class="rh-btn rh-btn-sec" data-fechar="1">Voltar</button><button type="button" class="rh-btn" id="agres-ok">Salvar</button></div>');
  const q=s=>ov.querySelector(s);
  // quem não veio: o natural é remarcar
  ov.addEventListener("change",e=>{if(e.target.name==="agres"&&e.target.value==="faltou"&&!q("#agres-prox").value)q("#agres-prox").value="remarcar";});
  if(sel==="faltou"&&!r.proximo_passo)q("#agres-prox").value="remarcar";
  q("#agres-ok").addEventListener("click",e=>{
    const v=(ov.querySelector('input[name="agres"]:checked')||{}).value;
    if(!v){msg(ov,"Escolha se a reunião aconteceu ou se a pessoa não veio.",true);return;}
    enviar(ov,e.currentTarget,()=>api("resultado","POST",{resultado:v,proximo:q("#agres-prox").value||null,anotacao:q("#agres-obs").value},"&id="+r.id),"Resultado registrado");
  });
  const lp=q("#agres-limpar");
  if(lp)lp.addEventListener("click",e=>enviar(ov,e.currentTarget,()=>api("resultado","POST",{resultado:null},"&id="+r.id),"Resultado desfeito"));
}

/* ── 🎨 sua página (quem atende) ───────────────────────────────────────── */
// Reduz a foto no próprio navegador: quadrada (corte no centro), 256 px, JPEG. Fica leve no banco e nos e-mails.
function reduzirFoto(arq){
  return new Promise((ok,nao)=>{
    if(!arq||!/^image\//.test(arq.type)){nao(new Error("Escolha uma imagem (JPG ou PNG)."));return;}
    const url=URL.createObjectURL(arq),img=new Image();
    img.onload=()=>{
      const L=256,c=document.createElement("canvas");c.width=c.height=L;
      const s=Math.min(img.naturalWidth,img.naturalHeight),x=(img.naturalWidth-s)/2,y=(img.naturalHeight-s)/2;
      const g=c.getContext("2d");g.fillStyle="#fff";g.fillRect(0,0,L,L);g.drawImage(img,x,y,s,s,0,0,L,L);
      URL.revokeObjectURL(url);ok(c.toDataURL("image/jpeg",.86));
    };
    img.onerror=()=>{URL.revokeObjectURL(url);nao(new Error("Não consegui abrir essa imagem."));};
    img.src=url;
  });
}
function abrirMarca(){
  const D=AG.dados,m=D.marca||{},t=D.tipos.find(x=>x.ativo);
  let foto; // undefined = mantém · "" = tira · data: = troca
  const ini=n=>String(n||"").trim().split(/\s+/).filter(Boolean).map(p=>p[0]).slice(0,2).join("").toUpperCase()||"?";
  const ov=janela("🎨 Sua página de agendamento",
    '<p class="agd-dica">É o que o cliente vê ao abrir o link, e a assinatura dos e-mails e das mensagens de WhatsApp.</p>'+
    '<div class="agd-marca"><div class="agd-av" id="agmc-av"></div><div class="agd-marca-f"><label class="rh-btn rh-btn-sec agd-foto-bt">📷 Escolher foto<input type="file" id="agmc-arq" accept="image/*" hidden></label><button type="button" class="agd-lk agd-lk-v" id="agmc-tirar"'+(m.foto_dados?'':' hidden')+'>tirar foto</button><small>Foto de rosto, de preferência com fundo claro.</small></div></div>'+
    '<div class="agd-2">'+campo("Nome de quem atende",'<input id="agmc-nome" maxlength="60" placeholder="Ex.: Gabriela Alvarenga" value="'+esc(m.nome||"")+'">')+campo("Cargo",'<input id="agmc-cargo" maxlength="60" placeholder="Ex.: Consultora Comercial" value="'+esc(m.cargo||"")+'">')+'</div>'+
    campo("Mensagem de boas-vindas <small>(opcional, até 300 letras)</small>",'<textarea id="agmc-boas" maxlength="300" rows="3" placeholder="Ex.: Olá! Escolha o melhor horário para conversarmos sobre as soluções de segurança e facilities do Grupo ServCamp.">'+esc(m.boas_vindas||"")+'</textarea>')+
    (t?'<p class="agd-dica"><a href="'+esc(linkDe(t))+'" target="_blank" rel="noopener">👀 Ver a página como o cliente vê</a> (salve antes)</p>':'')+
    '<div class="agd-acoes"><button type="button" class="rh-btn rh-btn-sec" data-fechar="1">Voltar</button><button type="button" class="rh-btn" id="agmc-ok">Salvar</button></div>',true);
  const q=s=>ov.querySelector(s);
  const pintar=()=>{const av=q("#agmc-av"),src=foto!==undefined?foto:(m.foto_dados||"");
    if(src){av.style.backgroundImage='url("'+src+'")';av.textContent="";}else{av.style.backgroundImage="";av.textContent=ini(q("#agmc-nome").value);}
    q("#agmc-tirar").hidden=!src;};
  pintar();
  q("#agmc-nome").addEventListener("input",pintar);
  q("#agmc-arq").addEventListener("change",e=>{const f=e.target.files&&e.target.files[0];if(!f)return;reduzirFoto(f).then(d=>{foto=d;msg(ov,"");pintar();}).catch(err=>msg(ov,err.message,true));});
  q("#agmc-tirar").addEventListener("click",()=>{foto="";pintar();});
  q("#agmc-ok").addEventListener("click",e=>{
    const corpo={nome:q("#agmc-nome").value,cargo:q("#agmc-cargo").value,boas_vindas:q("#agmc-boas").value};
    if(foto!==undefined)corpo.foto=foto;
    enviar(ov,e.currentTarget,()=>api("marca","POST",corpo),"Página atualizada");
  });
}

/* ── diretores (calendário público do iCloud) ──────────────────────────── */
function semLeitura(D){return(D.diretores||[]).some(d=>d.ativo&&!d.valido);}
const haTexto=iso=>{if(!iso)return"nunca";const m=Math.round((Date.now()-+new Date(iso))/60000);return m<1?"agora há pouco":m<60?"há "+m+" min":m<1440?"há "+Math.round(m/60)+" h":"há "+Math.round(m/1440)+" dias";};
function abrirDiretores(){
  const D=AG.dados,ds=D.diretores||[];
  const linha=d=>'<div class="agdi" data-id="'+d.id+'"><div class="agdi-n"><b>'+esc(d.nome)+'</b>'+(d.ativo?'':' <span class="agd-tag">pausado</span>')+
    '<span class="agdi-s '+(d.ativo&&!d.valido?'ruim':'ok')+'">'+(d.ativo?(d.valido?'✅ lido '+esc(haTexto(d.lido_em))+' · '+d.compromissos+' compromisso'+(d.compromissos===1?'':'s')+' nos próximos 90 dias':'⚠️ sem leitura válida: os tipos que exigem '+esc(d.nome)+' estão fora do ar'):'pausado: não bloqueia nada')+'</span>'+
    (d.erro?'<span class="agdi-e">Último erro: '+esc(d.erro)+'</span>':'')+'<span class="agdi-l">'+esc(d.link)+'</span></div>'+
    '<div class="agdi-a"><button type="button" class="agd-lk" data-d="atualizar">atualizar</button><button type="button" class="agd-lk" data-d="trocar">trocar link</button><button type="button" class="agd-lk" data-d="pausar">'+(d.ativo?'pausar':'reativar')+'</button><button type="button" class="agd-lk agd-lk-v" data-d="tirar">remover</button></div></div>';
  const ov=janela("👔 Diretores — agenda do iPhone",
    '<p class="agd-dica">Os horários em que o diretor está ocupado somem do link dos tipos de reunião que <b>exigem</b> ele (marque em ⚙️ Horários e tipos). O painel guarda só <b>quando</b> o diretor está ocupado: não guarda o título, o local nem os convidados. A agenda é relida a cada 5 minutos.</p>'+
    '<div id="agdi-lista">'+(ds.length?ds.map(linha).join(""):'<div class="agd-vazio">Nenhum diretor cadastrado.</div>')+'</div>'+
    '<div class="agd-sub" id="agdi-tit">Cadastrar diretor</div>'+
    campo("Nome",'<input id="agdi-nome" maxlength="60" placeholder="Ex.: Paulo">')+
    campo("Link do calendário público",'<input id="agdi-url" placeholder="webcal://p12-caldav.icloud.com/published/…">')+
    '<input type="hidden" id="agdi-id">'+
    '<div class="agd-acoes"><button type="button" class="rh-btn rh-btn-sec" data-fechar="1">Fechar</button><button type="button" class="rh-btn" id="agdi-ok">Cadastrar</button></div>'+
    '<details class="agdi-como"><summary>Como o diretor pega esse link no iPhone</summary><ol class="agd-passos"><li>Abrir o app <b>Calendário</b> › tocar em <b>Calendários</b> (embaixo)</li><li>Tocar no <b>ⓘ</b> ao lado do calendário que ele usa para os compromissos</li><li>Ativar <b>Calendário Público</b></li><li>Tocar em <b>Compartilhar Link</b> › <b>Copiar</b> e mandar o link para você</li></ol>'+
    '<p class="agd-dica">⚠️ Quem tiver esse link consegue ler os compromissos, com os títulos. Mande só para quem precisa. Se o diretor preferir, ele pode criar um calendário só de “Disponibilidade”, pôr nele os horários em que não pode, e publicar só esse. Para parar de compartilhar, é só desligar o Calendário Público no iPhone.</p></details>',true);
  const q=s=>ov.querySelector(s),aj=ds.reduce((m,d)=>(m[d.id]=d,m),{});
  const acaoD=(fn,ok,b)=>{b.disabled=true;fn().then(()=>{toast("✅ "+ok);return api("");}).then(j=>{AG.dados=j;fechar();render();abrirDiretores();}).catch(e=>{b.disabled=false;msg(ov,e.message,true);});};
  ov.addEventListener("click",e=>{
    const b=e.target.closest("[data-d]");if(!b)return;
    const row=b.closest(".agdi"),id=row.dataset.id,d=aj[id];
    if(b.dataset.d==="atualizar")acaoD(()=>api("atualizar","POST",{},"&id="+id),"Calendário relido",b);
    else if(b.dataset.d==="pausar")acaoD(()=>api("diretor","POST",{id,nome:d.nome,ativo:!d.ativo}),d.ativo?"Diretor pausado":"Diretor reativado",b);
    else if(b.dataset.d==="tirar"){if(confirm("Remover "+d.nome+"? Os tipos de reunião deixam de exigir ele e o link volta a mostrar os horários dele."))acaoD(()=>api("diretor","DELETE",null,"&id="+id),"Diretor removido",b);}
    else if(b.dataset.d==="trocar"){q("#agdi-id").value=id;q("#agdi-nome").value=d.nome;q("#agdi-url").value="";q("#agdi-tit").textContent="Trocar o link de "+d.nome;q("#agdi-ok").textContent="Salvar";q("#agdi-url").focus();}
  });
  q("#agdi-ok").addEventListener("click",e=>{
    const id=q("#agdi-id").value;
    acaoD(()=>api("diretor","POST",{id:id||null,nome:q("#agdi-nome").value,url:q("#agdi-url").value}),id?"Link trocado":"Diretor cadastrado",e.currentTarget);
  });
}

function abrirIphone(){
  const k=AG.dados.ics_chave;
  const https=location.origin+"/api/rh?modulo=agendapub&t=ics&k="+encodeURIComponent(k);
  const webcal=https.replace(/^https?:/,"webcal:");
  const ov=janela("📱 Ver a agenda no iPhone",
    '<p class="agd-dica">Toda reunião marcada aqui ou pelo link aparece no Calendário do iPhone. É só de leitura: para marcar, remarcar ou cancelar, use o painel. O iPhone atualiza de tempos em tempos (em geral, alguns minutos).</p>'+
    '<a class="rh-btn agd-largo" href="'+esc(webcal)+'">📲 Adicionar ao Calendário (abra no iPhone)</a>'+
    '<div class="agd-sub">Ou à mão</div><ol class="agd-passos"><li>No iPhone: <b>Ajustes › Calendário › Contas › Adicionar Conta › Outra</b></li><li>Toque em <b>Adicionar Calendário Assinado</b></li><li>Cole o endereço abaixo e toque em <b>Seguinte › Salvar</b></li></ol>'+
    '<div class="agd-copia"><input class="agd-url" readonly value="'+esc(webcal)+'"><button type="button" class="rh-btn" id="agi-copiar">Copiar</button></div>'+
    '<p class="agd-dica">⚠️ Este endereço mostra as reuniões com nome e telefone de quem marcou: não mande para ninguém. Se vazar, gere um novo (o antigo para de funcionar e é preciso assinar de novo no iPhone).</p>'+
    '<div class="agd-acoes"><button type="button" class="rh-btn rh-btn-sec" id="agi-novo">Gerar endereço novo</button><button type="button" class="rh-btn" data-fechar="1">Pronto</button></div>');
  ov.querySelector("#agi-copiar").addEventListener("click",()=>copiar(webcal,"📋 Endereço copiado"));
  ov.querySelector("#agi-novo").addEventListener("click",e=>{
    if(!confirm("Gerar um endereço novo? O que estiver assinado no iPhone para de atualizar até você assinar o novo."))return;
    enviar(ov,e.currentTarget,()=>api("ics","POST",{}),"Endereço novo gerado: abra 📱 de novo para assinar");
  });
}

/* ── números no Painel Comercial ───────────────────────────────────────── */
// Chamado pelo comDashRender (index.html) com o lugar e o mês do painel ("2026-11"). Quem não pode ver
// (o servidor responde 403) não vê nada: o bloco some.
const PAINEL={pedido:0};
raiz.agPainelComercial=function(el,mes){
  if(!el)return;const n=++PAINEL.pedido;
  el.innerHTML='<div class="agp"><div class="agp-h">📅 Agenda Comercial</div><div class="agp-vazio">Carregando os números da agenda…</div></div>';
  api("numeros","GET",null,"&mes="+encodeURIComponent(mes||"")).then(j=>{if(n===PAINEL.pedido&&el.isConnected)el.innerHTML=painelHtml(j);})
    .catch(e=>{if(n!==PAINEL.pedido)return;if(e.status===403||e.status===401||e.codigo==="SEM_TABELA")el.innerHTML="";else el.innerHTML='<div class="agp"><div class="agp-h">📅 Agenda Comercial</div><div class="agp-vazio">Não consegui carregar os números da agenda.</div></div>';});
};
function painelHtml(j){
  const A=j.atual,B=j.anterior,[ano,mm]=j.mes.split("-"),mesNome=MESL[Number(mm)-1]+" de "+ano;
  const dif=(x,y,suf)=>y==null||x==null?"":(x===y?'<em class="agp-ig">= mês anterior</em>':'<em class="'+(x>y?"agp-up":"agp-dn")+'">'+(x>y?"▲":"▼")+" "+Math.abs(x-y)+(suf||"")+' vs mês anterior</em>');
  const tile=(ic,cor,lbl,val,sub,cmp)=>'<div class="agp-k" style="border-top-color:'+cor+'"><span class="agp-ic">'+ic+'</span><span class="agp-l">'+lbl+'</span><b>'+val+'</b><span class="agp-s">'+sub+'</span>'+(cmp||"")+'</div>';
  const barras=(pares,cor,vazio)=>{if(!pares.length)return'<div class="agp-vazio">'+vazio+'</div>';const mx=Math.max(...pares.map(p=>p[1]));
    return pares.map(([k,v])=>'<div class="agp-b"><span>'+esc(k)+'</span><div><i style="width:'+Math.max(4,v/mx*100)+'%;background:'+cor+'"></i></div><b>'+v+'</b></div>').join("");};
  const topHora=j.por_hora.slice().sort((a,b)=>b[1]-a[1])[0];
  let h='<div class="agp"><div class="agp-h">📅 Agenda Comercial <small>reuniões de '+esc(mesNome)+' · pelo link e cadastradas</small></div><div class="agp-ks">';
  h+=tile("🗓️","#2e8fef","Reuniões no mês",A.marcadas,A.futuras?A.futuras+" ainda vão acontecer":"todas já aconteceram",dif(A.marcadas,B.marcadas));
  h+=tile("✅","#16a34a","Realizadas",A.realizadas,A.pendentes?"⚠️ "+A.pendentes+" sem resultado registrado":"resultado registrado");
  h+=tile("🎯","#0d9488","Comparecimento",A.comparecimento==null?"—":A.comparecimento+"%",A.faltas+" não compareceu"+(A.faltas===1?"":"ram"),dif(A.comparecimento,B.comparecimento," pts"));
  h+=tile("🔗","#7c3aed","Marcadas pelo link",A.pelo_link,A.marcadas?Math.round(A.pelo_link/A.marcadas*100)+"% do total":"o cliente escolhe o horário");
  h+=tile("📨","#f97316","Viraram proposta",A.viraram_proposta,A.fecharam?A.fecharam+" já fechou"+(A.fecharam===1?"":"aram")+" negócio":"das reuniões realizadas");
  h+=tile("❌","#dc2626","Canceladas",A.canceladas,A.canceladas_cliente+" pelo próprio cliente");
  h+='</div><div class="agp-g">';
  const serie=j.serie.map(s=>[MES[Number(s.mes.slice(5))-1],s.marcadas,s.realizadas]),mx=Math.max(1,...serie.map(s=>s[1]));
  h+='<div class="agp-c"><div class="agp-t">Últimos 6 meses <span><i style="background:#93c5fd"></i>marcadas <i style="background:#16a34a"></i>realizadas</span></div><div class="agp-serie">'+
    serie.map(([m,a,b])=>'<div><div class="agp-col"><i style="height:'+(a/mx*100)+'%;background:#93c5fd" title="'+a+' marcadas"></i><i style="height:'+(b/mx*100)+'%;background:#16a34a" title="'+b+' realizadas"></i></div><span>'+m+'</span><b>'+a+'</b></div>').join("")+'</div></div>';
  h+='<div class="agp-c"><div class="agp-t">Horários mais procurados <span>'+(topHora?"pico às "+esc(topHora[0]):"últimos 6 meses")+'</span></div>'+barras(j.por_hora,"#2e8fef","Ainda sem reuniões marcadas.")+'</div>';
  h+='<div class="agp-c"><div class="agp-t">Dias mais procurados <span>últimos 6 meses</span></div>'+barras(j.por_dia,"#7c3aed","Ainda sem reuniões marcadas.")+'</div>';
  h+='<div class="agp-c"><div class="agp-t">Depois da reunião <span>próximo passo das realizadas</span></div>'+barras(j.proximos_passos,"#f97316","Registre o resultado das reuniões na Agenda Comercial.")+
    (j.por_tipo.length?'<div class="agp-t" style="margin-top:12px">Por tipo de reunião</div>'+barras(j.por_tipo,"#0d9488",""):"")+'</div>';
  h+='</div></div>';
  return h;
}

// Sessão caiu ou outra pessoa entrou na mesma aba: nada da anterior fica na tela.
function ligarSessao(){
  if(typeof raiz._sessaoExpirou==="function"&&!raiz._sessaoExpirou.__ag){
    const e0=raiz._sessaoExpirou;
    raiz._sessaoExpirou=function(){fechar();AG.dados=null;AG.erro=null;AG.dono=null;const el=conteudo();if(el)el.innerHTML="";return e0.apply(this,arguments);};
    raiz._sessaoExpirou.__ag=true;
  }
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",ligarSessao);else ligarSessao();
})(typeof window!=="undefined"?window:globalThis);
