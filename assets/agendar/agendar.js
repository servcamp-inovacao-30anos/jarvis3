/* Página pública de agendamento (agendar.html). Sem login. Dois jeitos de abrir:
   • agendar.html?s=LINK  → mostra só os horários livres do tipo de reunião do link e marca um deles;
   • agendar.html?r=CODIGO → "Sua reunião": o cliente remarca ou cancela a reunião dele (link do e-mail), até 2 horas antes.
   Quem garante que não há reunião em cima de reunião é o servidor (api/_agenda.js + restrição no banco);
   aqui só se mostra o que ele mandou. */
(function(){
"use strict";
const $=id=>document.getElementById(id);
const esc=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const P=new URLSearchParams(location.search);
let S=(P.get("s")||(P.get("r")?"":location.hash.replace(/^#/,""))).trim();
const COD=(P.get("r")||"").trim();
const SEM=["dom","seg","ter","qua","qui","sex","sáb"];
const MES=["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];
const diaTxt=d=>{const x=new Date(d+"T12:00:00Z");return SEM[x.getUTCDay()]+", "+x.getUTCDate()+" de "+MES[x.getUTCMonth()];};
const durTxt=m=>m<60?m+" minutos":(m%60?Math.floor(m/60)+"h"+String(m%60).padStart(2,"0"):m/60+(m===60?" hora":" horas"));
// "2026-11-06T13:00:00Z" → { dia, hora } em Brasília
const br=iso=>{const d=new Date(+new Date(iso)-3*3600000).toISOString();return{dia:d.slice(0,10),hora:d.slice(11,16)};};
const E={tipo:null,dias:{},dia:null,hora:null,remarcando:false,minha:null};

async function api(t,metodo,corpo){
  let q="/api/rh?modulo=agendapub&t="+t;
  if(!metodo){
    if(t==="minha")q+="&r="+encodeURIComponent(COD);
    else{q+="&s="+encodeURIComponent(S);if(E.remarcando&&COD)q+="&r="+encodeURIComponent(COD);}
  }
  const r=await fetch(q,{method:metodo||"GET",headers:corpo?{"Content-Type":"application/json"}:{},body:corpo?JSON.stringify(corpo):undefined});
  const j=await r.json().catch(()=>({}));
  if(!r.ok){const e=new Error(j.error||"Não foi possível agora. Tente de novo.");e.codigo=j.codigo;e.status=r.status;throw e;}
  return j;
}
function erroTopo(m){$("agInfo").textContent=m;$("agPasso1").hidden=true;$("agForm").hidden=true;$("agMinha").hidden=true;}
function cabecalho(t){
  $("agTit").textContent=t.nome;
  document.querySelector(".ag-topo").style.setProperty("--cor",/^#[0-9a-f]{6}$/i.test(t.cor||"")?t.cor:"#1e4d8c");
}

/* ── marcar ─────────────────────────────────────────────────────────────── */
async function carregar(manterDia){
  if(!S){erroTopo("Link incompleto. Peça o link de agendamento de novo ao nosso Comercial.");return;}
  let j;
  try{j=await api("horarios");}catch(e){erroTopo(e.message);return;}
  E.tipo=j.tipo;E.dias=j.dias||{};
  cabecalho(j.tipo);
  $("agInfo").innerHTML="⏱ "+esc(durTxt(j.tipo.duracao_min))+(j.tipo.local?"<br>📍 "+esc(j.tipo.local):"");
  const dias=Object.keys(E.dias).sort();
  $("agPasso1").hidden=false;
  if(!dias.length){$("agDias").innerHTML='<p class="ag-vazio">Não há horários livres nos próximos dias. Fale com o nosso Comercial.</p>';$("agHoras").innerHTML="";$("agTitHoras").hidden=true;return;}
  if(!manterDia||!E.dias[E.dia])E.dia=dias[0];
  $("agDias").innerHTML=dias.map(d=>{const x=new Date(d+"T12:00:00Z");return'<button type="button" class="ag-dia'+(d===E.dia?" on":"")+'" data-d="'+d+'" role="option" aria-selected="'+(d===E.dia)+'"><span>'+SEM[x.getUTCDay()]+'</span><b>'+x.getUTCDate()+'</b><span>'+MES[x.getUTCMonth()]+'</span></button>';}).join("");
  horas();
}
function horas(){
  const h=E.dias[E.dia]||[];
  $("agTitHoras").hidden=false;
  $("agHoras").innerHTML=h.map(x=>'<button type="button" class="ag-hora" data-h="'+x+'" role="option">'+x+'</button>').join("");
}
$("agDias").addEventListener("click",e=>{
  const b=e.target.closest("[data-d]");if(!b)return;
  E.dia=b.dataset.d;
  document.querySelectorAll(".ag-dia").forEach(x=>{const on=x===b;x.classList.toggle("on",on);x.setAttribute("aria-selected",on);});
  horas();
});
$("agHoras").addEventListener("click",async e=>{
  const b=e.target.closest("[data-h]");if(!b)return;
  E.hora=b.dataset.h;
  if(E.remarcando){await remarcar();return;}
  $("agEscolha").textContent="📅 "+diaTxt(E.dia)+" às "+E.hora;
  $("agErro").textContent="";
  $("agPasso1").hidden=true;$("agForm").hidden=false;
  $("agNome").focus();
});
$("agTrocar").addEventListener("click",()=>{$("agForm").hidden=true;$("agPasso1").hidden=false;});
$("agTel").addEventListener("input",e=>{ // (19) 99999-9999 enquanto digita
  const d=e.target.value.replace(/\D/g,"").slice(0,11);
  e.target.value=d.length>6?"("+d.slice(0,2)+") "+d.slice(2,d.length-4)+"-"+d.slice(-4):d.length>2?"("+d.slice(0,2)+") "+d.slice(2):d;
});
$("agForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const bt=$("agBt");$("agErro").textContent="";
  const corpo={s:S,dia:E.dia,hora:E.hora,nome:$("agNome").value,telefone:$("agTel").value,email:$("agEmail").value,obs:$("agObs").value,site:$("agSite").value};
  if(corpo.nome.trim().length<2){$("agErro").textContent="Informe o seu nome.";return;}
  if(corpo.telefone.replace(/\D/g,"").length<10){$("agErro").textContent="Informe o telefone com DDD.";return;}
  bt.disabled=true;bt.textContent="Agendando…";
  try{
    const j=await api("agendar","POST",corpo);
    $("agForm").hidden=true;$("agPasso1").hidden=true;$("agOk").hidden=false;
    $("agOkTxt").innerHTML="<b>"+esc(j.tipo)+"</b><br>"+esc(diaTxt(j.dia))+" às "+esc(j.hora)+" ("+esc(durTxt(j.duracao_min))+")"+(j.local?"<br>📍 "+esc(j.local):"");
    if(j.convite)$("agIcs").href="/api/rh?modulo=agendapub&t=convite&id="+encodeURIComponent(j.convite.id)+"&c="+encodeURIComponent(j.convite.c);
    else $("agIcs").hidden=true;
    const z=iso=>new Date(iso).toISOString().replace(/[-:]/g,"").replace(/\.\d{3}/,"");
    $("agGoogle").href="https://calendar.google.com/calendar/render?action=TEMPLATE&text="+encodeURIComponent(j.tipo+" — Grupo ServCamp")+"&dates="+z(j.inicio)+"/"+z(j.fim)+(j.local?"&location="+encodeURIComponent(j.local):"");
    if(j.email_cliente==="enviado"){$("agEmailOk").hidden=false;$("agEmailOk").textContent="📧 Enviamos a confirmação para o seu e-mail.";}
    if(j.gerenciar){$("agGerenciar").hidden=false;$("agGerenciar").href="/agendar.html?r="+encodeURIComponent(j.gerenciar);}
    window.scrollTo(0,0);
  }catch(err){
    bt.disabled=false;bt.textContent="Confirmar agendamento";
    if(err.codigo==="OCUPADO"){ // alguém marcou antes: volta aos horários atualizados
      await carregar(true);
      $("agForm").hidden=true;$("agPasso1").hidden=false;
      $("agInfo").insertAdjacentHTML("beforeend",'<br><b style="color:#b91c1c">'+esc(err.message)+'</b>');
    }else $("agErro").textContent=err.message;
  }
});

/* ── Sua reunião (remarcar ou cancelar) ─────────────────────────────────── */
function mostrarMinha(){
  const m=E.minha,i=br(m.inicio),f=br(m.fim);
  cabecalho(m.tipo);
  $("agTit").textContent=m.tipo.nome;
  $("agInfo").innerHTML="Olá, "+esc(m.nome)+"!";
  $("agPasso1").hidden=true;$("agForm").hidden=true;$("agOk").hidden=true;$("agMinha").hidden=false;
  $("agMinhaTxt").innerHTML="📅 <b>"+esc(diaTxt(i.dia))+" às "+esc(i.hora)+"</b> ("+esc(durTxt(m.tipo.duracao_min))+")"+(m.local?"<br>📍 "+esc(m.local):"")+"<br><small>horário de Brasília</small>";
  let aviso="";
  const rem=$("agMinhaRemarcar"),can=$("agMinhaCancelar"),novo=$("agMinhaNovo");
  rem.hidden=can.hidden=novo.hidden=true;
  if(m.status!=="ativa"){aviso="Esta reunião foi cancelada.";if(m.tipo.slug){novo.hidden=false;novo.href="/agendar.html?s="+encodeURIComponent(m.tipo.slug);}}
  else if(m.passou)aviso="Esta reunião já aconteceu.";
  else if(!m.pode_cancelar)aviso="Faltam menos de "+m.cancela_ate_h+" horas para a reunião. Para mudar, fale com o nosso Comercial.";
  else{
    can.hidden=false;
    if(m.pode_remarcar)rem.hidden=false;
    else aviso="Você já remarcou o máximo de vezes. Para mudar de novo, fale com o nosso Comercial.";
  }
  $("agMinhaAviso").textContent=aviso;
}
async function carregarMinha(){
  try{E.minha=await api("minha");}catch(e){erroTopo(e.message);$("agTit").textContent="Sua reunião";return;}
  mostrarMinha();
}
$("agMinhaCancelar").addEventListener("click",async e=>{
  const m=E.minha,i=br(m.inicio);
  if(!confirm("Cancelar a reunião de "+diaTxt(i.dia)+" às "+i.hora+"?"))return;
  e.currentTarget.disabled=true;
  try{await api("cancelar-minha","POST",{r:COD});}catch(err){e.currentTarget.disabled=false;$("agMinhaAviso").textContent=err.message;return;}
  e.currentTarget.disabled=false;
  await carregarMinha();
});
$("agMinhaRemarcar").addEventListener("click",async()=>{
  E.remarcando=true;S=E.minha.tipo.slug||"";
  $("agMinha").hidden=true;
  await carregar(false);
  $("agInfo").insertAdjacentHTML("beforeend",'<br><b>Escolha o novo dia e horário.</b>');
  const v=document.createElement("button");v.type="button";v.className="ag-link";v.textContent="← voltar";
  v.addEventListener("click",()=>{E.remarcando=false;v.remove();mostrarMinha();});
  $("agPasso1").appendChild(v);
});
async function remarcar(){
  if(!confirm("Remarcar para "+diaTxt(E.dia)+" às "+E.hora+"?"))return;
  try{
    await api("remarcar-minha","POST",{r:COD,dia:E.dia,hora:E.hora});
  }catch(err){
    if(err.codigo==="OCUPADO"){await carregar(true);$("agInfo").insertAdjacentHTML("beforeend",'<br><b style="color:#b91c1c">'+esc(err.message)+'</b>');}
    else alert(err.message);
    return;
  }
  E.remarcando=false;
  document.querySelectorAll("#agPasso1 .ag-link").forEach(x=>x.remove());
  await carregarMinha();
  $("agMinhaAviso").textContent="✅ Reunião remarcada! Você receberá a confirmação por e-mail, se informou um.";
}

if(COD)carregarMinha();else carregar(false);
})();
