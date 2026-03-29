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
app.get("/cnpj/:cnpj", async (req, res) => {
  try {
    const result = await consultar(req.params.cnpj);
    res.json(result);
  } catch (e) {
      res.status(500).json({ erro: e.message });
}
});

app.listen(3000, () => {
  console.log("API rodando");
});
