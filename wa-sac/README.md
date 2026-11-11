# wa-sac: WhatsApp do SAC (Baileys)

Microsserviço Node que mantém a sessão de WhatsApp do SAC e expõe uma API HTTP pequena para o JARVIS **enviar** mensagens (texto e foto com legenda). Não processa mensagens recebidas.

O JARVIS roda na Vercel (serverless, sem conexão persistente). Este serviço precisa rodar num servidor **sempre ligado** (VPS, Docker). A Vercel só chama a API HTTP dele.

```
JARVIS (Vercel) --HTTPS + x-api-key--> wa-sac (VPS/Docker) --WhatsApp Web (Baileys)--> WhatsApp
```

## Aviso importante: risco de banimento e o que NÃO foi testado

- **Baileys é uma API NÃO oficial.** Ela imita o WhatsApp Web. O WhatsApp não autoriza esse uso e pode **bloquear ou banir o número** a qualquer momento, sem aviso. Use um número que o negócio aceite perder, nunca o número principal da empresa sem alternativa.
- **Não foi possível testar este serviço contra o WhatsApp de verdade** (pareamento, envio, reconexão, logout reais). Os testes automáticos usam um socket falso. O que foi verificado com o Baileys real: o pacote carrega e gera o QR code. Faça um teste real com um número descartável antes de colocar em produção.
- A imagem Docker também não foi construída/testada na máquina onde o serviço foi escrito (não havia Docker). Teste o `docker build` antes de subir.

### Boas práticas para reduzir o risco

- Só envie para quem **já falou com o SAC ou é cliente** (resposta/aviso esperado). Nada de lista fria, divulgação ou envio em massa. Este serviço não tem rota de broadcast de propósito.
- Mantenha o intervalo entre envios alto (padrão 5 s + até 40% aleatório). Não baixe de 3 s.
- Evite mensagens idênticas repetidas para muitas pessoas; varie o texto e personalize (nome, protocolo).
- Use um número com histórico (não chip novo) e deixe o WhatsApp do celular ativo e atualizado.
- Não pareie o mesmo número em dois lugares ao mesmo tempo. Se outro login assumir a sessão, o serviço para (veja "Estados") e só volta quando alguém pedir.
- Se muita gente bloquear ou denunciar as mensagens, o número cai. Ofereça um jeito de a pessoa não receber mais.
- Tenha um plano B (número reserva ou API oficial) para o caso de banimento.

## Como subir

### Docker (recomendado)

```bash
cd wa-sac
docker build -t wa-sac .
docker run -d --name wa-sac --restart unless-stopped \
  -p 127.0.0.1:3000:3000 \
  -e WA_API_KEY="$(openssl rand -hex 32)" \
  -v wa-sac-data:/data \
  wa-sac
```

O volume em `/data` guarda as credenciais da sessão. **Sem volume, cada recriação do contêiner exige escanear o QR de novo.** O contêiner roda como usuário não-root e tem `HEALTHCHECK` em `/health`.

Exemplo de `docker-compose.yml`:

```yaml
services:
  wa-sac:
    build: ./wa-sac
    container_name: wa-sac
    restart: unless-stopped
    init: true
    environment:
      WA_API_KEY: ${WA_API_KEY:?defina WA_API_KEY}   # mínimo 16 caracteres
      WA_INTERVALO_MIN_MS: "5000"
      # WA_AUTH_DIR já é /data/auth na imagem
    ports:
      - "127.0.0.1:3000:3000"   # exponha ao mundo só via proxy HTTPS (veja abaixo)
    volumes:
      - wa-sac-data:/data

volumes:
  wa-sac-data:
```

```bash
echo "WA_API_KEY=$(openssl rand -hex 32)" > .env   # ao lado do docker-compose.yml
docker compose up -d --build
docker compose logs -f wa-sac
```

### Direto com Node (20+)

```bash
cd wa-sac
npm ci
WA_API_KEY="uma-chave-longa-com-16-ou-mais-caracteres" node server.js
# ou, lendo um arquivo .env (Node 20.6+):
node --env-file=.env server.js
```

Mantenha o processo vivo com systemd, pm2 ou similar. A pasta `./auth` (ou `WA_AUTH_DIR`) precisa ser persistente.

### HTTPS e rede

O serviço fala HTTP puro e a chave trafega no cabeçalho `x-api-key`. **Publique-o atrás de um proxy com HTTPS** (Caddy, Nginx, Traefik) e, se possível, restrinja o acesso por firewall. Não há CORS: só chamadas servidor a servidor (a Vercel), nunca do navegador.

## Variáveis de ambiente

| Variável | Obrigatória | Padrão | Descrição |
|---|---|---|---|
| `WA_API_KEY` | **sim** | (nenhum) | Segredo compartilhado com o JARVIS. Mínimo 16 caracteres. O serviço **não sobe** sem ela. |
| `WA_INTERVALO_MIN_MS` | não | `5000` | Intervalo mínimo entre envios, em ms. A fila soma jitter aleatório de até 40%. |
| `WA_AUTH_DIR` | não | `./auth` (`/data/auth` no Docker) | Pasta das credenciais da sessão. |
| `PORT` | não | `3000` | Porta HTTP. |
| `HOST` | não | `0.0.0.0` | Endereço de escuta. |

Veja `.env.example`.

## Como o SAC conecta o WhatsApp (QR code)

O QR aparece **dentro do JARVIS**; ninguém precisa abrir este serviço no navegador.

1. No JARVIS, o SAC abre a tela de conexão do WhatsApp e clica em **Conectar** (o JARVIS chama `POST /connect`).
2. O JARVIS consulta `GET /status` a cada poucos segundos. Quando `state` for `"qr"`, mostra a imagem do campo `qr` (data URL PNG). O QR expira em cerca de 20 s e o serviço o renova sozinho.
3. No celular do SAC: WhatsApp > **Aparelhos conectados** > **Conectar um aparelho** > escanear o QR.
4. O `state` vira `"open"` e `numero` mostra o número conectado. As credenciais ficam salvas em `WA_AUTH_DIR`.

Depois disso, ao reiniciar o serviço ele reconecta sozinho, sem novo QR. Se ninguém escanear, o QR expira em cerca de 1 minuto e o estado volta para `closed`; basta clicar em Conectar de novo.

Para trocar de número ou desconectar: `POST /logout` (o JARVIS faz isso pelo botão de desconectar). Isso desloga o aparelho no WhatsApp, apaga as credenciais e volta ao estado `closed`.

## API HTTP

Todas as rotas, **exceto `GET /health`**, exigem o cabeçalho `x-api-key` igual a `WA_API_KEY` (401 caso contrário). Corpo máximo de 8 MB. Rota desconhecida: 404. Método errado: 405. Respostas sempre em JSON.

| Rota | Resposta |
|---|---|
| `GET /health` | `200 {"ok":true}` (sem chave) |
| `GET /status` | `{"state":"open"\|"connecting"\|"qr"\|"closed","numero":"5519999998888"\|null,"qr":"data:image/png;base64,..."\|null,"desde":epochMs\|null}`. `qr` só vem com `state="qr"`. `desde` é o instante em que entrou no estado atual (`null` se ainda não houve mudança desde que o serviço subiu). |
| `POST /connect` | Inicia/reinicia o pareamento (já `open`: não faz nada). Devolve o JSON do `/status`. |
| `POST /logout` | Desconecta, apaga as credenciais, volta a `closed`. Devolve o JSON do `/status`. |
| `POST /send` | Veja abaixo. |

### POST /send

```json
{
  "numero": "(19) 99999-8888",
  "texto": "Olá! Seu chamado foi atualizado.",
  "imagem": { "base64": "...", "mimetype": "image/jpeg", "nome": "foto.jpg" }
}
```

`imagem` é opcional; com imagem, `texto` vira a legenda (e pode ser vazio).

| Status | Corpo | Quando |
|---|---|---|
| 200 | `{"ok":true,"id":"<messageId>"}` | Enviado. |
| 409 | `{"ok":false,"motivo":"WhatsApp desconectado"}` | `state` diferente de `open`. |
| 422 | `{"ok":false,"motivo":"..."}` | Número inválido, número sem WhatsApp, texto vazio e sem imagem, mimetype fora de `image/jpeg`/`image/png`/`image/webp`, imagem acima de 5 MB. |
| 429 | `{"ok":false,"motivo":"..."}` | Mais de 20 envios pendentes na fila. |
| 500 | `{"ok":false,"motivo":"erro interno"}` | Erro inesperado (sem stack). |
| 400 | `{"ok":false,"motivo":"..."}` | JSON inválido ou corpo que não é objeto. |
| 413 | `{"ok":false,"motivo":"..."}` | Corpo acima de 8 MB. |

Normalização do número: só dígitos; se começar com 55 e tiver 12+ dígitos, é aceito como está; senão prefixa 55. Só celular brasileiro: DDD de 2 dígitos (sem zero inicial) + 9 dígitos começando em 9. Fixo, número curto e DDD com zero (`019...`) são recusados. O serviço consulta o WhatsApp (`onWhatsApp`) e usa o JID que ele devolver.

**Fila e tempo de resposta.** Todos os envios passam por uma única fila serial com intervalo mínimo (mais jitter) e mostram "digitando" antes de enviar. A resposta do `POST /send` só volta quando a mensagem sai, então, com a fila cheia, uma chamada pode levar vários minutos (20 pendentes x ~6 s = ~2 min). Configure um timeout generoso no JARVIS e trate o 429 com nova tentativa mais tarde.

### Exemplo (curl)

```bash
curl -s https://wa.exemplo.com/status -H "x-api-key: $WA_API_KEY"
curl -s -X POST https://wa.exemplo.com/connect -H "x-api-key: $WA_API_KEY"
curl -s -X POST https://wa.exemplo.com/send -H "x-api-key: $WA_API_KEY" \
  -H "content-type: application/json" \
  -d '{"numero":"(19) 99999-8888","texto":"Olá!"}'
```

## Estados e reconexão

- `closed`: sem sessão ativa (aguardando `/connect`).
- `connecting`: abrindo a conexão ou esperando para reconectar.
- `qr`: aguardando a leitura do QR.
- `open`: conectado; só nesse estado o `/send` funciona.

Ao subir, se houver credenciais salvas, o serviço reconecta sozinho. Em qualquer queda a reconexão é automática com **backoff exponencial de 1 s até 60 s**, com estas exceções:

- **loggedOut** (o número saiu de "Aparelhos conectados", ou foi deslogado pelo celular): as credenciais são apagadas e o estado vai para `closed`. É preciso parear de novo.
- **connectionReplaced** (outro login assumiu a sessão): vai para `closed` e **não** tenta reconectar sozinho (evita brigar com o outro login em loop). Credenciais mantidas; `POST /connect` retoma.
- **forbidden/403** (o WhatsApp recusou a conta, possível bloqueio): vai para `closed` e não insiste.
- **QR que expirou sem leitura**: vai para `closed` (em vez de gerar QR para sempre).

## Segurança e logs

- `x-api-key` comparada com `crypto.timingSafeEqual`.
- Os logs (JSON, uma linha por evento) **não** trazem o texto das mensagens, a chave nem o número completo (aparece mascarado, ex.: `5519*****8888`).
- As credenciais em `WA_AUTH_DIR` dão acesso total à conta de WhatsApp: proteja o volume/pasta e não versione (`auth/` está no `.gitignore`).

## Desenvolvimento

```bash
cd wa-sac
npm ci
npm test       # node --test, sem rede e sem WhatsApp de verdade (socket falso)
```

Estrutura:

- `server.js`: servidor HTTP nativo, rotas, autenticação e validações do `/send`.
- `whatsapp.js`: gerenciador de conexão (estados, QR, reconexão, envio). A fábrica de socket é injetável; a real usa o Baileys.
- `fila.js`: fila serial com intervalo mínimo e jitter (relógio e espera injetáveis).
- `numero.js`: normalização de número (função pura).
- `test/`: testes (`*.test.js`) e utilitários de teste (`fakes.js`).

Nota técnica: o Baileys 6.7.x é um pacote ESM puro (não funciona com `require`), por isso `whatsapp.js` o carrega com `import()` dinâmico. O resto do código é CommonJS. O Baileys usa `sharp` (instalado automaticamente como dependência par) para gerar a miniatura das fotos; sem ele a foto ainda seria enviada, só sem miniatura. A versão do Baileys está fixada em `package.json` e no `package-lock.json`; atualize com cuidado e teste de novo, porque o WhatsApp muda o protocolo e versões antigas deixam de funcionar.
