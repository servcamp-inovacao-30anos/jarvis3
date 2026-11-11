# Sistema visual do Feedback de Faltas

Aplicado em 05/11/2026 no módulo Feedback de Faltas. Base: a identidade que o dashboard já tem (o módulo Faltas x Medidas é a referência) mais as diretrizes do repositório [axiaoge2/Apple-Hig-Designer](https://github.com/axiaoge2/Apple-Hig-Designer) (licença MIT).

## Princípios

1. **Clareza.** Cada tela responde uma pergunta. Quem preciso avisar? Quem está esperando ligar? Quem a coordenação chama? Como está quem já conversou?
2. **Deferência.** Fundos sólidos, bordas finas, cor só onde há significado (vermelho = alerta real, âmbar = atenção, verde = ok, violeta = pasta da coordenação).
3. **Profundidade com propósito.** Sombra e movimento mostram hierarquia (resumo, abas fixas, janelas), nunca decoração.
4. **Consistência com o dashboard.** Mesma família (Segoe UI), mesmo azul `#1d6fc4`, mesmo navy `#1e3a5f`, mesmos controles de 36 px e raios 8/12 do Faltas x Medidas. Claro e escuro herdam as variáveis `--wh` e `--g*` do sistema.

## Layout (refeito em 10/11/2026: simples, direto, uma situação por vez)

O módulo não segue a estrutura dos outros: o layout nasce do trabalho do SAC. O SAC manda uma mensagem pedindo que a pessoa ligue; a tela mostra **quem está em cada etapa**, em quatro contadores que também são as abas:

Mandar mensagem → Aguardando retorno → Chamar na base → Acompanhando 30 dias. O histórico de contatos é um botão ao lado da busca.

- **Pessoas são cards, não linhas.** Cada card tem uma ação principal (enviar mensagem, registrar que ligou, registrar a conversa) e leva a situação em um selo.
- **O acompanhamento é uma análise.** O card mostra o veredito, a faixa de 30 dias com cada falta marcada, faltas antes x depois e quem falou com a pessoa. Clicar abre o **panorama** em painel lateral, com a lista de cards ainda visível atrás.
- **O registro tem duas escolhas** ("Falei com a pessoa" / "Não consegui falar") e só mostra os campos de cada caso.
- Cores por significado: azul = trabalho novo, âmbar = esperando, vermelho = coordenação ou piora, verde = melhora.

Vocabulário: "Retirar da cobrança" (a baixa), "Voltar para a cobrança" (desfazer), "Faltou de novo" (piorou), "Não respondeu" (mensagem vencida sem ligação).

## Tokens (prefixo `--fb-`)

| Grupo | Valores |
|---|---|
| Cores | texto `--g800`, secundário `--g600`, apoio `#5d6f86` (contraste 4,9:1), marca `#1d6fc4`, navy `#1e3a5f` |
| Situação | `t-da` vermelho `#e5322d`, `t-am` âmbar `#f5b000`, `t-ok` verde `#079455`, `t-vi` violeta `#7a5af8`, `t-gr` cinza `#98a2b3`, `t-br` azul |
| Tipografia | título 1,5 rem/700, título de janela 1,125 rem/700, nome na lista 0,9375 rem/600, corpo 0,875 rem, apoio 0,8125 rem, mínimo 0,6875 rem (só rótulos em caixa alta) |
| Espaçamento | grade de 4/8 px: 8, 12, 16, 20, 24 |
| Raios | 8 (controles), 12 (cartões, listas), 16 (janelas) |
| Alvos | 36 px com mouse, 44 px em toque (`pointer: coarse`) |
| Foco | anel de 4 px `--fb-ring` em todo controle |
| Movimento | 120 / 200 / 320 / 560 ms; saída suave `cubic-bezier(.22,1,.36,1)`; mola `cubic-bezier(.34,1.32,.64,1)` só em janelas e no interruptor |

## Movimento

- Entrada das linhas e dos cartões em cascata (32 ms por item, no máximo 14), subida de 12 px com fade.
- Parallax no cabeçalho: o brilho de fundo, o título e o resumo andam em velocidades diferentes do conteúdo (variável `--fb-sy`, atualizada por `requestAnimationFrame` com listener passivo).
- Abas fixas ganham sombra ao grudar; o sublinhado da aba ativa cresce a partir do centro.
- Números do resumo contam de 0 até o valor; barras de progresso crescem da esquerda.
- Janelas entram com mola leve e saem em 160 ms; o painel lateral (perfil) desliza.
- `prefers-reduced-motion`: sem deslocamento, sem animação contínua, só mudanças de estado instantâneas.

## Regras de conteúdo

- Nenhum emoji, nem na tela nem na mensagem padrão do WhatsApp (teste automático confere).
- Ícones em SVG de traço único (`FB_IC` em `index.html`).
- Botões levam só números (índice da lista), nunca texto vindo do banco; todo texto dinâmico passa por `_esc`.

---

## Engenharia de prompt (versão para reutilizar)

```
PAPEL
Você é um engenheiro front-end sênior (15+ anos, ex-equipe de design de interface da Apple), responsável
pelo módulo "Feedback de Faltas" do dashboard JARVIS do Grupo ServCamp (HTML/CSS/JS puro em um único
index.html; Vercel; Supabase). O módulo é usado todos os dias pelo SAC e pela coordenação.

OBJETIVO
Refazer a experiência visual do módulo: hierarquia, tipografia, botões, cards, listas, janelas, fluxo e
movimento. Tom corporativo enterprise, calmo e confiável. Fácil de entender por qualquer pessoa na primeira
vez que abre. Linguagem simples, direta, específica (nunca genérica).

IDENTIDADE (NÃO NEGOCIÁVEL)
Reutilize a identidade que o dashboard já tem: Segoe UI, azul #1d6fc4, navy #1e3a5f, escala de cinzas --g*,
controles de 36 px, raios 8/12, tokens claro/escuro do Faltas x Medidas. Nada que destoe do conjunto.
Use como método (não como estética) as diretrizes do Apple-Hig-Designer: clareza, deferência, profundidade;
grade de 4/8 px; hierarquia por peso e tamanho; alvos confortáveis; foco visível; movimento curto com curva de
saída suave; reduzir movimento respeitado.

REGRAS DO NEGÓCIO (a tela precisa ensinar isto sem manual)
1. Falta sem feedback registrado continua na cobrança.
2. Falta de quem já teve o feedback baixado pela coordenação sai da cobrança e é acompanhada por 30 dias só
   no perfil da pessoa; o alerta de "faltou de novo" aparece só ali.
3. Só a coordenação retira da cobrança, desfaz, exclui e conecta o WhatsApp.
4. Injustificadas e abonadas são listas separadas.
5. 2 ou mais faltas sem nenhum contato vão para "Sem posicionamento" (aviso para a coordenação).

PROIBIDO
Emoji; ícones decorativos sem função; texto menor que 11 px; cor como única forma de informar; textos longos
em caixa alta; mais de uma ação primária por linha; jargão técnico na tela; quebrar o modo escuro.

ENTREGA
1) Estrutura: cabeçalho com 4 números clicáveis, abas na ordem do fluxo, uma frase de ajuda por aba, listas
   com colunas fixas, estados vazios que dizem o que fazer. 2) Janelas (formulário, WhatsApp, QR, perfil,
   confirmação) no mesmo padrão. 3) Movimento: entrada em cascata, parallax leve do cabeçalho, abas fixas,
   contagem de números, barras que crescem, mola só em janelas; tudo desligável por prefers-reduced-motion.
4) Código: classes com prefixo fb-, tokens em variáveis CSS, nenhum estilo inline com cor, nenhum dado do
   banco dentro de onclick.

CRITÉRIOS DE ACEITE (verificar antes de entregar)
- Funciona em 1440 px, 1024 px e 390 px; claro e escuro; teclado (Tab/Esc) e leitor de tela (rótulos, aria).
- Contraste de texto >= 4,5:1. Alvos >= 36 px (44 px em toque).
- Nenhum emoji; nenhuma regressão nos testes (npm test); sem erro no console.
- Um usuário novo descobre, em menos de 10 segundos, quem precisa contatar e como registrar o contato.
```

## Sistema v2 (10/11/2026): o que vale hoje

O CSS inteiro (`assets/ligacoes/ligacoes.css`) foi reescrito sobre tokens. Esta seção vale mais que as anteriores quando houver conflito.

| Camada | Regra |
|---|---|
| Tipografia | Segoe UI Variable (a CSP do sistema não carrega fonte externa). Escala `--t12 · t13 · t14 · t16 · t20 · t24`; só os pesos 400, 500 e 600; números tabulares. Nada de 700 e nada de tamanho solto |
| Espaço | `--s1…s8` (4, 8, 12, 16, 20, 24, 32) |
| Raio | `--r8` controles pequenos · `--r10` controles · `--r14` cards · `--r20` painel lateral |
| Profundidade | Anel translúcido de 1 px + sombra suave (`--e1`, `--e2`, `--e3`). Não se usa borda sólida junto com sombra |
| Cor | `--fb-hair` (linha fina), tons `tn-da/am/ok/vi/gr/br` com `--k` (ponto e barra), `--kbg` (fundo suave) e `--ktx` (texto). Textos com contraste mínimo de 4,5:1 |
| Cabeçalho | Todo bloco tem cabeçalho e **barra de destaque no topo** na cor da situação (contadores, cards, janelas e painel lateral). As informações dentro do bloco são separadas por linhas finas |

Componentes: contador (`fb-sit`), cabeçalho da lista (`fb-ph`, com a contagem), card em três faixas (`fb-pc-h`, `fb-pc-b`, `fb-pc-a`), tag com ponto (`fb-tag`), calendário por mês (`fb-meses`, `fb-cal`), faixa de 30 dias do card (`fb-mini`), seção do panorama com cabeçalho e dado ao lado (`fb-pf-sec > h4`), linha do tempo (`fb-tl`).

Calendário: um bloco por mês, o mês no título e só o número do dia no quadrado. O dia sem falta fica sem cor; a falta é o único destaque forte (fundo vermelho suave, número em negrito e um ponto, para não depender só da cor); abonada em âmbar; o dia do contato em azul; hoje com anel; mensagem do SAC com um ponto no canto. Vai de 30 dias antes do contato até o fim da semana de hoje.

Texto: nada de descrição que repete o óbvio. A definição de cada veredito mora no tooltip do filtro, e o tooltip de cada contador explica a situação.

### Panorama (referência enviada em 10/11/2026)

O painel lateral segue a referência do Raphael: painel largo (860 px) com fundo claro e cartões brancos, cada um com ícone e título.

1. **Cabeçalho:** avatar, nome, RE · posto, supervisor com ícone e o veredito em pílula com ícone de tendência (sobe, desce, estável, olho).
2. **Três cartões coloridos:** Antes do contato · Depois do contato (vermelho se piorou, verde se melhorou) · Acompanhamento (até a data e quantos dias faltam). Uma seta liga o primeiro ao segundo.
3. **Evolução das faltas:** duas barras (antes e depois) e a variação em % ("+100% no período").
4. **Calendário de faltas:** um mês por vez, com setas, e a legenda ao lado. Dia sem falta em verde suave, falta em vermelho suave, abonada em âmbar, dia do contato em azul, hoje com anel.
5. **Linha do tempo na horizontal** (30 dias antes, contato do SAC, até hoje) com o destaque ao lado ("Situação em atenção").
6. **Histórico:** a lista detalhada de faltas, mensagens, conversas e medidas.
7. **Rodapé:** as ações à esquerda e **Fechar** à direita.
