# Medida disciplinar pelo JARVIS: plano

Proposta do Raphael (26/10/2026), discutida e decidida nesta conversa.

## Onde estamos (26/10/2026, à noite)

Feito nesta branch (`feature/medida-disciplinar`), com testes em `test/medida.test.js`:

- **E-mail semanal** (Fase 1): embaixo de cada colaborador, o resumo do ano; depois da tabela, a tabela **"Reincidência no ano"** (faltas injustificadas e medidas desde 01/01, última medida e o selo Reincidente / 1 medida / Sem medida) e o botão **"Abrir no Painel ServCamp"**. O endereço do botão vem de `PAINEL_URL` na Vercel ou é guardado sozinho quando o Raphael abre o painel do aviso (só https). Sem endereço, o e-mail sai sem o botão.
- **Gerar medida** (Fase 2), na tela Faltas da Supervisão: botão em cada falta em aberto → editor com o histórico do colaborador, tipo (advertência verbal, advertência escrita, suspensão + dias), datas, empresa (vem da última planilha), as faltas da ocorrência e as situações (o motivo se monta sozinho e pode ser reescrito) e o **documento A4 mudando ao vivo**. Confirma, recebe o número `MD-AAAA-NNNN` e imprime ou salva em PDF.
- **Rastreio**: cada medida gerada é registrada em nome de quem gerou (`fm_auditoria`, entidade `fm_medida_gerada`). Aba **"Medidas geradas"**: falta lançar / lançadas / canceladas, separadas por supervisor; a coordenação vê todas. A medida sai de "falta lançar" sozinha quando a planilha diária trouxer a medida do mesmo colaborador (a partir de 3 dias antes da geração), ou quando alguém marca "Já lancei no SAR2G". Cancelar exige motivo e o registro fica.
- **Lembrete no perfil**: quem gerou e ainda não lançou vê "N medidas para lançar no SAR2G" no menu (a coordenação vê o total) e um aviso ao entrar.
- **Quem gera** (decidido): Raphael, Jussilene e João (todas as áreas) e os supervisores (só a área deles). A checagem é no servidor (`api/_medida_regras.js`).
- A interface fica em `assets/medida/` (o `index.html` está no limite de tamanho) e se encaixa nas funções da tela dos supervisores.
- **Documento assinado** (27/10): em "Medidas geradas", "Anexar assinado" recebe a foto (reduzida no próprio aparelho para até ~2 MB) ou o PDF do documento assinado pelo colaborador. Fica registrado quem anexou e quando; dá para trocar e tirar. O arquivo fica na `fm_auditoria` (ação `MEDIDA_ASSINADA`) e só desce quando alguém abre. Filtro "Sem documento assinado". Anexa quem gerou, a coordenação ou o supervisor da área.
- **Resumo semanal para a coordenação** (27/10): no painel do aviso por e-mail, seção "Resumo semanal para a coordenação" — quem recebe (a Jussilene), ligar/desligar, prévia, teste e envio da semana. Ligado, sai na rodada automática das segundas (com o automático do aviso ligado), uma vez por semana: o que falta lançar no SAR2G (da mais antiga para a mais nova), por supervisor (falta lançar, mais antiga, geradas e lançadas na semana, sem assinatura) e o que está sem documento assinado. Botão para a aba "Medidas geradas".

Falta:

1. **Modelo oficial de advertência** (o Raphael manda em 27/10). Até lá, advertência escrita e verbal saem num modelo provisório no mesmo formato da suspensão (`docHtml` em `assets/medida/medida.js`).
2. **Importar as faltas desde 01/01** (o arquivo `faltas injustificadas desde 01-01.xlsx` ainda não está na PR). Enquanto isso, a contagem de faltas do ano no e-mail e no editor começa em 01/06/2026, quando o módulo passou a guardar as faltas.

Contexto: o aviso semanal por e-mail (`api/_faltas_email.js`) já manda a cada supervisor as faltas injustificadas da área. A apuração já tira demitidos, abonos, declarações e afastamentos (`docs/faltas-apuracao.md`). O que falta é ajudar o supervisor a decidir **qual** medida aplicar e a gerar o documento.

## Regras decididas

- **Quem decide a medida é o supervisor.** O sistema não cria regra de infração nem decide a medida: toda falta injustificada enviada já é passível de medida. A "escada" da empresa (1ª advertência escrita, 2ª suspensão de 1 dia, 3ª suspensão de 2 a 3 dias... até justa causa) é só contexto; não vira regra no sistema.
- **O histórico é para informar, de forma objetiva:** quantas medidas o colaborador já tomou no ano, de que tipo, quando e por quê. **Advertência verbal também conta** no histórico.
- **Período do histórico de medidas:** desde 01/01 do ano atual (como a aba Histórico).
- **O SAR2G continua sendo o sistema principal.** O documento gerado no JARVIS não substitui o lançamento no SAR2G; o supervisor ainda precisa lançar lá.
- **Rastreio para a coordenação:** toda medida gerada fica registrada (quem gerou, quando, colaborador, tipo, dias, data, motivo, posto) e aparece como **"gerada, ainda não lançada no SAR2G"** até a planilha diária trazer a medida (aba DISCIPLINA). Assim nada deixa de ser lançado.

## Fase 1: histórico do colaborador no e-mail semanal

Em cada colaborador do aviso (uma linha por pessoa, como hoje), acrescentar:
- medidas no ano: quantas e de que tipo (advertência verbal, advertência escrita, suspensão com os dias) e a última (tipo + data);
- faltas injustificadas no ano (já sem abonadas, afastamentos e demitidos).

Fonte: a mesma de `verHistorico` em `api/_faltas.js` (`fm_medidas` desde 01/01, `dedupMedidas`, canceladas não contam; `fm_faltas` com `codigo = 'I'` desde 01/01). Casar por RE + primeiro nome (o RE se repete entre as empresas do grupo; ver `R.primeiroNome`).

Onde mexer: `faltasDoPeriodo` / montagem do e-mail em `api/_faltas_email.js` e o HTML em `api/_faltas_email_html.js`. Testes em `test/faltas_email.test.js`.

## Fase 2: tela "Gerar medida" (dentro do dashboard)

O e-mail leva um link para a tela dos supervisores (já existe: `#pg-faltassup`, `fsRender` no `index.html`, cada supervisor vê a sua área). Em cada caso de falta injustificada, um botão **Gerar medida**:

1. Abre um formulário com: tipo (**Advertência verbal**, **Advertência escrita**, **Suspensão** + quantidade de dias), data de início, motivo (texto livre, já preenchido com "faltou sem justificativa em dd/mm" e editável) e o histórico do colaborador ao lado (Fase 1).
2. O documento é montado na hora, conforme a escolha (ver modelo abaixo), e pode ser impresso ou salvo em PDF (`window.print()` com folha de impressão, sem dependência nova).
3. Ao gerar, grava um registro (sugestão: `fm_auditoria`, ação `MEDIDA_GERADA`, sem tabela nova, mesmo padrão dos atestados em `salvarAtestado`): `{ re, nome, tipo, grau, dias, inicio, motivo, posto, caso (re|primeiraFalta), supervisor }`.
4. A coordenação vê a lista **"Medidas geradas, falta lançar no SAR2G"** (quem gerou, colaborador, tipo, dias, data, motivo, posto). A medida sai da lista sozinha quando a planilha diária traz uma medida do mesmo RE com data a partir da geração (aba DISCIPLINA → `fm_medidas`). Também dá para marcar "lançada" à mão.

Quem pode gerar (confirmado pelo Raphael em 26/10/2026): ele, a coordenadora Jussilene, o João e os supervisores, cada supervisor só para a área dele.

## Modelo oficial (transcrito do PDF enviado em 26/10/2026)

Variáveis entre `{ }`. O PDF enviado é o de **suspensão**; falta o de **advertência** (pedir ao Raphael).

```
                         {EMPRESA}                       ← ex.: SERV CAMP TERCEIRIZAÇÃO / SERV CAMP FACILITES / SERV CAMP PJ

        AVISO DO EMPREGADOR PARA SUSPENDER O EMPREGADO DO SERVIÇO

RE: {RE} – {NOME}

Na conformidade da Consolidação das leis do trabalho pelo presente o notificamos que a partir de
{DATA_INICIO} esta suspenso de suas atividades pelo período de {DIAS} dia (s) pelo seguinte motivo:

MOTIVO DA SUSPENSÃO                                       ← sublinhado, negrito (sem repetir nome e RE, que já estão acima)

{MOTIVO}                                                  ← texto do supervisor, maiúsculas, sublinhado, negrito, justificado

Não só esperamos que tome as necessárias providências a fim de que não se repita (m) a (s)
irregularidade (s) acima discriminada (s), como também aproveitamos para esclarecer-lhes que a
repetição ou a prática de outra Prevista em nossos Regulamentos, Ordens de Serviços, etc., irá
contribuir desfavoravelmente em seu progresso nesta Empresa, além de poder acarretar-lhe penalidades
mais severas, conforme preceitua as disposições do Artigo 482 e suas alíneas da Consolidação das
leis do trabalho.

Campinas, {DATA_DOCUMENTO}                       atenciosamente

CIENTE: ____/____/______                         ______________________________
                                                 ASSINATURA DO EMPREGADOR
                                                 TESTEMUNHA:
___________________________________              Nome: __________________________
Assinatura do Colaborador                        Doc.: __________________________
                                                 TESTEMUNHA;
                                                 Nome: __________________________
                                                 Doc: ---------------------------
```

Personalização pedida: ao escolher **Advertência**, o título e o texto passam a falar de advertência (sem dias); ao escolher **Suspensão**, aparece "suspensão" e a quantidade de dias. Nome, RE e o motivo digitado pelo supervisor sempre aparecem. Fonte: Arial, título centralizado em negrito, corpo justificado, A4.

A empresa do cabeçalho vem do colaborador (`EMPRESA` da aba FUNCIONARIOS ATIVOS; no relatório de faltas, `EMPRESAFUNC`).

## Faltas injustificadas desde 01/01 (relatório do SAR2G recebido em 26/10/2026)

Arquivo `faltas injustificadas desde 01-01.xlsx`, aba `Planilha1`: 2.630 linhas, de 01/01 a 26/10/2026, 424 pessoas, três empresas. Uma linha por falta. Colunas usadas: `EMPRESAFUNC`, `RE`, `NOMEFUNC`, `DATAPONTO`, `ESCALA`, `CARGO`, `AREASUPER`, `NOMELOCAL`, `FALTASINJUSTIFICADAS` (sempre 1 neste arquivo). Sem linhas repetidas.

Plano de importação (ainda não feito):
- Pelo botão **Enviar histórico**, reconhecendo o arquivo pelas colunas `DATAPONTO` + `FALTASINJUSTIFICADAS`.
- Só entram as datas **antes da primeira falta que o módulo já tem** (hoje 01/06/2026); de 01/06 em diante o módulo já tem as faltas, apuradas.
- Entram em `fm_faltas` com `codigo = 'I'` e marcadas como histórico (sugestão: `tipo = 'HISTORICO'`), e passam pela mesma conferência (demitidos, abonos, afastamentos: `reapurarComBanco`).
- **Não abrem caso nem vão para o e-mail:** `verCasos` deve ignorar `tipo = 'HISTORICO'` (a janela de 150 dias pega o fim de maio). Contam só no histórico do colaborador (`verHistorico`).
- Mesmas regras de módulo: escalas 5X2, 6X1 e 12X36 (`R.familiaEscala`); "DIA SIM DIA NÃO", 3X4 etc. ficam de fora, como na planilha diária.

## Ordem combinada

1. Importar as faltas desde 01/01 (só histórico) e colocar o histórico de medidas no e-mail semanal (Fase 1).
2. Tela "Gerar medida" + rastreio da coordenação (Fase 2), depois de receber o modelo de **advertência** e confirmar quem pode gerar.
