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
  const str = String(codigo);
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
function formatarTelefone(tel) {
  if (!tel) return "";
  const t = tel.replace(/\D/g, "");

  if (t.length === 10) {
    return `(${t.slice(0,2)}) ${t.slice(2,6)}-${t.slice(6)}`;
  }

  if (t.length === 11) {
    return `(${t.slice(0,2)}) ${t.slice(2,7)}-${t.slice(7)}`;
  }

  return tel;
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

  // 🔴 ReceitaWS primeiro
  try {
    data = await receitaWS(cnpj);
  } catch {
    data = await brasilAPI(cnpj);
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

  const telefone = formatarTelefone(data.ddd_telefone_1 || data.telefone || "");

  const email = (data.email || "").toLowerCase();

  const tipo = data.descricao_tipo_de_logradouro || data.tipo_logradouro || "";
  const logradouro = data.logradouro || "";
  const numero = data.numero || "";
  const complemento = data.complemento || "";
  const bairro = data.bairro || "";
  const municipio = data.municipio || "";
  const uf = data.uf || "";
  const cep = formatarCEP(data.cep || "");

  const endereco = [
    [tipo, logradouro].filter(Boolean).join(" "),
    numero,
    complemento,
    bairro,
    `${municipio}/${uf}`,
    cep
  ].filter(v => v && v !== "/").join(", ");

// 👥 SÓCIOS (robusto definitivo)
const sociosArray = data.qsa || data.socios || [];

const socios = sociosArray
  .map(s => {
    const nomeSocio =
      s.nome_socio ||
      s.nome ||
      s.nome_empresarial ||
      "";

    const qualificacao =
      s.qual ||
      s.qualificacao ||
      s.qualificacao_socio ||
      s.descricao ||
      s.cargo ||
      s.funcao ||
      "";

    if (!nomeSocio) return "";

    return qualificacao
      ? `${nomeSocio}: ${qualificacao}`
      : nomeSocio;
  })
  .filter(Boolean)
  .join("\n");

  // ✅ CNAE PRINCIPAL (ReceitaWS + BrasilAPI)
  let principal = "";
  if (data.atividade_principal && data.atividade_principal.length > 0) {
    const p = data.atividade_principal[0];
    principal = `${formatarCNAE(p.code)} - ${p.text}`;
  } else if (data.cnae_fiscal && data.cnae_fiscal_descricao) {
    principal = `${formatarCNAE(data.cnae_fiscal)} - ${data.cnae_fiscal_descricao}`;
  }

  // ✅ CNAES SECUNDÁRIOS
  let secundarias = "";

  if (data.atividades_secundarias) {
    secundarias = data.atividades_secundarias
      .map(c => `${formatarCNAE(c.code)} - ${c.text}`)
      .join("\n");
  } else if (data.cnaes_secundarios) {
    secundarias = data.cnaes_secundarios
      .map(c => `${formatarCNAE(c.codigo)} - ${c.descricao}`)
      .join("\n");
  }

  return [
    telefone,
    email,
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
