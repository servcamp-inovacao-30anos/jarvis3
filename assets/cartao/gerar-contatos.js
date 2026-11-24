// Refaz os contatos (.vcf) dos cartões de visita a partir de assets/cartao/cartoes.js.
// Rode depois de mudar qualquer dado lá:  node assets/cartao/gerar-contatos.js
const fs = require("fs");
const path = require("path");
const C = require("./cartoes.js");

const RAIZ = path.join(__dirname, "..", "..");
for (const apelido of Object.keys(C.CARTOES)) {
  const p = C.CARTOES[apelido];
  const foto = p.foto ? fs.readFileSync(path.join(RAIZ, p.foto)).toString("base64") : "";
  const destino = path.join(RAIZ, p.contato);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, C.vcard(apelido, foto));
  console.log("ok", p.contato);
}
