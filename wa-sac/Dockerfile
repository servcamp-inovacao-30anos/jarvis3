# Microsserviço de WhatsApp do SAC (Baileys). Imagem enxuta, usuário não-root.

# ---- estágio 1: instala as dependências de produção ----
FROM node:20-alpine AS deps
WORKDIR /app

# O Baileys 6.7.x depende do pacote "libsignal", que o npm busca no GitHub
# (o package-lock aponta para git+ssh). Por isso o git no build, e a troca de
# ssh:// por https:// para não precisar de chave SSH. Só existe neste estágio.
RUN apk add --no-cache git \
 && git config --global url."https://github.com/".insteadOf "ssh://git@github.com/" \
 && git config --global --add url."https://github.com/".insteadOf "git@github.com:"

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ---- estágio 2: imagem final ----
FROM node:20-alpine
ENV NODE_ENV=production \
    PORT=3000 \
    WA_AUTH_DIR=/data/auth

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json server.js whatsapp.js numero.js fila.js ./

# /data guarda as credenciais da sessão do WhatsApp: monte um volume aqui,
# senão o SAC precisa escanear o QR de novo a cada recriação do contêiner.
RUN mkdir -p /data/auth && chown -R node:node /data /app
USER node
VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
