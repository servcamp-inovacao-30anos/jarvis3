/* Agenda Comercial — a guia da administradora (Gabriela) no painel.
   Fica fora do index.html porque ele já está perto do limite de tamanho (test/auth_exigencia).
   O servidor é o api/_agenda.js (/api/rh?modulo=agenda); quem decide quem administra é ele.
   • Links para enviar: um por tipo de reunião (agendar.html?s=…), para copiar ou mandar por WhatsApp.
   • Reuniões: as próximas por dia, com remarcar e cancelar; e reunião cadastrada à mão.
   • Bloqueios, horário de atendimento, tipos e a assinatura do iPhone (.ics).
   Reunião em cima de reunião nunca: o banco recusa, e a tela mostra a mensagem do servidor. */
(function(raiz){
"use strict";
const esc=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const uk=()=>sessionStorage.getItem("userKey")||"";
const toast=t=>{if(typeof hqToast==="function")hqToast(t);};
const SEM=["Domingo","Segunda","Terça","Quarta","Quinta","Sexta","Sábado"];
const SEMC=["dom","seg","ter","qua","qui","sex","sáb"];
const MES=["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];
const AG={dados:null,erro:null,carregando:false,dono:null,verPassadas:false};

// horário de Brasília (UTC-3) a partir do ISO do banco
const br=iso=>{const d=new Date(+new Date(iso)-3*3600000).toISOString();return{dia:d.slice(0,10),hora:d.slice(11,16)};};
const hojeBR=()=>br(new Date().toISOString()).dia;
const diaLongo=d=>{const x=new Date(d+"T12:00:00Z");return SEM[x.getUTCDay()]+", "+x.getUTCDate()+" de "+MES[x.getUTCMonth()];};
const durTxt=m=>m<60?m+" min":(m%60?Math.floor(m/60)+"h"+String(m%60).padStart(2,"0"):m/60+"h");
const telTxt=t=>{const d=String(t||"").replace(/\D/g,"");return d.length===11?"("+d.slice(0,2)+") "+d.slice(2,7)+"-"+d.slice(7):d.length===10?"("+d.slice(0,2)+") "+d.slice(2,6)+"-"+d.slice(6):d;};
const zap=t=>{let d=String(t||"").replace(/\D/g,"");if(d.length<=11)d="55"+d;return"https://wa.me/"+d;};
const linkDe=t=>location.origin+"/agendar.html?s="+encodeURIComponent(t.slug);

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
    '<button type="button" class="rh-btn rh-btn-sec" data-ag="iphone">📱 Ver no iPhone</button></div>';
  h+='<div class="agd-kpis"><div><b>'+ativas.filter(r=>br(r.inicio).dia===hoje).length+'</b><span>hoje</span></div><div><b>'+semana+'</b><span>nos próximos 7 dias</span></div><div><b>'+ativas.length+'</b><span>marcadas no total</span></div><div><b>'+ativas.filter(r=>r.origem==="link").length+'</b><span>marcadas pelo link</span></div></div>';
  // links
  h+='<div class="agd-card"><div class="agd-h">🔗 Links para enviar ao cliente</div>'+
    (tipos.length?tipos.map(t=>'<div class="agd-link"><span class="agd-cor" style="background:'+esc(t.cor||"#1e4d8c")+'"></span><div class="agd-link-n"><b>'+esc(t.nome)+'</b><span>'+esc(durTxt(t.duracao_min))+(t.local?' · '+esc(t.local):'')+'</span></div>'+
      '<input class="agd-url" readonly value="'+esc(linkDe(t))+'" aria-label="Link de '+esc(t.nome)+'">'+
      '<button type="button" class="rh-btn" data-ag="copiar" data-id="'+t.id+'">Copiar</button>'+
      '<a class="rh-btn rh-btn-sec" href="https://wa.me/?text='+encodeURIComponent("Olá! Escolha o melhor dia e horário para a nossa reunião: "+linkDe(t))+'" target="_blank" rel="noopener">WhatsApp</a>'+
      '<a class="agd-lk" href="'+esc(linkDe(t))+'" target="_blank" rel="noopener">abrir</a></div>').join(""):'<div class="agd-vazio">Nenhum tipo de reunião ativo. Crie um em ⚙️ Horários e tipos.</div>')+'</div>';
  // próximas
  const porDia={};ativas.forEach(r=>{const d=br(r.inicio).dia;(porDia[d]=porDia[d]||[]).push(r);});
  h+='<div class="agd-card"><div class="agd-h">📅 Próximas reuniões</div>';
  const dias=Object.keys(porDia).sort();
  h+=dias.length?dias.map(d=>'<div class="agd-dia"><div class="agd-dia-t">'+(d===hoje?"Hoje · ":d===somaDias(hoje,1)?"Amanhã · ":"")+esc(diaLongo(d))+'</div>'+porDia[d].map(linhaReuniao).join("")+'</div>').join(""):'<div class="agd-vazio">Nenhuma reunião marcada. Mande um dos links acima para o cliente escolher o horário.</div>';
  h+='</div>';
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
      (canc?' <span class="agd-tag agd-tag-c">cancelada</span>':'')+(r.origem==="link"?' <span class="agd-tag">pelo link</span>':' <span class="agd-tag agd-tag-m">cadastrada aqui</span>')+'</div>'+
      '<div class="agd-r-x">'+(r.telefone?'<a href="tel:'+esc(r.telefone)+'">'+esc(telTxt(r.telefone))+'</a> · <a href="'+esc(zap(r.telefone))+'" target="_blank" rel="noopener">WhatsApp</a>':'')+
      (r.email?(r.telefone?' · ':'')+'<a href="mailto:'+esc(r.email)+'">'+esc(r.email)+'</a>':'')+'</div>'+
      (r.obs?'<div class="agd-r-o">“'+esc(r.obs)+'”</div>':'')+'</div>'+
    (canc||passou?'':'<div class="agd-r-a"><button type="button" class="agd-lk" data-ag="remarcar" data-id="'+r.id+'">remarcar</button><button type="button" class="agd-lk agd-lk-v" data-ag="cancelar" data-id="'+r.id+'">cancelar</button></div>')+'</div>';
}

/* ── eventos ───────────────────────────────────────────────────────────── */
function ligar(el){
  if(el.__ag)return;el.__ag=true;
  el.addEventListener("click",e=>{
    const b=e.target.closest("[data-ag]");if(!b||!el.contains(b))return;
    const a=b.dataset.ag,id=b.dataset.id;
    if(a==="recarregar")recarregar();
    else if(a==="marcar")abrirMarcar();
    else if(a==="bloquear")abrirBloqueio();
    else if(a==="config")abrirConfig();
    else if(a==="iphone")abrirIphone();
    else if(a==="passadas"){AG.verPassadas=!AG.verPassadas;render();}
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
  if(!confirm("Cancelar a reunião de "+r.nome+" em "+diaLongo(a.dia)+" às "+a.hora+"?\n\nO horário volta a ficar livre no link. Avise a pessoa."))return;
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

function abrirMarcar(){
  const D=AG.dados,tipos=D.tipos.filter(t=>t.ativo);
  if(!tipos.length){toast("Crie um tipo de reunião primeiro (⚙️ Horários e tipos).");return;}
  const ov=janela("➕ Marcar reunião",
    '<p class="agd-dica">Para reuniões combinadas por telefone ou pessoalmente. Pode ser fora do horário de atendimento, mas nunca em cima de outra reunião.</p>'+
    campo("Tipo",'<select id="agm-tipo">'+tipos.map(t=>'<option value="'+t.id+'">'+esc(t.nome)+' ('+esc(durTxt(t.duracao_min))+')</option>').join("")+'</select>')+
    '<div class="agd-2">'+campo("Dia",'<input type="date" id="agm-dia" min="'+hojeBR()+'" value="'+hojeBR()+'">')+campo("Horário",'<input type="time" id="agm-hora" step="300" value="09:00">')+'</div>'+
    campo("Nome",'<input id="agm-nome" maxlength="80">')+
    '<div class="agd-2">'+campo("Telefone <small>(opcional)</small>",'<input id="agm-tel" type="tel" maxlength="20">')+campo("E-mail <small>(opcional)</small>",'<input id="agm-email" type="email" maxlength="120">')+'</div>'+
    campo("Observação <small>(opcional)</small>",'<textarea id="agm-obs" maxlength="500" rows="2"></textarea>')+
    '<div class="agd-acoes"><button type="button" class="rh-btn rh-btn-sec" data-fechar="1">Voltar</button><button type="button" class="rh-btn" id="agm-ok">Marcar</button></div>');
  const v=id=>ov.querySelector(id).value;
  ov.querySelector("#agm-ok").addEventListener("click",e=>enviar(ov,e.currentTarget,()=>api("reuniao","POST",{tipo_id:v("#agm-tipo"),dia:v("#agm-dia"),hora:v("#agm-hora"),nome:v("#agm-nome"),telefone:v("#agm-tel"),email:v("#agm-email"),obs:v("#agm-obs")}),"Reunião marcada"));
  ov.querySelector("#agm-nome").focus();
}
function abrirRemarcar(r){
  if(!r)return;const a=br(r.inicio);
  const ov=janela("Remarcar · "+r.nome,
    '<p class="agd-dica">Hoje está em <b>'+esc(diaLongo(a.dia))+' às '+a.hora+'</b>. Avise a pessoa do novo horário.</p>'+
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
    '<label class="agd-ck"><input type="checkbox" class="t-ativo"'+(!t||t.ativo?" checked":"")+'> ativo</label></div>';
  const ov=janela("⚙️ Horários e tipos de reunião",
    '<div class="agd-sub">Horário de atendimento <small>(o que aparece no link)</small></div>'+[1,2,3,4,5,6,0].map(linhaDia).join("")+
    '<div class="agd-3">'+
      campo("Intervalo entre reuniões",'<select id="agc-int">'+[0,5,10,15,20,30,45,60].map(m=>'<option value="'+m+'"'+(c.intervalo_min===m?" selected":"")+'>'+(m?m+" min":"sem intervalo")+'</option>').join("")+'</select>')+
      campo("Antecedência mínima",'<select id="agc-ant">'+[0,1,2,4,8,12,24,48].map(h=>'<option value="'+h+'"'+(c.antecedencia_h===h?" selected":"")+'>'+(h?h+" h":"nenhuma")+'</option>').join("")+'</select>')+
      campo("Agenda aberta por",'<select id="agc-jan">'+[7,14,21,30,45,60,90].map(d=>'<option value="'+d+'"'+(c.janela_dias===d?" selected":"")+'>'+d+' dias</option>').join("")+'</select>')+
      campo("Horários a cada",'<select id="agc-passo">'+[15,20,30,45,60].map(m=>'<option value="'+m+'"'+(c.passo_min===m?" selected":"")+'>'+m+' min</option>').join("")+'</select>')+
    '</div>'+
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
    const cfg={semana,intervalo_min:+q("#agc-int").value,antecedencia_h:+q("#agc-ant").value,janela_dias:+q("#agc-jan").value,passo_min:+q("#agc-passo").value};
    const tipos=[...ov.querySelectorAll(".agd-tipo")].map(l=>({id:l.dataset.id||null,nome:l.querySelector(".t-nome").value,duracao_min:+l.querySelector(".t-dur").value,local:l.querySelector(".t-local").value,cor:l.querySelector(".t-cor").value,ativo:l.querySelector(".t-ativo").checked}))
      .filter(t=>t.id||t.nome.trim()); // linha nova em branco é ignorada
    enviar(ov,e.currentTarget,async()=>{
      await api("config","POST",cfg);
      for(const t of tipos){
        const antes=t.id&&D.tipos.find(x=>String(x.id)===String(t.id));
        if(antes&&antes.nome===t.nome&&antes.duracao_min===t.duracao_min&&(antes.local||"")===t.local&&antes.cor===t.cor&&antes.ativo===t.ativo)continue;
        await api("tipo","POST",t);
      }
    },"Configuração salva");
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
