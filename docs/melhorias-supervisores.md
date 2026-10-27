# Melhorias para os supervisores (27/10/2026): o que foi achado e decidido

## 1. Inicialização lenta
**Gargalo encontrado.** O `index.html` carregava no `<head>`, de forma síncrona, três bibliotecas de um CDN externo
antes de desenhar qualquer coisa. A maior é a `xlsx.full.min.js` (861 KB; 3,4 s para baixar numa medição a frio
feita aqui, contra 0,5 s do Chart.js e 0,4 s do Leaflet). Ela só é usada quando alguém importa uma planilha (sempre
dentro de funções), mas travava a primeira tela de todo mundo.

**Mudança.** `defer` na `xlsx.full.min.js`: o download sai do caminho da primeira tela e a biblioteca chega antes
de qualquer clique de importação. Chart.js e Leaflet ficaram como estavam (o Chart.js é usado no desenho da Visão
Geral; deixá-lo para depois mudaria a ordem de desenho e o tema dos gráficos).

**Outros pontos vistos e deixados como estão (mudariam o comportamento):** a resposta de `casos` é grande (cerca
de 2 MB, com os calendários) e é pedida na Visão Geral; `/api/latest` traz a planilha inteira. Para o supervisor a
resposta de `casos` agora é menor, porque só vem a área dele.

**Medição.** Não deu para medir a inicialização autenticada em produção daqui. O método para comparar: aba Rede do
navegador, "Desativar cache", recarregar e ler o tempo até o evento `DOMContentLoaded` e o primeiro desenho.

## 2. Cada supervisor vê só a própria área (autorização no servidor)
`GET casos` e `GET historico` (api/_faltas.js) passam a filtrar pelo **login** (`MD.SUPERVISORES` + `MD.daArea`),
não por parâmetro da URL. Coordenação, diretoria, TV e aprovadores continuam vendo tudo. Parâmetros como `sup` ou
`area` na chamada não mudam o resultado (teste em test/faltas_api.test.js). O link do e-mail continua indo direto
para a tela de faltas em aberto depois do login (`?pg=faltassup`).

## 3. Topo da tela Faltas x Medidas
Mesmos botões e funções, agora em dois grupos: as quatro telas (lista, quadro, painel, histórico) como navegação
principal, e relatório, aviso por e-mail, envio de planilha e atualizar como ações de apoio, num grupo à parte.
Em telas estreitas os grupos quebram em linhas de largura total.

## 4. Janela Gerar medida
Topo, passos e rodapé mais baixos; a folha na prévia tem a altura do conteúdo; o ajuste automático considera a
largura **e** a altura (a folha inteira aparece quando a tela deixa; abaixo de 62% o texto ficaria ilegível, então
a prévia rola dentro da própria área, com o rodapé de ações sempre visível). Zoom manual continua valendo.

## 5. Botão Gerar medida na linha
Cada situação em aberto (prazo vencido, no prazo, aguardando retorno, coordenação) mostra o botão **Gerar medida**
na própria linha, com o nome da pessoa no texto de ajuda. Situações já tratadas não mostram o botão.

## 6. E-mail
Colunas de datas e de situação alinhadas à esquerda. A tabela já era HTML de verdade (nenhuma imagem de tabela). O
único link do aviso é o botão "Abrir no Painel ServCamp".

## 7. Aviso de novo contrato
Era o cartão de comemoração do Comercial (`_celebrarContrato`), mostrado **a cada login** durante 30 dias. Agora
aparece **uma vez por contrato em cada navegador** (`localStorage.ctVistos`). A faixa fixa da Visão Geral e o
confete seguem como estavam; os outros avisos do sistema não foram tocados.
