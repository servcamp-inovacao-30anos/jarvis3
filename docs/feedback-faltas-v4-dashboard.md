# Feedback de Faltas v4: Visão geral e Desempenho

Pedido do Raphael em 10/11/2026, com as decisões que ele tomou. A referência visual é a imagem do dashboard com
cards em degradê vivo, uma curva de área em destaque e mini-gráficos embaixo. Serve de inspiração, não de cópia.

## O briefing

> **Papel:** você é o time de produto e design sênior do Grupo ServCamp.
>
> **Missão:** transformar o Feedback de Faltas num painel que a diretoria lê em 10 segundos e que o SAC opera sem
> pensar.
>
> **Regra de ouro:** cada número responde a uma pergunta de negócio, está num lugar só e é dito uma vez.
>
> **Visual:**
> - Indicadores em degradê vivo, com sombra na própria cor e tipografia forte nos números.
> - Gráficos desenhados à mão (SVG), com animação de entrada e leitura ao passar o mouse.
> - Nada de dado solto em fundo branco, cor apagada ou texto que não ajuda a decidir.
> - Fundo cinza-claro, para os cards e os gráficos saltarem.

## 1. Estrutura das abas

**Visão geral · Fila do SAC · Monitoramento 30 dias · Desempenho · Histórico**

- No topo continuam a faixa azul-marinho, os filtros de **Turno** e **Área** (valem para tudo) e as abas.
- O filtro de **Período sai do topo**, para não haver a mesma função em vários lugares:
  - Na Visão geral, o período é escolhido acima dos cards.
  - No Histórico, há um filtro de datas próprio.
  - No Desempenho, a escolha é "de mês X até mês Y".
- Os cards de números aparecem **só na Visão geral**.

## 2. Visão geral

**Seletor de período** acima dos cards: **Hoje · Semana · Folha (26 a 25) · Período**.

**O funil das faltas** (pedido do Raphael): quatro cards minimalistas em degradê vivo, em sequência e ligados por
setas. Cada card mostra o número, a % sobre a etapa anterior e os avatares de quem está nele ("+N").

| Etapa | O que conta | Clique |
|---|---|---|
| **1. Faltaram** (azul royal) | As pessoas com falta sem justificativa no período. Uma linha discreta mostra quantas ainda estão sem mensagem e as abonadas, que não entram no funil. | A lista abaixo mostra essas pessoas. |
| **2. Mensagem enviada** (violeta) | Dessas, para quem o SAC mandou WhatsApp, com a % das que faltaram. | A lista mostra para quem foi enviado e quando. |
| **3. Ligaram · feedback registrado** (esmeralda) | Dessas, quem ligou e teve a conversa registrada, com a % das mensagens. São as faltas tratadas: saem da cobrança e passam ao monitoramento. | A lista mostra essas pessoas com o card do monitoramento. |
| **4. Não responderam** (coral) | As que passaram do prazo sem ligar, com a % das mensagens. Embaixo vem quantas ainda estão no prazo. | A lista mostra essas pessoas com Enviar WhatsApp e Registrar feedback. |

Ao lado do funil, um quinto card mais estreito:

| Card | O que mostra | Clique |
|---|---|---|
| **Tempo médio por feedback** (âmbar) | Os minutos por conversa no período. | Sem clique, só a informação. |

**Como a tela funciona:**
- O card clicado fica marcado e a lista abaixo **troca**. O card não expande.
- Ao abrir a aba, vem selecionada a etapa **1. Faltaram**.

**A conta das etapas:**
- Mensagens enviadas = ligaram + não responderam + ainda no prazo.
- O que falta tratar (sem mensagem, no prazo, não respondeu) fica separado do que já foi tratado (ligou e o feedback
  foi registrado).

**No perfil de cada um:** o panorama mostra o mesmo funil da pessoa, com as faltas, as mensagens recebidas, as
ligações com feedback e as mensagens sem resposta, com as datas, somando o histórico da pessoa.

## 3. Desempenho: painel de diretoria com 4 sub-abas

**Controles fixos no alto:**
- Período da folha (26 a 25) ou mês do calendário.
- **De** (mês inicial) e **até** (mês final).
- Turno e área já vêm do topo.

**Regra das contas:**
- Todas as % são sobre as faltas **sem justificativa**. As abonadas aparecem como contexto, nunca misturadas.
- O mês em andamento é sempre marcado como **parcial**.

### 3.1 Resumo executivo

Quatro indicadores em degradê, cada um com o número em destaque e a variação com seta e cor:

1. **Faltas da empresa**: o mês final contra o mês inicial, em %.
2. **Efeito do feedback**: a redução média das faltas de quem recebeu feedback (30 dias antes contra 30 dias depois do
   contato).
3. **Taxa de melhora**: a % de pessoas que faltaram menos depois do feedback.
4. **Projeção do mês**: quantas faltas o mês atual deve fechar mantendo o ritmo até hoje.

**Gráfico principal:** "Faltas sem justificativa, mês a mês".
- Curva suave com área em degradê, pontos nos meses e o valor de cada mês ao passar o mouse.
- O mês atual aparece realizado até hoje, mais o fechamento projetado em tracejado.
- Os próximos 3 meses vêm pela tendência dos últimos 6, em tracejado, com uma faixa de margem.

**Card lateral, "Fechamento projetado":**
- O número grande.
- A comparação com o mês anterior.
- Uma mini-coluna por semana do mês.

**Três mini-cards embaixo, com gráfico de área:** feedbacks registrados por mês, tempo médio por mês e faltas para
tratar por mês.

### 3.2 Efeito do feedback

- **Indicadores:**
  - pessoas que receberam feedback;
  - % que melhorou, % igual e % que piorou;
  - redução média de faltas.
- **Colunas agrupadas por mês do contato:** faltas nos 30 dias antes contra os 30 dias depois, com a projeção dos
  contatos ainda dentro dos 30 dias.
- **Rosca:** Melhorou, Igual e Piorou.
- **Tabela de cada colaborador:**
  - faltas no mês inicial e no mês final, a variação e o resultado;
  - ordenável;
  - clicar abre o panorama.
  - Em destaque, as 5 maiores melhoras e as 5 maiores pioras.

### 3.3 Empresa e áreas

- **Colunas por mês:** sem justificativa e abonadas empilhadas, com a linha de tendência e a projeção.
- **Ranking por área (supervisor):**
  - barras horizontais com as faltas do mês final;
  - a variação contra o mês inicial (seta e cor);
  - o turno da área.
- **Destaques:** a área que mais melhorou e a que mais piorou.

### 3.4 Motivos e atendimento

- **Motivos:** % de cada um sobre as faltas tratadas, em barras horizontais ou rosca.
- **Motivo que mais cresceu** contra o mês anterior.
- **Tempo médio por feedback:**
  - a evolução mês a mês, em linha;
  - por motivo;
  - por pessoa do SAC.

## 4. Sistema visual

- **Fonte:** Plus Jakarta Sans, licença aberta, hospedada em `assets/fonts`, porque a política de segurança só
  aceita fonte do próprio sistema.
  - Números em 700 e 800, com algarismos tabulares.
  - Rótulos em 500 e 600.
- **Fundo do painel:** cinza-claro #EEF1F6. Cards brancos com sombra suave em duas camadas e raio de 16 px.
- **Degradês dos indicadores**, cada um com sombra colorida na própria cor:

  | Cor | De | Para |
  |---|---|---|
  | Azul royal | #2563EB | #1E3A8A |
  | Coral | #FB7185 | #E11D48 |
  | Âmbar | #FBBF24 | #EA580C |
  | Esmeralda | #34D399 | #059669 |
  | Violeta | #A78BFA | #6D28D9 |

- **Gráficos:**
  - SVG próprio, sem biblioteca externa.
  - Grade discreta e eixos com poucos rótulos.
  - Animação de entrada (o traço se desenha e as colunas sobem).
  - Ao passar o mouse, uma etiqueta com o valor exato.
  - A projeção sempre em tracejado e com a legenda "projeção".
- **Interações:** cards sobem 2 px no hover, há foco visível no teclado e o movimento é reduzido quando o sistema pede.
- **Sem emoji. Sem texto redundante.** Cada indicador tem o rótulo, o número, a variação e um contexto de no máximo
  uma linha.

## 4.1 Calendário do panorama (decidido em 10/11/2026)

- **Dia sem falta:** verde.
- **Falta sem justificar:** vermelho.
- **Abonada:** azul.
- **Dia do contato:** anel azul-marinho, para não confundir com a abonada.
- **Mensagem do SAC:** um ponto lilás no canto do dia.

Nos gráficos do Desempenho, as abonadas seguem o mesmo azul claro.

## 5. Definições precisas

| Termo | Definição |
|---|---|
| Falta para tratar | Código I: injustificada, sem feedback baixado, ainda na cobrança. |
| Falta já tratada | Código T: injustificada de quem teve o feedback registrado e baixado. Fica fora da cobrança. |
| Abonada | Códigos A, J, L e AF. Não entram nas %. |
| Melhorou | Nos 30 dias depois do contato, menos faltas que nos 30 dias antes, ou nenhuma. É avaliado só com 7 dias ou mais desde o contato. |
| Redução média | A soma das faltas depois de todos os contatos avaliados, comparada à soma das faltas antes. |
| Fechamento projetado | As faltas do mês até hoje ÷ os dias passados × os dias do mês. |
| Tendência | A reta de mínimos quadrados dos últimos 6 meses fechados, projetada 3 meses à frente. A faixa é ± o desvio dos resíduos. |
