// api/_bdv_regras.js — regras puras do relatório de coberturas do supervisor (BDV).
// Prefixo "_" → não vira rota. O bloco abaixo é copiado igual no index.html.

/*ini bdvRegras*/
/* Coberturas do supervisor (BDV): a que horas ele chegou ao posto, comparado
   com o horário de início da vaga que precisava de cobertura.
   ESTE BLOCO É IGUAL em api/_bdv_regras.js e no index.html (um teste confere).

   O horário de referência, nesta ordem:
     1. falta no mesmo posto e no mesmo dia → horário da vaga de QUEM FALTOU
        (campo HORARIO da falta; nas planilhas antigas, a JORNADA da pessoa nos
        ativos, se ela for daquele posto). Cada falta casada é um registro:
        duas pessoas faltaram no posto, são duas coberturas.
     2. ida sem falta (férias, agenda, posto vago…) → horários de início do
        posto: o último turno que já tinha começado na chegada; chegou antes de
        qualquer turno, vale o primeiro (chegou antes do horário).
   Sede da empresa e textos livres ("deixar colaborador em casa") não são posto:
   ficam à parte, fora da conta. */
const BDV_LIMITES={noPrazo:60,grave:180}; // minutos depois do início
/* Planilha de referência "Horário de início dos clientes" (portaria e limpeza): cobre os postos sem JORNADA nos ativos. */
const BDV_JORNADAS_REF={"ACDC CAMPINAS":["06:40","07:00","09:00"],"AIMARA":["08:00"],"ANAKEL":["07:30"],"ANALISE EMPRESARIAL":["07:00"],"APEX SCIENCE":["06:00","07:00"],"ASK":["06:00"],"BANCO ABC BRASIL":["06:00","18:00"],"BIODUX":["07:00"],"CCL PARANA":["06:30"],"CELSO CHARURI DE CAMPINAS":["07:30"],"CLINICA ESCALADA":["07:00"],"CLINICA ESCALADA UNID. 02":["07:00"],"CLINICA HALAM":["07:00","09:00"],"CLINICA IGCC":["06:00","08:42"],"COLOMARTI":["07:30"],"COLOMARTI INDAITUBA":["07:00"],"COND - ÁGUA BRANCA":["06:00","07:00","08:00","18:00"],"COND - ALECRINS":["07:00"],"COND - ALTO CAMBUÍ":["06:00","08:30","18:00"],"COND - AMBIANCE RESIDENCE IV":["06:30","18:30"],"COND - ARARUAMA":["08:00"],"COND - ARBORETO":["07:00"],"COND - ARCO VERDE":["08:30"],"COND - AVANT GARDE":["06:00","18:00"],"COND - BAIA DE GUANABARA":["06:00","08:00","18:00"],"COND - CAMBORIU":["08:00"],"COND - CAMBUÍ":["08:00"],"COND - CAMBUI SQUARE":["06:00","18:00"],"COND - CARMEM LIDIA":["08:00"],"COND - CASAS D ITALIA VILLA BELLA":["06:00","18:00"],"COND - CENTER VILLE":["07:00"],"COND - CHACARA PRIMAVERA":["06:00","08:00","18:00"],"COND - COLISEU":["06:00","08:00","18:00"],"COND - COMERCIAL RIACHUELO":["08:00"],"COND - CONQUISTA":["06:00","08:00","18:00"],"COND - CRISTAIS":["08:00"],"COND - DELLOS 1":["08:00"],"COND - DOM NERY":["07:00"],"COND - ECO RESIDENZA":["06:00"],"COND - ECOWAY":["06:00","07:00","08:00","18:00"],"COND - EDIFICIO JOAO PUPO":["07:00"],"COND - FELICITY":["06:00","18:00"],"COND - FORTE ITAMARACA":["07:00","10:00","20:30"],"COND - FORTE SAO JOAQUIM":["08:30"],"COND - GIARDINO D ITALIA":["06:00","18:00"],"COND - GIBRALTAR":["22:00"],"COND - GOIAS":["06:00","08:00","14:00"],"COND - HARAS BELA VISTA":["06:00","18:00"],"COND - IBIRA":["08:00"],"COND - IDYLLE CAMBUI":["06:00","07:00","18:00"],"COND - JEQUITIBAS I":["06:40"],"COND - LAGUNA":["07:00"],"COND - LAUERZ":["07:00"],"COND - LIVING CELEBRATION":["06:00","08:00","09:00","18:00"],"COND - LONDON LOFT":["07:00"],"COND - LONDON PARK":["08:00"],"COND - LUMINI 3":["06:00","08:00","18:00"],"COND - MAIS MIRASSOL":["08:00"],"COND - MAISON RENOIR":["06:00","07:00","18:00"],"COND - MAISON RENOIR P. PRADO":["06:00","18:00"],"COND - MENDES":["08:00"],"COND - MONICA":["08:00"],"COND - NATUS HOME":["06:30","08:00","18:30"],"COND - PARQUE DOS PÁSSAROS":["06:00","08:00","18:00"],"COND - PARQUE ECOLÓGICO":["06:00","07:00","10:00","18:00"],"COND - PATEO DAS INDAIAS":["07:30"],"COND - PEDRA BELLA":["08:00"],"COND - PERNAMBUCO":["06:30","07:10","18:30"],"COND - POEMA":["06:00","07:00","07:20","18:00","19:00"],"COND - PORTAL DAS AMOREIRAS":["06:00","08:00","18:00"],"COND - PQ QUARESMEIRA":["06:00","18:00"],"COND - PRAIA DO FAROL":["06:00","08:00","18:00"],"COND - RAQUEL MENDONCA":["06:00","07:00","18:00"],"COND - RAVENNA":["08:00"],"COND - RESIDENCIAL LUGANO":["06:00","08:00","18:00"],"COND - REVIVA":["06:00","07:50","18:00"],"COND - ROSSI AVILA":["06:00","07:00","18:00"],"COND - SAMAMBAIA":["06:00","08:00","18:00"],"COND - SANTA GENEBRA I":["06:00","08:00","18:00"],"COND - SANTOS DUMONT II":["08:00"],"COND - SOLEIL":["08:00"],"COND - TANGARA":["06:00","08:00","18:00"],"COND - TONS DO MORUMBI":["06:00","08:00","18:00"],"COND - TORRE DO CASTELO":["06:00","07:00","18:00"],"COND - VENEZA":["06:00","07:00","18:00"],"COND - VERNISSAGE":["06:00","08:00","18:00"],"COND - VICTORIA":["14:00"],"COND - VILA ODILA":["08:00"],"COND - VILA ROMANA":["06:00","18:00"],"COND - VILA SICILIANA":["08:00"],"COND - VILLA FLORA HORTOLANDIA":["07:00","09:00","19:00"],"COND - VILLAGE MONET":["06:00","08:00","18:00"],"COND - VILLAGE RUGENDAS":["06:00","07:00","09:50","18:00"],"COND - VILLAGIO DI MILANO":["06:00","07:30","18:00"],"DISTRITO INDUSTRIAL":["06:00","18:00"],"DURST":["08:00"],"EETAD":["06:00","18:00"],"EQUITRONIC EQUIPAMENTOS":["06:00","06:30","11:50"],"FEV":["07:00"],"GUABI NUTRICAO":["06:30"],"IGREJA DO NAZARENO CENTRAL":["20:00"],"JACSYS SISTEMAS":["07:30"],"KADANT":["06:00","07:42","18:00"],"MATTOSO EXTRATO NATURAIS LTDA":["07:00"],"OFTALMOLOGIA SIGNORELLI":["07:00"],"OSSEA TECHNOLOGY":["07:30"],"PEDRAS & POLIMENTOS":["07:00"],"RSB PLASTICOS":["07:00"],"SHMB":["08:00"],"SUL CORTE":["07:00","07:30","08:00"],"SUPPORT DO BRASIL":["07:30"],"VITA COMPONENTES":["07:20"]};
const BDV_SEDE=["SERV CAMP TERCEIRIZACAO"];
function bdvNorm(s){return String(s==null?"":s).normalize("NFD").replace(/[̀-ͯ]/g,"").toUpperCase().replace(/\s+/g," ").trim();}
function bdvHoraMin(h){const m=String(h==null?"":h).match(/(\d{1,2}):(\d{2})/);if(!m)return null;const v=+m[1]*60+ +m[2];return v<1440?v:null;}
function bdvMinHora(v){return v==null?null:String(Math.floor(v/60)).padStart(2,"0")+":"+String(v%60).padStart(2,"0");}
/* "12H 06:00 - 18:00 S/ INT" → 360 */
function bdvJornadaIni(j){const m=String(j||"").match(/(\d{1,2}):(\d{2})\s*[-–]\s*\d{1,2}:\d{2}/);return m?+m[1]*60+ +m[2]:null;}
/* duração do dia do supervisor: "1/1/00 10:28" ou "10:28" → 628 (o último hh:mm do texto) */
function bdvTempoMin(t){const m=String(t||"").match(/(\d{1,3}):(\d{2})(?::\d{2})?\s*$/);return m?+m[1]*60+ +m[2]:null;}
function bdvTurnosPostos(ativos,ref){
  const m={},poe=(p,v)=>{if(!p||v==null)return;(m[p]=m[p]||[]).indexOf(v)<0&&m[p].push(v);};
  (ativos||[]).forEach(a=>poe(bdvNorm(a.LOCAL),bdvJornadaIni(a.JORNADA)));
  Object.keys(ref||{}).forEach(p=>(ref[p]||[]).forEach(h=>poe(bdvNorm(p),bdvHoraMin(h))));
  Object.keys(m).forEach(k=>m[k].sort((x,y)=>x-y));
  return m;
}
/* diferença chegada − início; passou da meia-noite (vaga 22:00, chegada 00:30) conta como depois */
function bdvDiferenca(cheg,ini){if(cheg==null||ini==null)return null;let d=cheg-ini;if(d<-720)d+=1440;return d;}
function bdvClassifica(d){
  if(d==null)return"SEM_HORARIO";
  if(d<0)return"ANTES";
  if(d<=BDV_LIMITES.noPrazo)return"NO_PRAZO";
  if(d<=BDV_LIMITES.grave)return"ATRASO";
  return"GRAVE";
}
function bdvMontar(bdv,faltas,ativos,coberturas,ref){
  const turnos=bdvTurnosPostos(ativos,ref);
  const porRE={};(ativos||[]).forEach(a=>{if(a.RE!=null&&a.RE!=="")porRE[String(a.RE).trim()]=a;});
  const conhecidos=new Set(Object.keys(turnos));
  const fPorChave={},mPorChave={};
  (faltas||[]).forEach(f=>{const p=bdvNorm(f.LOCAL),d=String(f.DATA||"").slice(0,10);if(!p||!d)return;conhecidos.add(p);(fPorChave[p+"|"+d]=fPorChave[p+"|"+d]||[]).push(f);});
  (coberturas||[]).forEach(c=>{const p=bdvNorm(c.LOCAL),d=String(c.DATA||"").slice(0,10);if(!p||!d)return;conhecidos.add(p);const k=p+"|"+d;let mo=String(c.MOTIVO||"").trim().toUpperCase().replace(/^COBERTURA (DE )?/,"");if(!mo)return;if(mo==="FALTAS")mo="FALTA SEM REGISTRO";(mPorChave[k]=mPorChave[k]||[]).indexOf(mo)<0&&mPorChave[k].push(mo);});
  const iniDaFalta=f=>{
    const h=bdvHoraMin(String(f.HORARIO||"").split(/[–-]/)[0]);if(h!=null)return{ini:h,fonte:"FALTA"};
    const a=porRE[String(f.RE==null?"":f.RE).trim()];
    if(a&&bdvNorm(a.LOCAL)===bdvNorm(f.LOCAL)){const j=bdvJornadaIni(a.JORNADA);if(j!=null)return{ini:j,fonte:"JORNADA"};}
    return null;
  };
  const iniDoPosto=(p,cheg)=>{const t=turnos[p];if(!t||!t.length||cheg==null)return null;let ini=null;t.forEach(v=>{if(v<=cheg)ini=v;});return{ini:ini==null?t[0]:ini,fonte:"POSTO"};};
  const visitas={},out=[];
  (bdv||[]).forEach((r,i)=>{
    const p=bdvNorm(String(r.DESTINO||"").split("/")[0]),d=String(r.DATA||"").slice(0,10);
    const v={i,r,p,d,cheg:bdvHoraMin(r.HORARIO),usada:false};
    if(!p||BDV_SEDE.indexOf(p)>=0||!conhecidos.has(p)){out.push(bdvRegistro(v,null,null,"NAO_E_POSTO",null));return;}
    (visitas[p+"|"+d]=visitas[p+"|"+d]||[]).push(v);
  });
  Object.keys(visitas).forEach(k=>{
    const vs=visitas[k];
    (fPorChave[k]||[]).forEach(f=>{
      const fi=iniDaFalta(f);
      // mais de uma ida ao posto no dia: a que chegou mais perto do início da vaga
      let v=vs[0];
      if(fi&&vs.length>1)vs.forEach(x=>{const a=bdvDiferenca(x.cheg,fi.ini),b=bdvDiferenca(v.cheg,fi.ini);if(a!=null&&(b==null||Math.abs(a)<Math.abs(b)))v=x;});
      v.usada=true;
      const ref=fi||iniDoPosto(v.p,v.cheg);
      out.push(bdvRegistro(v,ref,f,"FALTA",null));
    });
    vs.filter(v=>!v.usada).forEach(v=>out.push(bdvRegistro(v,iniDoPosto(v.p,v.cheg),null,(mPorChave[k]||[]).join(" + ")||"SEM MOTIVO REGISTRADO",null)));
  });
  return out.sort((a,b)=>a.data.localeCompare(b.data)||String(a.chegada).localeCompare(String(b.chegada))||a.chave.localeCompare(b.chave));
}
function bdvRegistro(v,ref,f,motivo){
  const r=v.r,ini=ref?ref.ini:null,dif=motivo==="NAO_E_POSTO"?null:bdvDiferenca(v.cheg,ini);
  const km=parseFloat(String(r.KM==null?"":r.KM).replace(",","."));
  const sup=String(r.NOME||"—").trim()||"—",dest=String(r.DESTINO||"—").trim()||"—",ch=bdvMinHora(v.cheg);
  return{
    chave:[v.d,bdvNorm(sup),bdvNorm(dest),ch||"",f&&f.RE!=null&&f.RE!==""?String(f.RE).trim():"-"].join("|"),
    data:v.d,supervisor:sup,destino:dest,posto:v.p||null,chegada:ch,inicio:bdvMinHora(ini),
    fonte_inicio:ini==null?null:ref.fonte,diferenca_min:dif,
    situacao:motivo==="NAO_E_POSTO"?"NAO_E_POSTO":bdvClassifica(dif),
    motivo:motivo==="NAO_E_POSTO"?null:motivo,
    falta_re:f&&f.RE!=null&&String(f.RE).trim()!==""&&!isNaN(+f.RE)?+f.RE:null,
    falta_nome:f?(f.NOME||null):null,falta_abono:f?(String(f.ABONO||"").trim()||null):null,
    km:isFinite(km)?km:null,tempo_min:bdvTempoMin(r.TEMPO)
  };
}
/*fim bdvRegras*/

module.exports={BDV_LIMITES,BDV_JORNADAS_REF,BDV_SEDE,bdvNorm,bdvHoraMin,bdvMinHora,bdvJornadaIni,bdvTempoMin,bdvTurnosPostos,bdvDiferenca,bdvClassifica,bdvMontar,bdvRegistro};
