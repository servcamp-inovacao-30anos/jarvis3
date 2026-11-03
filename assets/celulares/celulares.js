/* Celulares dos postos — a guia de controle e o número de cada posto na guia Clientes.
   Fica fora do index.html porque ele já está no limite de tamanho (test/auth_exigencia).
   O servidor é o api/_celulares.js (/api/rh?modulo=celulares), e é ele que decide quem vê o quê:
   • guia Celulares (administrador, ou quem foi liberado em Configurações › 👁️ Guias): a lista com o
     que falta e o que conferir, cadastro, edição, baixa, importação da planilha CELULARES, o Excel de
     backup e o DDD completado de uma vez. As senhas não vêm na lista: cada uma é pedida na hora (🔒)
     e fica registrado quem viu;
   • guia Clientes (todo mundo): número e login Zello de cada posto, para o supervisor ligar.
   O aparelho ("AGUAS CLARAS - PORTARIA") é ligado ao cliente da planilha do sistema ("AGUAS CLARAS")
   pelo nome sem o posto; o que não casar sozinho é ligado à mão (🔗 na guia Celulares).
   Esconder a guia é só conveniência: quem barra os outros é o servidor. */
(function(raiz){
"use strict";

/* ── regras puras (test/celulares_tela.test.js) ──────────────────────────── */
const semAcento=s=>String(s==null?"":s).normalize("NFD").replace(/[̀-ͯ]/g,"");
const ABREV={PQ:"PARQUE",JD:"JARDIM",JARD:"JARDIM",STA:"SANTA",STO:"SANTO",VL:"VILA",RESID:"RESIDENCIAL"};
// "Pq. Ecológico (RONDA)" → "PARQUE ECOLOGICO RONDA"
function chave(s){
  return semAcento(s).toUpperCase().replace(/&/g," E ").replace(/[^A-Z0-9]+/g," ").trim().split(" ").filter(Boolean).map(t=>ABREV[t]||t).join(" ");
}
const PREFIXOS=new Set(["COND","CONDOMINIO","CONDO","RES","RESIDENCIAL","EDIFICIO","ED","EDIF"]);
// o posto (e o que vem junto dele) no fim do nome do aparelho
const POSTOS=new Set(["PORTARIA","PORTEIRO","RONDA","ZELADOR","ZELADORA","ZELADORIA","LIMPEZA","LIDER","APOIO","ADM","ADMINISTRATIVO","ADMINISTRACAO",
  "RECEPCAO","SINDICA","SINDICO","JARDINEIRO","JARDINAGEM","MANUTENCAO","CONTROLADOR","VIGIA","VIGILANTE","SEGURANCA",
  "CELULAR","SUMIU","APARELHO","DO","CLIENTE","DESLIGADO","DESLIGADA","NOTURNO","DIURNO"]);
const NUMERACAO=/^(I|II|III|IV|V|\d{1,2})$/;
// Nome do cliente do sistema para comparar: sem o "COND./RES." da frente e sem parênteses.
// O fim fica: "ASA LIDER" pode ser um cliente, e não o posto LIDER do cliente ASA.
function nucleoCliente(s){
  const t=chave(String(s==null?"":s).replace(/\([^)]*\)/g," ")).split(" ").filter(Boolean);
  while(t.length>1&&PREFIXOS.has(t[0]))t.shift();
  return t.join(" ");
}
// O nome do cliente dentro do nome do aparelho: "COND - TURQUEZA VILLE - PORTARIA APOIO" → "TURQUEZA VILLE".
// "RONDA 01" e "PORTARIA II" saem inteiros; "AMBIANCE IV" e "UNIDADE 1" ficam (o número é do nome).
function nucleo(s){
  const t=nucleoCliente(s).split(" ").filter(Boolean);
  for(;;){
    const n=t.length;
    if(n>1&&POSTOS.has(t[n-1])){t.pop();continue;}
    if(n>2&&NUMERACAO.test(t[n-1])&&POSTOS.has(t[n-2])){t.pop();continue;}
    break;
  }
  return t.join(" ");
}
// Número no nome ("II", "2", "02", "III"): unidade diferente nunca é "parecida" ("SANTOS DUMONT II" não é o SANTOS DUMONT).
const ROMANO={I:"1",II:"2",III:"3",IV:"4",V:"5",VI:"6",VII:"7",VIII:"8",IX:"9",X:"10"};
const numTok=t=>/^\d+$/.test(t)?String(+t):(ROMANO[t]||null);
const normTok=t=>numTok(t)||t;
const numerosDe=toks=>toks.map(numTok).filter(Boolean).sort().join(",");
// mesma palavra, ou abreviação dela ("P" de PARQUE, "UNID" de UNIDADE, "S" de SAN)
function tokOk(a,b){
  a=normTok(a);b=normTok(b);if(a===b)return true;
  const[c,l]=a.length<b.length?[a,b]:[b,a];
  return !numTok(c)&&!numTok(l)&&(c.length===1||c.length>=3)&&l.indexOf(c)===0;
}
// as palavras de "parte" aparecem em "todo", na mesma ordem. Abreviação só vale acompanhada: no
// máximo uma, e com pelo menos uma palavra igual ("P" sozinho não pode virar "PLUTÃO").
function contemEmOrdem(todo,parte){
  let i=0,abrev=0;
  for(const t of todo)if(i<parte.length&&tokOk(t,parte[i])){if(normTok(t)!==normTok(parte[i]))abrev++;i++;}
  return i===parte.length&&abrev<=1&&parte.length-abrev>=1;
}
// aparelhos: {id, cliente, cliente_vinculado, tipo}; nomes: clientes da planilha do sistema.
// Devolve Map id → {nome, como}:
//   "manual"   ligado na tela;
//   "nome"     o nome bate (tirando o posto, o "COND." e acento/pontuação; "3" = "III");
//   "parecido" só uma SUGESTÃO para confirmar na guia Celulares — não aparece para o supervisor:
//              erro de digitação, nome mais curto ou mais comprido que o do sistema, abreviação;
//   {nome:null, como:"perdido"} quando o cliente ligado na tela saiu da planilha.
// Na dúvida (dois candidatos), não sugere nada.
function vincular(aparelhos,nomes){
  const porChave=new Map(),porNucleo=new Map(),porCompacto=new Map(),porNormal=new Map(),clientes=[];
  const junta=(m,k,n)=>{if(!m.has(k))m.set(k,[]);if(m.get(k).indexOf(n)<0)m.get(k).push(n);};
  for(const n0 of nomes||[]){
    const n=String(n0==null?"":n0).trim();if(!n)continue;
    const c=chave(n),k=nucleoCliente(n);
    if(c&&!porChave.has(c))porChave.set(c,n);
    if(!k)continue;
    const tk=k.split(" ");
    if(!porNucleo.has(k))clientes.push({n,k,tk,kc:k.replace(/ /g,""),num:numerosDe(tk)});
    junta(porNucleo,k,n);junta(porCompacto,k.replace(/ /g,""),n);junta(porNormal,tk.map(normTok).join(" "),n);
  }
  const unico=l=>l&&l.length===1?l[0]:null;
  const out=new Map();
  for(const a of aparelhos||[]){
    if(!a)continue;
    if(a.cliente_vinculado){const n=porChave.get(chave(a.cliente_vinculado));out.set(a.id,n?{nome:n,como:"manual"}:{nome:null,como:"perdido"});continue;}
    if(a.tipo==="INTERNO")continue;
    const exato=porChave.get(chave(a.cliente));
    if(exato){out.set(a.id,{nome:exato,como:"nome"});continue;}
    const d=nucleo(a.cliente);if(!d)continue;
    const td=d.split(" "),dc=d.replace(/ /g,"");
    const certo=unico(porNucleo.get(d))||unico(porCompacto.get(dc))||unico(porNormal.get(td.map(normTok).join(" ")));
    if(certo){out.set(a.id,{nome:certo,como:"nome"});continue;}
    // sugestões: a que tem mais palavras em comum ganha; empate = dúvida
    const num=numerosDe(td),lim=dc.length>=12?2:1;
    let melhor=0,quem=[];
    for(const c of clientes){
      if(c.num!==num)continue;
      let s=0;
      // o do sistema é mais curto: começando pela mesma palavra ("LAGO DI LUGANO" não é o "LUGANO")
      if(tokOk(td[0],c.tk[0])&&contemEmOrdem(td,c.tk))s=c.tk.length;
      else if((td.length>1||d.length>=5)&&contemEmOrdem(c.tk,td))s=td.length;           // o do aparelho é mais curto
      else if(dc.length>=6&&Math.abs(c.kc.length-dc.length)<=1&&distancia(c.kc,dc,lim)<=lim)s=c.tk.length; // digitação
      if(!s)continue;
      if(s>melhor){melhor=s;quem=[c];}else if(s===melhor)quem.push(c);
    }
    if(quem.length===1){const n=unico(porNucleo.get(quem[0].k));if(n)out.set(a.id,{nome:n,como:"parecido"});}
  }
  return out;
}
// Quantas letras trocar/pôr/tirar para ir de a a b (para cedo quando passa do limite).
function distancia(a,b,lim){
  let ant=Array.from({length:b.length+1},(_,j)=>j);
  for(let i=1;i<=a.length;i++){
    const cur=[i];let menor=i;
    for(let j=1;j<=b.length;j++){cur[j]=Math.min(ant[j]+1,cur[j-1]+1,ant[j-1]+(a[i-1]===b[j-1]?0:1));if(cur[j]<menor)menor=cur[j];}
    if(menor>lim)return lim+1;
    ant=cur;
  }
  return ant[b.length];
}
// O que sobra do nome do aparelho tirando o cliente: "AGUAS CLARAS - PORTARIA" → "PORTARIA".
function rotuloPosto(aparelho,cliente){
  const tira=new Set(chave(cliente).split(" ").concat([...PREFIXOS]));
  return chave(String(aparelho==null?"":aparelho).replace(/[()]/g," ")).split(" ").filter(x=>x&&!tira.has(x)).join(" ");
}
// Mesma regra do servidor (api/_celulares_regras.js; o teste confere as duas).
function analisarNumero(v){
  let d=String(v==null?"":v).replace(/\D/g,"");
  if(d.length>=12&&d.indexOf("55")===0)d=d.slice(2);
  d=d.replace(/^0+/,"");
  if(d.length===10||d.length===11)return{ok:true,ddd:d.slice(0,2),local:d.slice(2)};
  if(d.length===8||d.length===9)return{ok:false,semDDD:true,local:d};
  return{ok:false,invalido:true};
}
const fmtLocal=d=>d.length===9?d.slice(0,5)+"-"+d.slice(5):d.length===8?d.slice(0,4)+"-"+d.slice(4):d;
function formatarNumero(v){const a=analisarNumero(v);return a.ok?"("+a.ddd+") "+fmtLocal(a.local):a.semDDD?fmtLocal(a.local):String(v==null?"":v).trim();}
// Toque para ligar. Sem DDD liga do mesmo jeito dentro da região.
function telHref(v){const a=analisarNumero(v);return a.ok?"tel:+55"+a.ddd+a.local:a.semDDD?"tel:"+a.local:"";}
// contatos (api ?t=contatos) → Map chave(cliente do sistema) → [{numero, login, posto}]
function contatosPorCliente(contatos,nomes){
  const lista=(contatos||[]).filter(Boolean);
  const v=vincular(lista.map(c=>({id:c.id,cliente:c.cliente,cliente_vinculado:c.cliente_vinculado,tipo:"POSTO"})),nomes);
  const m=new Map();
  for(const c of lista){
    const x=v.get(c.id);if(!x||!x.nome||x.como==="parecido")continue; // sugestão sem confirmar não vai para o supervisor
    const k=chave(x.nome);if(!m.has(k))m.set(k,[]);
    m.get(k).push({numero:c.numero||"",login:c.login_zello||"",posto:rotuloPosto(c.cliente,x.nome)});
  }
  m.forEach(l=>l.sort((a,b)=>a.posto.localeCompare(b.posto)));
  return m;
}
// Clientes do sistema mais parecidos com o nome do aparelho (para ligar à mão).
function sugestoes(aparelho,nomes,quantos){
  const d=nucleo(aparelho),td=new Set(d.split(" ").filter(Boolean));
  if(!td.size)return[];
  return [...new Set((nomes||[]).map(n=>String(n||"").trim()).filter(Boolean))].map(n=>{
    const k=nucleoCliente(n),tk=k.split(" ").filter(Boolean);
    if(!tk.length)return{n,nota:0};
    const comum=tk.filter(t=>td.has(t)).length;
    const nota=comum/Math.max(td.size,tk.length)+(d.indexOf(k)===0||k.indexOf(d)===0?0.5:0);
    return{n,nota};
  }).filter(x=>x.nota>0).sort((a,b)=>b.nota-a.nota||a.n.localeCompare(b.n)).slice(0,quantos||6).map(x=>x.n);
}

if(typeof module==="object"&&module.exports){
  module.exports={chave,nucleo,vincular,rotuloPosto,analisarNumero,formatarNumero,telHref,contatosPorCliente,sugestoes};
  return;
}

/* ── no navegador ──────────────────────────────────────────────────────── */
const esc=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const uk=()=>sessionStorage.getItem("userKey")||"";
const toast=t=>{if(typeof hqToast==="function")hqToast(t);};
const CEL={lista:null,dono:null,carregando:false,erro:null,f:{q:"",sit:"ATIVO",pend:"",chip:""},pag:1,
  contatos:null,contatosDono:null,contatosEm:0,pedindo:false,idx:null,idxDe:null};
const POR_PAGINA=50;
const SIT={ATIVO:"Ativo",RESERVA:"Reserva",BAIXADO:"Baixado"};
const SEGREDO={senha_gmail:"Senha do Gmail",senha_zello:"Senha Zello",applock:"Bloqueio AppLock"};
const CONTATOS_MS=5*60000;

async function api(t,metodo,corpo,qs){
  const r=await fetch("/api/rh?modulo=celulares"+(t?"&t="+t:"")+(qs||""),{method:metodo||"GET",headers:corpo?{"Content-Type":"application/json"}:{},body:corpo?JSON.stringify(corpo):undefined});
  const j=await r.json().catch(()=>({}));
  if(!r.ok||j.ok===false){const e=new Error(j.error||("Falha ("+r.status+")"));e.codigo=j.codigo;e.status=r.status;throw e;}
  return j;
}
// Clientes da planilha do sistema, sem os que não são cliente (reserva técnica, departamento,
// as próprias empresas: CL_EXCL do index.html) — um aparelho nunca deve casar com eles.
function nomesClientes(){
  try{
    const fora=new Set(typeof CL_EXCL!=="undefined"?[...CL_EXCL].map(chave):[]);
    return[...new Set(((typeof DASHBOARD_DATA!=="undefined"&&DASHBOARD_DATA&&DASHBOARD_DATA.clientes)||[]).map(r=>r&&r.NOME!=null?String(r.NOME).trim():"").filter(n=>n&&!fora.has(chave(n))))];
  }catch(e){return[];}
}
function clientesAtuais(){try{return typeof DASHBOARD_DATA!=="undefined"&&DASHBOARD_DATA?DASHBOARD_DATA.clientes:null;}catch(e){return null;}}

/* ── guia Clientes: número e login Zello de cada posto ─────────────────── */
// Lista dos contatos: uma vez a cada 5 min por pessoa logada. Falhou (ou a tabela ainda não existe):
// a guia Clientes segue normal, só sem o número.
raiz.celContatosCarregar=function(){
  const dono=uk();
  if(CEL.contatos&&CEL.contatosDono===dono&&Date.now()-CEL.contatosEm<CONTATOS_MS)return;
  if(CEL.pedindo)return;
  CEL.pedindo=true;
  api("contatos").then(j=>{
    CEL.contatos=Array.isArray(j.contatos)?j.contatos:[];CEL.contatosDono=dono;CEL.contatosEm=Date.now();CEL.idx=null;
    if(typeof ST!=="undefined"&&ST.pg==="clientes"&&typeof rTbl==="function")rTbl("clientes");
  }).catch(e=>{console.warn("celulares: contatos",e&&e.message);}).then(()=>{CEL.pedindo=false;});
};
function indice(){
  if(!CEL.contatos||CEL.contatosDono!==uk())return null;
  const cli=clientesAtuais();
  if(!CEL.idx||CEL.idxDe!==cli){CEL.idx=contatosPorCliente(CEL.contatos,nomesClientes());CEL.idxDe=cli;}
  return CEL.idx;
}
raiz.celContatosDe=function(nome){const i=indice();return i?(i.get(chave(nome))||[]):null;};
// texto para a busca da tabela (número com e sem máscara, e o login)
raiz.celContatosTexto=function(nome){
  const l=raiz.celContatosDe(nome);if(!l||!l.length)return null;
  return{numeros:l.map(c=>formatarNumero(c.numero)+" "+String(c.numero||"").replace(/\D/g,"")).join(" / "),zellos:l.map(c=>c.login).join(" / ")};
};
const semDado='<span class="cel-sem">—</span>';
raiz.celCelularHtml=function(r){
  const l=raiz.celContatosDe(r&&r.NOME);
  if(!l||!l.length)return semDado;
  return l.map(c=>{
    const f=formatarNumero(c.numero),h=telHref(c.numero);
    const n=!c.numero?'<span class="cel-sem">sem número</span>':h?'<a class="cel-tel" href="'+esc(h)+'">'+esc(f)+'</a>':esc(f);
    return'<div class="cel-ct">'+n+(c.posto?'<span class="cel-pt">'+esc(c.posto)+'</span>':'')+'</div>';
  }).join("");
};
raiz.celZelloHtml=function(r){
  const l=raiz.celContatosDe(r&&r.NOME);
  if(!l||!l.length)return semDado;
  return l.map(c=>'<div class="cel-ct">'+(c.login?'<span class="cel-z">'+esc(c.login)+'</span>':'<span class="cel-sem">sem login</span>')+(c.posto?'<span class="cel-pt">'+esc(c.posto)+'</span>':'')+'</div>').join("");
};

/* ── guia Celulares ─────────────────────────────────────────────────────── */
const conteudo=()=>document.getElementById("cel-content");
// Abrir a guia (navTo): mostra o que já tinha (sem piscar) e busca de novo por trás — outra pessoa
// pode ter mexido. Só aqui mexe no filtro geral e no subtítulo: é a guia que está na tela.
raiz.celLoad=function(){
  const fb=document.querySelector(".fb");if(fb)fb.style.display="none"; // período/turno/área não valem aqui
  const sub=document.getElementById("pgSub");if(sub)sub.textContent="Cadastro e pendências dos aparelhos";
  if(CEL.dono!==uk()){CEL.lista=null;CEL.erro=null;CEL.dono=uk();} // outra pessoa entrou nesta aba
  raiz.celRender();
  carregar();
};
// Busca a lista. Pedido no meio de outra busca não se perde: roda de novo logo depois dela
// (a primeira pode ter saído antes de a última gravação chegar no banco).
function carregar(){
  if(CEL.carregando){CEL.denovo=true;return;}
  CEL.carregando=true;CEL.denovo=false;
  const dono=uk();
  api("").then(j=>{if(dono===uk()){CEL.lista=Array.isArray(j.aparelhos)?j.aparelhos:[];CEL.erro=null;}})
    .catch(e=>{
      if(dono!==uk())return;
      // sem permissão (ou a sessão mudou): some com o que estava na tela
      if(e.status===403||!CEL.lista){CEL.lista=null;CEL.erro=e;}
      else toast("Não consegui atualizar os aparelhos: "+e.message);
    })
    .then(()=>{
      CEL.carregando=false;
      if(CEL.denovo){carregar();return;}
      if(typeof ST==="undefined"||ST.pg==="celulares")raiz.celRender();
    });
}
const recarregar=()=>{CEL.contatos=null;CEL.idx=null;carregar();};

// pendências do servidor + a do vínculo com o cliente do sistema (só a tela conhece a planilha)
function comVinculo(lista){
  const nomes=nomesClientes(),temNomes=nomes.length>0;
  const v=temNomes?vincular(lista,nomes):new Map();
  return lista.map(a=>{
    const x=v.get(a.id)||null,pend=(a.pend||[]).slice();
    if(temNomes&&a.tipo!=="INTERNO"&&a.situacao==="ATIVO"){
      if(!x)pend.push({campo:"cliente_vinculado",tipo:"vinculo",msg:"Sem cliente no sistema"});
      else if(!x.nome)pend.push({campo:"cliente_vinculado",tipo:"vinculo",msg:"Cliente ligado saiu da planilha"});
      else if(x.como==="parecido")pend.push({campo:"cliente_vinculado",tipo:"vinculo",msg:"Cliente parecido: confirme"});
    }
    return Object.assign({},a,{vinc:x,pendT:pend});
  });
}
const chipDe=p=>p.tipo+"|"+String(p.msg).split(":")[0];
let _temNomes=false; // a planilha do sistema está carregada (dá para ligar aparelho a cliente)
function filtrar(lista){
  const f=CEL.f,q=chave(f.q),qd=f.q.replace(/\D/g,"");
  return lista.filter(a=>{
    if(f.sit&&a.situacao!==f.sit)return false;
    if(f.pend==="ok"&&a.pendT.length)return false;
    if(f.pend&&f.pend!=="ok"&&!a.pendT.some(p=>p.tipo===f.pend))return false;
    if(f.chip&&!a.pendT.some(p=>chipDe(p)===f.chip))return false;
    if(q){
      const txt=chave([a.cliente,a.cliente_vinculado,a.vinc&&a.vinc.nome,a.modelo,a.numero,a.login_zello,a.email,a.imei1,a.imei2,a.obs].join(" "));
      const dig=String((a.numero||"")+" "+(a.imei1||"")+" "+(a.imei2||"")).replace(/\D/g,"");
      if(txt.indexOf(q)<0&&!(qd.length>=4&&dig.indexOf(qd)>=0))return false;
    }
    return true;
  }).sort((a,b)=>String(a.cliente||"").localeCompare(String(b.cliente||""),"pt-BR"));
}
function cartao(cls,ic,rot,valor,sub,filtro){
  return'<div class="sk '+cls+(filtro?' clickable" data-cel="filtro" data-pend="'+filtro:'')+'"><div class="sk-top"><span class="sk-ic">'+ic+'</span></div><div class="sk-lbl">'+rot+'</div><div class="sk-v">'+valor+'</div><div class="sk-sub">'+sub+'</div></div>';
}
function erroHtml(e){
  if(e.status===403)return'<div class="cel-vazio">🔒 Esta guia é só para administradores ou para quem foi liberado em <b>Configurações › 👁️ Guias</b>.</div>';
  if(e.codigo==="SEM_TABELA")return'<div class="cel-vazio">A tabela dos celulares ainda não foi criada no banco. Avise o administrador.</div>';
  return'<div class="cel-vazio">Não consegui carregar os aparelhos: '+esc(e.message)+'<br><button type="button" class="rh-btn rh-btn-sec" data-cel="recarregar" style="margin-top:12px">Tentar de novo</button></div>';
}
raiz.celRender=function(){
  const el=conteudo();if(!el)return;
  // outra pessoa entrou nesta aba sem recarregar (a página continua em Celulares): nada da anterior
  if(CEL.dono!==uk()){raiz.celLoad();return;}
  ligarEventos(el);
  if(CEL.erro){el.innerHTML=erroHtml(CEL.erro);return;}
  if(!CEL.lista){el.innerHTML='<div class="cel-vazio">Carregando os aparelhos…</div>';return;}
  const sub=document.getElementById("pgSub");if(sub&&typeof ST!=="undefined"&&ST.pg==="celulares")sub.textContent="Cadastro e pendências dos aparelhos";
  const todos=comVinculo(CEL.lista),temNomes=nomesClientes().length>0;
  _temNomes=temNomes;
  CEL.vinc=new Map(todos.map(a=>[String(a.id),a.vinc]));
  const ativos=todos.filter(a=>a.situacao==="ATIVO");
  const nSit=s=>todos.filter(a=>a.situacao===s).length;
  const comFalta=ativos.filter(a=>a.pendT.some(p=>p.tipo==="falta"));
  const campos=ativos.reduce((t,a)=>t+a.pendT.filter(p=>p.tipo==="falta").length,0);
  const conferir=ativos.filter(a=>a.pendT.some(p=>p.tipo==="conferir")).length;
  const semVinc=ativos.filter(a=>a.pendT.some(p=>p.tipo==="vinculo")).length;
  const semDDD=todos.filter(a=>a.situacao!=="BAIXADO"&&a.pendT.some(p=>p.msg==="Número sem DDD")).length;
  const internos=ativos.filter(a=>a.tipo==="INTERNO").length;
  let h='<div class="cel-barra">'+
    '<button type="button" class="rh-btn" data-cel="novo">➕ Novo aparelho</button>'+
    '<button type="button" class="rh-btn rh-btn-sec" data-cel="importar">📥 Importar planilha</button>'+
    (todos.length?'<button type="button" class="rh-btn rh-btn-sec" data-cel="exportar">📤 Excel (backup)</button>':'')+
    (semDDD?'<button type="button" class="rh-btn rh-btn-sec" data-cel="ddd">📞 Completar DDD ('+semDDD+')</button>':'')+
    '</div>';
  if(!todos.length){
    el.innerHTML=h+'<div class="cel-vazio"><b>Nenhum aparelho cadastrado ainda.</b><br>Importe a planilha CELULARES (📥) para trazer todos de uma vez, ou cadastre um a um (➕).</div>';
    return;
  }
  h+='<div class="sec-kpis cel-kpis">'+
    cartao("sk-bl","📱","Aparelhos ativos",ativos.length,"<b>"+nSit("RESERVA")+"</b> reserva · <b>"+nSit("BAIXADO")+"</b> baixados · <b>"+internos+"</b> uso interno","")+
    cartao("sk-re","⚠️","Com dado faltando",comFalta.length,"<b>"+campos+"</b> campos em branco","falta")+
    cartao("sk-or","🔎","Para conferir",conferir,"DDD, repetidos, inválidos","conferir")+
    cartao("sk-pu","🔗","Sem cliente no sistema",temNomes?semVinc:"—",temNomes?"sem cliente ou a confirmar: fora da guia Clientes":"carregue a planilha do sistema",temNomes?"vinculo":"")+
    '</div>';
  // atalhos: cada tipo de pendência, com a contagem dentro da situação escolhida
  const base=todos.filter(a=>!CEL.f.sit||a.situacao===CEL.f.sit),cont=new Map();
  base.forEach(a=>{new Set(a.pendT.map(chipDe)).forEach(k=>cont.set(k,(cont.get(k)||0)+1));});
  const chips=[...cont.entries()].sort((a,b)=>b[1]-a[1]);
  if(chips.length)h+='<div class="cel-chips">'+chips.map(([k,n])=>{const[t,m]=k.split("|");return'<button type="button" class="cel-chip cel-'+esc(t)+(CEL.f.chip===k?' on':'')+'" data-cel="chip" data-k="'+esc(k)+'">'+esc(m)+' <b>'+n+'</b></button>';}).join("")+'</div>';
  const lista=filtrar(todos);
  const paginas=Math.max(1,Math.ceil(lista.length/POR_PAGINA));
  if(CEL.pag>paginas)CEL.pag=paginas;
  const ini=(CEL.pag-1)*POR_PAGINA,pagina=lista.slice(ini,ini+POR_PAGINA);
  const sel=(id,ops,v)=>'<select class="cel-sel" id="'+id+'">'+ops.map(([k,t])=>'<option value="'+k+'"'+(v===k?' selected':'')+'>'+t+'</option>').join("")+'</select>';
  const algum=CEL.f.q||CEL.f.pend||CEL.f.chip||CEL.f.sit!=="ATIVO";
  h+='<div class="ts"><div class="th2"><div style="display:flex;align-items:center;gap:7px"><div class="chb"></div><span class="ct">Aparelhos</span><span class="cel-n">'+lista.length+' de '+todos.length+'</span></div>'+
    '<div class="cel-filtros"><input class="sb2" type="search" id="cel-q" placeholder="Buscar cliente, número, IMEI, login…" value="'+esc(CEL.qTela!=null?CEL.qTela:CEL.f.q)+'">'+
    sel("cel-sit",[["ATIVO","Ativos"],["RESERVA","Reserva"],["BAIXADO","Baixados"],["","Todas as situações"]],CEL.f.sit)+
    sel("cel-pend",[["","Todas as pendências"],["falta","Com dado faltando"],["conferir","Para conferir"],["vinculo","Sem cliente no sistema"],["ok","Tudo certo"]],CEL.f.pend)+
    (algum?'<button type="button" class="cel-limpar" data-cel="limpar">limpar filtros</button>':'')+'</div></div>';
  if(!pagina.length)h+='<div class="nd">Nenhum aparelho com esses filtros.</div>';
  else{
    h+='<div class="cel-rola"><table class="cel-tbl"><thead><tr><th>Cliente</th><th>Modelo</th><th>Número</th><th>Login Zello</th><th>IMEI 1 / IMEI 2</th><th>E-mail</th><th>Senhas</th><th>Situação</th><th>Pendências</th><th></th></tr></thead><tbody>'+
      pagina.map(linha).join("")+'</tbody></table></div>';
    if(paginas>1){
      h+='<div class="pag"><div class="pi2">'+(ini+1)+'–'+Math.min(ini+POR_PAGINA,lista.length)+' de '+lista.length+'</div><div class="pbs">';
      for(let i=1;i<=paginas;i++)h+='<button type="button" class="pb'+(i===CEL.pag?' active':'')+'" data-cel="pag" data-p="'+i+'">'+i+'</button>';
      h+='</div></div>';
    }
  }
  h+='</div><div class="cel-nota">“X” num campo quer dizer <b>não se aplica</b> (não conta como falta). As senhas não aparecem na lista: 🔒 mostra as de um aparelho e fica registrado quem viu.</div>';
  const q=document.activeElement&&document.activeElement.id==="cel-q",pos=q?document.activeElement.selectionStart:0;
  el.innerHTML=h;
  if(q){const i=document.getElementById("cel-q");if(i){i.focus();try{i.setSelectionRange(pos,pos);}catch(e){}}}
};
function linha(a){
  const d=x=>x?esc(x):'<span class="cel-sem">—</span>';
  let cli='<b>'+d(a.cliente)+'</b>';
  if(a.tipo==="INTERNO")cli+='<span class="cel-tag">uso interno</span>';
  else if(a.vinc&&a.vinc.nome&&a.vinc.como==="parecido")cli+='<span class="cel-vin cel-vin-q" title="Sugestão pelo nome parecido: só aparece na guia Clientes depois de confirmada">↳ '+esc(a.vinc.nome)+' ?</span>'+
    '<span class="cel-acoes"><button type="button" class="cel-lk" data-cel="confirmar" data-id="'+a.id+'">✓ confirmar</button><button type="button" class="cel-lk" data-cel="vincular" data-id="'+a.id+'">trocar</button></span>';
  else if(a.vinc&&a.vinc.nome)cli+='<span class="cel-vin" title="'+(a.vinc.como==="manual"?"Ligado na tela":"Ligado pelo nome")+'">↳ '+esc(a.vinc.nome)+'</span>';
  if(a.tipo!=="INTERNO"&&a.situacao!=="BAIXADO"&&(!a.vinc||!a.vinc.nome)&&_temNomes)cli+='<button type="button" class="cel-lk" data-cel="vincular" data-id="'+a.id+'">🔗 ligar ao cliente</button>';
  const f=formatarNumero(a.numero),h=telHref(a.numero);
  const num=!a.numero?d(""):h?'<a class="cel-tel" href="'+esc(h)+'">'+esc(f)+'</a>':esc(f);
  const p=a.pendT;
  const chips=p.slice(0,3).map(x=>'<span class="cel-p cel-'+esc(x.tipo)+'">'+esc(x.msg)+'</span>').join("")+(p.length>3?'<span class="cel-p cel-mais" title="'+esc(p.slice(3).map(x=>x.msg).join("\n"))+'">+'+(p.length-3)+'</span>':"");
  return'<tr'+(a.situacao==="BAIXADO"?' class="cel-baixado"':'')+'>'+
    '<td class="cel-cli">'+cli+'</td><td>'+d(a.modelo)+'</td><td class="cel-nw">'+num+'</td><td>'+d(a.login_zello)+'</td>'+
    '<td class="cel-imei">'+d(a.imei1)+'<br>'+d(a.imei2)+'</td><td>'+d(a.email)+'</td>'+
    '<td>'+((a.com||[]).length?'<button type="button" class="cel-ver" data-cel="senhas" data-id="'+a.id+'">🔒 ver</button>':'<span class="cel-sem">—</span>')+'</td>'+
    '<td><span class="cel-sit cel-sit-'+esc(String(a.situacao||"").toLowerCase())+'">'+esc(SIT[a.situacao]||a.situacao||"—")+'</span></td>'+
    '<td class="cel-pends">'+(chips||'<span class="cel-ok">✓ completo</span>')+'</td>'+
    '<td><button type="button" class="cel-ed" data-cel="editar" data-id="'+a.id+'" title="Editar" aria-label="Editar">✏️</button></td></tr>';
}

/* ── eventos (um ouvinte por tela; nada de onclick com texto do banco) ── */
let _debounce=null;
function ligarEventos(el){
  if(el.__cel)return;el.__cel=true;
  el.addEventListener("click",e=>{
    const b=e.target.closest("[data-cel]");if(!b||!el.contains(b))return;
    const acao=b.dataset.cel,id=b.dataset.id;
    if(acao==="novo")abrirForm(null);
    else if(acao==="editar")abrirForm(achar(id));
    else if(acao==="senhas")verSenhas(achar(id));
    else if(acao==="vincular")abrirVinculo(achar(id));
    else if(acao==="confirmar"){const x=CEL.vinc&&CEL.vinc.get(String(id));if(x&&x.nome)confirmarVinculo(id,x.nome,b);}
    else if(acao==="importar")abrirImportar();
    else if(acao==="exportar")exportar(b);
    else if(acao==="ddd")abrirDDD();
    else if(acao==="recarregar")recarregar();
    else if(acao==="pag"){CEL.pag=+b.dataset.p||1;raiz.celRender();}
    else if(acao==="chip"){CEL.f.chip=CEL.f.chip===b.dataset.k?"":b.dataset.k;CEL.pag=1;raiz.celRender();}
    else if(acao==="filtro"){CEL.f.pend=CEL.f.pend===b.dataset.pend?"":b.dataset.pend;CEL.f.sit="ATIVO";CEL.f.chip="";CEL.pag=1;raiz.celRender();}
    else if(acao==="limpar"){CEL.f={q:"",sit:"ATIVO",pend:"",chip:""};CEL.qTela=null;CEL.pag=1;raiz.celRender();}
  });
  el.addEventListener("input",e=>{
    if(e.target.id!=="cel-q")return;
    const v=e.target.value;CEL.qTela=v;clearTimeout(_debounce);
    _debounce=setTimeout(()=>{CEL.f.q=v;CEL.pag=1;raiz.celRender();},250);
  });
  el.addEventListener("change",e=>{
    if(e.target.id==="cel-sit"){CEL.f.sit=e.target.value;CEL.f.chip="";CEL.pag=1;raiz.celRender();}
    else if(e.target.id==="cel-pend"){CEL.f.pend=e.target.value;CEL.pag=1;raiz.celRender();}
  });
}
const achar=id=>(CEL.lista||[]).find(a=>String(a.id)===String(id))||null;

/* ── janelas ─────────────────────────────────────────────────────────────── */
function janela(titulo,html,larga){
  fechar();
  const ov=document.createElement("div");
  ov.className="cel-ov";ov.id="cel-ov";
  ov.innerHTML='<div class="cel-box'+(larga?' cel-larga':'')+'" role="dialog" aria-modal="true" aria-label="'+esc(titulo)+'">'+
    '<div class="cel-h"><b>'+esc(titulo)+'</b><button type="button" class="cel-x" data-fechar="1" aria-label="Fechar">✕</button></div>'+
    '<div class="cel-c">'+html+'</div></div>';
  let baixou=null;
  ov.addEventListener("mousedown",e=>{baixou=e.target;});
  ov.addEventListener("click",e=>{if((e.target===ov&&baixou===ov)||e.target.closest("[data-fechar]"))fechar();});
  document.body.appendChild(ov);
  return ov;
}
function fechar(){const o=document.getElementById("cel-ov");if(o)o.remove();}
// Resposta que chega depois de a janela fechar não pode fechar a próxima que a pessoa abriu.
function fecharSe(ov){if(document.getElementById("cel-ov")===ov)fechar();}
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&document.getElementById("cel-ov"))fechar();});

// Sessão caiu (12 h, bloqueio, "sair de todos os aparelhos") ou outra pessoa entrou nesta aba:
// fecha a janela aberta (pode ser a das senhas) e esquece a lista e os contatos da pessoa anterior.
function esquecer(){
  fechar();
  CEL.lista=null;CEL.erro=null;CEL.dono=null;CEL.contatos=null;CEL.contatosDono=null;CEL.idx=null;
  const el=conteudo();if(el)el.innerHTML="";
}
function ligarSessao(){
  if(typeof raiz._sessaoExpirou==="function"&&!raiz._sessaoExpirou.__cel){
    const e0=raiz._sessaoExpirou;
    raiz._sessaoExpirou=function(){esquecer();return e0.apply(this,arguments);};
    raiz._sessaoExpirou.__cel=true;
  }
  if(typeof raiz._abrirSessao==="function"&&!raiz._abrirSessao.__cel){
    const a0=raiz._abrirSessao;
    raiz._abrirSessao=function(){
      esquecer();const r=a0.apply(this,arguments);
      if(typeof ST!=="undefined"&&ST.pg==="celulares")raiz.celLoad();
      return r;
    };
    raiz._abrirSessao.__cel=true;
  }
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",ligarSessao);else ligarSessao();
const msg=(ov,t,erro)=>{
  if(!document.body.contains(ov)){if(erro&&t)toast("⚠️ "+t);return;} // a janela já foi fechada
  const m=ov.querySelector(".cel-msg");if(m){m.textContent=t||"";m.className="cel-msg"+(erro?" cel-erro":"");}
};
const ocupado=(b,s)=>{if(b){b.disabled=!!s;if(s){b.dataset.txt=b.textContent;b.textContent=s;}else if(b.dataset.txt)b.textContent=b.dataset.txt;}};

/* cadastro / edição */
const CAMPOS_FORM=[
  ["cliente","Cliente (posto)","Ex.: AGUAS CLARAS - PORTARIA"],["modelo","Modelo","Ex.: MOTO G14"],
  ["numero","Número","(19) 98258-6713"],["login_zello","Login Zello",""],
  ["imei1","IMEI 1","15 dígitos"],["imei2","IMEI 2","X se não tiver"],
  ["email","E-mail","conta@gmail.com"]
];
function abrirForm(a){
  const novo=!a,v=a||{tipo:"POSTO",situacao:"ATIVO"};
  const nomes=[...new Set(nomesClientes())].sort((x,y)=>x.localeCompare(y,"pt-BR"));
  const campo=([k,r,ph])=>'<label class="cel-f"><span>'+r+'</span><input name="'+k+'" value="'+esc(v[k]||"")+'" placeholder="'+esc(ph)+'" autocomplete="off"></label>';
  const segredo=k=>{const tem=!novo&&(a.com||[]).indexOf(k)>=0;
    return'<label class="cel-f"><span>'+SEGREDO[k]+'</span><input name="'+k+'" autocomplete="off" spellcheck="false" placeholder="'+(novo?"":tem?"•••••• guardada (em branco = manter)":"vazia")+'"></label>';};
  const ops=(n,l,atual)=>'<select name="'+n+'">'+l.map(([k,t])=>'<option value="'+k+'"'+(atual===k?' selected':'')+'>'+t+'</option>').join("")+'</select>';
  const ov=janela(novo?"Novo aparelho":"Editar aparelho",
    '<form class="cel-form" autocomplete="off">'+
    '<div class="cel-grid">'+campo(CAMPOS_FORM[0])+
      '<label class="cel-f"><span>Tipo</span>'+ops("tipo",[["POSTO","Posto de cliente"],["INTERNO","Uso interno (supervisor, base…)"]],v.tipo)+'</label>'+
      '<label class="cel-f cel-vinc-f"><span>Cliente no sistema</span><input name="cliente_vinculado" list="cel-dl" value="'+esc(v.cliente_vinculado||"")+'" placeholder="em branco = ligar pelo nome" autocomplete="off"></label>'+
      '<label class="cel-f"><span>Situação</span>'+ops("situacao",[["ATIVO","Ativo (no posto)"],["RESERVA","Reserva (na base)"],["BAIXADO","Baixado (saiu de uso)"]],v.situacao)+'</label>'+
      CAMPOS_FORM.slice(1).map(campo).join("")+
      segredo("senha_gmail")+segredo("senha_zello")+segredo("applock")+
    '</div>'+
    '<label class="cel-f cel-obs"><span>Observação</span><textarea name="obs" rows="2">'+esc(v.obs||"")+'</textarea></label>'+
    '<datalist id="cel-dl">'+nomes.map(n=>'<option value="'+esc(n)+'">').join("")+'</datalist>'+
    (!novo&&(a.com||[]).length?'<button type="button" class="cel-link" data-acao="revelar">👁️ Mostrar as senhas guardadas</button>':'')+
    (!novo&&a.atualizado_por?'<div class="cel-quem">Última alteração: '+esc(a.atualizado_por)+(a.atualizado_em?' em '+esc(dataBR(a.atualizado_em)):'')+'</div>':'')+
    '<div class="cel-pe">'+(!novo?'<button type="button" class="rh-btn rh-btn-sec cel-apagar" data-acao="apagar">🗑️ Apagar</button>':'')+
      '<span class="cel-msg" role="status"></span>'+
      '<button type="button" class="rh-btn rh-btn-sec" data-fechar="1">Cancelar</button>'+
      '<button type="submit" class="rh-btn">Salvar</button></div></form>',true);
  const form=ov.querySelector("form");
  const tipoSel=form.elements.tipo,vincF=form.querySelector(".cel-vinc-f");
  const mostraVinc=()=>{vincF.style.display=tipoSel.value==="INTERNO"?"none":"";};
  tipoSel.addEventListener("change",mostraVinc);mostraVinc();
  const revelado={};
  form.addEventListener("click",async e=>{
    const b=e.target.closest("[data-acao]");if(!b)return;
    if(b.dataset.acao==="revelar"){
      ocupado(b,"Buscando…");
      try{const s=await api("senhas","GET",null,"&id="+encodeURIComponent(a.id));
        Object.keys(SEGREDO).forEach(k=>{form.elements[k].value=s[k]||"";form.elements[k].placeholder="vazia";revelado[k]=s[k]||"";});
        b.remove();
      }catch(err){ocupado(b,"");msg(ov,err.message,true);}
    }
    if(b.dataset.acao==="apagar"){
      if(!confirm("Apagar o aparelho "+(a.cliente||a.numero||"")+"?\n\nSe ele só saiu de uso, prefira mudar a Situação para Baixado: o cadastro fica guardado."))return;
      ocupado(b,"Apagando…");
      try{await api("","DELETE",null,"&id="+encodeURIComponent(a.id));fecharSe(ov);toast("🗑️ Aparelho apagado");recarregar();}
      catch(err){ocupado(b,"");msg(ov,err.message,true);}
    }
  });
  form.addEventListener("submit",async e=>{
    e.preventDefault();
    const corpo={};
    ["cliente","tipo","situacao","cliente_vinculado","modelo","numero","login_zello","imei1","imei2","email","obs"].forEach(k=>{
      const val=String(form.elements[k].value||"").trim();
      if(k==="cliente_vinculado"&&form.elements.tipo.value==="INTERNO"){if(!novo&&a.cliente_vinculado)corpo[k]="";return;}
      if(novo){if(val)corpo[k]=val;return;}
      if(val!==String(a[k]==null?"":a[k]).trim())corpo[k]=val;
    });
    Object.keys(SEGREDO).forEach(k=>{
      const val=String(form.elements[k].value||"");
      if(Object.prototype.hasOwnProperty.call(revelado,k)){if(val!==revelado[k])corpo[k]=val;}
      else if(val.trim())corpo[k]=val;
    });
    if(!novo&&!Object.keys(corpo).length){fechar();return;}
    const bt=form.querySelector('button[type="submit"]');ocupado(bt,"Salvando…");msg(ov,"");
    try{
      if(novo)await api("","POST",corpo);else await api("","PATCH",corpo,"&id="+encodeURIComponent(a.id));
      fecharSe(ov);toast(novo?"📱 Aparelho cadastrado":"✅ Aparelho salvo");recarregar();
    }catch(err){ocupado(bt,"");msg(ov,err.message,true);}
  });
  const pri=form.elements[novo?"cliente":"modelo"];if(pri)pri.focus();
}
function dataBR(iso){const t=Date.parse(iso);if(!t)return"";const s=new Date(t-3*3600000).toISOString();return s.slice(8,10)+"/"+s.slice(5,7)+"/"+s.slice(0,4)+" às "+s.slice(11,16);}

/* senhas de um aparelho */
async function verSenhas(a){
  if(!a)return;
  const ov=janela("Senhas · "+(a.cliente||"aparelho"),'<div class="cel-vazio">Buscando…</div>');
  try{
    const s=await api("senhas","GET",null,"&id="+encodeURIComponent(a.id));
    if(!document.body.contains(ov))return;
    ov.querySelector(".cel-c").innerHTML=Object.keys(SEGREDO).map(k=>'<div class="cel-seg"><span>'+SEGREDO[k]+'</span><code>'+(s[k]?esc(s[k]):'<i class="cel-sem">vazia</i>')+'</code>'+(s[k]?'<button type="button" class="cel-link" data-copiar="'+k+'">copiar</button>':'')+'</div>').join("")+
      '<div class="cel-nota">Fica registrado que você viu as senhas deste aparelho.</div>';
    ov.querySelector(".cel-c").addEventListener("click",e=>{
      const b=e.target.closest("[data-copiar]");if(!b)return;
      const v=s[b.dataset.copiar]||"";
      (navigator.clipboard?navigator.clipboard.writeText(v):Promise.reject()).then(()=>{b.textContent="copiado ✓";}).catch(()=>{b.textContent="não deu para copiar";});
    });
  }catch(err){if(document.body.contains(ov))ov.querySelector(".cel-c").innerHTML='<div class="cel-vazio cel-erro">'+esc(err.message)+'</div>';}
}

/* ligar ao cliente do sistema */
function abrirVinculo(a){
  if(!a)return;
  const nomes=nomesClientes().sort((x,y)=>x.localeCompare(y,"pt-BR"));
  const porChave=new Map(nomes.map(n=>[chave(n),n]));
  const sug=sugestoes(a.cliente,nomes,6);
  const ov=janela("Ligar ao cliente do sistema",
    '<div class="cel-txt">Aparelho: <b>'+esc(a.cliente||"(sem nome)")+'</b>. Escolha o cliente da planilha do sistema: é por ele que o número aparece na guia <b>Clientes</b>.</div>'+
    (sug.length?'<div class="cel-sug">'+sug.map(n=>'<button type="button" class="cel-chip" data-nome="'+esc(n)+'">'+esc(n)+'</button>').join("")+'</div>':'')+
    '<label class="cel-f"><span>Cliente no sistema</span><input id="cel-vinc-in" list="cel-dl2" autocomplete="off" value="'+esc(a.cliente_vinculado||"")+'"></label>'+
    '<datalist id="cel-dl2">'+nomes.map(n=>'<option value="'+esc(n)+'">').join("")+'</datalist>'+
    '<div class="cel-pe"><button type="button" class="rh-btn rh-btn-sec" data-acao="interno">É de uso interno</button>'+
    (a.cliente_vinculado?'<button type="button" class="rh-btn rh-btn-sec" data-acao="tirar">Tirar o vínculo</button>':'')+
    '<span class="cel-msg" role="status"></span><button type="button" class="rh-btn" data-acao="ligar">Ligar</button></div>');
  const inp=ov.querySelector("#cel-vinc-in");
  const salvar=async(corpo,b)=>{ocupado(b,"Salvando…");try{await api("","PATCH",corpo,"&id="+encodeURIComponent(a.id));fecharSe(ov);toast("🔗 Aparelho ligado");recarregar();}catch(err){ocupado(b,"");msg(ov,err.message,true);}};
  ov.querySelector(".cel-c").addEventListener("click",e=>{
    const s=e.target.closest("[data-nome]");if(s){inp.value=s.dataset.nome;inp.focus();return;}
    const b=e.target.closest("[data-acao]");if(!b)return;
    if(b.dataset.acao==="ligar"){
      if(!inp.value.trim())return msg(ov,"Escolha um cliente.",true);
      const v=porChave.get(chave(inp.value));
      if(!v)return msg(ov,"Esse nome não está na lista de clientes do sistema.",true);
      salvar({cliente_vinculado:v},b);
    }
    if(b.dataset.acao==="tirar")salvar({cliente_vinculado:""},b);
    if(b.dataset.acao==="interno")salvar({tipo:"INTERNO",cliente_vinculado:""},b);
  });
  inp.focus();
}

// ✓ confirmar a sugestão: vira ligação feita na tela (e passa a aparecer na guia Clientes)
async function confirmarVinculo(id,nome,b){
  ocupado(b,"…");
  try{await api("","PATCH",{cliente_vinculado:nome},"&id="+encodeURIComponent(id));toast("🔗 Ligado a "+nome);recarregar();}
  catch(err){ocupado(b,"");toast("⚠️ "+err.message);}
}

/* importar a planilha CELULARES (o navegador lê; o servidor confere e grava) */
function abrirImportar(){
  const ov=janela("Importar planilha de celulares",
    '<div class="cel-txt">Escolha a planilha (.xlsx) no formato da <b>CELULARES</b>: MODELO, CLIENTES, IMEI 1, IMEI 2, NUMERO, E-MAIL, SENHA GMAIL, LOGIN - ZELLO, SENHA ZELLO e Bloqueio: AppLock — em qualquer ordem.<br>'+
    'A importação só <b>acrescenta</b>: aparelho que já está aqui, digitado igual, é ignorado. Para corrigir um aparelho, edite na tabela.</div>'+
    '<input type="file" id="cel-arq" accept=".xlsx,.xls,.csv">'+
    '<div id="cel-prev"></div><div class="cel-pe"><span class="cel-msg" role="status"></span><button type="button" class="rh-btn rh-btn-sec" data-fechar="1">Cancelar</button></div>',true);
  let linhas=null;
  ov.querySelector("#cel-arq").addEventListener("change",async e=>{
    const arq=e.target.files&&e.target.files[0];if(!arq)return;
    const prev=ov.querySelector("#cel-prev");prev.innerHTML='<div class="cel-vazio">Lendo a planilha…</div>';msg(ov,"");
    if(typeof XLSX==="undefined"){prev.innerHTML="";return msg(ov,"A leitura de Excel ainda está carregando. Tente de novo em alguns segundos.",true);}
    try{
      const wb=XLSX.read(await arq.arrayBuffer(),{type:"array"});
      let ultimoErro=null,j=null;
      for(const nome of wb.SheetNames){ // a primeira aba com o cabeçalho certo
        const l=XLSX.utils.sheet_to_json(wb.Sheets[nome],{header:1,raw:true,defval:""}).map(r=>r.map(c=>c==null?"":String(c)));
        try{j=await api("importar","POST",{linhas:l});linhas=l;break;}catch(err){ultimoErro=err;if(err.codigo!=="PLANILHA")break;}
      }
      if(!j)throw ultimoErro||new Error("Planilha vazia.");
      const p=j.previa;
      prev.innerHTML='<div class="cel-resumo"><div><b>'+p.lidos+'</b> aparelhos na planilha</div><div><b>'+p.novos+'</b> novos para importar</div><div><b>'+p.iguais+'</b> já cadastrados (ficam como estão)</div>'+
        (p.internos?'<div><b>'+p.internos+'</b> marcados como uso interno (supervisor, mesa, RH…) — dá para mudar depois</div>':'')+
        (p.vazias?'<div>'+p.vazias+' linha(s) vazia(s) ignorada(s)</div>':'')+
        '<div class="cel-colunas">Colunas reconhecidas: '+p.colunas.map(c=>esc(c.cabecalho)).join(", ")+(p.naoReconhecidas.length?'<br>Ignoradas: '+p.naoReconhecidas.map(esc).join(", "):'')+'</div></div>'+
        (p.novos?'<button type="button" class="rh-btn" data-acao="confirmar">Importar '+p.novos+' aparelho'+(p.novos>1?'s':'')+'</button>':'<div class="cel-txt">Nada novo para importar.</div>');
    }catch(err){prev.innerHTML="";linhas=null;msg(ov,err.message,true);}
  });
  ov.querySelector(".cel-c").addEventListener("click",async e=>{
    const b=e.target.closest('[data-acao="confirmar"]');if(!b||!linhas)return;
    ocupado(b,"Importando…");
    try{const j=await api("importar","POST",{linhas,confirmar:true});fecharSe(ov);toast("📥 "+j.inseridos+" aparelho(s) importado(s)");CEL.f={q:"",sit:"ATIVO",pend:"",chip:""};recarregar();}
    catch(err){ocupado(b,"");msg(ov,err.message,true);}
  });
}

/* DDD de uma vez */
async function abrirDDD(){
  const ov=janela("Completar o DDD",'<div class="cel-vazio">Contando…</div>');
  const desenhar=async ddd=>{
    try{
      const j=await api("ddd","POST",{ddd});
      if(!document.body.contains(ov))return;
      const p=j.previa;
      ov.querySelector(".cel-c").innerHTML='<div class="cel-txt"><b>'+p.quantos+'</b> número(s) estão sem DDD. Completar todos com:</div>'+
        '<label class="cel-f cel-ddd"><span>DDD</span><input id="cel-ddd" inputmode="numeric" maxlength="2" value="'+esc(ddd)+'"></label>'+
        (p.exemplos.length?'<div class="cel-ex">'+p.exemplos.map(x=>'<div>'+esc(x.cliente||"")+': '+esc(x.antes)+' → <b>'+esc(x.depois)+'</b></div>').join("")+(p.quantos>p.exemplos.length?'<div>… e mais '+(p.quantos-p.exemplos.length)+'</div>':'')+'</div>':'')+
        '<div class="cel-pe"><span class="cel-msg" role="status"></span><button type="button" class="rh-btn rh-btn-sec" data-fechar="1">Cancelar</button>'+
        (p.quantos?'<button type="button" class="rh-btn" data-acao="aplicar">Completar '+p.quantos+'</button>':'')+'</div>';
    }catch(err){if(document.body.contains(ov))ov.querySelector(".cel-c").innerHTML='<div class="cel-vazio cel-erro">'+esc(err.message)+'</div>';}
  };
  await desenhar("19");
  ov.addEventListener("change",e=>{if(e.target.id==="cel-ddd"&&/^\d{2}$/.test(e.target.value))desenhar(e.target.value);});
  ov.addEventListener("click",async e=>{
    const b=e.target.closest('[data-acao="aplicar"]');if(!b)return;
    const ddd=(ov.querySelector("#cel-ddd")||{}).value||"";
    ocupado(b,"Completando…");
    try{const j=await api("ddd","POST",{ddd,confirmar:true});fecharSe(ov);toast("📞 "+j.alterados+" número(s) com DDD");recarregar();}
    catch(err){ocupado(b,"");msg(ov,err.message,true);}
  });
}

/* Excel de backup: tudo, com as senhas, e uma aba com as pendências */
async function exportar(b){
  if(typeof XLSX==="undefined"){toast("A leitura de Excel ainda está carregando. Tente de novo em alguns segundos.");return;}
  if(!confirm("O Excel de backup leva as senhas de todos os aparelhos. Guarde o arquivo num lugar seguro.\n\nGerar agora?"))return;
  ocupado(b,"Gerando…");
  try{
    const j=await api("exportar");
    const cols=j.colunas||[];
    const ap=(j.aparelhos||[]).slice().sort((x,y)=>String(x.cliente||"").localeCompare(String(y.cliente||""),"pt-BR"));
    const linhas=[cols.map(c=>c[1]).concat(["ATUALIZADO EM","ATUALIZADO POR"])].concat(ap.map(a=>cols.map(c=>a[c[0]]==null?"":String(a[c[0]])).concat([a.atualizado_em?dataBR(a.atualizado_em):"",a.atualizado_por||""])));
    const pend=[["CLIENTES","NUMERO","SITUAÇÃO","O QUE FALTA / CONFERIR","TIPO"]];
    ap.forEach(a=>(a.pend||[]).forEach(p=>pend.push([a.cliente||"",a.numero||"",SIT[a.situacao]||a.situacao||"",p.msg,p.tipo==="falta"?"Falta":"Conferir"])));
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(linhas),"Celulares");
    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(pend),"Pendências");
    // download do mesmo jeito dos outros Excel do painel (Blob + link)
    const url=URL.createObjectURL(new Blob([XLSX.write(wb,{bookType:"xlsx",type:"array"})],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}));
    const a=document.createElement("a");a.href=url;a.download="CELULARES-"+new Date(Date.now()-3*3600000).toISOString().slice(0,10)+".xlsx";
    document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),4000);
    toast("📤 Excel gerado");
  }catch(err){toast("Não consegui gerar o Excel: "+err.message);}
  ocupado(b,"");
}
})(typeof window!=="undefined"?window:globalThis);
