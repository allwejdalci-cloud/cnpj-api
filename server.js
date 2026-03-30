const express = require("express");
// const fetch = require("node-fetch");
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const Redis = require("ioredis");

const app = express();

let redis = null;

// ==============================
function limparCNPJ(cnpj) {
  return cnpj.replace(/\D/g, "");
}

// ==============================
async function brasilAPI(cnpj) {
  const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`);
  if (!res.ok) throw new Error("BrasilAPI falhou");
  return res.json();
}

// ==============================
async function receitaWS(cnpj) {
  const res = await fetch(`https://receitaws.com.br/v1/cnpj/${cnpj}`);
  const data = await res.json();

  if (data.status === "ERROR") {
    throw new Error("ReceitaWS falhou");
  }

  return data;
}

// ==============================
async function consultar(cnpjRaw) {
  const cnpj = limparCNPJ(cnpjRaw);
  const cacheKey = `cnpj:${cnpj}`;

  let cached = null;
  if (redis) {
    cached = await redis.get(cacheKey);
  }
  if (cached) return JSON.parse(cached);

  let data;

  try {
    data = await brasilAPI(cnpj);
  } catch {
    data = await receitaWS(cnpj);
  }

  if (redis) {
    await redis.set(cacheKey, JSON.stringify(data), "EX", 86400);
  }
  return data;
}

// ==============================
function formatarSaida(data) {
  const cnpj = data.cnpj || "";
  const cnpjMask = cnpj
    ? cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5")
    : "";

  const nome = data.razao_social || data.nome || "";
  const fantasia = data.nome_fantasia || data.fantasia || "";
  const abertura = data.data_inicio_atividade || data.abertura || "";
  const capital = data.capital_social || "";

  const sociosArray = data.qsa || data.socios || [];
  const socios = sociosArray
    .map(s => `${s.nome || s.nome_socio}: ${s.qual || s.qualificacao}`)
    .join("\n");

  const principal = data.cnae_fiscal_descricao || "";

  const secundariasArray = data.cnaes_secundarios || [];
  const secundarias = secundariasArray
    .map(c => c.descricao || c.text)
    .join("\n");

  return [
    "",
    `${cnpjMask}  -  ${cnpj}`,
    nome,
    `Nome FANTASIA: ${fantasia}`,
    `Data de Abertura: ${abertura}`,
    "",
    `CAPITAL SOCIAL: ${capital}`,
    socios,
    "",
    `CÓDIGO E DESCRIÇÃO DA ATIVIDADE ECONÔMICA PRINCIPAL`,
    principal,
    "",
    `CÓDIGO E DESCRIÇÃO DAS ATIVIDADES ECONÔMICAS SECUNDÁRIAS`,
    secundarias
  ].join("\n").trim();
}
app.get("/cnpj/:cnpj", async (req, res) => {
  try {
    const result = await consultar(req.params.cnpj);
    const formatado = formatarSaida(result);
    res.send(formatado);
  } catch (e) {
      res.status(500).json({ erro: e.message });
}
});

app.listen(3000, () => {
  console.log("API rodando");
});
