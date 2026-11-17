/* Guias liberadas ou escondidas em Configurações › 👁️ Guias valem sem a pessoa sair e entrar.
   Antes elas só eram lidas no login, e quem usa "Manter conectado" quase nunca faz login de novo:
   o administrador liberava, salvava, e a pessoa continuava sem ver.
   Agora o painel pergunta ao servidor (api/users.js, action minhas_guias) ao abrir, a cada 3 minutos e
   quando a pessoa volta para a aba. Mudou: guarda, refaz o menu (applyUserUI) e atualiza a cópia da
   sessão salva no aparelho. Quem barra o acesso de verdade continua sendo o servidor de cada guia. */
(function(){
"use strict";
var INTERVALO=3*60000,buscando=false,ultima=0;

function atuais(){try{return sessionStorage.getItem("userGuias")||"{}";}catch(e){return "{}";}}
// mesma lista em outra ordem não é mudança
function chave(o){var k=Object.keys(o||{}).sort(),r={};k.forEach(function(x){r[x]=!!o[x];});return JSON.stringify(r);}

function atualizar(forcar){
  var logado=null,tok=null;
  try{logado=sessionStorage.getItem("logged");tok=sessionStorage.getItem("authToken");}catch(e){}
  if(logado!=="1"||!tok||buscando)return;
  if(!forcar&&Date.now()-ultima<30000)return; // voltar para a aba várias vezes seguidas não repete
  buscando=true;ultima=Date.now();
  fetch("/api/users",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"minhas_guias"})})
    .then(function(r){return r.ok?r.json():null;})
    .then(function(j){
      if(!j||!j.ok||!j.guias||typeof j.guias!=="object")return;
      var antes={};try{antes=JSON.parse(atuais());}catch(e){}
      if(chave(antes)===chave(j.guias))return;
      try{sessionStorage.setItem("userGuias",JSON.stringify(j.guias));}catch(e){return;}
      if(typeof window.sessaoAtualizar==="function")window.sessaoAtualizar(); // a cópia do "Manter conectado"
      if(typeof window.applyUserUI==="function")window.applyUserUI();
      if(typeof window.hqToast==="function")window.hqToast("👁️ Suas guias foram atualizadas pelo administrador");
    })
    .catch(function(){})
    .then(function(){buscando=false;});
}

function ligar(){
  atualizar(true);
  setInterval(function(){atualizar(true);},INTERVALO);
  document.addEventListener("visibilitychange",function(){if(document.visibilityState==="visible")atualizar(false);});
}
window.guiasAtualizar=function(){atualizar(true);};
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",ligar);else ligar();
})();
