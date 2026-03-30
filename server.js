const express = require("express");
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const Redis = require("ioredis");

const app = express();

let redis = null;

// ==============================
function limparCNPJ(cnpj) {
  return cnpj.replace(/\D/g, "");
}

// ==============================
function formatarData(data) {
  if (!data) return "";
  const partes = data.split("-");
  if (partes.length !== 3) return data;
  return `${partes[2]}/${partes[1]}/${partes[0]}`;
}

// ==============================
function formatarCapital(valor) {
  if (!valor) return "";
  const numero = parseFloat(valor);
  if (isNaN(numero)) return valor;
  return numero.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

// ==============================
function formatarCNAE(codigo) {
  if (!codigo) return "";

  const str = String(codigo); // 👈 garante string
  const c = str.replace(/\D/g, "").padStart(7, "0");

  return `${c.slice(0,2)}.${c.slice(2,4)}-${c.slice(4,5)}-${c.slice(5)}`;
}

// ==============================
function formatarCEP(cep) {
  if (!cep) return "";
  const clean = cep.replace(/\D/g, "");
  if (clean.length !== 8) return cep;
  const mask = `${clean.slice(0,5)}-${clean.slice(5)}`;
  return `${mask}  -  ${clean}`;
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
  const abertura = formatarData(data.data_inicio_atividade || data.abertura || "");
  const capital = formatarCapital(data.capital_social || "");

  // 📞 TELEFONE
  const telefone = data.ddd_telefone_1 || data.telefone || "";

  // 📧 EMAIL
  const email = data.email || "";
  const emailUpper = email ? email.toUpperCase() : "";
  const emailLower = email ? email.toLowerCase() : "";

  // 📍 ENDEREÇO
  const logradouro = data.logradouro || "";
  const numero = data.numero || "";
  const complemento = data.complemento || "";
  const bairro = data.bairro || "";
  const municipio = data.municipio || data.uf_municipio || "";
  const uf = data.uf || "";
  const cep = formatarCEP(data.cep || "");

  const endereco = [
    logradouro,
    numero,
    complemento,
    bairro,
    `${municipio}/${uf}`,
    cep
  ].filter(v => v && v !== "/").join(", ");

  // 👥 SÓCIOS
  const sociosArray = data.qsa || data.socios || [];
  const socios = sociosArray
    .map(s => {
      const nomeSocio = s.nome || s.nome_socio || "";
      const qual = s.qual || s.qualificacao || s.descricao || "";
      return nomeSocio && qual ? `${nomeSocio}: ${qual}` : "";
    })
    .filter(Boolean)
    .join("\n");

  // CNAE PRINCIPAL
  const principal = data.cnae_fiscal && data.cnae_fiscal_descricao
    ? `${formatarCNAE(data.cnae_fiscal)} - ${data.cnae_fiscal_descricao}`
    : "";

  // CNAES SECUNDÁRIOS
  const secundariasArray = data.cnaes_secundarios || [];
  const secundarias = secundariasArray
    .map(c => {
      const codigo = c.codigo || c.code || "";
      const descricao = c.descricao || c.text || "";
      return codigo && descricao
        ? `${formatarCNAE(codigo)} - ${descricao}`
        : "";
    })
    .filter(Boolean)
    .join("\n");

  return [
    telefone,
    emailUpper,
    emailLower,
    "",
    `${cnpjMask}  -  ${cnpj}`,
    nome,
    `Nome FANTASIA: ${fantasia}`,
    `Data de Abertura: ${abertura}`,
    "",
    endereco,
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

// ==============================
app.get("/cnpj/:cnpj", async (req, res) => {
  try {
    const result = await consultar(req.params.cnpj);
    const formatado = formatarSaida(result);

    res.set("Content-Type", "text/plain; charset=utf-8");
    res.send(formatado);

  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

app.listen(3000, () => {
  console.log("API rodando");
});
