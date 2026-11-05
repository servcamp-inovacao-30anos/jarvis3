/* Página pública de agendamento (agendar.html?s=LINK). Sem login: mostra só os horários livres do tipo de
   reunião do link e marca um deles. Quem garante que não há reunião em cima de reunião é o servidor
   (api/_agenda.js + restrição no banco); aqui só se mostra o que ele mandou. */
(function(){
"use strict";
const $=id=>document.getElementById(id);
const esc=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const s=(new URLSearchParams(location.search).get("s")||location.hash.replace(/^#/,"")).trim();
const SEM=["dom","seg","ter","qua","qui","sex","sáb"];
const MES=["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];
const diaTxt=d=>{const x=new Date(d+"T12:00:00Z");return SEM[x.getUTCDay()]+", "+x.getUTCDate()+" de "+MES[x.getUTCMonth()];};
const durTxt=m=>m<60?m+" minutos":(m%60?Math.floor(m/60)+"h"+String(m%60).padStart(2,"0"):m/60+(m===60?" hora":" horas"));
const E={tipo:null,dias:{},dia:null,hora:null};

async function api(t,metodo,corpo){
  const r=await fetch("/api/rh?modulo=agendapub&t="+t+(metodo?"":"&s="+encodeURIComponent(s)),{method:metodo||"GET",headers:corpo?{"Content-Type":"application/json"}:{},body:corpo?JSON.stringify(corpo):undefined});
  const j=await r.json().catch(()=>({}));
  if(!r.ok){const e=new Error(j.error||"Não foi possível agora. Tente de novo.");e.codigo=j.codigo;e.status=r.status;throw e;}
  return j;
}
function erroTopo(m){$("agInfo").textContent=m;$("agPasso1").hidden=true;$("agForm").hidden=true;}

async function carregar(manterDia){
  if(!s){erroTopo("Link incompleto. Peça o link de agendamento de novo ao nosso Comercial.");return;}
  let j;
  try{j=await api("horarios");}catch(e){erroTopo(e.message);return;}
  E.tipo=j.tipo;E.dias=j.dias||{};
  $("agTit").textContent=j.tipo.nome;
  document.querySelector(".ag-topo").style.setProperty("--cor",/^#[0-9a-f]{6}$/i.test(j.tipo.cor||"")?j.tipo.cor:"#1e4d8c");
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
$("agHoras").addEventListener("click",e=>{
  const b=e.target.closest("[data-h]");if(!b)return;
  E.hora=b.dataset.h;
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
  const corpo={s,dia:E.dia,hora:E.hora,nome:$("agNome").value,telefone:$("agTel").value,email:$("agEmail").value,obs:$("agObs").value,site:$("agSite").value};
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
carregar(false);
})();
