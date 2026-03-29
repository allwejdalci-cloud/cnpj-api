import express from "express";
import fetch from "node-fetch";
import Redis from "ioredis";

const app = express();

// 🔴 COLE SUA URL DO REDIS AQUI
const redis = new Redis("COLE_AQUI_SUA_REDIS_URL");

// ==============================
// 🔧 UTIL
// ==============================
function limparCNPJ(cnpj) {
  return cnpj.replace(/\D/g, "");
}

// ==============================
// 🔎 BRASIL API
// ==============================
async function brasilAPI(cnpj) {
  const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`);
  if (!res.ok) throw new Error("BrasilAPI falhou");
  return res.json();
}

// ==============================
// 🔎 RECEITA WS (fallback)
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
// 🧠 NORMALIZAÇÃO
// ==============================
function formatar(data) {
  return {
    cnpj: data.cnpj || "",
    nome: data.razao_social || data.nome || "",
    fantasia: data.nome_fantasia || data.fantasia || "",
    abertura: data.data_inicio_atividade || data.abertura || "",
    capital: data.capital_social || "",
    qsa: data.qsa || data.socios || [],
    atividade_principal: data.cnae_fiscal_descricao || "",
    atividades_secundarias: data.cnaes_secundarios || []
  };
}

// ==============================
// 🚀 CONSULTA PRINCIPAL
// ==============================
async function consultar(cnpjRaw) {
  const cnpj = limparCNPJ(cnpjRaw);
  const cacheKey = `cnpj:${cnpj}`;

  // CACHE
  const cached = await redis.get(cacheKey);
  if (cached) return JSON.parse(cached);

  let data;

  try {
    data = await brasilAPI(cnpj);
  } catch {
    data = await receitaWS(cnpj);
  }

  const final = formatar(data);

  await redis.set(cacheKey, JSON.stringify(final), "EX", 86400);

  return final;
}

// ==============================
// 🌐 ENDPOINT
// ==============================
app.get("/cnpj/:cnpj", async (req, res) => {
  try {
    const result = await consultar(req.params.cnpj);
    res.json(result);
  } catch {
    res.status(500).json({ erro: "falha" });
  }
});

app.listen(3000, () => {
  console.log("API rodando");
});