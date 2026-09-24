// api/_senha.js — hash de senha com scrypt (crypto do próprio Node, sem dependência).
// Arquivo com prefixo "_" → NÃO vira rota na Vercel; é só importado.
//
// Formato guardado:  scrypt:N:r:p:<sal base64>:<hash base64>
// Os parâmetros vão junto no texto, então dá para subir o custo no futuro sem
// invalidar as senhas já gravadas. O separador é ":" e não "$" de propósito:
// "$" some quando o valor é colado num terminal ou num .env com expansão.
//
// Gerar o hash da senha padrão (valor da env DEFAULT_PASSWORD_HASH):
//   node api/_senha.js
// e digitar a senha quando pedir. Não reaproveite "servcamp2026": ela ficou
// no histórico público do repositório.

const crypto = require("crypto");

const N = 16384, R = 8, P = 1, TAM = 32;
const FORMATO = /^scrypt:(\d+):(\d+):(\d+):([A-Za-z0-9+/]+=*):([A-Za-z0-9+/]+=*)$/;

function scrypt(senha, sal, tam, n, r, p) {
  return new Promise((ok, falha) => {
    crypto.scrypt(String(senha), sal, tam, { N: n, r, p, maxmem: 256 * n * r }, (err, chave) => err ? falha(err) : ok(chave));
  });
}

// true quando o valor guardado já é um hash (e não uma senha antiga em texto claro)
function isHash(guardado) {
  return FORMATO.test(String(guardado || ""));
}

async function hash(senha) {
  const sal = crypto.randomBytes(16);
  const chave = await scrypt(senha, sal, TAM, N, R, P);
  return ["scrypt", N, R, P, sal.toString("base64"), chave.toString("base64")].join(":");
}

// Confere a senha digitada contra o valor guardado: o hash ou, nas linhas
// antigas, a senha em texto claro (users.js converte essas no próximo login
// certo). Comparação sempre em tempo constante.
async function verify(senha, guardado) {
  if (!guardado) return false;
  const m = FORMATO.exec(String(guardado));
  if (!m) {
    const a = crypto.createHash("sha256").update(String(senha)).digest();
    const b = crypto.createHash("sha256").update(String(guardado)).digest();
    return crypto.timingSafeEqual(a, b);
  }
  const n = +m[1], r = +m[2], p = +m[3];
  const sal = Buffer.from(m[4], "base64"), esperado = Buffer.from(m[5], "base64");
  // hash truncado ou parâmetros absurdos: recusa em vez de aceitar qualquer senha
  if (esperado.length < 16 || sal.length < 8 || n > 1048576 || r > 32 || p > 16) return false;
  let chave;
  try { chave = await scrypt(senha, sal, esperado.length, n, r, p); } catch (e) { return false; }
  return crypto.timingSafeEqual(chave, esperado);
}

module.exports = { hash, verify, isHash };

// node api/_senha.js → pede a senha e imprime o hash
if (require.main === module) {
  const rl = require("readline").createInterface({ input: process.stdin, output: process.stdout });
  rl.question("Senha: ", s => {
    rl.close();
    if (s.length < 6) { console.error("Use ao menos 6 caracteres."); process.exitCode = 1; return; }
    hash(s).then(h => console.log(h));
  });
}
