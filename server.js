require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const net = require("net");
const { Pool } = require("pg");
const multer = require("multer");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);

const bcrypt = require("bcrypt");
const moment = require("moment");
const { v4: uuidv4 } = require("uuid");
const archiver = require("archiver");
const { Parser } = require("xml2js");
const JSZip = require("jszip");
const { DOMParser } = require("@xmldom/xmldom");
const tj = require("@mapbox/togeojson");
const axios = require("axios");
const jwt = require('jsonwebtoken');
const { DateTime } = require('luxon');          // npm i luxon
const zone = 'America/Belem';


const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  ImageRun,
  Header,
  Footer,
} = require("docx");

const PDFDocument = require("pdfkit");

// CONFIGURAÇÃO DO EXPRESS
const app = express();

// Aumenta o limite padrão para o corpo JSON/urlencoded
app.use(express.json({ limit: "200mb" }));
app.use(express.urlencoded({ limit: "200mb", extended: true }));

// Permite CORS
app.use(cors({ origin: "*" }));

// CONFIGURAÇÃO DO BANCO DE DADOS (PostgreSQL) usando .env

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

// CONFIGURAÇÃO DE SESSÃO (express-session + connect-pg-simple)

app.use(
  session({
    store: new pgSession({
      pool: pool,
      tableName: "session",
    }),
    secret: process.env.SESSION_SECRET || "fallback-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 24 * 60 * 60 * 1000, // 24 horas
      secure: false, // Em produção, use true se for HTTPS
    },
  })
);

function isAdmin(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.redirect("/");
  }

  pool
    .query("SELECT id, permissoes FROM usuarios WHERE id = $1", [req.session.userId])
    .then((result) => {
      if (result.rows.length === 0) {
        return res.redirect("/");
      }
      const user = result.rows[0];

      if (user.id === 1) {
        return next();
      }

      if (
        user.permissoes &&
        (user.permissoes.includes("master") ||
          user.permissoes.includes("admin") ||
          user.permissoes.includes("gestor"))
      ) {
        return next();
      }

      return res.status(403).send("Acesso negado: usuário não é administrador.");
    })
    .catch((error) => {
      console.error("Erro ao verificar permissões de admin:", error);
      return res.status(500).send("Erro interno do servidor.");
    });
}


// MIDDLEWARE: isAuthenticated (protege rotas e páginas)

async function isAuthenticated(req, res, next) {
  try {
    if (!req.session || !req.session.userId) {
      return res.redirect("/");
    }

    if (req.session.userId === 1) {
      return next();
    }

    const userQuery = `
      SELECT init, permissoes
      FROM usuarios
      WHERE id = $1
      LIMIT 1
    `;
    const result = await pool.query(userQuery, [req.session.userId]);

    if (result.rows.length === 0) {
      return res.redirect("/");
    }

    const { init, permissoes } = result.rows[0];

    if (!init) {
      return res.status(403).send("Acesso negado: usuário não liberado.");
    }

    let listaPermissoes = [];
    if (permissoes) {
      try {
        // Tenta interpretar como JSON
        listaPermissoes = JSON.parse(permissoes);
      } catch (err) {
        // Se falhar, assume que está separado por vírgulas
        listaPermissoes = permissoes.split(",").map(p => p.trim());
      }
    }

    if (
      listaPermissoes.includes("master") ||
      listaPermissoes.includes("admin") ||
      listaPermissoes.includes("gestor")
    ) {
      return next();
    }

    return res.status(403).send("Acesso negado: permissões insuficientes.");
  } catch (error) {
    console.error("Erro ao verificar permissões:", error);
    return res.status(500).send("Erro interno do servidor.");
  }
}

// ARQUIVOS ESTÁTICOS
// em server.js, antes de todas as rotas:
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use("/assets", express.static(path.join(__dirname, "public", "assets")));
app.use(
  "/pages",
  isAuthenticated,
  express.static(path.join(__dirname, "public", "pages"))
);


// ROTAS PRINCIPAIS
// Rota para carregar a página HTML do painel admin
app.get("/admin", isAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin/admin-dashboard.html"));
});
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/login-cadastro.html"));
});
app.get("/politicaprivacidade", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "politicas-privacidade.html"));
});
app.get("/solicitar-rota.html", (req, res) => {
  res.sendFile(path.join(__dirname, "public/solicitar-rota.html"));
});
app.get("/admin-login.html", (req, res) => {
  res.sendFile(path.join(__dirname, "public/admin-login.html"));
});
app.get("/dashboard-admin.html", (req, res) => {
  res.sendFile(path.join(__dirname, "public/admin/dashboard-admin.html"));
});
app.get("/dashboard-fornecedor.html", (req, res) => {
  res.sendFile(path.join(__dirname, "public/fornecedores/dashboard-fornecedor.html"));
});
app.get("/frota-fornecedor.html", (req, res) => {
  res.sendFile(path.join(__dirname, "public/fornecedores/frota-fornecedor.html"));
});
app.get("/monitor-fornecedor.html", (req, res) => {
  res.sendFile(path.join(__dirname, "public/fornecedores/monitor-fornecedor.html"));
});
app.get("/motorista-fornecedor.html", (req, res) => {
  res.sendFile(path.join(__dirname, "public/fornecedores/motorista-fornecedor.html"));
});
app.get("/relatorios-fonecedor.html", (req, res) => {
  res.sendFile(path.join(__dirname, "public/fornecedores/relatorios-fonecedor.html"));
});


app.get("/logout", (req, res) => {
  req.session.destroy((err) => {
    res.clearCookie("connect.sid");
    return res.redirect("/");
  });
});

// CONFIGURAÇÃO DE UPLOAD

const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}
const storageUsuarios = multer.diskStorage({
  destination: (req, file, cb) => {
    // Cria diretório se não existir
    const dir = path.join(__dirname, "uploads", "usuarios");
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    // Nome do arquivo com timestamp
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, "user-" + uniqueSuffix + ext);
  },
});
const uploadUsuarios = multer({ storage: storageUsuarios });
const memorandoUpload = multer();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});
const storageRelatorios = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(uploadDir, "relatorios");
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, "relatorio-" + uniqueSuffix + ext);
  },
});
const uploadRelatorios = multer({ storage: storageRelatorios });

app.use("/uploads", express.static(path.join(__dirname, "uploads")));

const upload = multer({ dest: "uploads/" });
const uploadFrota = multer({ storage: storage });
const uploadMonitores = multer({ storage: storage });


// FUNÇÕES UTILITÁRIAS PARA CONVERSÃO DE ARQUIVOS (KMZ -> KML, etc.)

async function kmzToKml(filePath) {
  const data = fs.readFileSync(filePath);
  const zip = await JSZip.loadAsync(data);
  const kmlFile = Object.keys(zip.files).find((fileName) =>
    fileName.endsWith(".kml")
  );
  if (!kmlFile) throw new Error("KMZ inválido: não contém arquivo KML.");
  const kmlData = await zip.files[kmlFile].async("string");
  return kmlData;
}

async function convertToGeoJSON(filePath, originalname) {
  const extension = path.extname(originalname).toLowerCase();

  if (extension === ".geojson" || extension === ".json") {
    const data = fs.readFileSync(filePath, "utf8");
    return JSON.parse(data);
  }
  if (extension === ".kml") {
    const kmlData = fs.readFileSync(filePath, "utf8");
    const dom = new DOMParser().parseFromString(kmlData, "text/xml");
    return tj.kml(dom);
  }
  if (extension === ".kmz") {
    const kmlData = await kmzToKml(filePath);
    const dom = new DOMParser().parseFromString(kmlData, "text/xml");
    return tj.kml(dom);
  }
  if (extension === ".gpx") {
    const gpxData = fs.readFileSync(filePath, "utf8");
    const dom = new DOMParser().parseFromString(gpxData, "text/xml");
    return tj.gpx(dom);
  }
  throw new Error("Formato de arquivo não suportado.");
}
// ====> ROTA /api/admin/users (GET)
// Retorna lista de usuários para o DataTable
app.get("/api/admin/users", async (req, res) => {
  try {
    const query = `
      SELECT id, nome_completo, telefone, email, permissoes, init
      FROM usuarios
      ORDER BY id ASC
    `;
    const result = await pool.query(query);
    return res.status(200).json(result.rows);
  } catch (error) {
    console.error("Erro ao buscar usuários:", error);
    return res.status(500).json({ error: "Erro interno ao buscar usuários." });
  }
});

// CONTADORES DE ROTAS POR CAPACIDADE CONFIGURADA
app.get("/api/rotas/contadores", async (req, res) => {
  try {
    // 1) Pega a capacidade de cada linha cadastrada
    const sql = `
      SELECT
        lr.id          AS rota_id,
        lr.capacidade  AS capacidade
      FROM linhas_rotas lr
    `;
    const { rows } = await pool.query(sql);

    // 2) Conta cada linha conforme a capacidade configurada
    let vans = 0, micro = 0, onibus = 0;
    for (const { capacidade } of rows) {
      if (capacidade <= 16) {
        vans++;
      } else if (capacidade <= 33) {
        micro++;
      } else if (capacidade <= 50) {
        onibus++;
      }
      // Se houver capacidades diferentes, ajuste as faixas acima
    }

    // 3) Retorna todos os 71 (vans+micro+onibus) = total de linhas
    res.json({ vans, micro, onibus });

  } catch (err) {
    console.error("Erro contadores rotas:", err);
    res.status(500).json({ error: "Erro interno ao obter contadores." });
  }
});



// ----------------------------------------------------------------------
// ROTAS PARA RELATÓRIOS DE OCORRÊNCIA
// ----------------------------------------------------------------------
app.get("/api/relatorios", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM relatorios_ocorrencias ORDER BY id DESC");
    return res.json(result.rows);
  } catch (error) {
    console.error("Erro ao obter relatórios:", error);
    return res.status(500).json({ success: false, message: "Erro ao obter relatórios." });
  }
});

app.post("/api/relatorios/cadastrar", uploadRelatorios.array("anexo[]"), async (req, res) => {
  try {
    await pool.query("ALTER TABLE relatorios_ocorrencias ALTER COLUMN rota_id TYPE VARCHAR(255)");
    await pool.query("ALTER TABLE relatorios_ocorrencias ADD COLUMN IF NOT EXISTS fornecedor_id INT");
    const { tipo_relatorio, rota_id, data_ocorrido, corpo, fornecedor_id } = req.body;
    let caminhos = [];
    if (req.files && req.files.length > 0) {
      req.files.forEach((f) => {
        const relPath = "/uploads/relatorios/" + f.filename;
        caminhos.push(relPath);
      });
    }
    const query = `
      INSERT INTO relatorios_ocorrencias (
        tipo_relatorio, rota_id, data_ocorrido, corpo, caminho_anexo, fornecedor_id
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id
    `;
    const values = [
      tipo_relatorio,
      rota_id,
      data_ocorrido,
      corpo,
      JSON.stringify(caminhos),
      fornecedor_id ? parseInt(fornecedor_id, 10) : null
    ];
    const result = await pool.query(query, values);
    return res.json({ success: true, newId: result.rows[0].id });
  } catch (error) {
    console.error("Erro ao cadastrar relatório:", error);
    return res.status(500).json({ success: false, message: "Erro ao cadastrar relatório." });
  }
});

app.put("/api/relatorios/:id", uploadRelatorios.array("editar_anexo[]"), async (req, res) => {
  try {
    const { id } = req.params;
    const tipo_relatorio = req.body.editar_tipo_relatorio;
    const rota_id = req.body.editar_rota_id;
    const data_ocorrido = req.body.editar_data_ocorrido;
    const corpo = req.body.editar_corpo;

    const check = await pool.query("SELECT * FROM relatorios_ocorrencias WHERE id = $1", [id]);
    if (check.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Relatório não encontrado." });
    }

    let existingPaths = [];
    if (check.rows[0].caminho_anexo) {
      try {
        existingPaths = JSON.parse(check.rows[0].caminho_anexo);
      } catch (e) {
        existingPaths = [];
      }
    }

    let newPaths = existingPaths;
    if (req.files && req.files.length > 0) {
      newPaths = [];
      req.files.forEach((f) => {
        const relPath = "/uploads/relatorios/" + f.filename;
        newPaths.push(relPath);
      });
    }

    const updateQuery = `
      UPDATE relatorios_ocorrencias
      SET tipo_relatorio = $1,
          rota_id = $2,
          data_ocorrido = $3,
          corpo = $4,
          caminho_anexo = $5
      WHERE id = $6
    `;
    await pool.query(updateQuery, [
      tipo_relatorio,
      rota_id,
      data_ocorrido,
      corpo,
      JSON.stringify(newPaths),
      id,
    ]);

    return res.json({ success: true });
  } catch (error) {
    console.error("Erro ao editar relatório:", error);
    return res.status(500).json({ success: false, message: "Erro ao editar relatório." });
  }
});

app.delete("/api/relatorios/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const check = await pool.query("SELECT * FROM relatorios_ocorrencias WHERE id = $1", [id]);
    if (check.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Relatório não encontrado." });
    }

    await pool.query("DELETE FROM relatorios_ocorrencias WHERE id = $1", [id]);
    return res.json({ success: true });
  } catch (error) {
    console.error("Erro ao excluir relatório:", error);
    return res.status(500).json({ success: false, message: "Erro ao excluir relatório." });
  }
});

app.get("/api/relatorios-gerais", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM relatorios_gerais ORDER BY id DESC");
    let data = result.rows.map(r => {
      let anexos = [];
      if (r.caminho_anexo) {
        try {
          anexos = JSON.parse(r.caminho_anexo);
        } catch { }
      }
      return {
        id: r.id,
        tipo_relatorio: r.tipo_relatorio,
        data_relatorio: r.data_relatorio,
        corpo: r.corpo,
        caminho_anexo: anexos,
        created_at: r.created_at,
        updated_at: r.updated_at
      };
    });
    res.json(data);
  } catch (error) {
    res.status(500).json({ success: false, message: "Erro ao listar relatórios." });
  }
});

app.post("/api/relatorios-gerais/cadastrar", uploadRelatorios.array("anexo[]"), async (req, res) => {
  try {
    const { tipo_relatorio, data_relatorio, corpo } = req.body;
    let caminhos = [];
    if (req.files && req.files.length > 0) {
      req.files.forEach((f) => {
        const relPath = "/uploads/relatorios/" + f.filename;
        caminhos.push(relPath);
      });
    }
    const query = `
      INSERT INTO relatorios_gerais (
        tipo_relatorio, data_relatorio, corpo, caminho_anexo
      )
      VALUES ($1, $2, $3, $4)
      RETURNING id
    `;
    const values = [
      tipo_relatorio,
      data_relatorio,
      corpo,
      JSON.stringify(caminhos)
    ];
    const result = await pool.query(query, values);
    return res.json({ success: true, newId: result.rows[0].id });
  } catch (error) {
    console.error("Erro ao cadastrar relatório:", error);
    return res.status(500).json({ success: false, message: "Erro ao cadastrar relatório." });
  }
});

app.get("/api/relatorios-gerais/:id/gerar-pdf", async (req, res) => {
  function formatarDataPtBr(dataString) {
    const data = new Date(dataString);
    const meses = [
      "janeiro",
      "fevereiro",
      "março",
      "abril",
      "maio",
      "junho",
      "julho",
      "agosto",
      "setembro",
      "outubro",
      "novembro",
      "dezembro"
    ];
    const dia = data.getDate().toString().padStart(2, '0');
    const mes = meses[data.getMonth()];
    const ano = data.getFullYear();
    return `${dia} de ${mes} de ${ano}`;
  }

  const { id } = req.params;
  try {
    const result = await pool.query("SELECT * FROM relatorios_gerais WHERE id = $1", [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Relatório não encontrado." });
    }
    const relatorio = result.rows[0];
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const filename = `relatorio_${id}.pdf`;
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
    res.setHeader("Content-Type", "application/pdf");
    doc.pipe(res);

    const logoPath = path.join(__dirname, "public", "assets", "img", "logo_memorando1.png");
    if (fs.existsSync(logoPath)) {
      doc.image(logoPath, 50, 20, { width: 60 });
    }

    const separadorPath = path.join(__dirname, "public", "assets", "img", "memorando_separador.png");
    doc
      .fontSize(11)
      .font("Helvetica-Bold")
      .text("ESTADO DO PARÁ\nPREFEITURA MUNICIPAL DE CANAÃ DOS CARAJÁS\nSECRETARIA MUNICIPAL DE EDUCAÇÃO", 250, 20, {
        width: 300,
        align: "right"
      });

    if (fs.existsSync(separadorPath)) {
      const separadorX = (doc.page.width - 510) / 2;
      const separadorY = 90;
      doc.image(separadorPath, separadorX, separadorY, { width: 510 });
    }

    doc.y = 130;
    doc.x = 50;

    doc
      .fontSize(12)
      .font("Helvetica-Bold")
      .text(`RELATÓRIO GERAL N.º ${relatorio.id}/2025 - SECRETARIA MUNICIPAL DE EDUCAÇÃO`, { align: "justify" })
      .moveDown();

    const corpoAjustado = relatorio.corpo.replace(/\r\n/g, "\n").replace(/\r/g, "");

    doc
      .fontSize(12)
      .font("Helvetica")
      .text(`Tipo de Relatório: ${relatorio.tipo_relatorio}`, { align: "justify" })
      .text(`Data do Relatório: ${formatarDataPtBr(relatorio.data_relatorio)}`, { align: "justify" })
      .moveDown()
      .text("Prezados(as),", { align: "justify" })
      .moveDown()
      .text(corpoAjustado, { align: "justify" })
      .moveDown();

    const spaceNeededForSignature = 100;
    if (doc.y + spaceNeededForSignature > doc.page.height - 160) {
      doc.addPage();
    }

    const signatureY = doc.page.height - 270;
    doc.y = signatureY;
    doc.x = 50;

    doc
      .fontSize(12)
      .font("Helvetica")
      .text("Atenciosamente,", { align: "justify" })
      .moveDown(2);

    const signaturePath = path.join(__dirname, "public", "assets", "img", "signature.png");
    if (fs.existsSync(signaturePath)) {
      doc.image(signaturePath, 220, signatureY - 0, { width: 150 });
      doc.moveDown(0);
    }

    doc
      .text("DANILO DE MORAIS GUSTAVO", { align: "center" })
      .text("Gestor de Transporte Escolar", { align: "center" })
      .text("Portaria 118/2023 - GP", { align: "center" });

    if (fs.existsSync(separadorPath)) {
      const footerSepX = (doc.page.width - 510) / 2;
      const footerSepY = doc.page.height - 160;
      doc.image(separadorPath, footerSepX, footerSepY, { width: 510 });
    }

    const logo2Path = path.join(__dirname, "public", "assets", "img", "memorando_logo2.png");
    if (fs.existsSync(logo2Path)) {
      const logo2X = (doc.page.width - 160) / 2;
      const logo2Y = doc.page.height - 150;
      doc.image(logo2Path, logo2X, logo2Y, { width: 160 });
    }

    doc
      .fontSize(10)
      .font("Helvetica")
      .text("SECRETARIA MUNICIPAL DE EDUCAÇÃO - SEMED", 50, doc.page.height - 85, {
        width: doc.page.width - 100,
        align: "center"
      })
      .text("Rua Itamarati s/n - Bairro Novo Horizonte - CEP: 68.356-103 - Canaã dos Carajás - PA", {
        align: "center"
      })
      .text("Telefone: (94) 99293-4500", { align: "center" });

    let anexos = [];
    if (relatorio.caminho_anexo) {
      try {
        anexos = JSON.parse(relatorio.caminho_anexo);
      } catch { }
    }

    if (anexos.length > 0) {
      anexos.forEach((anexo, idx) => {
        const absoluteAnexo = path.join(__dirname, anexo);
        if (fs.existsSync(absoluteAnexo)) {
          doc.addPage();
          doc.fontSize(14).font("Helvetica-Bold").text(`Anexo ${idx + 1}:`, { align: "left" }).moveDown();
          const ext = path.extname(absoluteAnexo).toLowerCase();
          if (ext === ".jpg" || ext === ".jpeg" || ext === ".png") {
            doc.image(absoluteAnexo, { fit: [500, 700], align: "center", valign: "top" });
          } else if (ext === ".pdf") {
            doc
              .fontSize(12)
              .text("O anexo é um arquivo PDF. Abra separadamente:", { align: "left" })
              .moveDown()
              .font("Helvetica-Bold")
              .text(anexo, { link: anexo, underline: true });
          } else {
            doc
              .fontSize(12)
              .text("Arquivo anexo disponível em:", { align: "left" })
              .moveDown()
              .font("Helvetica-Bold")
              .text(anexo);
          }
        }
      });
    }

    doc.end();
  } catch (error) {
    res.status(500).json({ success: false, message: "Erro ao gerar PDF." });
  }
});

app.get("/api/relatorios-gerais/:id/gerar-docx", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query("SELECT * FROM relatorios_gerais WHERE id = $1", [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Relatório não encontrado." });
    }
    const relatorio = result.rows[0];
    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({
              text: `RELATÓRIO GERAL N.º ${relatorio.id}/2025 - SECRETARIA MUNICIPAL DE EDUCAÇÃO`,
              heading: HeadingLevel.HEADING1,
              alignment: AlignmentType.CENTER
            }),
            new Paragraph({ text: "", spacing: { after: 200 } }),
            new Paragraph({
              text: `Tipo de Relatório: ${relatorio.tipo_relatorio}`,
              spacing: { after: 200 }
            }),
            new Paragraph({
              text: `Data do Relatório: ${relatorio.data_relatorio}`,
              spacing: { after: 200 }
            }),
            new Paragraph({ text: "Prezados(as),", spacing: { after: 200 } }),
            new Paragraph({ text: "Descrição:", bold: true, underline: {}, spacing: { after: 100 } }),
            new Paragraph({ text: relatorio.corpo, spacing: { after: 400 } }),
            new Paragraph({ text: "Atenciosamente,", spacing: { after: 400 } }),
            new Paragraph({ text: "DANILO DE MORAIS GUSTAVO", alignment: AlignmentType.CENTER }),
            new Paragraph({ text: "Gestor de Transporte Escolar", alignment: AlignmentType.CENTER }),
            new Paragraph({ text: "Portaria 118/2023 - GP", alignment: AlignmentType.CENTER })
          ]
        }
      ]
    });
    const buffer = await Packer.toBuffer(doc);
    const filename = `relatorio_${id}.docx`;
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.send(buffer);
  } catch (error) {
    res.status(500).json({ success: false, message: "Erro ao gerar DOCX." });
  }
});

app.put("/api/relatorios-gerais/:id", uploadRelatorios.array("editar_anexo"), async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query("SELECT * FROM relatorios_gerais WHERE id = $1", [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Relatório não encontrado." });
    }
    const relatorio = result.rows[0];
    let anexosExistentes = [];
    if (relatorio.caminho_anexo) {
      try {
        anexosExistentes = JSON.parse(relatorio.caminho_anexo);
      } catch { }
    }
    let arquivosNovos = [];
    if (req.files && req.files.length > 0) {
      arquivosNovos = req.files.map(file => {
        return path.relative(__dirname, file.path).replace(/\\/g, "/");
      });
    }
    let caminho_anexo_final = anexosExistentes;
    if (arquivosNovos.length > 0) {
      caminho_anexo_final = arquivosNovos;
    }
    const tipo_relatorio = req.body.editar_tipo_relatorio || relatorio.tipo_relatorio;
    const data_relatorio = req.body.editar_data_relatorio || relatorio.data_relatorio;
    const corpo = req.body.editar_corpo || relatorio.corpo;
    await pool.query(
      "UPDATE relatorios_gerais SET tipo_relatorio=$1, data_relatorio=$2, corpo=$3, caminho_anexo=$4, updated_at=NOW() WHERE id=$5",
      [tipo_relatorio, data_relatorio, corpo, JSON.stringify(caminho_anexo_final), id]
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: "Erro ao atualizar relatório." });
  }
});

app.delete("/api/relatorios-gerais/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query("SELECT * FROM relatorios_gerais WHERE id = $1", [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Relatório não encontrado." });
    }
    await pool.query("DELETE FROM relatorios_gerais WHERE id = $1", [id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: "Erro ao excluir relatório." });
  }
});

app.get("/api/relatorios/:id/gerar-pdf", async (req, res) => {
  function formatarDataPtBr(dataString) {
    const data = new Date(dataString);
    const meses = [
      "janeiro",
      "fevereiro",
      "março",
      "abril",
      "maio",
      "junho",
      "julho",
      "agosto",
      "setembro",
      "outubro",
      "novembro",
      "dezembro"
    ];
    const dia = data.getDate().toString().padStart(2, '0');
    const mes = meses[data.getMonth()];
    const ano = data.getFullYear();
    return `${dia} de ${mes} de ${ano}`;
  }
  const { id } = req.params;
  try {
    const result = await pool.query("SELECT * FROM relatorios_ocorrencias WHERE id = $1", [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Relatório não encontrado." });
    }
    const relatorio = result.rows[0];
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const filename = `relatorio_${id}.pdf`;
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
    res.setHeader("Content-Type", "application/pdf");
    doc.pipe(res);

    const logoPath = path.join(__dirname, "public", "assets", "img", "logo_memorando1.png");
    if (fs.existsSync(logoPath)) {
      doc.image(logoPath, 50, 20, { width: 60 });
    }

    const separadorPath = path.join(
      __dirname,
      "public",
      "assets",
      "img",
      "memorando_separador.png"
    );

    doc
      .fontSize(11)
      .font("Helvetica-Bold")
      .text(
        "ESTADO DO PARÁ\n" +
        "PREFEITURA MUNICIPAL DE CANAÃ DOS CARAJÁS\n" +
        "SECRETARIA MUNICIPAL DE EDUCAÇÃO",
        250,
        20,
        { width: 300, align: "right" }
      );

    if (fs.existsSync(separadorPath)) {
      const separadorX = (doc.page.width - 510) / 2;
      const separadorY = 90;
      doc.image(separadorPath, separadorX, separadorY, { width: 510 });
    }

    doc.y = 130;
    doc.x = 50;

    doc
      .fontSize(12)
      .font("Helvetica-Bold")
      .text(`RELATÓRIO DE OCORRÊNCIA N.º ${relatorio.id}/2025 - SECRETARIA MUNICIPAL DE EDUCAÇÃO`, {
        align: "justify",
      })
      .moveDown();

    const corpoAjustado = relatorio.corpo.replace(/\r\n/g, "\n").replace(/\r/g, "");

    doc
      .fontSize(12)
      .font("Helvetica")
      .text(`Tipo de Relatório: ${relatorio.tipo_relatorio}`, { align: "justify" })
      .text(`Rota ID: ${relatorio.rota_id}`, { align: "justify" })
      .text(`Data do Ocorrido: ${formatarDataPtBr(relatorio.data_ocorrido)}`, { align: "justify" })
      .moveDown()
      .text("Prezados(as),", { align: "justify" })
      .moveDown()
      .text(corpoAjustado, { align: "justify" })
      .moveDown();

    const spaceNeededForSignature = 100;
    if (doc.y + spaceNeededForSignature > doc.page.height - 160) {
      doc.addPage();
    }

    const signatureY = doc.page.height - 270;
    doc.y = signatureY;
    doc.x = 50;

    doc
      .fontSize(12)
      .font("Helvetica")
      .text("Atenciosamente,", { align: "justify" })
      .moveDown(2);

    const signaturePath = path.join(__dirname, "public", "assets", "img", "signature.png");
    if (fs.existsSync(signaturePath)) {
      doc.image(signaturePath, 220, signatureY - 0, { width: 150 });
      doc.moveDown(0);
    }

    doc
      .text("DANILO DE MORAIS GUSTAVO", { align: "center" })
      .text("Gestor de Transporte Escolar", { align: "center" })
      .text("Portaria 118/2023 - GP", { align: "center" });

    if (fs.existsSync(separadorPath)) {
      const footerSepX = (doc.page.width - 510) / 2;
      const footerSepY = doc.page.height - 160;
      doc.image(separadorPath, footerSepX, footerSepY, { width: 510 });
    }

    const logo2Path = path.join(
      __dirname,
      "public",
      "assets",
      "img",
      "memorando_logo2.png"
    );
    if (fs.existsSync(logo2Path)) {
      const logo2X = (doc.page.width - 160) / 2;
      const logo2Y = doc.page.height - 150;
      doc.image(logo2Path, logo2X, logo2Y, { width: 160 });
    }

    doc
      .fontSize(10)
      .font("Helvetica")
      .text(
        "SECRETARIA MUNICIPAL DE EDUCAÇÃO - SEMED",
        50,
        doc.page.height - 85,
        {
          width: doc.page.width - 100,
          align: "center",
        }
      )
      .text(
        "Rua Itamarati s/n - Bairro Novo Horizonte - CEP: 68.356-103 - Canaã dos Carajás - PA",
        {
          align: "center",
        }
      )
      .text("Telefone: (94) 99293-4500", { align: "center" });

    if (relatorio.caminho_anexo) {
      let anexos = [];
      try {
        anexos = JSON.parse(relatorio.caminho_anexo);
      } catch (e) {
        anexos = [];
      }
      if (anexos.length > 0) {
        anexos.forEach((anexo, idx) => {
          const absoluteAnexo = path.join(__dirname, anexo);
          if (fs.existsSync(absoluteAnexo)) {
            doc.addPage();
            doc.fontSize(14).font("Helvetica-Bold").text(`Anexo ${idx + 1}:`, { align: "left" }).moveDown();
            const ext = path.extname(absoluteAnexo).toLowerCase();
            if (ext === ".jpg" || ext === ".jpeg" || ext === ".png") {
              doc.image(absoluteAnexo, {
                fit: [500, 700],
                align: "center",
                valign: "top",
              });
            } else if (ext === ".pdf") {
              doc
                .fontSize(12)
                .text("O anexo é um arquivo PDF. Abra separadamente:", { align: "left" })
                .moveDown()
                .font("Helvetica-Bold")
                .text(anexo, { link: anexo, underline: true });
            } else {
              doc
                .fontSize(12)
                .text("Arquivo anexo disponível em:", { align: "left" })
                .moveDown()
                .font("Helvetica-Bold")
                .text(anexo);
            }
          }
        });
      }
    }

    doc.end();
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Erro ao gerar PDF.",
    });
  }
});



app.get("/api/relatorios/:id/gerar-docx", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query("SELECT * FROM relatorios_ocorrencias WHERE id = $1", [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Relatório não encontrado." });
    }
    const relatorio = result.rows[0];
    const docxContent = `
      RELATÓRIO DE OCORRÊNCIA
      ID: ${relatorio.id}
      Tipo: ${relatorio.tipo_relatorio}
      Rota: ${relatorio.rota_id}
      Data: ${relatorio.data_ocorrido}
      Descrição: ${relatorio.corpo}
    `;
    const buffer = Buffer.from(docxContent, "utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="relatorio_${id}.docx"`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    return res.send(buffer);
  } catch (error) {
    console.error("Erro ao gerar DOCX:", error);
    return res.status(500).json({ success: false, message: "Erro ao gerar DOCX." });
  }
});

// ====> ROTA /api/admin/update-user (PUT)
// Atualiza permissões do usuário
app.put("/api/admin/update-user", async (req, res) => {
  try {
    const { id, permissoes } = req.body;
    const updateQuery = `
      UPDATE usuarios
      SET permissoes = $1
      WHERE id = $2
    `;
    await pool.query(updateQuery, [permissoes, id]);
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Erro ao atualizar usuário:", error);
    return res.status(500).json({ error: "Erro interno ao atualizar usuário." });
  }
});

// ====> ROTA /api/admin/toggle-init (PUT)
// Atualiza o campo init (permitir/restringir acesso)
app.put("/api/admin/toggle-init", async (req, res) => {
  try {
    const { id, init } = req.body;
    const updateQuery = `
      UPDATE usuarios
      SET init = $1
      WHERE id = $2
    `;
    await pool.query(updateQuery, [init, id]);
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Erro ao atualizar init do usuário:", error);
    return res.status(500).json({ error: "Erro interno ao atualizar init do usuário." });
  }
});
app.get("/api/fornecedor/meu", async (req, res) => {
  try {
    // exemplo de obtenção do userId da sessão
    const userId = req.session?.userId;
    if (!userId) {
      return res.status(401).json({ error: "Usuário não está logado." });
    }

    // Buscando o fornecedor_id na tabela usuario_fornecedor
    const relForn = await pool.query(
      "SELECT fornecedor_id FROM usuario_fornecedor WHERE usuario_id = $1 LIMIT 1",
      [userId]
    );

    if (relForn.rows.length === 0) {
      // Não encontrou vínculo: retorna null ou erro
      return res.json({ fornecedor_id: null });
    }

    // Se encontrou, retorna
    return res.json({ fornecedor_id: relForn.rows[0].fornecedor_id });
  } catch (error) {
    console.error("Erro ao buscar fornecedor do usuário:", error);
    return res.status(500).json({ error: "Erro interno ao buscar fornecedor do usuário." });
  }
});

// Exemplo de rota no backend (Express) para contadores do fornecedor
// Ajustar conforme seu sistema
app.get("/api/fornecedor/dashboard", async (req, res) => {
  try {
    // Exemplo: obter o fornecedor_id pelo usuário logado, se estiver em session
    const userId = req.session.userId;
    // Se tiver tabela de relacionamento 'usuario_fornecedor' para saber qual o fornecedor do user:
    const relQuery = `SELECT fornecedor_id FROM usuario_fornecedor WHERE usuario_id = $1 LIMIT 1`;
    const relResult = await pool.query(relQuery, [userId]);
    if (relResult.rows.length === 0) {
      return res.json({ monitores: 0, motoristas: 0, veiculos: 0 });
    }
    const fornecedorId = relResult.rows[0].fornecedor_id;

    // Contar monitores
    const countMonitores = await pool.query(
      `SELECT COUNT(*) AS total FROM monitores WHERE fornecedor_id = $1`,
      [fornecedorId]
    );
    // Contar motoristas
    const countMotoristas = await pool.query(
      `SELECT COUNT(*) AS total FROM motoristas WHERE fornecedor_id = $1`,
      [fornecedorId]
    );
    // Contar frota
    const countFrota = await pool.query(
      `SELECT COUNT(*) AS total FROM frota WHERE fornecedor_id = $1`,
      [fornecedorId]
    );

    return res.json({
      monitores: countMonitores.rows[0].total,
      motoristas: countMotoristas.rows[0].total,
      veiculos: countFrota.rows[0].total
    });
  } catch (error) {
    console.error("Erro ao carregar dados do fornecedor:", error);
    return res.status(500).json({ error: "Erro interno ao carregar dados do fornecedor." });
  }
});


// ====> ROTA /api/admin/delete-user/:id (DELETE)
// Exclui o usuário pelo ID
app.delete("/api/admin/delete-user/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const deleteQuery = `
      DELETE FROM usuarios
      WHERE id = $1
    `;
    await pool.query(deleteQuery, [id]);
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Erro ao excluir usuário:", error);
    return res.status(500).json({ error: "Erro interno ao excluir usuário." });
  }
});

// ROTA: CADASTRAR USUÁRIO

app.get("/api/usuarios/perfil", isAuthenticated, async (req, res) => {
  try {
    const userId = req.session.userId;
    const query = `
        SELECT
          id,
          nome_completo,
          cpf,
          cnpj,
          telefone,
          email,
          rg,
          data_nascimento,
          cep,
          cidade,
          estado,
          logradouro,
          numero,
          complemento,
          link_foto_perfil,
          doc_rg_path,
          doc_contrato_path,
          preferencia_tema,
          notificacoes_email,
          linguagem,
          auth_dois_fatores,
          pergunta_seguranca
        FROM usuarios
        WHERE id = $1
        LIMIT 1
      `;
    const result = await pool.query(query, [userId]);
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Usuário não encontrado.",
      });
    }
    return res.json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    console.error("Erro ao buscar perfil:", error);
    return res.status(500).json({
      success: false,
      message: "Erro interno ao buscar perfil do usuário.",
    });
  }
});

app.put("/api/usuarios/perfil", isAuthenticated, async (req, res) => {
  try {
    const userId = req.session.userId;
    const {
      nome_completo,
      cpf,
      cnpj,
      telefone,
      email,
      rg,
      data_nascimento,
      cep,
      cidade,
      estado,
      logradouro,
      numero,
      complemento,
    } = req.body;

    const query = `
        UPDATE usuarios
        SET
          nome_completo = $1,
          cpf = $2,
          cnpj = $3,
          telefone = $4,
          email = $5,
          rg = $6,
          data_nascimento = $7,
          cep = $8,
          cidade = $9,
          estado = $10,
          logradouro = $11,
          numero = $12,
          complemento = $13
        WHERE id = $14
        RETURNING id
      `;
    const values = [
      nome_completo || null,
      cpf || null,
      cnpj || null,
      telefone || null,
      email || null,
      rg || null,
      data_nascimento || null,
      cep || null,
      cidade || null,
      estado || null,
      logradouro || null,
      numero || null,
      complemento || null,
      userId,
    ];
    const result = await pool.query(query, values);
    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Usuário não encontrado para atualizar.",
      });
    }

    // Você pode inserir notificação aqui, se desejar:
    // ...

    return res.json({
      success: true,
      message: "Perfil atualizado com sucesso!",
    });
  } catch (error) {
    console.error("Erro ao atualizar perfil:", error);
    return res.status(500).json({
      success: false,
      message: "Erro interno ao atualizar perfil.",
    });
  }
});

app.put("/api/usuarios/preferencias", isAuthenticated, async (req, res) => {
  try {
    const userId = req.session.userId;
    const { preferencia_tema, notificacoes_email, linguagem } = req.body;

    const query = `
        UPDATE usuarios
        SET
          preferencia_tema = $1,
          notificacoes_email = $2,
          linguagem = $3
        WHERE id = $4
        RETURNING id
      `;
    const values = [
      preferencia_tema || null,
      notificacoes_email || null,
      linguagem || null,
      userId,
    ];
    const result = await pool.query(query, values);
    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Usuário não encontrado para atualizar preferências.",
      });
    }

    return res.json({
      success: true,
      message: "Preferências do usuário atualizadas com sucesso!",
    });
  } catch (error) {
    console.error("Erro ao atualizar preferências:", error);
    return res.status(500).json({
      success: false,
      message: "Erro interno ao atualizar preferências.",
    });
  }
});

app.put(
  "/api/usuarios/documentos",
  isAuthenticated,
  uploadUsuarios.fields([
    { name: "profilePic", maxCount: 1 },
    { name: "docRg", maxCount: 1 },
    { name: "docContrato", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const userId = req.session.userId;

      let linkFotoPerfil = null;
      let docRgPath = null;
      let docContratoPath = null;

      if (req.files["profilePic"] && req.files["profilePic"].length > 0) {
        linkFotoPerfil =
          "uploads/usuarios/" + req.files["profilePic"][0].filename;
      }
      if (req.files["docRg"] && req.files["docRg"].length > 0) {
        docRgPath = "uploads/usuarios/" + req.files["docRg"][0].filename;
      }
      if (req.files["docContrato"] && req.files["docContrato"].length > 0) {
        docContratoPath =
          "uploads/usuarios/" + req.files["docContrato"][0].filename;
      }

      // Se desejar, pesquise os valores antigos do usuário
      // para excluir arquivos anteriores, se isso fizer sentido.

      // Montar o fragmento de UPDATE só para os campos enviados:
      const fieldsToSet = [];
      const values = [];
      let idx = 1;

      if (linkFotoPerfil) {
        fieldsToSet.push(` link_foto_perfil = $${idx++}`);
        values.push(linkFotoPerfil);
      }
      if (docRgPath) {
        fieldsToSet.push(` doc_rg_path = $${idx++}`);
        values.push(docRgPath);
      }
      if (docContratoPath) {
        fieldsToSet.push(` doc_contrato_path = $${idx++}`);
        values.push(docContratoPath);
      }
      if (fieldsToSet.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Nenhum arquivo enviado.",
        });
      }

      const query = `
          UPDATE usuarios
          SET ${fieldsToSet.join(",")}
          WHERE id = $${idx}
          RETURNING id
        `;
      values.push(userId);

      const result = await pool.query(query, values);
      if (result.rowCount === 0) {
        return res.status(404).json({
          success: false,
          message: "Usuário não encontrado para atualizar documentos.",
        });
      }

      return res.json({
        success: true,
        message: "Documentos/Foto atualizados com sucesso!",
      });
    } catch (error) {
      console.error("Erro ao atualizar documentos de usuário:", error);
      return res.status(500).json({
        success: false,
        message: "Erro interno ao atualizar documentos do usuário.",
      });
    }
  }
);

// Exemplo de rota para atualização de segurança do usuário com bcrypt:
app.put("/api/usuarios/seguranca", isAuthenticated, async (req, res) => {
  try {
    const userId = req.session.userId;
    const { nova_senha, auth_dois_fatores, pergunta_seguranca } = req.body;

    let updateFields = "";
    const values = [];
    let index = 1;

    // Se o usuário forneceu nova senha, vamos criptografá-la com bcrypt
    if (nova_senha) {
      const bcrypt = require("bcrypt");
      const saltRounds = 10;
      const hashedPassword = await bcrypt.hash(nova_senha, saltRounds);

      updateFields += ` senha = $${index++},`;
      values.push(hashedPassword);
    }

    if (auth_dois_fatores !== undefined) {
      updateFields += ` auth_dois_fatores = $${index++},`;
      values.push(auth_dois_fatores);
    }

    if (pergunta_seguranca !== undefined) {
      updateFields += ` pergunta_seguranca = $${index++},`;
      values.push(pergunta_seguranca);
    }

    if (!updateFields) {
      return res.status(400).json({
        success: false,
        message: "Nenhum campo de segurança fornecido para atualizar.",
      });
    }

    // Remove a última vírgula
    updateFields = updateFields.slice(0, -1);

    // Monta a query dinâmica
    const query = `
        UPDATE usuarios
        SET ${updateFields}
        WHERE id = $${index}
        RETURNING id
      `;

    values.push(userId);

    const result = await pool.query(query, values);
    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Usuário não encontrado para atualizar segurança.",
      });
    }

    return res.json({
      success: true,
      message: "Configurações de segurança atualizadas com sucesso!",
    });
  } catch (error) {
    console.error("Erro ao atualizar segurança:", error);
    return res.status(500).json({
      success: false,
      message: "Erro interno ao atualizar segurança do usuário.",
    });
  }
});

app.post("/api/cadastrar-usuario", async (req, res) => {
  try {
    const { nome_completo, cpf_cnpj, telefone, email, senha } = req.body;

    // 1) Verificar se e-mail já existe
    const checkEmail = await pool.query(
      "SELECT id FROM usuarios WHERE email = $1 LIMIT 1",
      [email]
    );
    if (checkEmail.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Este e-mail já está em uso. Tente outro.",
      });
    }

    // 2) Limpa pontuação do CPF/CNPJ
    const docNumeros = (cpf_cnpj || "").replace(/\D/g, "");
    let cpfValue = null;
    let cnpjValue = null;

    // 3) Decide se é CPF (11 dígitos) ou CNPJ (14 dígitos)
    if (docNumeros.length === 11) {
      cpfValue = docNumeros;
    } else if (docNumeros.length === 14) {
      cnpjValue = docNumeros;
    } else {
      return res.status(400).json({
        success: false,
        message: "Documento inválido: deve ter 11 dígitos (CPF) ou 14 (CNPJ).",
      });
    }

    // 4) Verifica se já existe o mesmo CPF ou CNPJ
    if (cpfValue) {
      const checkCPF = await pool.query(
        "SELECT id FROM usuarios WHERE cpf = $1 LIMIT 1",
        [cpfValue]
      );
      if (checkCPF.rows.length > 0) {
        return res.status(400).json({
          success: false,
          message: "Este CPF já está em uso. Tente outro.",
        });
      }
    } else if (cnpjValue) {
      const checkCNPJ = await pool.query(
        "SELECT id FROM usuarios WHERE cnpj = $1 LIMIT 1",
        [cnpjValue]
      );
      if (checkCNPJ.rows.length > 0) {
        return res.status(400).json({
          success: false,
          message: "Este CNPJ já está em uso. Tente outro.",
        });
      }
    }

    // 5) Criptografa a senha
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(senha, saltRounds);

    // 6) Insere no banco (init = FALSE por padrão)
    const insertQuery = `
            INSERT INTO usuarios (
                nome_completo, cpf, cnpj, telefone, email, senha, init
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING id
        `;
    const initValue = false;
    const values = [
      nome_completo,
      cpfValue,
      cnpjValue,
      telefone,
      email,
      hashedPassword,
      initValue,
    ];
    const result = await pool.query(insertQuery, values);
    if (result.rows.length > 0) {
      return res.status(200).json({
        success: true,
        message:
          "Cadastro realizado com sucesso! Aguarde ativação ou permissões.",
      });
    } else {
      return res.status(500).json({
        success: false,
        message: "Não foi possível cadastrar o usuário (erro interno).",
      });
    }
  } catch (error) {
    console.error("Erro ao cadastrar usuário:", error);

    if (error.code === "23505") {
      return res.status(400).json({
        success: false,
        message:
          "Violação de exclusividade. Verifique se email/CPF/CNPJ já existe.",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Erro ao cadastrar usuário. Tente novamente.",
    });
  }
});


// ROTA: LOGIN

app.post("/api/login", async (req, res) => {
  try {
    const { email, senha } = req.body;
    const userQuery = `
      SELECT id, senha, init, permissoes
      FROM usuarios
      WHERE email = $1
      LIMIT 1
    `;
    const result = await pool.query(userQuery, [email]);
    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Usuário não encontrado."
      });
    }
    const usuario = result.rows[0];
    if (!usuario.init) {
      return res.status(403).json({
        success: false,
        message: "Usuário ainda não está inicializado para acesso."
      });
    }
    const match = await bcrypt.compare(senha, usuario.senha);
    if (!match) {
      return res.status(401).json({
        success: false,
        message: "Senha incorreta."
      });
    }
    req.session.userId = usuario.id;
    let redirectUrl = "/pages/transporte-escolar/dashboard-escolar.html";
    if (usuario.permissoes) {
      if (
        usuario.permissoes.includes("admin") ||
        usuario.permissoes.includes("gestor")
      ) {
        redirectUrl = "/pages/transporte-escolar/dashboard-escolar.html";
      } else if (
        usuario.permissoes.includes("locan") ||
        usuario.permissoes.includes("talisma") ||
        usuario.permissoes.includes("ctl") ||
        usuario.permissoes.includes("roma") ||
        usuario.permissoes.includes("diamond")
      ) {
        redirectUrl = "/dashboard-fornecedor.html";
      }
    }
    return res.status(200).json({
      success: true,
      message: "Login bem sucedido!",
      redirectUrl
    });
  } catch (error) {
    console.error("Erro ao efetuar login:", error);
    return res.status(500).json({
      success: false,
      message: "Erro interno ao efetuar login."
    });
  }
});

// ====> api/admin-login (Node/Express) <====
// A rota que valida se o usuário pode acessar a área administrativa
app.post("/api/admin-login", async (req, res) => {
  try {
    const { email, senha } = req.body;
    const userQuery = `
      SELECT id, senha, init, permissoes
      FROM usuarios
      WHERE email = $1
      LIMIT 1
    `;
    const result = await pool.query(userQuery, [email]);

    // Verifica se o usuário existe
    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Usuário admin não encontrado.",
      });
    }

    const usuario = result.rows[0];

    // Verifica se está liberado (init = true)
    if (!usuario.init) {
      return res.status(403).json({
        success: false,
        message: "Usuário ainda não está inicializado para acesso.",
      });
    }

    // Verifica senha
    const match = await bcrypt.compare(senha, usuario.senha);
    if (!match) {
      return res.status(401).json({
        success: false,
        message: "Senha incorreta.",
      });
    }

    // Verifica se é admin (id = 1) ou se tem permissão master
    const temPermissaoAdmin = (
      usuario.id === 1 ||
      (usuario.permissoes && usuario.permissoes.includes("master"))
    );

    if (!temPermissaoAdmin) {
      return res.status(403).json({
        success: false,
        message: "Acesso administrativo negado.",
      });
    }

    // Se chegou até aqui, usuário pode logar na área administrativa
    req.session.userId = usuario.id; // se estiver usando express-session

    return res.status(200).json({
      success: true,
      message: "Login de admin bem-sucedido!",
      redirectUrl: "/dashboard-admin.html",
    });
  } catch (error) {
    console.error("Erro ao efetuar login admin:", error);
    return res.status(500).json({
      success: false,
      message: "Erro interno ao efetuar login de admin.",
    });
  }
});


// GET /api/usuario-logado
app.get("/api/usuario-logado", async (req, res) => {
  try {
    if (!req.session || !req.session.userId) {
      return res.json({
        success: false,
        message: "Usuário não está logado."
      });
    }
    const userQuery = `
        SELECT
          id,
          nome_completo,
          cpf,
          cnpj,
          telefone,
          email,
          endereco,
          cidade,
          estado,
          cep,
          foto_perfil,
          pergunta_seguranca,
          autenticacao_dois_fatores,
          tema_preferido,
          notificacoes_email,
          linguagem_preferida
        FROM usuarios
        WHERE id = $1
        LIMIT 1
      `;
    const result = await pool.query(userQuery, [req.session.userId]);
    if (result.rows.length === 0) {
      return res.json({
        success: false,
        message: "Usuário não encontrado no banco."
      });
    }
    const usuario = result.rows[0];
    return res.json({
      success: true,
      id: usuario.id,
      nome_completo: usuario.nome_completo,
      email: usuario.email,
      cpf: usuario.cpf,
      cnpj: usuario.cnpj,
      telefone: usuario.telefone,
      endereco: usuario.endereco,
      cidade: usuario.cidade,
      estado: usuario.estado,
      cep: usuario.cep,
      foto_perfil: usuario.foto_perfil,
      pergunta_seguranca: usuario.pergunta_seguranca,
      autenticacao_dois_fatores: usuario.autenticacao_dois_fatores,
      tema_preferido: usuario.tema_preferido,
      notificacoes_email: usuario.notificacoes_email,
      linguagem_preferida: usuario.linguagem_preferida
    });
  } catch (error) {
    console.error("Erro ao buscar /api/usuario-logado:", error);
    return res.status(500).json({
      success: false,
      message: "Erro interno do servidor."
    });
  }
});

// POST /api/atualizar-usuario
app.post("/api/atualizar-usuario", async (req, res) => {
  try {
    if (!req.session || !req.session.userId) {
      return res.json({
        success: false,
        message: "Usuário não está logado."
      });
    }
    const {
      nome_completo,
      email,
      cpf,
      cnpj,
      telefone,
      endereco,
      cidade,
      estado,
      cep,
      foto_perfil,
      pergunta_seguranca,
      autenticacao_dois_fatores,
      tema_preferido,
      notificacoes_email,
      linguagem_preferida
    } = req.body;
    const updateQuery = `
      UPDATE usuarios SET
        nome_completo = $1,
        email = $2,
        cpf = $3,
        cnpj = $4,
        telefone = $5,
        endereco = $6,
        cidade = $7,
        estado = $8,
        cep = $9,
        foto_perfil = $10,
        pergunta_seguranca = $11,
        autenticacao_dois_fatores = $12,
        tema_preferido = $13,
        notificacoes_email = $14,
        linguagem_preferida = $15
      WHERE id = $16
      RETURNING *;
    `;
    const values = [
      nome_completo,
      email,
      cpf,
      cnpj,
      telefone,
      endereco,
      cidade,
      estado,
      cep,
      foto_perfil,
      pergunta_seguranca,
      autenticacao_dois_fatores,
      tema_preferido,
      notificacoes_email,
      linguagem_preferida,
      req.session.userId
    ];
    const result = await pool.query(updateQuery, values);
    if (result.rowCount === 0) {
      return res.json({
        success: false,
        message: "Usuário não encontrado ou sem alterações."
      });
    }
    return res.json({
      success: true,
      message: "Dados atualizados com sucesso!",
      usuario: result.rows[0]
    });
  } catch (error) {
    console.error("Erro ao atualizar usuário:", error);
    return res.status(500).json({
      success: false,
      message: "Erro interno do servidor."
    });
  }
});


// ====================================================================================
// ZONEAMENTOS
// ====================================================================================
app.post("/api/zoneamento/cadastrar", async (req, res) => {
  try {
    const { nome_zoneamento, geojson } = req.body;

    if (!nome_zoneamento || !geojson) {
      return res.status(400).json({
        success: false,
        message: "Nome do zoneamento ou GeoJSON não fornecidos.",
      });
    }

    let parsed;
    try {
      parsed = JSON.parse(geojson);
    } catch (err) {
      return res.status(400).json({
        success: false,
        message: "GeoJSON inválido.",
      });
    }

    if (!parsed.type || parsed.type !== "Feature" || !parsed.geometry) {
      return res.status(400).json({
        success: false,
        message: "GeoJSON inválido ou sem geometry.",
      });
    }

    // Permitir Polygon ou LineString
    const validTypes = ["Polygon", "LineString"];
    if (!validTypes.includes(parsed.geometry.type)) {
      return res.status(400).json({
        success: false,
        message: "GeoJSON deve ser Polygon ou LineString.",
      });
    }

    const userId = req.session?.userId || null;

    // Insere
    const insertQuery = `
        INSERT INTO zoneamentos (nome, geom)
        VALUES ($1, ST_SetSRID(ST_GeomFromGeoJSON($2), 4326))
        RETURNING id;
      `;
    const insertValues = [nome_zoneamento, JSON.stringify(parsed.geometry)];
    const result = await pool.query(insertQuery, insertValues);

    if (result.rows.length > 0) {
      const newId = result.rows[0].id;
      // Notificação
      const mensagem = `Zoneamento criado: ${nome_zoneamento}`;
      await pool.query(
        `INSERT INTO notificacoes (user_id, acao, tabela, registro_id, mensagem)
           VALUES ($1, 'CREATE', 'zoneamentos', $2, $3)`,
        [userId, newId, mensagem]
      );
      return res.json({
        success: true,
        message: "Zoneamento cadastrado com sucesso!",
        id: newId,
      });
    } else {
      return res.status(500).json({
        success: false,
        message: "Erro ao cadastrar zoneamento.",
      });
    }
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Erro interno do servidor.",
    });
  }
});

app.get("/api/zoneamentos", async (req, res) => {
  try {
    const query = `
            SELECT
                id,
                nome,
                ST_AsGeoJSON(geom) as geojson
            FROM zoneamentos;
        `;
    const result = await pool.query(query);
    const zoneamentos = result.rows.map((row) => ({
      id: row.id,
      nome: row.nome,
      geojson: JSON.parse(row.geojson),
    }));
    res.json(zoneamentos);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Erro interno do servidor.",
    });
  }
});

app.delete("/api/zoneamento/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // Quem está fazendo a ação?
    const userId = req.session?.userId || null;

    // Buscar o nome do zoneamento antes de deletar (para log)
    const busca = await pool.query(
      "SELECT nome FROM zoneamentos WHERE id = $1",
      [id]
    );
    if (busca.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Zoneamento não encontrado.",
      });
    }
    const nomeZoneamento = busca.rows[0].nome;

    const deleteQuery = "DELETE FROM zoneamentos WHERE id = $1";
    const result = await pool.query(deleteQuery, [id]);

    if (result.rowCount > 0) {
      // REGISTRA NOTIFICAÇÃO
      const mensagem = `Zoneamento excluído: ${nomeZoneamento}`;
      const acao = "DELETE";
      const tabela = "zoneamentos";
      await pool.query(
        `INSERT INTO notificacoes (user_id, acao, tabela, registro_id, mensagem)
                 VALUES ($1, $2, $3, $4, $5)`,
        [userId, acao, tabela, id, mensagem]
      );

      res.json({
        success: true,
        message: "Zoneamento excluído com sucesso!",
      });
    } else {
      res.status(404).json({
        success: false,
        message: "Zoneamento não encontrado.",
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Erro interno do servidor.",
    });
  }
});

app.post(
  "/api/zoneamento/importar",
  upload.single("file"),
  async (req, res) => {
    try {
      const filePath = req.file.path;
      const originalName = req.file.originalname;
      const geojson = await convertToGeoJSON(filePath, originalName);
      const features = geojson.features || [];

      // (Opcional: pode registrar apenas 1 notificação "Importação de zoneamentos" em vez de uma por feature)
      // Quem está fazendo a ação?
      const userId = req.session?.userId || null;

      for (const feature of features) {
        const props = feature.properties || {};
        const geometry = feature.geometry;
        const nome = props.nome || props.bairros || "Sem nome";
        const lote = props.lote || "Sem número";
        if (!geometry) continue;

        const insertQuery = `
                INSERT INTO zoneamentos (nome, lote, geom)
                VALUES ($1, $2, ST_SetSRID(ST_Force2D(ST_GeomFromGeoJSON($3)), 4326))
                RETURNING id;
            `;
        const values = [nome, lote, JSON.stringify(geometry)];
        const result = await pool.query(insertQuery, values);

        if (result.rows.length > 0) {
          const newId = result.rows[0].id;
          // Notificação por cada polígono criado:
          const mensagem = `Zoneamento importado/criado: ${nome}`;
          const acao = "CREATE";
          const tabela = "zoneamentos";
          await pool.query(
            `INSERT INTO notificacoes (user_id, acao, tabela, registro_id, mensagem)
                     VALUES ($1, $2, $3, $4, $5)`,
            [userId, acao, tabela, newId, mensagem]
          );
        }
      }
      fs.unlinkSync(filePath);
      res.json({
        success: true,
        message: "Importação concluída com sucesso!",
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Erro interno do servidor.",
      });
    }
  }
);

app.put("/api/zoneamento/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { nome_zoneamento, geojson } = req.body;

    if (!nome_zoneamento || !geojson) {
      return res.status(400).json({ success: false, message: "Nome ou GeoJSON não fornecidos." });
    }

    let parsed;
    try { parsed = JSON.parse(geojson); }
    catch { return res.status(400).json({ success: false, message: "GeoJSON inválido." }); }

    if (parsed.type !== "Feature" || !parsed.geometry)
      return res.status(400).json({ success: false, message: "GeoJSON inválido ou sem geometry." });

    const validTypes = ["Polygon", "LineString"];
    if (!validTypes.includes(parsed.geometry.type))
      return res.status(400).json({ success: false, message: "GeoJSON deve ser Polygon ou LineString." });

    const userId = req.session?.userId || null;

    const upd = await pool.query(
      `UPDATE zoneamentos SET nome=$1, geom=ST_SetSRID(ST_GeomFromGeoJSON($2),4326)
       WHERE id=$3 RETURNING id`,
      [nome_zoneamento, JSON.stringify(parsed.geometry), id]
    );
    if (!upd.rowCount)
      return res.status(404).json({ success: false, message: "Zoneamento não encontrado." });

    await pool.query(
      `INSERT INTO notificacoes (user_id, acao, tabela, registro_id, mensagem)
       VALUES ($1,'UPDATE','zoneamentos',$2,$3)`,
      [userId, id, `Zoneamento atualizado: ${nome_zoneamento}`]
    );
    res.json({ success: true, message: "Zoneamento atualizado com sucesso!" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Erro interno do servidor." });
  }
});
// ====================================================================================
// ESCOLAS
// ====================================================================================
app.post("/api/escolas/cadastrar", async (req, res) => {
  try {
    const {
      latitude,
      longitude,
      area,
      logradouro,
      numero,
      complemento,
      pontoReferencia,
      bairro,
      cep,
      nomeEscola,
      codigoINEP,
    } = req.body;

    const regime = req.body["regime[]"] || [];
    const nivel = req.body["nivel[]"] || [];
    const horario = req.body["horario[]"] || [];
    const zoneamentosSelecionados = JSON.parse(
      req.body.zoneamentosSelecionados || "[]"
    );

    // Quem está fazendo a ação?
    const userId = req.session?.userId || null;

    const insertEscolaQuery = `
            INSERT INTO escolas (
                nome, codigo_inep, latitude, longitude, area,
                logradouro, numero, complemento, ponto_referencia,
                bairro, cep, regime, nivel, horario
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
            RETURNING id;
        `;
    const values = [
      nomeEscola,
      codigoINEP || null,
      latitude ? parseFloat(latitude) : null,
      longitude ? parseFloat(longitude) : null,
      area,
      logradouro || null,
      numero || null,
      complemento || null,
      pontoReferencia || null,
      bairro || null,
      cep || null,
      regime.join(","),
      nivel.join(","),
      horario.join(","),
    ];
    const result = await pool.query(insertEscolaQuery, values);
    if (result.rows.length === 0) {
      return res.status(500).json({
        success: false,
        message: "Erro ao cadastrar escola.",
      });
    }
    const escolaId = result.rows[0].id;

    if (zoneamentosSelecionados.length > 0) {
      const insertZonaEscolaQuery = `
                INSERT INTO escolas_zoneamentos (escola_id, zoneamento_id)
                VALUES ($1, $2);
            `;
      for (const zid of zoneamentosSelecionados) {
        await pool.query(insertZonaEscolaQuery, [escolaId, zid]);
      }
    }

    // NOTIFICAÇÃO
    const mensagem = `Escola criada: ${nomeEscola}`;
    await pool.query(
      `INSERT INTO notificacoes (user_id, acao, tabela, registro_id, mensagem)
             VALUES ($1, 'CREATE', 'escolas', $2, $3)`,
      [userId, escolaId, mensagem]
    );

    res.json({
      success: true,
      message: "Escola cadastrada com sucesso!",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Erro interno do servidor.",
    });
  }
});

app.get("/api/escolas", async (req, res) => {
  try {
    const query = `
        SELECT
          e.id,
          e.nome,
          e.codigo_inep,
          e.latitude,
          e.longitude,
          e.area,
          e.logradouro,
          e.numero,
          e.complemento,
          e.ponto_referencia,
          e.bairro,
          e.cep,
          e.regime,
          e.nivel,
          e.horario,
          COALESCE(
            json_agg(
              json_build_object('id', z.id, 'nome', z.nome)
            ) FILTER (WHERE z.id IS NOT NULL),
            '[]'
          ) AS zoneamentos
        FROM escolas e
        LEFT JOIN escolas_zoneamentos ez ON ez.escola_id = e.id
        LEFT JOIN zoneamentos z ON z.id = ez.zoneamento_id
        GROUP BY e.id
        ORDER BY e.id;
      `;
    const result = await pool.query(query);
    const escolas = result.rows.map((row) => ({
      id: row.id,
      nome: row.nome,
      codigo_inep: row.codigo_inep,
      latitude: row.latitude,
      longitude: row.longitude,
      area: row.area,
      logradouro: row.logradouro,
      numero: row.numero,
      complemento: row.complemento,
      ponto_referencia: row.ponto_referencia,
      bairro: row.bairro,
      cep: row.cep,
      regime: (row.regime || "").split(",").filter((r) => r),
      nivel: (row.nivel || "").split(",").filter((n) => n),
      horario: (row.horario || "").split(",").filter((h) => h),
      zoneamentos: row.zoneamentos,
    }));
    res.json(escolas);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: "Erro interno do servidor.",
    });
  }
});

// EDITAR ESCOLA
app.put("/api/escolas/:id", async (req, res) => {
  try {
    const escolaId = req.params.id;
    const {
      editarLatitude,
      editarLongitude,
      editarArea,
      editarLogradouro,
      editarNumero,
      editarComplemento,
      editarPontoReferencia,
      editarBairro,
      editarCep,
      editarNomeEscola,
      editarCodigoINEP,
    } = req.body;

    const editarRegime = req.body["editarRegime[]"] || [];
    const editarNivel = req.body["editarNivel[]"] || [];
    const editarHorario = req.body["editarHorario[]"] || [];
    const zoneamentosSelecionadosEditar = JSON.parse(
      req.body.zoneamentosSelecionadosEditar || "[]"
    );

    // Quem está fazendo a ação?
    const userId = req.session?.userId || null;

    // Atualiza campos na tabela escolas
    const updateEscolaQuery = `
        UPDATE escolas
        SET 
          nome = $1,
          codigo_inep = $2,
          latitude = $3,
          longitude = $4,
          area = $5,
          logradouro = $6,
          numero = $7,
          complemento = $8,
          ponto_referencia = $9,
          bairro = $10,
          cep = $11,
          regime = $12,
          nivel = $13,
          horario = $14
        WHERE id = $15
        RETURNING id;
      `;
    const values = [
      editarNomeEscola,
      editarCodigoINEP || null,
      editarLatitude ? parseFloat(editarLatitude) : null,
      editarLongitude ? parseFloat(editarLongitude) : null,
      editarArea,
      editarLogradouro || null,
      editarNumero || null,
      editarComplemento || null,
      editarPontoReferencia || null,
      editarBairro || null,
      editarCep || null,
      editarRegime.join(","),
      editarNivel.join(","),
      editarHorario.join(","),
      escolaId,
    ];

    const result = await pool.query(updateEscolaQuery, values);
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Escola não encontrada para atualizar.",
      });
    }

    // Zera os relacionamentos de zoneamentos
    await pool.query(`DELETE FROM escolas_zoneamentos WHERE escola_id = $1`, [
      escolaId,
    ]);

    // Se existirem zoneamentos selecionados, insere novamente
    if (zoneamentosSelecionadosEditar.length > 0) {
      const insertZonaEscolaQuery = `
          INSERT INTO escolas_zoneamentos (escola_id, zoneamento_id)
          VALUES ($1, $2);
        `;
      for (const zid of zoneamentosSelecionadosEditar) {
        await pool.query(insertZonaEscolaQuery, [escolaId, zid]);
      }
    }

    // Notificação
    const mensagem = `Escola atualizada: ${editarNomeEscola}`;
    await pool.query(
      `INSERT INTO notificacoes (user_id, acao, tabela, registro_id, mensagem)
         VALUES ($1, 'UPDATE', 'escolas', $2, $3)`,
      [userId, escolaId, mensagem]
    );

    res.json({
      success: true,
      message: "Escola atualizada com sucesso!",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: "Erro interno do servidor.",
    });
  }
});

// EXCLUIR ESCOLA
app.delete("/api/escolas/:id", async (req, res) => {
  try {
    const escolaId = req.params.id;
    // Quem está fazendo a ação?
    const userId = req.session?.userId || null;

    // Verifica se a escola existe
    const checkQuery = `SELECT * FROM escolas WHERE id = $1`;
    const checkResult = await pool.query(checkQuery, [escolaId]);
    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Escola não encontrada.",
      });
    }

    // Exclui relacionamentos
    await pool.query(`DELETE FROM escolas_zoneamentos WHERE escola_id = $1`, [
      escolaId,
    ]);

    // Exclui a escola
    const deleteEscolaQuery = `DELETE FROM escolas WHERE id = $1`;
    await pool.query(deleteEscolaQuery, [escolaId]);

    // Notificação
    const mensagem = `Escola excluída: ${checkResult.rows[0].nome}`;
    await pool.query(
      `INSERT INTO notificacoes (user_id, acao, tabela, registro_id, mensagem)
         VALUES ($1, 'DELETE', 'escolas', $2, $3)`,
      [userId, escolaId, mensagem]
    );

    res.json({
      success: true,
      message: "Escola excluída com sucesso!",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: "Erro interno do servidor.",
    });
  }
});

// ====================================================================================
// FORNECEDORES
// ====================================================================================
app.post("/api/fornecedores/cadastrar", async (req, res) => {
  try {
    const {
      nome_fornecedor,
      tipo_contrato,
      cnpj,
      contato,
      latitude,
      longitude,
      logradouro,
      numero,
      complemento,
      bairro,
      cep,
    } = req.body;

    if (!nome_fornecedor || !tipo_contrato || !cnpj || !contato) {
      return res.status(400).json({
        success: false,
        message: "Campos obrigatórios não fornecidos.",
      });
    }

    // Quem está fazendo a ação?
    const userId = req.session?.userId || null;

    const insertQuery = `
            INSERT INTO fornecedores (
                nome_fornecedor, tipo_contrato, cnpj, contato,
                latitude, longitude, logradouro, numero,
                complemento, bairro, cep
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING id;
        `;
    const values = [
      nome_fornecedor,
      tipo_contrato,
      cnpj,
      contato,
      latitude ? parseFloat(latitude) : null,
      longitude ? parseFloat(longitude) : null,
      logradouro || null,
      numero || null,
      complemento || null,
      bairro || null,
      cep || null,
    ];
    const result = await pool.query(insertQuery, values);

    if (result.rows.length === 0) {
      return res.status(500).json({
        success: false,
        message: "Erro ao cadastrar fornecedor.",
      });
    }
    const newFornecedorId = result.rows[0].id;

    // NOTIFICAÇÃO
    const mensagem = `Fornecedor criado: ${nome_fornecedor}`;
    await pool.query(
      `INSERT INTO notificacoes (user_id, acao, tabela, registro_id, mensagem)
             VALUES($1, 'CREATE', 'fornecedores', $2, $3)`,
      [userId, newFornecedorId, mensagem]
    );

    res.json({
      success: true,
      message: "Fornecedor cadastrado com sucesso!",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Erro interno do servidor.",
    });
  }
});

app.delete("/api/fornecedores/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // Quem está fazendo a ação?
    const userId = req.session?.userId || null;

    // Buscar o nome do fornecedor antes de deletar (para log)
    const busca = await pool.query(
      "SELECT nome_fornecedor FROM fornecedores WHERE id = $1",
      [id]
    );
    if (busca.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Fornecedor não encontrado.",
      });
    }
    const nomeFornecedor = busca.rows[0].nome_fornecedor;

    const deleteQuery = "DELETE FROM fornecedores WHERE id = $1";
    const result = await pool.query(deleteQuery, [id]);

    if (result.rowCount > 0) {
      // NOTIFICAÇÃO
      const mensagem = `Fornecedor excluído: ${nomeFornecedor}`;
      const acao = "DELETE";
      const tabela = "fornecedores";
      await pool.query(
        `INSERT INTO notificacoes (user_id, acao, tabela, registro_id, mensagem)
                 VALUES($1, $2, $3, $4, $5)`,
        [userId, acao, tabela, id, mensagem]
      );

      res.json({
        success: true,
        message: "Fornecedor excluído com sucesso!",
      });
    } else {
      res.status(404).json({
        success: false,
        message: "Fornecedor não encontrado.",
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Erro interno do servidor.",
    });
  }
});

// ====================================================================================
// FORNECEDORES ADMINISTRATIVOS
// ====================================================================================

/**
 * GET /api/fornecedores_administrativos
 * Lista todos os fornecedores administrativos.
 */
app.get("/api/fornecedores_administrativos", async (req, res) => {
  try {
    const query = `
      SELECT id, nome_fornecedor, tipo_contrato, cnpj,
             contato, latitude, longitude,
             logradouro, numero, complemento, bairro, cep
        FROM fornecedores_administrativos
        ORDER BY id;
    `;
    const { rows } = await pool.query(query);
    return res.json(rows);
  } catch (err) {
    console.error("Erro ao listar fornecedores_administrativos:", err);
    return res.status(500).json({ success: false, message: "Erro interno do servidor." });
  }
});


/**
 * POST /api/fornecedores_administrativos/cadastrar
 * Cadastra um novo fornecedor administrativo.
 */
app.post("/api/fornecedores_administrativos/cadastrar", async (req, res) => {
  try {
    const {
      nome_fornecedor, tipo_contrato, cnpj, contato,
      latitude, longitude, logradouro, numero,
      complemento, bairro, cep
    } = req.body;

    if (!nome_fornecedor || !tipo_contrato || !cnpj || !contato) {
      return res.status(400).json({ success: false, message: "Campos obrigatórios não fornecidos." });
    }

    const userId = req.session?.userId || null;

    const insert = `
      INSERT INTO fornecedores_administrativos
        (nome_fornecedor, tipo_contrato, cnpj, contato,
         latitude, longitude, logradouro, numero,
         complemento, bairro, cep)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING id;
    `;
    const values = [
      nome_fornecedor, tipo_contrato, cnpj, contato,
      latitude ? parseFloat(latitude) : null,
      longitude ? parseFloat(longitude) : null,
      logradouro || null, numero || null, complemento || null,
      bairro || null, cep || null
    ];
    const result = await pool.query(insert, values);

    // notificação (opcional, igual às demais rotas)
    await pool.query(
      `INSERT INTO notificacoes (user_id, acao, tabela, registro_id, mensagem)
       VALUES ($1,'CREATE','fornecedores_administrativos',$2,$3)`,
      [userId, result.rows[0].id, `Fornecedor administrativo criado: ${nome_fornecedor}`]
    );

    return res.json({ success: true, message: "Fornecedor administrativo cadastrado com sucesso!" });
  } catch (err) {
    console.error("Erro ao cadastrar fornecedor_administrativo:", err);
    if (err.code === "23505") { // violação de chave única (CNPJ)
      return res.status(400).json({ success: false, message: "CNPJ já existente." });
    }
    return res.status(500).json({ success: false, message: "Erro interno do servidor." });
  }
});


/**
 * DELETE /api/fornecedores_administrativos/:id
 * Remove um fornecedor administrativo.
 */
app.delete("/api/fornecedores_administrativos/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.session?.userId || null;

    // pega nome p/ log
    const busca = await pool.query(
      "SELECT nome_fornecedor FROM fornecedores_administrativos WHERE id = $1",
      [id]
    );
    if (busca.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Fornecedor não encontrado." });
    }
    const nome = busca.rows[0].nome_fornecedor;

    const del = await pool.query("DELETE FROM fornecedores_administrativos WHERE id = $1", [id]);
    if (del.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Fornecedor não encontrado." });
    }

    await pool.query(
      `INSERT INTO notificacoes (user_id, acao, tabela, registro_id, mensagem)
       VALUES ($1,'DELETE','fornecedores_administrativos',$2,$3)`,
      [userId, id, `Fornecedor administrativo excluído: ${nome}`]
    );

    return res.json({ success: true, message: "Fornecedor administrativo excluído com sucesso!" });
  } catch (err) {
    console.error("Erro ao excluir fornecedor_administrativo:", err);
    return res.status(500).json({ success: false, message: "Erro interno do servidor." });
  }
});


// ====================================================================================
// FROTA
// ====================================================================================
// ENDPOINT GET /api/frota (ajustado para "cor_veiculo" e sem latitude/longitude)
app.get("/api/frota", async (req, res) => {
  try {
    const query = `
      SELECT
        f.id,
        f.cor_veiculo,
        f.placa,
        f.tipo_veiculo,
        f.capacidade,
        f.fornecedor_id,
        f.documentacao,
        f.licenca,
        f.ano,
        f.marca,
        f.modelo,
        f.tipo_combustivel,
        f.data_aquisicao,
        f.adaptado,
        f.elevador,
        f.ar_condicionado,
        f.gps,
        f.cinto_seguranca,
        fr.nome_fornecedor AS fornecedor_nome,
        COALESCE(
          json_agg(
            json_build_object(
              'id', m.id,
              'nome_motorista', m.nome_motorista,
              'cpf', m.cpf
            )
          ) FILTER (WHERE m.id IS NOT NULL),
          '[]'
        ) AS motoristas
      FROM frota f
      LEFT JOIN fornecedores fr ON fr.id = f.fornecedor_id
      LEFT JOIN frota_motoristas fm ON fm.carro_id = f.id
      LEFT JOIN motoristas m ON m.id = fm.motorista_id
      GROUP BY f.id, fr.nome_fornecedor
      ORDER BY f.id;
    `;
    const result = await pool.query(query);

    // Monta o objeto final
    const frotaCompleta = result.rows.map(row => ({
      id: row.id,
      cor_veiculo: row.cor_veiculo,
      placa: row.placa,
      tipo_veiculo: row.tipo_veiculo,
      capacidade: row.capacidade,
      fornecedor_id: row.fornecedor_id,
      documentacao: row.documentacao,
      licenca: row.licenca,
      ano: row.ano,
      marca: row.marca,
      modelo: row.modelo,
      tipo_combustivel: row.tipo_combustivel,
      data_aquisicao: row.data_aquisicao,
      adaptado: row.adaptado,
      elevador: row.elevador,
      ar_condicionado: row.ar_condicionado,
      gps: row.gps,
      cinto_seguranca: row.cinto_seguranca,
      fornecedor_nome: row.fornecedor_nome,
      motoristas: row.motoristas || []
    }));

    res.json(frotaCompleta);
  } catch (error) {
    console.error("Erro ao listar frota:", error);
    res.status(500).json({
      success: false,
      message: "Erro interno do servidor."
    });
  }
});

// ENDPOINT POST /api/frota/cadastrar (ajustado para "cor_veiculo" e sem latitude/longitude)
app.post(
  "/api/frota/cadastrar",
  uploadFrota.fields([{ name: "documentacao", maxCount: 1 }, { name: "licenca", maxCount: 1 }]),
  async (req, res) => {
    try {
      const {
        cor_veiculo,
        placa,
        tipo_veiculo,
        capacidade,
        fornecedor_id,
        ano,
        marca,
        modelo,
        tipo_combustivel,
        data_aquisicao,
        adaptado,
        elevador,
        ar_condicionado,
        gps,
        cinto_seguranca
      } = req.body;

      // Motoristas associados (se existir)
      let motoristasAssociados = [];
      if (req.body.motoristasAssociados) {
        motoristasAssociados = JSON.parse(req.body.motoristasAssociados);
      }

      // Verifica campos obrigatórios
      if (!cor_veiculo || !placa || !tipo_veiculo || !capacidade || !fornecedor_id) {
        return res.status(400).json({
          success: false,
          message: "Campos obrigatórios não fornecidos."
        });
      }

      const userId = req.session?.userId || null;

      // Upload de documentação e licenca
      let documentacaoPath = null;
      let licencaPath = null;
      if (req.files["documentacao"] && req.files["documentacao"].length > 0) {
        documentacaoPath = "uploads/frota/" + req.files["documentacao"][0].filename;
      }
      if (req.files["licenca"] && req.files["licenca"].length > 0) {
        licencaPath = "uploads/frota/" + req.files["licenca"][0].filename;
      }

      // Insere novo veículo na tabela frota
      const insertQuery = `
        INSERT INTO frota (
          cor_veiculo, placa, tipo_veiculo, capacidade,
          fornecedor_id, documentacao, licenca,
          ano, marca, modelo, tipo_combustivel,
          data_aquisicao, adaptado, elevador,
          ar_condicionado, gps, cinto_seguranca
        )
        VALUES (
          $1, $2, $3, $4,
          $5, $6, $7,
          $8, $9, $10, $11,
          $12, $13, $14,
          $15, $16, $17
        )
        RETURNING id;
      `;
      const values = [
        cor_veiculo,
        placa,
        tipo_veiculo,
        parseInt(capacidade, 10),
        parseInt(fornecedor_id, 10),
        documentacaoPath,
        licencaPath,
        ano ? parseInt(ano, 10) : null,
        marca || null,
        modelo || null,
        tipo_combustivel || null,
        data_aquisicao || null,
        adaptado === "Sim",
        elevador === "Sim",
        ar_condicionado === "Sim",
        gps === "Sim",
        cinto_seguranca === "Sim"
      ];
      const result = await pool.query(insertQuery, values);

      if (result.rows.length === 0) {
        return res.status(500).json({
          success: false,
          message: "Erro ao cadastrar veículo."
        });
      }

      const frotaId = result.rows[0].id;

      // Relacionamento com motoristas, se houve
      if (Array.isArray(motoristasAssociados) && motoristasAssociados.length > 0) {
        const relQuery = `
          INSERT INTO frota_motoristas (frota_id, motorista_id)
          VALUES ($1, $2)
        `;
        for (const motoristaId of motoristasAssociados) {
          await pool.query(relQuery, [frotaId, motoristaId]);
        }
      }

      // Exemplo: se quiser relacionar rota no momento do cadastro:
      const associarRotaId = req.body.associarRotaId;
      if (associarRotaId) {
        // Insere na tabela frota_rotas
        await pool.query(
          `INSERT INTO frota_rotas (frota_id, rota_id) VALUES ($1, $2)
           ON CONFLICT (frota_id, rota_id) DO NOTHING`,
          [frotaId, associarRotaId]
        );
      }

      // Notificação
      const mensagem = `Veículo adicionado à frota: ${cor_veiculo}`;
      await pool.query(
        `INSERT INTO notificacoes (user_id, acao, tabela, registro_id, mensagem)
         VALUES ($1, 'CREATE', 'frota', $2, $3)`,
        [userId, frotaId, mensagem]
      );

      return res.json({
        success: true,
        message: "Veículo cadastrado com sucesso!"
      });
    } catch (error) {
      console.error("Erro no /api/frota/cadastrar:", error);
      return res.status(500).json({
        success: false,
        message: "Erro interno do servidor."
      });
    }
  }
);

app.get("/api/frota/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const q = `
      SELECT f.*,
             fr.nome_fornecedor
      FROM   frota f
      LEFT JOIN fornecedores fr ON fr.id = f.fornecedor_id
      WHERE  f.id = $1
      LIMIT  1`;
    const { rows } = await pool.query(q, [id]);
    if (!rows.length) return res.status(404).json({ success: false, message: "Veículo não encontrado" });
    res.json(rows[0]);
  } catch (e) {
    console.error("GET /api/frota/:id", e);
    res.status(500).json({ success: false, message: "Erro interno" });
  }
});


// DELETE /api/itinerarios/:id — exclui um itinerário
app.delete('/api/itinerarios/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query(
      'DELETE FROM itinerarios WHERE id = $1',
      [id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Erro ao excluir itinerário:', err);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// POST /api/itinerarios — cria novo Itinerário
app.post('/api/itinerarios', async (req, res) => {
  try {
    const { escolas_ids, zoneamentos_ids } = req.body;
    if (
      !Array.isArray(escolas_ids) ||
      !Array.isArray(zoneamentos_ids)
    ) {
      return res.status(400).json({ error: 'Dados inválidos.' });
    }

    // 1) Reúne todos os pontos de parada via tabela de junção
    const pts = await pool.query(
      `SELECT p.id
         FROM pontos p
         JOIN pontos_zoneamentos pz
           ON pz.ponto_id = p.id
        WHERE pz.zoneamento_id = ANY($1)
          AND p.status = 'ativo'`,
      [zoneamentos_ids]
    );
    const pontos_ids = pts.rows.map(r => r.id);  // :contentReference[oaicite:0]{index=0}&#8203;:contentReference[oaicite:1]{index=1}

    // 2) Monta descrição: "Esc A, Esc B - Zona X, Zona Y"
    const esc = await pool.query(
      'SELECT nome FROM escolas WHERE id = ANY($1)',
      [escolas_ids]
    );
    const zn = await pool.query(
      'SELECT nome FROM zoneamentos WHERE id = ANY($1)',
      [zoneamentos_ids]
    );
    const nomesEsc = esc.rows.map(r => r.nome);
    const nomesZn = zn.rows.map(r => r.nome);
    const descricao = `${nomesEsc.join(', ')} - ${nomesZn.join(', ')}`;

    // 3) Insere no banco usando os nomes exatos das colunas
    const ins = await pool.query(
      `INSERT INTO itinerarios
         (escolas_ids, zoneamentos_ids, descricao, pontos_ids)
       VALUES ($1, $2, $3, $4)
       RETURNING id, descricao`,
      [escolas_ids, zoneamentos_ids, descricao, pontos_ids]
    );

    res.json(ins.rows[0]);
  } catch (err) {
    console.error('Erro ao criar itinerário:', err);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// GET /api/itinerarios — lista Itinerários (rotas mestres)
app.get('/api/itinerarios', async (req, res) => {
  try {
    const query = `
      SELECT
        i.id,
        i.escolas_ids,
        i.zoneamentos_ids,
        i.descricao,
        i.pontos_ids,
        -- nomes das escolas
        (
          SELECT COALESCE(
            json_agg(json_build_object('id', e.id, 'nome', e.nome))
            FILTER (WHERE e.id IS NOT NULL),
            '[]'
          )
          FROM escolas e
          WHERE e.id = ANY(i.escolas_ids)
        ) AS escolas,
        -- nomes dos zoneamentos
        (
          SELECT COALESCE(
            json_agg(json_build_object('id', z.id, 'nome', z.nome))
            FILTER (WHERE z.id IS NOT NULL),
            '[]'
          )
          FROM zoneamentos z
          WHERE z.id = ANY(i.zoneamentos_ids)
        ) AS zoneamentos
      FROM itinerarios i
      ORDER BY i.id ASC;
    `;
    const { rows } = await pool.query(query);
    res.json(rows);
  } catch (err) {
    console.error('Erro ao listar itinerários:', err);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// PUT /api/itinerarios/:id — atualiza um itinerário existente
app.put('/api/itinerarios/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { escolas_ids, zoneamentos_ids } = req.body;

    // Validação básica
    if (
      !Array.isArray(escolas_ids) ||
      !Array.isArray(zoneamentos_ids)
    ) {
      return res.status(400).json({ error: 'Dados inválidos.' });
    }

    // 1) Reúne os pontos de parada ativos via tabela de junção
    const pts = await pool.query(
      `SELECT p.id
         FROM pontos p
         JOIN pontos_zoneamentos pz ON pz.ponto_id = p.id
        WHERE pz.zoneamento_id = ANY($1)
          AND p.status = 'ativo'`,
      [zoneamentos_ids]
    );
    const pontos_ids = pts.rows.map(r => r.id);  // :contentReference[oaicite:0]{index=0}&#8203;:contentReference[oaicite:1]{index=1}

    // 2) Reconstrói descrição: "Esc A, Esc B - Zona X, Zona Y"
    const esc = await pool.query(
      'SELECT nome FROM escolas WHERE id = ANY($1)',
      [escolas_ids]
    );
    const zn = await pool.query(
      'SELECT nome FROM zoneamentos WHERE id = ANY($1)',
      [zoneamentos_ids]
    );
    const nomesEsc = esc.rows.map(r => r.nome);
    const nomesZn = zn.rows.map(r => r.nome);
    const descricao = `${nomesEsc.join(', ')} - ${nomesZn.join(', ')}`;

    // 3) Atualiza no banco
    const up = await pool.query(
      `UPDATE itinerarios
         SET escolas_ids     = $1,
             zoneamentos_ids = $2,
             descricao       = $3,
             pontos_ids      = $4
       WHERE id = $5
       RETURNING id, descricao`,
      [escolas_ids, zoneamentos_ids, descricao, pontos_ids, id]
    );

    if (up.rowCount === 0) {
      return res.status(404).json({ error: 'Itinerário não encontrado.' });
    }

    // 4) Retorna confirmação
    res.json({ success: true, id: up.rows[0].id, descricao: up.rows[0].descricao });
  } catch (err) {
    console.error('Erro ao atualizar itinerário:', err);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// GET /api/itinerarios/:id/pontos-ativos
app.get('/api/itinerarios/:id/pontos-ativos', async (req, res) => {
  const { id } = req.params;
  try {
    const q = `
      SELECT p.id, p.nome_ponto, p.latitude, p.longitude
        FROM pontos p
        JOIN pontos_zoneamentos pz ON pz.ponto_id = p.id
        JOIN itinerarios i       ON i.id = $1
       WHERE p.status = 'ativo'
         AND pz.zoneamento_id = ANY(i.zoneamentos_ids)
       ORDER BY p.id;
    `;
    const { rows } = await pool.query(q, [id]);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar pontos ativos.' });
  }
});



// === FROTA ⇄ ROTAS – LISTAR VÍNCULOS ================================
app.get("/api/frota/:id/rotas", async (req, res) => {
  try {
    const { id } = req.params;
    const q = `
      SELECT r.id, r.identificador, r.descricao
      FROM   linhas_rotas   r
      JOIN   frota_rotas     fr ON fr.rota_id = r.id
      WHERE  fr.frota_id = $1
      ORDER  BY r.identificador`;
    const { rows } = await pool.query(q, [id]);
    res.json(rows);           // ← devolve [] se não houver vínculos
  } catch (e) {
    console.error("GET /api/frota/:id/rotas", e);
    res.status(500).json({ success: false, message: "Erro interno" });
  }
});

// === FROTA ⇄ ROTAS – ATUALIZAR VÍNCULOS =============================
app.post("/api/frota/:id/rotas", async (req, res) => {
  try {
    const { id } = req.params;
    const { rotas } = req.body;       // array de IDs vindo do front‑end
    if (!Array.isArray(rotas)) {
      return res.status(400).json({ success: false, message: "Formato inválido" });
    }

    // remove os vínculos que não constam mais
    await pool.query("DELETE FROM frota_rotas WHERE frota_id = $1 AND rota_id <> ALL($2::int[])", [id, rotas]);

    // adiciona os que faltam (ON CONFLICT evita duplicar)
    const ins = `
      INSERT INTO frota_rotas (frota_id, rota_id)
      SELECT $1, UNNEST($2::int[])
      ON CONFLICT (frota_id, rota_id) DO NOTHING`;
    await pool.query(ins, [id, rotas]);

    res.json({ success: true });
  } catch (e) {
    console.error("POST /api/frota/:id/rotas", e);
    res.status(500).json({ success: false, message: "Erro interno" });
  }
});

// ====>  src/routes/frota.js   (ou onde você mantém as rotas Express) <====
app.post("/api/frota/atribuir-rota", async (req, res) => {
  try {
    const { frota_id, rota_id } = req.body;

    /* ---------- validação básica ------------------------------------ */
    if (!frota_id || !rota_id) {
      return res
        .status(400)
        .json({ success: false, message: "frota_id e rota_id são obrigatórios." });
    }

    /* ---------- existência de frota e rota -------------------------- */
    const checkFrota = await pool.query("SELECT id FROM frota WHERE id = $1", [
      frota_id,
    ]);
    if (checkFrota.rowCount === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Veículo não encontrado." });
    }

    const checkRota = await pool.query(
      "SELECT id FROM linhas_rotas WHERE id = $1",
      [rota_id]
    );
    if (checkRota.rowCount === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Rota não encontrada." });
    }

    /* ---------- insere relacionamento ------------------------------- */
    await pool.query(
      `
      INSERT INTO frota_rotas (frota_id, rota_id)
      VALUES ($1, $2)
      ON CONFLICT (frota_id, rota_id) DO NOTHING
    `,
      [frota_id, rota_id]
    );

    /* ---------- notificação opcional -------------------------------- */
    const userId = req.session?.userId || null;
    await pool.query(
      `
      INSERT INTO notificacoes (user_id, acao, tabela, registro_id, mensagem)
      VALUES ($1,'CREATE','frota_rotas',$2,$3)
    `,
      [userId, frota_id, `Veículo ${frota_id} vinculado à rota ${rota_id}`]
    );

    return res.json({
      success: true,
      message: "Rota atribuída ao veículo com sucesso!",
    });
  } catch (err) {
    console.error("Erro em /api/frota/atribuir-rota :", err);
    return res
      .status(500)
      .json({ success: false, message: "Erro interno do servidor." });
  }
});

app.delete("/api/frota/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // Quem está fazendo a ação?
    const userId = req.session?.userId || null;

    // Buscar nome do veículo antes de excluir (opcional)
    const busca = await pool.query(
      "SELECT nome_veiculo FROM frota WHERE id = $1",
      [id]
    );
    if (busca.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Veículo não encontrado.",
      });
    }
    const nomeVeiculo = busca.rows[0].nome_veiculo;

    const deleteQuery = "DELETE FROM frota WHERE id = $1";
    const result = await pool.query(deleteQuery, [id]);
    if (result.rowCount > 0) {
      // NOTIFICAÇÃO
      const mensagem = `Veículo removido da frota: ${nomeVeiculo}`;
      const acao = "DELETE";
      const tabela = "frota";
      await pool.query(
        `INSERT INTO notificacoes (user_id, acao, tabela, registro_id, mensagem)
                 VALUES ($1, $2, $3, $4, $5)`,
        [userId, acao, tabela, id, mensagem]
      );

      res.json({
        success: true,
        message: "Veículo excluído com sucesso!",
      });
    } else {
      res.status(404).json({
        success: false,
        message: "Veículo não encontrado.",
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Erro interno do servidor.",
    });
  }
});

// ====================================================================================
// MONITORES
// ====================================================================================
app.post(
  "/api/monitores/cadastrar",
  uploadMonitores.fields([
    { name: "documento_pessoal", maxCount: 1 },
    { name: "certificado_curso", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const {
        nome_monitor,
        cpf,
        fornecedor_id,
        telefone,
        email,
        endereco,
        data_admissao,
      } = req.body;
      if (!nome_monitor || !cpf || !fornecedor_id) {
        return res.status(400).json({
          success: false,
          message: "Campos obrigatórios não fornecidos.",
        });
      }

      // Quem está fazendo a ação?
      const userId = req.session?.userId || null;

      let documentoPessoalPath = null;
      let certificadoCursoPath = null;

      if (
        req.files["documento_pessoal"] &&
        req.files["documento_pessoal"].length > 0
      ) {
        documentoPessoalPath =
          "uploads/" + req.files["documento_pessoal"][0].filename;
      } else {
        return res.status(400).json({
          success: false,
          message: "Documento pessoal é obrigatório.",
        });
      }

      if (
        req.files["certificado_curso"] &&
        req.files["certificado_curso"].length > 0
      ) {
        certificadoCursoPath =
          "uploads/" + req.files["certificado_curso"][0].filename;
      }

      const fornecedorResult = await pool.query(
        "SELECT nome_fornecedor FROM fornecedores WHERE id = $1",
        [fornecedor_id]
      );
      const fornecedorNome =
        fornecedorResult.rows.length > 0
          ? fornecedorResult.rows[0].nome_fornecedor
          : null;

      if (
        fornecedorNome &&
        fornecedorNome !== "FUNDO MUNICIPAL DE EDUCAÇÃO DE CANAA DOS CARAJAS"
      ) {
        if (!certificadoCursoPath) {
          return res.status(400).json({
            success: false,
            message:
              "Certificado do curso é obrigatório para monitores de outros fornecedores.",
          });
        }
      }

      const insertQuery = `
                INSERT INTO monitores (
                    nome_monitor, cpf, fornecedor_id, telefone, email,
                    endereco, data_admissao, documento_pessoal, certificado_curso
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                RETURNING id;
            `;
      const values = [
        nome_monitor,
        cpf,
        parseInt(fornecedor_id, 10),
        telefone || null,
        email || null,
        endereco || null,
        data_admissao || null,
        documentoPessoalPath,
        certificadoCursoPath,
      ];
      const result = await pool.query(insertQuery, values);
      if (result.rows.length === 0) {
        return res.status(500).json({
          success: false,
          message: "Erro ao cadastrar monitor.",
        });
      }
      const novoMonitorId = result.rows[0].id;

      // NOTIFICAÇÃO
      const mensagem = `Monitor cadastrado: ${nome_monitor}`;
      await pool.query(
        `INSERT INTO notificacoes (user_id, acao, tabela, registro_id, mensagem)
                 VALUES ($1, 'CREATE', 'monitores', $2, $3)`,
        [userId, novoMonitorId, mensagem]
      );

      res.json({
        success: true,
        message: "Monitor cadastrado com sucesso!",
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Erro interno do servidor.",
      });
    }
  }
);

app.get("/api/monitores", async (req, res) => {
  try {
    const query = `
            SELECT m.id, m.nome_monitor, m.cpf, m.fornecedor_id, m.telefone, m.email, m.endereco,
                   m.data_admissao, m.documento_pessoal, m.certificado_curso,
                   fr.nome_fornecedor as fornecedor_nome
            FROM monitores m
            LEFT JOIN fornecedores fr ON fr.id = m.fornecedor_id
            ORDER BY m.id;
        `;
    const result = await pool.query(query);
    const monitores = result.rows.map((row) => ({
      id: row.id,
      nome_monitor: row.nome_monitor,
      cpf: row.cpf,
      fornecedor_id: row.fornecedor_id,
      telefone: row.telefone,
      email: row.email,
      endereco: row.endereco,
      data_admissao: row.data_admissao,
      documento_pessoal: row.documento_pessoal,
      certificado_curso: row.certificado_curso,
      fornecedor_nome: row.fornecedor_nome,
    }));
    res.json(monitores);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Erro interno do servidor.",
    });
  }
});

app.delete("/api/monitores/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // Quem está fazendo a ação?
    const userId = req.session?.userId || null;

    // Buscar nome do monitor antes de excluir (opcional)
    const busca = await pool.query(
      "SELECT nome_monitor FROM monitores WHERE id = $1",
      [id]
    );
    if (busca.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Monitor não encontrado.",
      });
    }
    const nomeMonitor = busca.rows[0].nome_monitor;

    const deleteQuery = "DELETE FROM monitores WHERE id = $1";
    const result = await pool.query(deleteQuery, [id]);
    if (result.rowCount > 0) {
      // NOTIFICAÇÃO
      const mensagem = `Monitor excluído: ${nomeMonitor}`;
      await pool.query(
        `INSERT INTO notificacoes (user_id, acao, tabela, registro_id, mensagem)
                 VALUES ($1, 'DELETE', 'monitores', $2, $3)`,
        [userId, id, mensagem]
      );

      res.json({
        success: true,
        message: "Monitor excluído com sucesso!",
      });
    } else {
      res.status(404).json({
        success: false,
        message: "Monitor não encontrado.",
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Erro interno do servidor.",
    });
  }
});

// ====> ROTA: Listar monitores do fornecedor do usuário logado
app.get("/api/fornecedor/monitores", async (req, res) => {
  try {
    const userId = req.session.userId;
    const relForn = await pool.query(
      "SELECT fornecedor_id FROM usuario_fornecedor WHERE usuario_id = $1 LIMIT 1",
      [userId]
    );
    if (relForn.rows.length === 0) {
      return res.json([]);
    }
    const fornecedorId = relForn.rows[0].fornecedor_id;

    const query = `
      SELECT m.id, m.nome_monitor, m.cpf
      FROM monitores m
      WHERE m.fornecedor_id = $1
      ORDER BY m.id ASC;
    `;
    const result = await pool.query(query, [fornecedorId]);
    return res.json(result.rows);
  } catch (error) {
    console.error("Erro ao listar monitores do fornecedor:", error);
    return res.status(500).json({ success: false, message: "Erro interno ao listar monitores do fornecedor." });
  }
});

// ====> ROTA: Cadastrar monitor para o fornecedor do usuário
app.post(
  "/api/fornecedor/monitores/cadastrar",
  uploadFrota.fields([
    { name: "documento_pessoal", maxCount: 1 },
    { name: "certificado_curso", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const userId = req.session.userId;
      const relForn = await pool.query(
        "SELECT fornecedor_id FROM usuario_fornecedor WHERE usuario_id = $1 LIMIT 1",
        [userId]
      );
      if (relForn.rows.length === 0) {
        return res.status(403).json({
          success: false,
          message: "Usuário não vinculado a nenhum fornecedor.",
        });
      }
      const fornecedorId = relForn.rows[0].fornecedor_id;

      const {
        nome_monitor,
        cpf,
        telefone,
        email,
        endereco,
        data_admissao,
      } = req.body;

      if (!nome_monitor || !cpf) {
        return res.status(400).json({
          success: false,
          message: "Campos obrigatórios não fornecidos.",
        });
      }

      let docPessoalPath = null;
      let certCursoPath = null;

      if (req.files["documento_pessoal"] && req.files["documento_pessoal"].length > 0) {
        docPessoalPath = "uploads/" + req.files["documento_pessoal"][0].filename;
      } else {
        return res.status(400).json({
          success: false,
          message: "Documento pessoal é obrigatório (PDF).",
        });
      }

      // Verifica se o fornecedor exige certificado
      const fQuery = "SELECT nome_fornecedor FROM fornecedores WHERE id = $1";
      const fResult = await pool.query(fQuery, [fornecedorId]);
      const fornecedorNome =
        fResult.rows.length > 0 ? fResult.rows[0].nome_fornecedor : null;

      if (
        fornecedorNome &&
        fornecedorNome !== "FUNDO MUNICIPAL DE EDUCAÇÃO DE CANAA DOS CARAJAS"
      ) {
        if (
          !req.files["certificado_curso"] ||
          req.files["certificado_curso"].length === 0
        ) {
          return res.status(400).json({
            success: false,
            message:
              "Certificado do curso é obrigatório para monitores de outros fornecedores.",
          });
        }
      }

      if (
        req.files["certificado_curso"] &&
        req.files["certificado_curso"].length > 0
      ) {
        certCursoPath = "uploads/" + req.files["certificado_curso"][0].filename;
      }

      const insertQuery = `
        INSERT INTO monitores (
          nome_monitor,
          cpf,
          fornecedor_id,
          telefone,
          email,
          endereco,
          data_admissao,
          documento_pessoal,
          certificado_curso
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9
        )
        RETURNING id;
      `;
      const values = [
        nome_monitor,
        cpf,
        fornecedorId,
        telefone || null,
        email || null,
        endereco || null,
        data_admissao || null,
        docPessoalPath,
        certCursoPath,
      ];
      const result = await pool.query(insertQuery, values);

      if (result.rows.length === 0) {
        return res.status(500).json({
          success: false,
          message: "Erro ao cadastrar monitor.",
        });
      }

      const novoMonitorId = result.rows[0].id;
      await pool.query(
        `INSERT INTO notificacoes (user_id, acao, tabela, registro_id, mensagem)
         VALUES ($1, 'CREATE', 'monitores', $2, $3)`,
        [userId, novoMonitorId, `Monitor cadastrado: ${nome_monitor}`]
      );

      return res.json({
        success: true,
        message: "Monitor cadastrado com sucesso!",
      });
    } catch (error) {
      console.error("Erro ao cadastrar monitor:", error);
      return res.status(500).json({
        success: false,
        message: "Erro interno do servidor.",
      });
    }
  }
);

// ====> ROTA: Excluir monitor do fornecedor
app.delete("/api/fornecedor/monitores/:id", async (req, res) => {
  try {
    const userId = req.session.userId;
    const relForn = await pool.query(
      "SELECT fornecedor_id FROM usuario_fornecedor WHERE usuario_id = $1 LIMIT 1",
      [userId]
    );
    if (relForn.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: "Usuário não vinculado a nenhum fornecedor.",
      });
    }
    const fornecedorId = relForn.rows[0].fornecedor_id;
    const monitorId = req.params.id;

    const checkQuery = `
      SELECT id FROM monitores
      WHERE id = $1
        AND fornecedor_id = $2
      LIMIT 1
    `;
    const checkResult = await pool.query(checkQuery, [monitorId, fornecedorId]);
    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Monitor não encontrado ou não pertence a este fornecedor.",
      });
    }

    await pool.query("DELETE FROM monitores WHERE id = $1", [monitorId]);
    return res.json({ success: true });
  } catch (error) {
    console.error("Erro ao excluir monitor:", error);
    return res
      .status(500)
      .json({ success: false, message: "Erro interno ao excluir monitor." });
  }
});

// ====> ROTA: Atribuir rota a monitor
app.post("/api/fornecedor/monitores/atribuir-rota", async (req, res) => {
  try {
    const userId = req.session?.userId;
    const { monitor_id, rota_id } = req.body;

    // Verifica o fornecedor do usuário
    const relForn = await pool.query(
      "SELECT fornecedor_id FROM usuario_fornecedor WHERE usuario_id = $1 LIMIT 1",
      [userId]
    );
    if (relForn.rows.length === 0) {
      return res
        .status(403)
        .json({ success: false, message: "Usuário não vinculado a fornecedor." });
    }
    const fornecedorId = relForn.rows[0].fornecedor_id;

    // Verifica se o monitor pertence a este fornecedor
    const checkMonitor = await pool.query(
      "SELECT id FROM monitores WHERE id = $1 AND fornecedor_id = $2",
      [monitor_id, fornecedorId]
    );
    if (checkMonitor.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Monitor não encontrado ou não pertence a este fornecedor.",
      });
    }

    // Verifica se a rota está associada a este fornecedor (linhas_rotas + fornecedores_rotas)
    const checkRota = await pool.query(
      `
        SELECT r.id
        FROM linhas_rotas r
        JOIN fornecedores_rotas fr ON fr.rota_id = r.id
        WHERE r.id = $1
          AND fr.fornecedor_id = $2
        LIMIT 1
      `,
      [rota_id, fornecedorId]
    );
    if (checkRota.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Rota não encontrada ou não pertence a este fornecedor.",
      });
    }

    // Insere na tabela monitores_rotas (ou monitores_rotas - sua escolha):
    await pool.query(
      `
        INSERT INTO monitores_rotas (monitor_id, rota_id)
        VALUES ($1, $2)
        ON CONFLICT (monitor_id, rota_id) DO NOTHING
      `,
      [monitor_id, rota_id]
    );

    return res.json({
      success: true,
      message: "Rota atribuída ao monitor com sucesso!",
    });
  } catch (error) {
    console.error("Erro ao atribuir rota ao monitor:", error);
    return res
      .status(500)
      .json({ success: false, message: "Erro ao atribuir rota ao monitor." });
  }
});


// ====================================================================================
// MOTORISTAS
// ====================================================================================
app.get("/api/motoristas", async (req, res) => {
  try {
    const query = `
            SELECT m.id,
                   m.nome_motorista,
                   m.cpf,
                   m.rg,
                   m.data_nascimento,
                   m.telefone,
                   m.email,
                   m.endereco,
                   m.cidade,
                   m.estado,
                   m.cep,
                   m.numero_cnh,
                   m.categoria_cnh,
                   m.validade_cnh,
                   m.fornecedor_id,
                   m.cnh_pdf,
                   m.cert_transporte_escolar,
                   m.cert_transporte_passageiros,
                   m.data_validade_transporte_escolar,
                   m.data_validade_transporte_passageiros,
                   fr.nome_fornecedor
            FROM motoristas m
            LEFT JOIN fornecedores fr ON fr.id = m.fornecedor_id
            ORDER BY m.id;
        `;
    const result = await pool.query(query);
    const hoje = new Date();
    const trintaDiasDepois = new Date(
      hoje.getTime() + 30 * 24 * 60 * 60 * 1000
    );

    const motoristas = result.rows.map((row) => {
      let statusEscolar = "OK";
      let statusPassageiros = "OK";

      if (row.data_validade_transporte_escolar) {
        const validadeEscolar = new Date(row.data_validade_transporte_escolar);
        if (validadeEscolar < hoje) {
          statusEscolar = "Vencido";
        } else if (validadeEscolar < trintaDiasDepois) {
          statusEscolar = "Próximo do vencimento";
        }
      }

      if (row.data_validade_transporte_passageiros) {
        const validadePassageiros = new Date(
          row.data_validade_transporte_passageiros
        );
        if (validadePassageiros < hoje) {
          statusPassageiros = "Vencido";
        } else if (validadePassageiros < trintaDiasDepois) {
          statusPassageiros = "Próximo do vencimento";
        }
      }

      return {
        id: row.id,
        nome_motorista: row.nome_motorista,
        cpf: row.cpf,
        rg: row.rg,
        data_nascimento: row.data_nascimento,
        telefone: row.telefone,
        email: row.email,
        endereco: row.endereco,
        cidade: row.cidade,
        estado: row.estado,
        cep: row.cep,
        numero_cnh: row.numero_cnh,
        categoria_cnh: row.categoria_cnh,
        validade_cnh: row.validade_cnh,
        fornecedor_id: row.fornecedor_id,
        cnh_pdf: row.cnh_pdf,
        cert_transporte_escolar: row.cert_transporte_escolar,
        cert_transporte_passageiros: row.cert_transporte_passageiros,
        data_validade_transporte_escolar: row.data_validade_transporte_escolar,
        data_validade_transporte_passageiros:
          row.data_validade_transporte_passageiros,
        fornecedor_nome: row.nome_fornecedor,
        status_cert_escolar: statusEscolar,
        status_cert_passageiros: statusPassageiros,
      };
    });
    res.json(motoristas);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Erro interno do servidor.",
    });
  }
});

app.post(
  "/api/motoristas/cadastrar",
  uploadFrota.fields([
    { name: "cnh_pdf", maxCount: 1 },
    { name: "cert_transporte_escolar", maxCount: 1 },
    { name: "cert_transporte_passageiros", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const {
        nome_motorista,
        cpf,
        rg,
        data_nascimento,
        telefone,
        email,
        endereco,
        cidade,
        estado,
        cep,
        numero_cnh,
        categoria_cnh,
        validade_cnh,
        fornecedor_id,
        data_validade_transporte_escolar,
        data_validade_transporte_passageiros,
      } = req.body;

      if (
        !nome_motorista ||
        !cpf ||
        !numero_cnh ||
        !categoria_cnh ||
        !validade_cnh ||
        !fornecedor_id
      ) {
        return res.status(400).json({
          success: false,
          message: "Campos obrigatórios não fornecidos.",
        });
      }

      // Quem está fazendo a ação?
      const userId = req.session?.userId || null;

      let cnhPdfPath = null;
      let certTransporteEscolarPath = null;
      let certTransportePassageirosPath = null;

      if (req.files["cnh_pdf"] && req.files["cnh_pdf"].length > 0) {
        cnhPdfPath = "uploads/" + req.files["cnh_pdf"][0].filename;
      } else {
        return res.status(400).json({
          success: false,
          message: "CNH é obrigatória.",
        });
      }
      if (
        req.files["cert_transporte_escolar"] &&
        req.files["cert_transporte_escolar"].length > 0
      ) {
        certTransporteEscolarPath =
          "uploads/" + req.files["cert_transporte_escolar"][0].filename;
      }
      if (
        req.files["cert_transporte_passageiros"] &&
        req.files["cert_transporte_passageiros"].length > 0
      ) {
        certTransportePassageirosPath =
          "uploads/" + req.files["cert_transporte_passageiros"][0].filename;
      }

      const fornecedorResult = await pool.query(
        "SELECT nome_fornecedor FROM fornecedores WHERE id = $1",
        [fornecedor_id]
      );
      const fornecedorNome =
        fornecedorResult.rows.length > 0
          ? fornecedorResult.rows[0].nome_fornecedor
          : null;

      if (
        fornecedorNome &&
        fornecedorNome !== "FUNDO MUNICIPAL DE EDUCAÇÃO DE CANAA DOS CARAJAS"
      ) {
        if (!certTransporteEscolarPath) {
          return res.status(400).json({
            success: false,
            message:
              "Certificado de transporte escolar é obrigatório para este fornecedor.",
          });
        }
        if (!certTransportePassageirosPath) {
          return res.status(400).json({
            success: false,
            message:
              "Certificado de transporte de passageiros é obrigatório para este fornecedor.",
          });
        }
      }

      const insertQuery = `
                INSERT INTO motoristas (
                    nome_motorista, cpf, rg, data_nascimento, telefone, email, endereco,
                    cidade, estado, cep, numero_cnh, categoria_cnh, validade_cnh,
                    fornecedor_id, cnh_pdf, cert_transporte_escolar, cert_transporte_passageiros,
                    data_validade_transporte_escolar, data_validade_transporte_passageiros
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7,
                    $8, $9, $10, $11, $12, $13,
                    $14, $15, $16, $17,
                    $18, $19
                )
                RETURNING id;
            `;
      const values = [
        nome_motorista,
        cpf,
        rg || null,
        data_nascimento || null,
        telefone || null,
        email || null,
        endereco || null,
        cidade || null,
        estado || null,
        cep || null,
        numero_cnh,
        categoria_cnh,
        validade_cnh,
        parseInt(fornecedor_id, 10),
        cnhPdfPath,
        certTransporteEscolarPath,
        certTransportePassageirosPath,
        data_validade_transporte_escolar || null,
        data_validade_transporte_passageiros || null,
      ];
      const result = await pool.query(insertQuery, values);
      if (result.rows.length === 0) {
        return res.status(500).json({
          success: false,
          message: "Erro ao cadastrar motorista.",
        });
      }
      const novoMotoristaId = result.rows[0].id;

      // NOTIFICAÇÃO
      const mensagem = `Motorista cadastrado: ${nome_motorista}`;
      await pool.query(
        `INSERT INTO notificacoes (user_id, acao, tabela, registro_id, mensagem)
                 VALUES ($1, 'CREATE', 'motoristas', $2, $3)`,
        [userId, novoMotoristaId, mensagem]
      );

      res.json({
        success: true,
        message: "Motorista cadastrado com sucesso!",
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Erro interno do servidor.",
      });
    }
  }
);

app.get("/api/motoristas/download/:type/:id", async (req, res) => {
  try {
    const { type, id } = req.params;
    const query = `
            SELECT cnh_pdf, cert_transporte_escolar, cert_transporte_passageiros
            FROM motoristas
            WHERE id = $1;
        `;
    const result = await pool.query(query, [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Motorista não encontrado.",
      });
    }
    const motorista = result.rows[0];
    let filePath = null;

    switch (type) {
      case "cnh":
        filePath = motorista.cnh_pdf;
        break;
      case "escolar":
        filePath = motorista.cert_transporte_escolar;
        break;
      case "passageiros":
        filePath = motorista.cert_transporte_passageiros;
        break;
      default:
        return res.status(400).json({
          success: false,
          message: "Tipo de documento inválido.",
        });
    }

    if (!filePath) {
      return res.status(404).json({
        success: false,
        message: "Documento não encontrado para este motorista.",
      });
    }

    const absolutePath = path.join(__dirname, filePath);
    if (!fs.existsSync(absolutePath)) {
      return res.status(404).json({
        success: false,
        message: "Arquivo não encontrado no servidor.",
      });
    }
    res.download(absolutePath);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Erro interno do servidor ao tentar baixar o arquivo.",
    });
  }
});
// ====> API: Listar motoristas somente do fornecedor do usuário logado
app.get("/api/fornecedor/motoristas", async (req, res) => {
  try {
    const userId = req.session.userId;
    const relForn = await pool.query(
      "SELECT fornecedor_id FROM usuario_fornecedor WHERE usuario_id = $1 LIMIT 1",
      [userId]
    );
    if (relForn.rows.length === 0) {
      return res.json([]);
    }
    const fornecedorId = relForn.rows[0].fornecedor_id;

    const query = `
      SELECT m.id,
             m.nome_motorista,
             m.cpf
      FROM motoristas m
      WHERE m.fornecedor_id = $1
      ORDER BY m.id ASC;
    `;
    const result = await pool.query(query, [fornecedorId]);
    return res.json(result.rows);
  } catch (error) {
    return res.status(500).json({ success: false, message: "Erro interno ao listar motoristas do fornecedor." });
  }
});

// ====> API: Cadastrar motorista para o fornecedor do usuário logado
// Sem 'fornecedor_id' no body - é definido pelo userId
app.post(
  "/api/fornecedor/motoristas/cadastrar",
  uploadFrota.fields([
    { name: "cnh_pdf", maxCount: 1 },
    { name: "cert_transporte_escolar", maxCount: 1 },
    { name: "cert_transporte_passageiros", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const userId = req.session.userId || null;
      const relForn = await pool.query(
        "SELECT fornecedor_id FROM usuario_fornecedor WHERE usuario_id = $1 LIMIT 1",
        [userId]
      );
      if (relForn.rows.length === 0) {
        return res.status(403).json({ success: false, message: "Usuário não vinculado a nenhum fornecedor." });
      }
      const fornecedorId = relForn.rows[0].fornecedor_id;

      const {
        nome_motorista,
        cpf,
        rg,
        data_nascimento,
        telefone,
        email,
        endereco,
        cidade,
        estado,
        cep,
        numero_cnh,
        categoria_cnh,
        validade_cnh,
        data_validade_transporte_escolar,
        data_validade_transporte_passageiros,
      } = req.body;

      if (!nome_motorista || !cpf || !numero_cnh || !categoria_cnh || !validade_cnh) {
        return res.status(400).json({
          success: false,
          message: "Campos obrigatórios não fornecidos.",
        });
      }

      let cnhPdfPath = null;
      let certTransporteEscolarPath = null;
      let certTransportePassageirosPath = null;

      if (req.files["cnh_pdf"] && req.files["cnh_pdf"].length > 0) {
        cnhPdfPath = "uploads/" + req.files["cnh_pdf"][0].filename;
      } else {
        return res.status(400).json({
          success: false,
          message: "CNH (PDF) é obrigatória.",
        });
      }
      if (req.files["cert_transporte_escolar"] && req.files["cert_transporte_escolar"].length > 0) {
        certTransporteEscolarPath = "uploads/" + req.files["cert_transporte_escolar"][0].filename;
      }
      if (req.files["cert_transporte_passageiros"] && req.files["cert_transporte_passageiros"].length > 0) {
        certTransportePassageirosPath = "uploads/" + req.files["cert_transporte_passageiros"][0].filename;
      }

      const fornecedorResult = await pool.query("SELECT nome_fornecedor FROM fornecedores WHERE id = $1", [fornecedorId]);
      const fornecedorNome = fornecedorResult.rows.length > 0 ? fornecedorResult.rows[0].nome_fornecedor : null;

      if (fornecedorNome && fornecedorNome !== "FUNDO MUNICIPAL DE EDUCAÇÃO DE CANAA DOS CARAJAS") {
        if (!certTransporteEscolarPath) {
          return res.status(400).json({
            success: false,
            message: "Certificado de transporte escolar é obrigatório para este fornecedor.",
          });
        }
        if (!certTransportePassageirosPath) {
          return res.status(400).json({
            success: false,
            message: "Certificado de transporte de passageiros é obrigatório para este fornecedor.",
          });
        }
      }

      const insertQuery = `
        INSERT INTO motoristas (
          nome_motorista, cpf, rg, data_nascimento, telefone, email, endereco,
          cidade, estado, cep, numero_cnh, categoria_cnh, validade_cnh, fornecedor_id,
          cnh_pdf, cert_transporte_escolar, cert_transporte_passageiros,
          data_validade_transporte_escolar, data_validade_transporte_passageiros
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10, $11, $12, $13, $14,
          $15, $16, $17, $18, $19
        )
        RETURNING id;
      `;
      const values = [
        nome_motorista,
        cpf,
        rg || null,
        data_nascimento || null,
        telefone || null,
        email || null,
        endereco || null,
        cidade || null,
        estado || null,
        cep || null,
        numero_cnh,
        categoria_cnh,
        validade_cnh,
        fornecedorId,
        cnhPdfPath,
        certTransporteEscolarPath,
        certTransportePassageirosPath,
        data_validade_transporte_escolar || null,
        data_validade_transporte_passageiros || null,
      ];
      const result = await pool.query(insertQuery, values);
      if (result.rows.length === 0) {
        return res.status(500).json({ success: false, message: "Erro ao cadastrar motorista." });
      }
      const novoMotoristaId = result.rows[0].id;

      const mensagem = `Motorista cadastrado: ${nome_motorista}`;
      await pool.query(
        `INSERT INTO notificacoes (user_id, acao, tabela, registro_id, mensagem)
         VALUES ($1, 'CREATE', 'motoristas', $2, $3)`,
        [userId, novoMotoristaId, mensagem]
      );

      return res.json({ success: true, message: "Motorista cadastrado com sucesso!" });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Erro interno do servidor." });
    }
  }
);

// ====> API: Deletar motorista (somente se pertence ao fornecedor do user)
app.delete("/api/fornecedor/motoristas/:id", async (req, res) => {
  try {
    const userId = req.session.userId;
    const relForn = await pool.query(
      "SELECT fornecedor_id FROM usuario_fornecedor WHERE usuario_id = $1 LIMIT 1",
      [userId]
    );
    if (relForn.rows.length === 0) {
      return res.status(403).json({ success: false, message: "Usuário não vinculado a fornecedor." });
    }
    const fornecedorId = relForn.rows[0].fornecedor_id;
    const motoristaId = req.params.id;

    const checkQuery = `SELECT id FROM motoristas WHERE id = $1 AND fornecedor_id = $2`;
    const checkResult = await pool.query(checkQuery, [motoristaId, fornecedorId]);
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Motorista não encontrado ou não pertence a este fornecedor." });
    }

    await pool.query("DELETE FROM motoristas WHERE id = $1", [motoristaId]);
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Erro interno ao excluir motorista." });
  }
});

app.get("/api/fornecedor/frota", async (req, res) => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Não está logado." });
    }
    const relForn = await pool.query(
      "SELECT fornecedor_id FROM usuario_fornecedor WHERE usuario_id = $1 LIMIT 1",
      [userId]
    );
    if (relForn.rows.length === 0) {
      return res.json([]);
    }
    const fornecedorId = relForn.rows[0].fornecedor_id;

    const query = `
      SELECT f.id,
             f.cor_veiculo,
             f.placa,
             f.tipo_veiculo,
             f.capacidade
      FROM frota f
      WHERE f.fornecedor_id = $1
      ORDER BY f.id DESC
    `;
    const result = await pool.query(query, [fornecedorId]);
    return res.json(result.rows);
  } catch (error) {
    return res.status(500).json({ success: false, message: "Erro interno ao listar frota." });
  }
});

app.post("/api/fornecedor/frota/cadastrar", uploadFrota.fields([
  { name: "documentacao", maxCount: 1 },
  { name: "licenca", maxCount: 1 }
]), async (req, res) => {
  try {
    const userId = req.session?.userId;
    const {
      cor_veiculo,
      placa,
      tipo_veiculo,
      capacidade,
      ano,
      marca,
      modelo,
      tipo_combustivel,
      data_aquisicao,
      adaptado,
      elevador,
      ar_condicionado,
      gps,
      cinto_seguranca,
      fornecedor_id
    } = req.body;

    const relForn = await pool.query(
      "SELECT fornecedor_id FROM usuario_fornecedor WHERE usuario_id = $1 LIMIT 1",
      [userId]
    );
    if (relForn.rows.length === 0) {
      return res.status(403).json({ success: false, message: "Usuário não vinculado a fornecedor." });
    }
    const realFornId = relForn.rows[0].fornecedor_id;
    if (parseInt(fornecedor_id, 10) !== realFornId) {
      return res.status(403).json({ success: false, message: "Fornecedor inválido." });
    }

    let docPath = null;
    let licPath = null;
    if (req.files["documentacao"] && req.files["documentacao"].length > 0) {
      docPath = "uploads/" + req.files["documentacao"][0].filename;
    }
    if (req.files["licenca"] && req.files["licenca"].length > 0) {
      licPath = "uploads/" + req.files["licenca"][0].filename;
    }

    const adapt = adaptado === "Sim";
    const elev = elevador === "Sim";
    const arCond = ar_condicionado === "Sim";
    const gpsBool = gps === "Sim";
    const cintoBool = cinto_seguranca === "Sim";

    const insertQuery = `
      INSERT INTO frota (
        cor_veiculo, placa, tipo_veiculo, capacidade,
        ano, marca, modelo, tipo_combustivel, data_aquisicao,
        adaptado, elevador, ar_condicionado, gps, cinto_seguranca,
        fornecedor_id, documentacao, licenca
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6, $7, $8, $9,
        $10, $11, $12, $13, $14,
        $15, $16, $17
      )
      RETURNING id
    `;
    const values = [
      cor_veiculo,
      placa,
      tipo_veiculo || null,
      capacidade ? parseInt(capacidade, 10) : null,
      ano ? parseInt(ano, 10) : null,
      marca || null,
      modelo || null,
      tipo_combustivel || null,
      data_aquisicao || null,
      adapt,
      elev,
      arCond,
      gpsBool,
      cintoBool,
      realFornId,
      docPath,
      licPath
    ];
    const result = await pool.query(insertQuery, values);
    if (result.rows.length === 0) {
      return res.status(500).json({ success: false, message: "Falha ao cadastrar veículo." });
    }

    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Erro interno ao cadastrar veículo." });
  }
});

// =============================================================================
// MOTORISTAS ADMINISTRATIVOS
// =============================================================================

// [GET] Listar todos os motoristas administrativos (inclui veículo associado)
app.get("/api/motoristas_administrativos", async (req, res) => {
  try {
    const query = `
      SELECT
        m.id,
        m.nome_motorista,
        m.cpf,
        m.rg,
        m.data_nascimento,
        m.telefone,
        m.email,
        m.endereco,
        m.cidade,
        m.estado,
        m.cep,
        m.numero_cnh,
        m.categoria_cnh,
        m.validade_cnh,
        m.fornecedor_id,
        m.cnh_pdf,
        m.carro_id,
        fa.placa       AS carro_placa,
        f.nome_fornecedor
      FROM motoristas_administrativos m
      LEFT JOIN fornecedores_administrativos f
        ON f.id = m.fornecedor_id
      LEFT JOIN frota_administrativa fa
        ON fa.id = m.carro_id
      ORDER BY m.id;
    `;
    const result = await pool.query(query);
    return res.json(result.rows);
  } catch (error) {
    console.error("Erro ao listar motoristas administrativos:", error);
    return res.status(500).json({
      success: false,
      message: "Erro interno do servidor."
    });
  }
});

app.post("/api/motoristas_administrativos/:id/associar-carro", async (req, res) => {
  try {
    const { id } = req.params;
    const { carro_id } = req.body;
    await pool.query(
      "UPDATE motoristas_administrativos SET carro_id = $1 WHERE id = $2",
      [carro_id, id]
    );
    res.json({ success: true, message: "Motorista associado ao veículo com sucesso." });
  } catch (err) {
    console.error("Erro ao associar motorista ao veículo:", err);
    res.status(500).json({ success: false, message: "Erro interno ao associar veículo." });
  }
});

// [POST] Cadastrar novo motorista administrativo (com upload de CNH PDF)
app.post(
  "/api/motoristas_administrativos",
  uploadFrota.single("cnh_pdf"),  // utiliza multer para receber o arquivo PDF da CNH
  async (req, res) => {
    try {
      const {
        nome_motorista,
        cpf,
        rg,
        data_nascimento,
        telefone,
        email,
        endereco,
        cidade,
        estado,
        cep,
        numero_cnh,
        categoria_cnh,
        validade_cnh,
        fornecedor_id
      } = req.body;

      // Verificação de campos obrigatórios
      if (
        !nome_motorista ||
        !cpf ||
        !numero_cnh ||
        !categoria_cnh ||
        !validade_cnh ||
        !fornecedor_id
      ) {
        return res.status(400).json({
          success: false,
          message: "Campos obrigatórios não fornecidos."
        });
      }

      // Caminho do arquivo da CNH
      let cnhPdfPath = null;
      if (req.file && req.file.filename) {
        cnhPdfPath = "/uploads/" + req.file.filename;
      } else {
        return res.status(400).json({
          success: false,
          message: "CNH (PDF) é obrigatória."
        });
      }

      // Inserção do novo motorista no banco
      const insertQuery = `
        INSERT INTO motoristas_administrativos (
          nome_motorista, cpf, rg, data_nascimento, telefone, email,
          endereco, cidade, estado, cep,
          numero_cnh, categoria_cnh, validade_cnh,
          fornecedor_id, cnh_pdf
        ) VALUES ($1, $2, $3, $4, $5, $6,
                  $7, $8, $9, $10,
                  $11, $12, $13,
                  $14, $15)
        RETURNING id;
      `;
      const values = [
        nome_motorista,
        cpf,
        rg || null,
        data_nascimento || null,
        telefone || null,
        email || null,
        endereco || null,
        cidade || null,
        estado || null,
        cep || null,
        numero_cnh,
        categoria_cnh,
        validade_cnh,
        parseInt(fornecedor_id, 10),
        cnhPdfPath
      ];
      const result = await pool.query(insertQuery, values);

      if (result.rows.length === 0) {
        return res.status(500).json({
          success: false,
          message: "Erro ao cadastrar motorista."
        });
      }
      const novoMotoristaId = result.rows[0].id;

      // Registro de notificação (opcional)
      const userId = req.session?.userId || null;
      const mensagem = `Motorista administrativo cadastrado: ${nome_motorista}`;
      await pool.query(
        `INSERT INTO notificacoes (user_id, acao, tabela, registro_id, mensagem)
         VALUES ($1, 'CREATE', 'motoristas_administrativos', $2, $3)`,
        [userId, novoMotoristaId, mensagem]
      );

      return res.json({
        success: true,
        message: "Motorista cadastrado com sucesso!"
      });
    } catch (error) {
      console.error("Erro ao cadastrar motorista administrativo:", error);
      if (error.code === "23505") {
        // Violação de chave única (por exemplo, CPF duplicado)
        return res.status(400).json({
          success: false,
          message: "CPF já cadastrado para outro motorista."
        });
      }
      return res.status(500).json({
        success: false,
        message: "Erro interno do servidor."
      });
    }
  }
);

// [PUT] Atualizar dados de um motorista administrativo existente
app.put(
  "/api/motoristas_administrativos/:id",
  uploadFrota.single("cnh_pdf"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const {
        nome_motorista,
        cpf,
        rg,
        data_nascimento,
        telefone,
        email,
        endereco,
        cidade,
        estado,
        cep,
        numero_cnh,
        categoria_cnh,
        validade_cnh,
        fornecedor_id
      } = req.body;

      if (
        !nome_motorista ||
        !cpf ||
        !numero_cnh ||
        !categoria_cnh ||
        !validade_cnh ||
        !fornecedor_id
      ) {
        return res.status(400).json({
          success: false,
          message: "Campos obrigatórios não fornecidos."
        });
      }

      // Obter caminho atual da CNH no banco (caso não seja enviada nova)
      let cnhPdfPath = null;
      if (req.file && req.file.filename) {
        // Se um novo arquivo PDF da CNH foi enviado, atualiza o caminho
        cnhPdfPath = "uploads/" + req.file.filename;
      } else {
        // Mantém o caminho antigo se não foi enviada uma nova CNH
        const resOld = await pool.query(
          "SELECT cnh_pdf FROM motoristas_administrativos WHERE id = $1",
          [id]
        );
        if (resOld.rows.length > 0) {
          cnhPdfPath = resOld.rows[0].cnh_pdf;
        }
      }

      const updateQuery = `
        UPDATE motoristas_administrativos
        SET 
          nome_motorista = $1,
          cpf = $2,
          rg = $3,
          data_nascimento = $4,
          telefone = $5,
          email = $6,
          endereco = $7,
          cidade = $8,
          estado = $9,
          cep = $10,
          numero_cnh = $11,
          categoria_cnh = $12,
          validade_cnh = $13,
          fornecedor_id = $14,
          cnh_pdf = $15
        WHERE id = $16
        RETURNING id;
      `;
      const values = [
        nome_motorista,
        cpf,
        rg || null,
        data_nascimento || null,
        telefone || null,
        email || null,
        endereco || null,
        cidade || null,
        estado || null,
        cep || null,
        numero_cnh,
        categoria_cnh,
        validade_cnh,
        parseInt(fornecedor_id, 10),
        cnhPdfPath,
        parseInt(id, 10)
      ];
      const result = await pool.query(updateQuery, values);

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Motorista não encontrado."
        });
      }

      // Registro de notificação (opcional)
      const userId = req.session?.userId || null;
      const mensagem = `Motorista administrativo atualizado: ${nome_motorista}`;
      await pool.query(
        `INSERT INTO notificacoes (user_id, acao, tabela, registro_id, mensagem)
         VALUES ($1, 'UPDATE', 'motoristas_administrativos', $2, $3)`,
        [userId, id, mensagem]
      );

      return res.json({ success: true, message: "Motorista atualizado com sucesso!" });
    } catch (error) {
      console.error("Erro ao atualizar motorista administrativo:", error);
      if (error.code === "23505") {
        return res.status(400).json({
          success: false,
          message: "CPF já cadastrado para outro motorista."
        });
      }
      return res.status(500).json({
        success: false,
        message: "Erro interno do servidor."
      });
    }
  }
);

// [DELETE] Excluir um motorista administrativo
app.delete("/api/motoristas_administrativos/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query("DELETE FROM motoristas_administrativos WHERE id = $1", [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Motorista não encontrado."
      });
    }

    // Registro de notificação (opcional)
    const userId = req.session?.userId || null;
    await pool.query(
      `INSERT INTO notificacoes (user_id, acao, tabela, registro_id, mensagem)
       VALUES ($1, 'DELETE', 'motoristas_administrativos', $2, $3)`,
      [userId, id, `Motorista administrativo excluído: ID ${id}`]
    );

    return res.json({ success: true });
  } catch (error) {
    console.error("Erro ao excluir motorista administrativo:", error);
    return res.status(500).json({
      success: false,
      message: "Erro interno ao excluir motorista."
    });
  }
});


// Retorna dados de um veículo (for modal edit)
app.get("/api/fornecedor/frota/:id", async (req, res) => {
  try {
    const userId = req.session?.userId;
    const { id } = req.params;

    const relForn = await pool.query(
      "SELECT fornecedor_id FROM usuario_fornecedor WHERE usuario_id = $1 LIMIT 1",
      [userId]
    );
    if (relForn.rows.length === 0) {
      return res
        .status(403)
        .json({ success: false, message: "Usuário não vinculado a fornecedor." });
    }
    const fornecedorId = relForn.rows[0].fornecedor_id;

    const check = await pool.query(
      `SELECT *
       FROM frota
       WHERE id = $1
         AND fornecedor_id = $2
       LIMIT 1`,
      [id, fornecedorId]
    );
    if (check.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Veículo não encontrado." });
    }
    return res.json(check.rows[0]);
  } catch (error) {
    return res.status(500).json({ success: false, message: "Erro interno ao buscar veículo." });
  }
});

// Atualiza dados do veículo (PUT)
app.put("/api/fornecedor/frota/:id", uploadFrota.fields([
  { name: "documentacao", maxCount: 1 },
  { name: "licenca", maxCount: 1 }
]), async (req, res) => {
  try {
    const userId = req.session?.userId;
    const { id } = req.params;

    const relForn = await pool.query(
      "SELECT fornecedor_id FROM usuario_fornecedor WHERE usuario_id = $1 LIMIT 1",
      [userId]
    );
    if (relForn.rows.length === 0) {
      return res
        .status(403)
        .json({ success: false, message: "Usuário não vinculado a fornecedor." });
    }
    const fornecedorId = relForn.rows[0].fornecedor_id;

    const check = await pool.query(
      `SELECT *
       FROM frota
       WHERE id = $1
         AND fornecedor_id = $2
       LIMIT 1`,
      [id, fornecedorId]
    );
    if (check.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Veículo não encontrado." });
    }

    const {
      cor_veiculo,
      placa,
      tipo_veiculo,
      capacidade,
      ano,
      marca,
      modelo,
      tipo_combustivel,
      data_aquisicao,
      adaptado,
      elevador,
      ar_condicionado,
      gps,
      cinto_seguranca
    } = req.body;

    let docPath = null;
    let licPath = null;
    if (req.files["documentacao"] && req.files["documentacao"].length > 0) {
      docPath = "uploads/" + req.files["documentacao"][0].filename;
    }
    if (req.files["licenca"] && req.files["licenca"].length > 0) {
      licPath = "uploads/" + req.files["licenca"][0].filename;
    }

    const adaptBool = (adaptado === "Sim");
    const elevBool = (elevador === "Sim");
    const arBool = (ar_condicionado === "Sim");
    const gpsBool = (gps === "Sim");
    const cintoBool = (cinto_seguranca === "Sim");

    let updateFields = [];
    let values = [];
    let index = 1;

    if (cor_veiculo != null) {
      updateFields.push(`cor_veiculo = $${index++}`);
      values.push(cor_veiculo);
    }
    if (placa != null) {
      updateFields.push(`placa = $${index++}`);
      values.push(placa);
    }
    if (tipo_veiculo != null) {
      updateFields.push(`tipo_veiculo = $${index++}`);
      values.push(tipo_veiculo);
    }
    if (capacidade != null) {
      updateFields.push(`capacidade = $${index++}`);
      values.push(parseInt(capacidade, 10));
    }
    if (ano != null && ano !== "") {
      updateFields.push(`ano = $${index++}`);
      values.push(parseInt(ano, 10));
    }
    if (marca != null) {
      updateFields.push(`marca = $${index++}`);
      values.push(marca);
    }
    if (modelo != null) {
      updateFields.push(`modelo = $${index++}`);
      values.push(modelo);
    }
    if (tipo_combustivel != null) {
      updateFields.push(`tipo_combustivel = $${index++}`);
      values.push(tipo_combustivel);
    }
    if (data_aquisicao != null && data_aquisicao !== "") {
      updateFields.push(`data_aquisicao = $${index++}`);
      values.push(data_aquisicao);
    }
    if (adaptado != null) {
      updateFields.push(`adaptado = $${index++}`);
      values.push(adaptBool);
    }
    if (elevador != null) {
      updateFields.push(`elevador = $${index++}`);
      values.push(elevBool);
    }
    if (ar_condicionado != null) {
      updateFields.push(`ar_condicionado = $${index++}`);
      values.push(arBool);
    }
    if (gps != null) {
      updateFields.push(`gps = $${index++}`);
      values.push(gpsBool);
    }
    if (cinto_seguranca != null) {
      updateFields.push(`cinto_seguranca = $${index++}`);
      values.push(cintoBool);
    }
    if (docPath) {
      updateFields.push(`documentacao = $${index++}`);
      values.push(docPath);
    }
    if (licPath) {
      updateFields.push(`licenca = $${index++}`);
      values.push(licPath);
    }

    if (updateFields.length === 0) {
      return res.json({ success: true, message: "Nada para atualizar." });
    }

    const updateQuery = `
      UPDATE frota
      SET ${updateFields.join(", ")}
      WHERE id = $${index}
      RETURNING id
    `;
    values.push(id);

    const result = await pool.query(updateQuery, values);
    if (result.rows.length === 0) {
      return res.status(500).json({ success: false, message: "Erro ao atualizar veículo." });
    }

    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Erro interno ao atualizar veículo." });
  }
});

app.post("/api/fornecedor/frota/atribuir-rota", async (req, res) => {
  try {
    const userId = req.session?.userId;
    const { frota_id, rota_id } = req.body;

    const relForn = await pool.query(
      "SELECT fornecedor_id FROM usuario_fornecedor WHERE usuario_id = $1 LIMIT 1",
      [userId]
    );
    if (relForn.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: "Usuário não vinculado a fornecedor."
      });
    }
    const fornecedorId = relForn.rows[0].fornecedor_id;

    const checkFrota = await pool.query(
      "SELECT id FROM frota WHERE id = $1 AND fornecedor_id = $2 LIMIT 1",
      [frota_id, fornecedorId]
    );
    if (checkFrota.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Veículo não encontrado ou não pertence a este fornecedor."
      });
    }

    const checkRota = await pool.query(`
      SELECT r.id
      FROM linhas_rotas r
      JOIN fornecedores_rotas fr ON fr.rota_id = r.id
      WHERE r.id = $1
        AND fr.fornecedor_id = $2
      LIMIT 1
    `, [rota_id, fornecedorId]);
    if (checkRota.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Rota não encontrada ou não pertence a este fornecedor."
      });
    }

    await pool.query(`
      INSERT INTO frota_rotas (frota_id, rota_id)
      VALUES ($1, $2)
      ON CONFLICT (frota_id, rota_id) DO NOTHING
    `, [frota_id, rota_id]);

    return res.json({ success: true, message: "Veículo associado à rota com sucesso!" });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Erro ao associar veículo à rota."
    });
  }
});

app.post('/api/alunos/:id/associar-ponto-mais-proximo', async (req, res) => {
  const alunoId = Number(req.params.id);
  const client = await pool.connect();

  try {
    // 1) Carrega dados do aluno ------------------------------------------------
    const { rows: alunoRows } = await client.query(
      `SELECT id,
              latitude,
              longitude,
              transporte_escolar_poder_publico AS poder
         FROM  alunos_ativos
        WHERE  id = $1`,
      [alunoId]
    );

    if (alunoRows.length === 0) {
      return res.status(404).json({ error: 'Aluno não encontrado' });
    }

    const { latitude, longitude, poder } = alunoRows[0];

    // regra 1 – poder público deve ser Municipal ou Estadual
    const poderOk =
      poder && ['municipal', 'estadual'].includes(poder.toLowerCase());
    if (!poderOk) {
      return res
        .status(400)
        .json({ error: 'Aluno não é atendido pelo poder público Municipal/Estadual' });
    }

    // regra 2 – precisa ter lat/lng válidos
    if (latitude == null || longitude == null) {
      return res
        .status(400)
        .json({ error: 'Aluno sem coordenadas (latitude/longitude)' });
    }

    // 0) Busca associação antiga, para possível desativação do ponto anterior ----
    const { rows: oldRows } = await client.query(
      `SELECT ponto_id FROM alunos_pontos WHERE aluno_id = $1`,
      [alunoId]
    );
    const oldPontoId = oldRows[0]?.ponto_id;

    // 2) Seleciona o ponto mais próximo ---------------------------------------
    const { rows: pontoRows } = await client.query(
      `
      WITH cand AS (
        SELECT id,
               6371 * acos(
                 cos(radians($1)) * cos(radians(latitude)) *
                 cos(radians(longitude) - radians($2)) +
                 sin(radians($1)) * sin(radians(latitude))
               ) AS d
          FROM pontos
         WHERE latitude  IS NOT NULL
           AND longitude IS NOT NULL
      )
      SELECT id, d
        FROM cand
   ORDER BY d
      LIMIT 1
      `,
      [latitude, longitude]
    );

    if (pontoRows.length === 0) {
      return res
        .status(404)
        .json({ error: 'Nenhum ponto de parada possui coordenadas cadastradas' });
    }

    const pontoId = pontoRows[0].id;
    const distanciaKm = Number(pontoRows[0].d).toFixed(3);

    // 3) Grava associação (regra 3 – apenas um ponto por aluno) ---------------
    await client.query('BEGIN');

    // upsert na tabela de ligações
    await client.query(
      `
      INSERT INTO alunos_pontos (aluno_id, ponto_id)
           VALUES ($1, $2)
      ON CONFLICT (aluno_id)
      DO UPDATE SET ponto_id = EXCLUDED.ponto_id
      `,
      [alunoId, pontoId]
    );

    // atualiza campo direto na tabela de alunos (se existir)
    await client.query(
      `UPDATE alunos_ativos SET ponto_id = $2 WHERE id = $1`,
      [alunoId, pontoId]
    );

    // ativa o ponto novo, se ainda não estiver ativo
    await client.query(
      `UPDATE pontos
          SET status = 'ativo'
        WHERE id = $1
          AND status <> 'ativo'`,
      [pontoId]
    );

    // 4) Desativa o ponto antigo, se não houver mais alunos vinculados a ele ---
    if (oldPontoId && oldPontoId !== pontoId) {
      const { rows: cntRows } = await client.query(
        `SELECT COUNT(*)::int AS c FROM alunos_pontos WHERE ponto_id = $1`,
        [oldPontoId]
      );
      if (cntRows[0].c === 0) {
        await client.query(
          `UPDATE pontos SET status = 'inativo' WHERE id = $1`,
          [oldPontoId]
        );
      }
    }

    // 5) Ajusta status de TODOS os pontos conforme existência de alunos ---------
    // inativa pontos sem NENHUM aluno associado
    await client.query(`
      UPDATE pontos p
         SET status = 'inativo'
       WHERE status <> 'inativo'
         AND NOT EXISTS (
           SELECT 1
             FROM alunos_pontos ap
            WHERE ap.ponto_id = p.id
         )
    `);

    // ativa pontos que tenham ao menos UM aluno, mas estejam inativos
    await client.query(`
      UPDATE pontos p
         SET status = 'ativo'
       WHERE status <> 'ativo'
         AND EXISTS (
           SELECT 1
             FROM alunos_pontos ap
            WHERE ap.ponto_id = p.id
         )
    `);

    await client.query('COMMIT');

    // 6) Resposta --------------------------------------------------------------
    return res.json({
      alunoId,
      pontoId,
      distancia_km: distanciaKm
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erro ao associar ponto mais próximo:', err);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  } finally {
    client.release();
  }
});

app.get("/api/relatorio/alunos-mapeados", async (req, res) => {
  try {
    const { escola_id } = req.query;
    const params = [];
    let filtro = "";

    if (escola_id) { filtro = "WHERE a.escola_id = $1"; params.push(escola_id); }

    const sql = `
      SELECT  a.pessoa_nome                      AS nome_aluno,
              a.id_pessoa,
              a.id_matricula,
              e.nome                             AS escola_nome,
              ap.ponto_id,
              /* residência */
              a.latitude   AS residencia_lat,
              a.longitude  AS residencia_lng,
              /* ponto de parada */
              p.latitude   AS ponto_lat,
              p.longitude  AS ponto_lng
      FROM alunos_ativos        a
      JOIN escolas              e  ON e.id = a.escola_id
      JOIN alunos_pontos        ap ON ap.aluno_id = a.id
      JOIN pontos               p  ON p.id        = ap.ponto_id
      ${filtro}
      ORDER BY e.nome, a.pessoa_nome;
    `;
    const { rows } = await pool.query(sql, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Erro interno." });
  }
});

app.delete("/api/fornecedor/frota/:id", async (req, res) => {
  try {
    const userId = req.session?.userId;
    const { id } = req.params;

    const relForn = await pool.query(
      "SELECT fornecedor_id FROM usuario_fornecedor WHERE usuario_id = $1 LIMIT 1",
      [userId]
    );
    if (relForn.rows.length === 0) {
      return res.status(403).json({ success: false, message: "Usuário não vinculado a fornecedor." });
    }
    const fornecedorId = relForn.rows[0].fornecedor_id;

    const check = await pool.query(
      "SELECT id FROM frota WHERE id = $1 AND fornecedor_id = $2 LIMIT 1",
      [id, fornecedorId]
    );
    if (check.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Veículo não encontrado para este fornecedor." });
    }

    await pool.query("DELETE FROM frota WHERE id = $1", [id]);
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Erro interno ao excluir veículo." });
  }
});

app.get("/api/fornecedor/rotas", async (req, res) => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Usuário não está logado." });
    }

    // Busca o fornecedor_id do usuário logado
    const relForn = await pool.query(
      "SELECT fornecedor_id FROM usuario_fornecedor WHERE usuario_id = $1 LIMIT 1",
      [userId]
    );
    if (relForn.rows.length === 0) {
      // Se não houver associação, retorna array vazio
      return res.json([]);
    }
    const fornecedorId = relForn.rows[0].fornecedor_id;

    // Rotas associadas ao fornecedor_id via tabela intermediária
    const query = `
      SELECT r.id, r.identificador, r.descricao
      FROM linhas_rotas r
      JOIN fornecedores_rotas fr ON fr.rota_id = r.id
      WHERE fr.fornecedor_id = $1
      ORDER BY r.id ASC
    `;
    const result = await pool.query(query, [fornecedorId]);
    return res.json(result.rows);
  } catch (error) {
    console.error("Erro ao listar rotas do fornecedor:", error);
    return res.status(500).json({
      success: false,
      message: "Erro interno ao listar rotas do fornecedor.",
    });
  }
});

// ====> API: Atribuir rota ao motorista
app.post("/api/fornecedor/motoristas/atribuir-rota", async (req, res) => {
  try {
    const userId = req.session?.userId;
    const { motorista_id, rota_id } = req.body;

    // Verifica o fornecedor do usuário
    const relForn = await pool.query(
      "SELECT fornecedor_id FROM usuario_fornecedor WHERE usuario_id = $1 LIMIT 1",
      [userId]
    );
    if (relForn.rows.length === 0) {
      return res
        .status(403)
        .json({ success: false, message: "Usuário não vinculado a fornecedor." });
    }
    const fornecedorId = relForn.rows[0].fornecedor_id;

    // Verifica se o motorista pertence a este fornecedor
    const checkMotorista = await pool.query(
      "SELECT id FROM motoristas WHERE id = $1 AND fornecedor_id = $2",
      [motorista_id, fornecedorId]
    );
    if (checkMotorista.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Motorista não encontrado ou não pertence a este fornecedor.",
      });
    }

    // Verifica se a rota está associada a este fornecedor (linhas_rotas + fornecedores_rotas)
    const checkRota = await pool.query(
      `
        SELECT r.id
        FROM linhas_rotas r
        JOIN fornecedores_rotas fr ON fr.rota_id = r.id
        WHERE r.id = $1
          AND fr.fornecedor_id = $2
        LIMIT 1
      `,
      [rota_id, fornecedorId]
    );
    if (checkRota.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Rota não encontrada ou não pertence a este fornecedor.",
      });
    }

    // Insere na tabela motoristas_rotas (ou outro nome):
    await pool.query(
      `
        INSERT INTO motoristas_rotas (motorista_id, rota_id)
        VALUES ($1, $2)
        ON CONFLICT (motorista_id, rota_id) DO NOTHING
      `,
      [motorista_id, rota_id]
    );

    return res.json({
      success: true,
      message: "Rota atribuída ao motorista com sucesso!",
    });
  } catch (error) {
    console.error("Erro ao atribuir rota ao motorista:", error);
    return res
      .status(500)
      .json({ success: false, message: "Erro ao atribuir rota ao motorista." });
  }
});

app.get("/api/motoristas/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const numericId = parseInt(id, 10);
    if (isNaN(numericId)) {
      return res.status(400).json({
        success: false,
        message: "ID inválido",
      });
    }
    const query = `SELECT * FROM motoristas WHERE id = $1`;
    const result = await pool.query(query, [numericId]);
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Motorista não encontrado",
      });
    }
    return res.json(result.rows[0]);
  } catch (error) {
    console.error("Erro ao buscar motorista:", error);
    return res.status(500).json({
      success: false,
      message: "Erro interno do servidor",
    });
  }
});

// ====================================================================================
// LOGIN / CHECK CPF / DEFINIR SENHA (MOTORISTAS, se for usar app etc.)
// ====================================================================================
app.post("/api/motoristas/login", async (req, res) => {
  try {
    const { cpf, senha } = req.body;
    if (!cpf) {
      return res.status(400).json({
        success: false,
        message: "CPF é obrigatório",
      });
    }
    const queryMotorista =
      "SELECT id, senha FROM motoristas WHERE cpf = $1 LIMIT 1";
    const result = await pool.query(queryMotorista, [cpf]);
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Motorista não encontrado",
      });
    }
    const motorista = result.rows[0];
    if (!motorista.senha) {
      return res.status(200).json({
        success: false,
        needsPassword: true,
        message: "Senha não cadastrada",
      });
    }
    if (!senha) {
      return res.status(400).json({
        success: false,
        message: "Informe a senha",
      });
    }
    if (motorista.senha !== senha) {
      return res.status(401).json({
        success: false,
        message: "Senha incorreta",
      });
    }
    return res.status(200).json({
      success: true,
      message: "Login realizado com sucesso",
      motoristaId: motorista.id,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Erro interno do servidor",
    });
  }
});

app.post("/api/motoristas/definir-senha", async (req, res) => {
  try {
    const { cpf, novaSenha } = req.body;
    if (!cpf || !novaSenha) {
      return res.status(400).json({
        success: false,
        message: "CPF e novaSenha são obrigatórios",
      });
    }
    const queryMotorista = "SELECT id FROM motoristas WHERE cpf = $1 LIMIT 1";
    const result = await pool.query(queryMotorista, [cpf]);
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Motorista não encontrado",
      });
    }
    const updateQuery = "UPDATE motoristas SET senha = $1 WHERE cpf = $2";
    await pool.query(updateQuery, [novaSenha, cpf]);

    return res.status(200).json({
      success: true,
      message: "Senha definida com sucesso",
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Erro interno do servidor",
    });
  }
});

app.post("/api/motoristas/check-cpf", async (req, res) => {
  try {
    const { cpf } = req.body;
    if (!cpf) {
      return res.status(400).json({
        success: false,
        message: "CPF é obrigatório",
      });
    }
    const queryMotorista =
      "SELECT id, senha FROM motoristas WHERE cpf = $1 LIMIT 1";
    const result = await pool.query(queryMotorista, [cpf]);
    if (result.rows.length === 0) {
      return res.json({ found: false, hasPassword: false });
    }
    const { senha } = result.rows[0];
    return res.json({
      found: true,
      hasPassword: !!senha,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Erro interno do servidor",
    });
  }
});

// ====================================================================================
// PONTOS DE PARADA
// ====================================================================================

/* ------------------------------------------------------------------
   LISTAR TODOS OS PONTOS (AGORA COM alunos_count)
------------------------------------------------------------------ */
// ====>  NOVO  GET /api/zoneamentos/:id/pontos-ativos  <====
app.get("/api/zoneamentos/:id/pontos-ativos", async (req, res) => {
  try {
    const { id } = req.params;           // zoneamento_id
    const q = `
      SELECT  p.id,
              p.nome_ponto,
              p.latitude,
              p.longitude
        FROM  pontos              p
        JOIN  pontos_zoneamentos  z ON z.ponto_id = p.id
       WHERE  z.zoneamento_id = $1
         AND  p.status = 'ativo'
       ORDER BY p.id;
    `;
    const { rows } = await pool.query(q, [id]);
    return res.json(rows);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Erro interno." });
  }
});

app.get("/api/pontos", async (req, res) => {
  try {
    const q = `
      WITH alunos_turno AS (
        SELECT
          ap.ponto_id,
          CASE
            WHEN a.turma ILIKE '%MAT%'  THEN 'manha'
            WHEN a.turma ILIKE '%VESP%' THEN 'tarde'
            WHEN a.turma ILIKE '%NOT%'  THEN 'noite'
            WHEN a.turma ILIKE '%INT%'  THEN 'integral'
            ELSE NULL
          END AS turno
        FROM alunos_ativos a
        JOIN alunos_pontos ap ON ap.aluno_id = a.id
        WHERE a.latitude IS NOT NULL
          AND a.longitude IS NOT NULL
          AND LOWER(a.transporte_escolar_poder_publico) IN ('municipal','estadual')
      ),
      alunos_agg AS (
        SELECT
          ponto_id,
          COUNT(*)                               AS total,
          COUNT(*) FILTER (WHERE turno = 'manha')    AS manha,
          COUNT(*) FILTER (WHERE turno = 'tarde')    AS tarde,
          COUNT(*) FILTER (WHERE turno = 'noite')    AS noite,
          COUNT(*) FILTER (WHERE turno = 'integral') AS integral
        FROM alunos_turno
        GROUP BY ponto_id
      )
      SELECT
        p.id,
        p.nome_ponto,
        p.latitude,
        p.longitude,
        p.area,
        p.logradouro,
        p.numero,
        p.complemento,
        p.ponto_referencia,
        p.bairro,
        p.cep,
        p.status,
        COALESCE(a.total, 0)    AS alunos_count,
        COALESCE(a.manha, 0)    AS alunos_manha,
        COALESCE(a.tarde, 0)    AS alunos_tarde,
        COALESCE(a.noite, 0)    AS alunos_noite,
        COALESCE(a.integral, 0) AS alunos_integral,
        COALESCE(
          json_agg(
            json_build_object('id', z.id, 'nome', z.nome)
          ) FILTER (WHERE z.id IS NOT NULL),
          '[]'
        ) AS zoneamentos
      FROM pontos p
      LEFT JOIN alunos_agg          a  ON a.ponto_id = p.id
      LEFT JOIN pontos_zoneamentos pz ON pz.ponto_id = p.id
      LEFT JOIN zoneamentos         z  ON z.id = pz.zoneamento_id
      GROUP BY
        p.id,
        a.total,
        a.manha,
        a.tarde,
        a.noite,
        a.integral
      ORDER BY p.id;
    `;
    const { rows } = await pool.query(q);
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: "Erro interno." });
  }
});

// server.js
app.get('/api/itinerarios/:itinerario_id/linhas', async (req, res) => {
  try {
    const { itinerario_id } = req.params;
    // força usar o schema público
    await pool.query(`SET search_path TO public`);

    const query = `
      SELECT
        lr.id,
        lr.nome_linha,
        lr.descricao,
        lr.veiculo_tipo,
        lr.capacidade,
        lr.alunos_ids,
        lr.paradas_ids,
        -- sanitiza NaN e converte em objeto JSON
        REPLACE( ST_AsGeoJSON(lr.geom), 'NaN', 'null' )::json AS geojson,
        -- contagem por turno
        COALESCE((
          SELECT COUNT(*) 
            FROM alunos_ativos a 
           WHERE a.id = ANY(lr.alunos_ids) 
             AND a.turma ILIKE '%MAT%'
        ), 0) AS alunos_manha,
        COALESCE((
          SELECT COUNT(*) 
            FROM alunos_ativos a 
           WHERE a.id = ANY(lr.alunos_ids) 
             AND a.turma ILIKE '%VESP%'
        ), 0) AS alunos_tarde,
        COALESCE((
          SELECT COUNT(*) 
            FROM alunos_ativos a 
           WHERE a.id = ANY(lr.alunos_ids) 
             AND a.turma ILIKE '%NOT%'
        ), 0) AS alunos_noite,
        COALESCE((
          SELECT COUNT(*) 
            FROM alunos_ativos a 
           WHERE a.id = ANY(lr.alunos_ids) 
             AND a.turma ILIKE '%INT%'
        ), 0) AS alunos_integral
      FROM public.linhas_rotas lr
      WHERE lr.itinerario_id = $1
      ORDER BY lr.nome_linha;
    `;
    const { rows } = await pool.query(query, [itinerario_id]);
    res.json(rows);
  } catch (err) {
    console.error('Erro ao listar linhas:', err);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});



// ============================================================================
//  POST /api/itinerarios/:itinerario_id/linhas/gerar
//    • incluiDef?  ← req.body.incluir_deficiencia   (bool)
//    • diurno?     ← req.body.diurno                (bool)
// ============================================================================
app.post('/api/itinerarios/:itinerario_id/linhas/gerar', async (req, res) => {
  const client = await pool.connect();
  try {
    const { itinerario_id } = req.params;
    const incluirDef = !!req.body?.incluir_deficiencia;
    const diurno = !!req.body?.diurno;      // ★ NOVO

    /* ── constantes ── */
    const VEL_KMH = 60, T_STOP = 2, T_MAX = 120, MAX_CAP = 50;
    const TURNS = ['manha', 'tarde', 'noite', 'integral'];
    const TURNS_PROC = diurno ? ['dia', 'noite', 'integral'] : TURNS;

    /* ── util ── */
    const hav = (la1, lo1, la2, lo2) => {
      const R = 6371, r = Math.PI / 180;
      const dφ = (la2 - la1) * r, dλ = (lo2 - lo1) * r;
      const a = Math.sin(dφ / 2) ** 2 +
        Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(dλ / 2) ** 2;
      return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };
    const tempo = coords => {
      let d = 0; for (let i = 1; i < coords.length; i++)
        d += hav(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]);
      return Math.round((d / VEL_KMH) * 60 + (coords.length - 2) * T_STOP);
    };
    const vtCap = n => n <= 16 ? ['van', 16] : n <= 33 ? ['microonibus', 33] : ['onibus', 50];

    /* ── prepara ── */
    await client.query('BEGIN');
    await client.query('SET search_path TO public');
    await client.query('DELETE FROM linhas_rotas WHERE itinerario_id=$1', [itinerario_id]);

    const it = await client.query(
      'SELECT pontos_ids, escolas_ids FROM itinerarios WHERE id=$1', [itinerario_id]);
    if (!it.rowCount) throw new Error('Itinerário não encontrado');
    const pontosIds = it.rows[0].pontos_ids, escolasIds = it.rows[0].escolas_ids;

    const esc = await client.query(
      'SELECT latitude lat, longitude lng FROM escolas WHERE id = ANY($1) LIMIT 1', [escolasIds]);
    if (!esc.rowCount) throw new Error('Escola não encontrada');
    const school = { lat: +esc.rows[0].lat, lng: +esc.rows[0].lng };

    /* ── alunos ── */
    const { rows: alunos } = await client.query(`
      SELECT ap.ponto_id,
             a.id aluno_id,
             a.latitude, a.longitude, a.turma,
             (a.deficiencia IS NOT NULL AND array_length(a.deficiencia,1)>0) tem_def
        FROM alunos_ativos a
        JOIN alunos_pontos ap ON ap.aluno_id = a.id
       WHERE ap.ponto_id = ANY($1)
         AND a.escola_id  = ANY($2)
         AND a.latitude  IS NOT NULL
         AND a.longitude IS NOT NULL
         ${incluirDef ? '' : `
         AND (a.deficiencia IS NULL OR array_length(a.deficiencia,1)=0)`}`,
      [pontosIds, escolasIds]);

    /* ── monta rawStops ── */
    const raw = {};                 // key → {lat,lng,ponto_id,alunos{turno:[]}}
    alunos.forEach(a => {
      const turno = /MAT/i.test(a.turma) ? 'manha' :
        /VESP/i.test(a.turma) ? 'tarde' :
          /NOT/i.test(a.turma) ? 'noite' : 'integral';
      const key = a.tem_def ? `E-${a.aluno_id}` : String(a.ponto_id);
      if (!raw[key]) raw[key] = {
        lat: +a.latitude, lng: +a.longitude, ponto_id: a.ponto_id || null,
        alunos: { manha: [], tarde: [], noite: [], integral: [] }
      };
      raw[key].alunos[turno].push(a.aluno_id);
    });

    /* coords faltantes de pontos normais */
    const falt = Object.values(raw).filter(s => !s.lat);
    if (falt.length) {
      const ids = falt.map(s => s.ponto_id);
      const pts = await client.query(
        'SELECT id,ST_Y(geom) lat,ST_X(geom) lng FROM pontos WHERE id=ANY($1)', [ids]);
      pts.rows.forEach(p => {
        const s = raw[Object.keys(raw).find(k => raw[k].ponto_id === p.id)];
        if (s) { s.lat = +p.lat; s.lng = +p.lng; }
      });
    }

    /* ── pseudoStops por turno / dia ── */
    const turnStops = {};
    TURNS_PROC.forEach(t => turnStops[t] = []);
    Object.entries(raw).forEach(([baseKey, s]) => {
      if (diurno) {
        /* turno “dia” usa o pico entre manhã e tarde */
        const peak = Math.max(s.alunos.manha.length, s.alunos.tarde.length);
        for (let i = 0; i < peak; i += MAX_CAP) {
          const ids = [      // alunos da faixa i-i+50 para cada turno (se existir)
            ...s.alunos.manha.slice(i, i + MAX_CAP),
            ...s.alunos.tarde.slice(i, i + MAX_CAP)
          ];
          if (!ids.length) continue;
          turnStops['dia'].push({
            key: `${baseKey}:dia:${i / MAX_CAP}`,
            baseKey, turno: 'dia', peakCount: Math.min(MAX_CAP, peak - i),
            lat: s.lat, lng: s.lng, alunosDia: ids,
            manha: s.alunos.manha.slice(i, i + MAX_CAP),
            tarde: s.alunos.tarde.slice(i, i + MAX_CAP)
          });
        }
      } else {
        ['manha', 'tarde'].forEach(t => {
          for (let i = 0; i < s.alunos[t].length; i += MAX_CAP) {
            const slice = s.alunos[t].slice(i, i + MAX_CAP);
            if (!slice.length) return;
            turnStops[t].push({
              key: `${baseKey}:${t}:${i / MAX_CAP}`,
              baseKey, turno: t,
              lat: s.lat, lng: s.lng, alunos: slice
            });
          }
        });
      }
      /* noite / integral nunca se fundem */
      ['noite', 'integral'].forEach(t => {
        for (let i = 0; i < s.alunos[t].length; i += MAX_CAP) {
          const slice = s.alunos[t].slice(i, i + MAX_CAP);
          if (!slice.length) return;
          turnStops[t].push({
            key: `${baseKey}:${t}:${i / MAX_CAP}`,
            baseKey, turno: t,
            lat: s.lat, lng: s.lng, alunos: slice
          });
        }
      });
    });

    /* ── clusterização greedy ── */
    const linhasTemp = [];   // cada item: {turno|dia, cluster, peakQt/qt, ids, coords}
    for (const turno of TURNS_PROC) {
      let pool = turnStops[turno].slice();
      while (pool.length) {
        pool.sort((a, b) => (b.peakCount || b.alunos.length) - (a.peakCount || a.alunos.length));
        const cluster = [pool.shift()];
        let carga = turno === 'dia'
          ? cluster[0].peakCount
          : cluster[0].alunos.length;

        let added;
        do {
          added = false;
          let best = -1, bestD = Infinity;
          for (let i = 0; i < pool.length; i++) {
            const cand = pool[i];
            const candCarga = turno === 'dia' ? cand.peakCount : cand.alunos.length;
            if (carga + candCarga > MAX_CAP) continue;
            const coords = [[school.lng, school.lat],
            ...cluster.map(c => [c.lng, c.lat]),
            [cand.lng, cand.lat],
            [school.lng, school.lat]];
            if (tempo(coords) > T_MAX) continue;
            const d = hav(cluster.at(-1).lat, cluster.at(-1).lng, cand.lat, cand.lng);
            if (d < bestD) { bestD = d; best = i; }
          }
          if (best >= 0) {
            const ch = pool.splice(best, 1)[0];
            cluster.push(ch);
            carga += turno === 'dia' ? ch.peakCount : ch.alunos.length;
            added = true;
          }
        } while (added);

        linhasTemp.push({ turno, cluster });
      }
    }

    /* ── monta dados finais p/ INSERT ── */
    let seq = 65;
    for (const ln of linhasTemp) {
      /* paradas físicas */
      const paradas = [...new Set(
        ln.cluster.map(c => raw[c.baseKey].ponto_id).filter(Boolean))];

      /* alunos por período */
      let idsManha = [], idsTarde = [], idsNoite = [], idsInte = [];
      if (diurno && ln.turno === 'dia') {
        idsManha = ln.cluster.flatMap(c => c.manha);
        idsTarde = ln.cluster.flatMap(c => c.tarde);
      } else {
        if (ln.turno === 'manha') idsManha = ln.cluster.flatMap(c => c.alunos);
        if (ln.turno === 'tarde') idsTarde = ln.cluster.flatMap(c => c.alunos);
      }
      if (ln.turno === 'noite') idsNoite = ln.cluster.flatMap(c => c.alunos);
      if (ln.turno === 'integral') idsInte = ln.cluster.flatMap(c => c.alunos);

      const alunosIds = [...new Set([
        ...idsManha, ...idsTarde, ...idsNoite, ...idsInte])];

      const coords = [[school.lng, school.lat],
      ...ln.cluster.map(c => [c.lng, c.lat]),
      [school.lng, school.lat]];
      const tMin = tempo(coords);

      /* pico de capacidade */
      const pico = diurno && ln.turno === 'dia'
        ? Math.max(idsManha.length, idsTarde.length)
        : alunosIds.length;
      const [vt, cap] = vtCap(pico);

      const periods = diurno && ln.turno === 'dia'
        ? ['manha', 'tarde']
        : [ln.turno];
      const tempos = {};
      periods.forEach(p => tempos[p] = tMin);

      const nome = String.fromCharCode(seq++);
      const ewkt = 'SRID=4326;LINESTRING(' +
        coords.map(p => p.join(' ')).join(',') + ')';

      await client.query(`
        INSERT INTO linhas_rotas
          (itinerario_id,nome_linha,descricao,
           veiculo_tipo,capacidade,
           alunos_ids,paradas_ids,geom,
           periodos_disponiveis,tempo_estimado)
        VALUES ($1,$2,$3,$4,$5,$6,$7,ST_GeomFromEWKT($8),$9,$10)`,
        [itinerario_id, nome, `Linha ${nome}`,
          vt, cap,
          alunosIds, paradas, ewkt,
          periods, tempos]);
    }

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('gerar linhas:', err);
    res.status(500).json({ error: 'Falha ao gerar linhas.' });
  } finally { client.release(); }
});


// GET /api/linhas/:linha_id/alunos — lista alunos da sub-rota por turno
app.get('/api/linhas/:linha_id/alunos', async (req, res) => {
  try {
    const { linha_id } = req.params;
    const { turno } = req.query;

    console.log(`▶️  Requisição recebida para linha ${linha_id}, turno: ${turno}`);

    const lr = await pool.query(
      `SELECT alunos_ids, paradas_ids
         FROM public.linhas_rotas
        WHERE id = $1`, [linha_id]
    );

    if (!lr.rowCount) {
      console.warn(`⚠️  Nenhuma linha encontrada com ID ${linha_id}`);
      return res.status(404).json({ error: 'Linha não encontrada.' });
    }

    const { alunos_ids, paradas_ids } = lr.rows[0];
    console.log(`✅ IDs encontrados: ${alunos_ids.length} alunos, ${paradas_ids.length} paradas`);

    const turnoCase = `
      CASE
        WHEN a.turma ILIKE '%MAT%'  THEN 'manha'
        WHEN a.turma ILIKE '%VESP%' THEN 'tarde'
        WHEN a.turma ILIKE '%NOT%'  THEN 'noite'
        WHEN a.turma ILIKE '%INT%'  THEN 'integral'
        ELSE NULL
      END
    `;

    const sql = `
      SELECT
        a.id,
        a.pessoa_nome                  AS nome,
        ${turnoCase}                  AS turno,
        e.nome                         AS escola_nome,
        COALESCE(e.latitude, -6.5201) AS escola_lat,
        COALESCE(e.longitude, -49.8532) AS escola_lng,
        p.id                           AS ponto_id,
        p.nome_ponto                   AS ponto_nome,
        p.latitude                     AS ponto_lat,
        p.longitude                    AS ponto_lng,
        COALESCE(array_length(a.deficiencia, 1), 0) > 0 AS tem_deficiencia
      FROM public.alunos_ativos a
      JOIN public.escolas        e  ON e.id = a.escola_id
      JOIN public.alunos_pontos  ap ON ap.aluno_id = a.id
      JOIN public.pontos         p  ON p.id = ap.ponto_id
      WHERE a.id        = ANY($1)
        AND ap.ponto_id = ANY($2)
        AND ${turnoCase} = $3
      ORDER BY a.pessoa_nome;
    `;

    const result = await pool.query(sql, [alunos_ids, paradas_ids, turno]);

    console.log(`✅ Alunos retornados: ${result.rows.length}`);
    if (result.rows.length > 0) {
      console.log(`🔎 Exemplo: ${JSON.stringify(result.rows[0], null, 2)}`);
    }

    res.json(result.rows);

  } catch (err) {
    console.error('❌ Erro ao listar alunos da linha:', err);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});



// LISTAR alunos com necessidades especiais de uma determinada escola
app.get('/api/escolas/:id/alunos-especiais', async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(
      `SELECT id,
              pessoa_nome   AS nome,
              bairro,
              latitude,
              longitude,
              deficiencia
         FROM alunos_ativos
        WHERE escola_id = $1
          AND deficiencia IS NOT NULL
          AND array_length(deficiencia,1) > 0
          AND bairro IS NOT NULL
          AND trim(bairro) <> ''`,
      [id]
    );
    return res.json(rows);
  } catch (err) {
    console.error('GET alunos-especiais:', err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});


app.post("/api/itinerarios-especiais", async (req, res) => {
  const { bairros_por_escola } = req.body;

  if (
    !Array.isArray(bairros_por_escola) ||
    bairros_por_escola.length === 0
  ) {
    return res
      .status(400)
      .json({ error: "Nenhuma escola enviada no payload." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const idsCriados = [];

    for (const item of bairros_por_escola) {
      const escolaId = +item.id || null;
      const bairros = Array.isArray(item.bairros) ? item.bairros : [];

      if (!escolaId || !bairros.length) continue; // segurança

      /* 1) Nome da escola para montar a descrição */
      const esc = await client.query(
        "SELECT nome FROM escolas WHERE id = $1 LIMIT 1",
        [escolaId]
      );
      if (!esc.rowCount) continue;                // escola inválida?

      const descricao = `${esc.rows[0].nome} - ${bairros.join(", ")}`;

      /* 2) INSERT propriamente dito */
      const ins = await client.query(
        `INSERT INTO itinerarios_especiais
           (escola_id, bairros, descricao)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [escolaId, bairros, descricao]
      );
      idsCriados.push(ins.rows[0].id);
    }

    await client.query("COMMIT");

    if (!idsCriados.length)
      return res
        .status(422)
        .json({ error: "Nenhum itinerário pôde ser criado." });

    /* Mantém compatibilidade com o front-end, devolvendo
       o primeiro ID, mas envia todos em 'ids' caso necessário. */
    res.json({ id: idsCriados[0], ids: idsCriados });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("POST /api/itinerarios-especiais:", e);
    res.status(500).json({ error: "Erro interno do servidor." });
  } finally {
    client.release();
  }
});

// -------------------------------------------------------------------
// LISTAR todos os itinerários especiais
// -------------------------------------------------------------------
app.get("/api/itinerarios-especiais", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT  ie.id,
              e.nome            AS escola,
              ie.bairros,
              ie.descricao
        FROM  itinerarios_especiais  ie
        JOIN  escolas               e  ON e.id = ie.escola_id
       ORDER BY ie.id DESC;
    `);

    return res.json(rows);   // → [{ id, escola, bairros, descricao }, …]
  } catch (err) {
    console.error("GET /api/itinerarios-especiais:", err);
    return res.status(500).json({ error: "Erro interno do servidor." });
  }
});


/* ==============================================================
 *  LINHAS DE ITINERARIOS ESPECIAIS
 * ============================================================== */
/* ==============================================================
 *  GET /api/itinerarios-especiais/:id/linhas
 *  (contagem por turno + geojson)
 * ============================================================== */
app.get('/api/itinerarios-especiais/:id/linhas', async (req, res) => {
  const { id } = req.params;
  const sql = `
    SELECT le.id,
           le.descricao,
           le.qtd_alunos,
           le.geojson,
           -- contagens por turno (extraídas de 'turma')
           SUM(CASE WHEN lower(a.turma) ~ '(mat|manh)'           THEN 1 END) AS alunos_manha,
           SUM(CASE WHEN lower(a.turma) ~ '(vesp|tarde)'         THEN 1 END) AS alunos_tarde,
           SUM(CASE WHEN lower(a.turma) ~ '(not|noit)'           THEN 1 END) AS alunos_noite,
           SUM(CASE WHEN lower(a.turma) ~ '(int|integral)'       THEN 1 END) AS alunos_integral
      FROM linhas_especiais le
 LEFT JOIN UNNEST(le.alunos_ids) AS aid(id) ON true
 LEFT JOIN alunos_ativos a ON a.id = aid.id
     WHERE le.itinerario_id = $1
  GROUP BY le.id
  ORDER BY le.id`;
  try {
    const { rows } = await pool.query(sql, [id]);
    res.json(rows);
  } catch (e) {
    console.error('GET linhas especiais:', e);
    res.status(500).json({ error: 'Erro interno.' });
  }
});


/* ==============================================================
 *  GET /api/linhas-especiais/:id/alunos?turno=manha|tarde|noite|integral
 * ============================================================== */
app.get('/api/linhas-especiais/:id/alunos', async (req, res) => {
  const { id } = req.params;
  const turnoPar = (req.query.turno || '').toLowerCase();

  const filtros = {
    manha: "(lower(a.turma) ~ '(mat|manh)')",
    tarde: "(lower(a.turma) ~ '(vesp|tarde)')",
    noite: "(lower(a.turma) ~ '(not|noit)')",
    integral: "(lower(a.turma) ~ '(int|integral)')"
  };
  const whereTurno = filtros[turnoPar] || 'true';

  const sql = `
    SELECT a.id,
           a.pessoa_nome                  AS nome,
           a.bairro,
           a.turma,
           CASE
             WHEN lower(a.turma) ~ '(mat|manh)'     THEN 'Manhã'
             WHEN lower(a.turma) ~ '(vesp|tarde)'   THEN 'Tarde'
             WHEN lower(a.turma) ~ '(not|noit)'     THEN 'Noite'
             WHEN lower(a.turma) ~ '(int|integral)' THEN 'Integral'
             ELSE ''
           END                                     AS turno_simples,
           e.nome                                   AS escola_nome
      FROM linhas_especiais le
      JOIN UNNEST(le.alunos_ids) AS aid(id)    ON true
      JOIN alunos_ativos        a              ON a.id = aid.id
      JOIN escolas              e              ON e.id = a.escola_id
     WHERE le.id = $1
       AND ${whereTurno}
     ORDER BY a.pessoa_nome`;
  try {
    const { rows } = await pool.query(sql, [id]);
    res.json(rows);
  } catch (e) {
    console.error('GET alunos linha especial:', e);
    res.status(500).json({ error: 'Erro interno.' });
  }
});


/* ==============================================================
 *  POST /api/itinerarios-especiais/:id/linhas/gerar
 *  Gera linhas especiais (≤ 42 alunos) usando casas dos alunos
 * ============================================================== */
app.post('/api/itinerarios-especiais/:id/linhas/gerar', async (req, res) => {
  const client = await pool.connect();
  const itId = parseInt(req.params.id, 10);
  const LIMITE = 42;

  /* distância Haversine em metros */
  const dist = (a, b) => {
    const R = 6371000, rad = x => x * Math.PI / 180;
    const dLat = rad(b.lat - a.lat);
    const dLon = rad(b.lon - a.lon);
    const h = Math.sin(dLat / 2) ** 2 +
      Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) *
      Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  };

  try {
    await client.query('BEGIN');

    /* 1) Coord. da escola do itinerário */
    /* 1) Coordenadas da escola ligada ao itinerário especial */
    const escola = await client.query(
      `SELECT e.id,
          e.nome,
          e.latitude  ::float AS lat,
          e.longitude ::float AS lon
     FROM itinerarios_especiais it
     JOIN escolas            e ON e.id = it.escola_id
    WHERE it.id = $1`, [itId]);

    if (!escola.rowCount)
      throw new Error('Itinerário ou escola inexistente.');

    const ESC = escola.rows[0];
    if (ESC.lat === null || ESC.lon === null)
      throw new Error('Escola sem latitude/longitude cadastrada.');


    /* 2) Alunos especiais ativos dessa escola */
    const alunos = (await client.query(`
        SELECT  id                AS aluno_id,
                latitude::float   AS lat,
                longitude::float  AS lon
          FROM  alunos_ativos
         WHERE  escola_id   = $1
           AND  deficiencia IS NOT NULL
           AND  array_length(deficiencia,1) > 0
           AND  latitude  IS NOT NULL
           AND  longitude IS NOT NULL`,
      [ESC.id])).rows;

    if (!alunos.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Nenhum aluno especial elegível.' });
    }

    /* 3) Algoritmo “greedy nearest” p/ agrupar até 42 alunos */
    let resto = [...alunos];   // cópia mutável
    const linhas = [];

    while (resto.length) {
      // começa com o aluno mais distante da escola (boa semente)
      resto.sort((a, b) => dist(b, ESC) - dist(a, ESC));
      const linha = [], coords = [], ids = [];
      let carga = 0;

      // 3.1 adiciona a semente
      const seed = resto.shift();
      linha.push(seed); ids.push(seed.aluno_id);
      carga++;

      // 3.2 completa até 42 buscando vizinho mais próximo
      while (carga < LIMITE && resto.length) {
        let best = 0, bestD = Infinity;
        resto.forEach((al, idx) => {
          linha.forEach(l => {
            const d = dist(al, l);
            if (d < bestD) { bestD = d; best = idx; }
          });
        });
        const prox = resto.splice(best, 1)[0];
        linha.push(prox);
        ids.push(prox.aluno_id);
        carga++;
      }

      /* ordem de visita simples: escola -> nearest-neighbour -> escola */
      const ordenada = [ESC, ...linha];
      // fecha o ciclo voltando à escola
      const path = [...ordenada, ESC].map(p => [p.lon, p.lat]);

      linhas.push({ alunos_ids: ids, qtd: carga, geo: path });
    }

    /* 4) Limpa antigas e grava novas */
    await client.query(
      'DELETE FROM linhas_especiais WHERE itinerario_id = $1', [itId]);

    for (let i = 0; i < linhas.length; i++) {
      const l = linhas[i];
      await client.query(`
        INSERT INTO linhas_especiais
               (itinerario_id, descricao, alunos_ids, qtd_alunos, geojson)
        VALUES ($1, $2, $3, $4, $5)`,
        [itId,
          `Linha ${i + 1}`,
          l.alunos_ids,
          l.qtd,
          JSON.stringify({ type: 'LineString', coordinates: l.geo })
        ]);
    }

    await client.query('COMMIT');
    res.json({ success: true, message: `${linhas.length} linha(s) criadas.` });

  } catch (e) {
    await client.query('ROLLBACK');
    console.error('GERAR LINHAS ESP:', e);
    res.status(500).json({ error: 'Falha ao gerar linhas.' });
  } finally {
    client.release();
  }
});



/* DELETE /api/linhas-especiais/:id
 * Exclui uma linha especial
 */
app.delete('/api/linhas-especiais/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM linhas_especiais WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE linha_especial:', err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});


/* ------------------------------------------------------------------
   CADASTRAR 1 PONTO
------------------------------------------------------------------ */
app.post("/api/pontos/cadastrar", async (req, res) => {
  try {
    const {
      latitudePonto, longitudePonto, area,
      logradouroPonto, numeroPonto, complementoPonto,
      pontoReferenciaPonto, bairroPonto, cepPonto,
      status = "ativo"                                /* ❶ */
    } = req.body;

    const zoneamentosPonto = JSON.parse(req.body.zoneamentosPonto || "[]");
    const userId = req.session?.userId || null;

    const ins = `
      INSERT INTO pontos(
        nome_ponto, latitude, longitude, area,
        logradouro, numero, complemento, ponto_referencia,
        bairro, cep, status                              /* ❷ */
      ) VALUES(
        'TEMP', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10            /* ❸ */
      ) RETURNING id`;
    const vals = [
      latitudePonto ? +latitudePonto : null,
      longitudePonto ? +longitudePonto : null,
      area,
      logradouroPonto || null,
      numeroPonto || null,
      complementoPonto || null,
      pontoReferenciaPonto || null,
      bairroPonto || null,
      cepPonto || null,
      status
    ];

    const { rows } = await pool.query(ins, vals);
    const pontoId = rows[0].id;

    /* renomeia para o próprio id */
    await pool.query("UPDATE pontos SET nome_ponto=$1 WHERE id=$2",
      [pontoId.toString(), pontoId]);

    /* zoneamentos */
    if (zoneamentosPonto.length) {
      const insZ = `INSERT INTO pontos_zoneamentos(ponto_id, zoneamento_id)
                    VALUES($1, $2)`;
      for (const zid of zoneamentosPonto)
        await pool.query(insZ, [pontoId, zid]);
    }

    /* notificação */
    await pool.query(`
      INSERT INTO notificacoes(user_id, acao, tabela, registro_id, mensagem)
      VALUES($1, 'CREATE', 'pontos', $2, $3)`,
      [userId, pontoId, `Ponto criado.ID = ${pontoId}`]);

    res.json({ success: true, message: "Ponto cadastrado!" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: "Erro interno." });
  }
});

/* ------------------------------------------------------------------
   CADASTRAR VÁRIOS
------------------------------------------------------------------ */
app.post("/api/pontos/cadastrar-multiplos", async (req, res) => {
  const client = await pool.connect();
  try {
    const { pontos, zoneamentos } = req.body;
    const userId = req.session?.userId || null;
    if (!Array.isArray(pontos) || !pontos.length)
      return res.status(400).json({ success: false, message: "Nenhum ponto." });

    await client.query("BEGIN");

    for (const p of pontos) {
      const {
        latitude, longitude, area, logradouro, numero,
        complemento, referencia, bairro, cep,
        zona, status = "ativo"                      /* ❹ default ativo */
      } = p;

      const ins = `
        INSERT INTO pontos(
        nome_ponto, latitude, longitude, area,
        logradouro, numero, complemento, ponto_referencia,
        bairro, cep, status
      ) VALUES(
        'TEMP', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
      ) RETURNING id`;
      const vals = [
        latitude != null ? +latitude : null,
        longitude != null ? +longitude : null,
        area || null, logradouro || null, numero || null,
        complemento || null, referencia || null,
        bairro || null, cep || null, status
      ];
      const { rows } = await client.query(ins, vals);
      const pontoId = rows[0].id;

      await client.query("UPDATE pontos SET nome_ponto=$1 WHERE id=$2",
        [pontoId.toString(), pontoId]);

      /* zona detectada */
      if (zona && zona !== "N/A") {
        let { rows: zRows } = await client.query(
          `SELECT id FROM zoneamentos WHERE nome = $1 LIMIT 1`, [zona]);
        let zid = zRows[0]?.id;
        if (!zid) {
          ({ rows: zRows } = await client.query(
            `INSERT INTO zoneamentos(nome) VALUES($1) RETURNING id`, [zona]));
          zid = zRows[0].id;
        }
        await client.query(`INSERT INTO pontos_zoneamentos(ponto_id, zoneamento_id)
                            VALUES($1, $2)`, [pontoId, zid]);
      }

      /* zona(s) escolhidas pelo usuário */
      if (zoneamentos?.length) {
        for (const zid of zoneamentos)
          await client.query(`INSERT INTO pontos_zoneamentos(ponto_id, zoneamento_id)
                              VALUES($1, $2)`, [pontoId, zid]);
      }

      await client.query(`
        INSERT INTO notificacoes(user_id, acao, tabela, registro_id, mensagem)
        VALUES($1, 'CREATE', 'pontos', $2, $3)`,
        [userId, pontoId, `Ponto criado(multi).ID = ${pontoId}`]);
    }
    await client.query("COMMIT");
    res.json({ success: true, message: "Pontos cadastrados!" });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    res.status(500).json({ success: false, message: "Erro interno." });
  } finally { client.release(); }
});

/* ------------------------------------------------------------------
   ATUALIZAR
------------------------------------------------------------------ */
app.put("/api/pontos/atualizar/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      latitudePontoEdit, longitudePontoEdit, areaEdit,
      logradouroPontoEdit, numeroPontoEdit, complementoPontoEdit,
      pontoReferenciaPontoEdit, bairroPontoEdit, cepPontoEdit,
      status = "ativo"                                /* ❺ */
    } = req.body;

    const zoneamentos = JSON.parse(req.body.zoneamentosPontoEdit || "[]");
    const userId = req.session?.userId || null;

    const up = `
      UPDATE pontos SET
        latitude = $1, longitude = $2, area = $3, logradouro = $4, numero = $5,
      complemento = $6, ponto_referencia = $7, bairro = $8, cep = $9, status = $10
      WHERE id = $11 RETURNING nome_ponto`;
    const vals = [
      latitudePontoEdit ? +latitudePontoEdit : null,
      longitudePontoEdit ? +longitudePontoEdit : null,
      areaEdit || null, logradouroPontoEdit || null, numeroPontoEdit || null,
      complementoPontoEdit || null, pontoReferenciaPontoEdit || null,
      bairroPontoEdit || null, cepPontoEdit || null, status, id
    ];
    const { rowCount, rows } = await pool.query(up, vals);
    if (!rowCount) return res.status(404).json({ success: false, message: "Ponto não encontrado." });

    await pool.query("DELETE FROM pontos_zoneamentos WHERE ponto_id=$1", [id]);
    if (zoneamentos.length) {
      const ins = `INSERT INTO pontos_zoneamentos(ponto_id, zoneamento_id)
                   VALUES($1, $2)`;
      for (const zid of zoneamentos)
        await pool.query(ins, [id, zid]);
    }

    await pool.query(`
      INSERT INTO notificacoes(user_id, acao, tabela, registro_id, mensagem)
      VALUES($1, 'UPDATE', 'pontos', $2, $3)`,
      [userId, id, `Ponto ${rows[0].nome_ponto} atualizado.`]);

    res.json({ success: true, message: "Atualizado!" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: "Erro interno." });
  }
});

/* ------------------------------------------------------------------
   EXCLUIR
------------------------------------------------------------------ */
app.delete("/api/pontos/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.session?.userId || null;

    const { rowCount: rc } = await pool.query(
      "DELETE FROM pontos WHERE id=$1 RETURNING nome_ponto", [id]);
    if (!rc) return res.status(404).json({ success: false, message: "Não encontrado." });

    await pool.query(`
      INSERT INTO notificacoes(user_id, acao, tabela, registro_id, mensagem)
      VALUES($1, 'DELETE', 'pontos', $2, $3)`,
      [userId, id, `Ponto ${id} removido.`]);
    res.json({ success: true, message: "Ponto excluído!" });
  } catch (e) {
    res.status(500).json({ success: false, message: "Erro interno." });
  }
});

// ====================================================================================
// ENDPOINT DE NOTIFICAÇÕES
// ====================================================================================
app.get("/api/notificacoes", async (req, res) => {
  try {
    // 1) Verifica autenticação
    if (!req.session?.userId) {
      return res.status(401).json({ success: false, message: "Não logado" });
    }
    const userId = req.session.userId;

    // 2) Consulta todas as notificações não lidas (user-specific ou gerais), ordenadas por data
    const query = `
      SELECT id,
             acao,
             tabela,
             registro_id,
             mensagem,
             datahora,
             is_read
      FROM notificacoes
      WHERE (user_id = $1 OR user_id IS NULL)
        AND is_read = FALSE
      ORDER BY datahora DESC
    `;
    const { rows } = await pool.query(query, [userId]);

    // 3) Formata o tempo relativo
    const now = Date.now();
    const notifications = rows.map(r => {
      const diffMin = Math.floor((now - r.datahora.getTime()) / 60000);
      const tempoStr = diffMin < 60
        ? `Há ${diffMin} minuto(s)`
        : `Há ${Math.floor(diffMin / 60)} hora(s)`;
      return {
        id: r.id,
        mensagem: r.mensagem,
        tempo: tempoStr,
        is_read: r.is_read
      };
    });

    // 4) Retorna tudo
    return res.json({ success: true, notifications });
  } catch (err) {
    console.error("Erro ao buscar notificações:", err);
    return res.status(500).json({ success: false, message: "Erro interno do servidor." });
  }
});


// Marcar uma ou várias notificações como lidas
app.patch("/api/notificacoes/marcar-lido", async (req, res) => {
  try {
    // 1) Verifica se o usuário está logado (opcional, dependendo da sua lógica)
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ success: false, message: "Não logado" });
    }
    const userId = req.session.userId;

    // 2) Recebe um array com os IDs das notificações do front-end
    const { notificacaoIds } = req.body;
    if (!Array.isArray(notificacaoIds) || notificacaoIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Nenhum ID de notificação fornecido.",
      });
    }
    const updateQuery = `
        UPDATE notificacoes
        SET is_read = TRUE
        WHERE id = ANY($1)
          AND(user_id = $2 OR user_id IS NULL)
        `;
    await pool.query(updateQuery, [notificacaoIds, userId]);

    return res.json({
      success: true,
      message: "Notificações marcadas como lidas.",
    });
  } catch (error) {
    console.error("Erro ao marcar notificações como lidas:", error);
    return res
      .status(500)
      .json({ success: false, message: "Erro interno do servidor." });
  }
});



app.get("/api/estatisticas-transporte", async (req, res) => {
  try {
    const meses = [
      "Jan",
      "Fev",
      "Mar",
      "Abr",
      "Mai",
      "Jun",
      "Jul",
      "Ago",
      "Set",
      "Out",
      "Nov",
      "Dez",
    ];
    const totalRotasPorMes = new Array(12).fill(0);
    const rotasUrbanaPorMes = new Array(12).fill(0);
    const rotasRuralPorMes = new Array(12).fill(0);

    const query = `
            SELECT
                EXTRACT(MONTH FROM created_at):: int AS mes,
      area_zona,
      COUNT(*) AS total
            FROM linhas_rotas
            GROUP BY 1, area_zona
            ORDER BY 1;
    `;
    const { rows } = await pool.query(query);

    rows.forEach((item) => {
      const mesIndex = item.mes - 1;
      const zona = item.area_zona;
      const qtd = parseInt(item.total, 10);

      totalRotasPorMes[mesIndex] += qtd;
      if (zona === "URBANA") {
        rotasUrbanaPorMes[mesIndex] = qtd;
      } else if (zona === "RURAL") {
        rotasRuralPorMes[mesIndex] = qtd;
      }
    });

    return res.json({
      periodo: meses,
      totalRotas: totalRotasPorMes,
      rotasUrbana: rotasUrbanaPorMes,
      rotasRural: rotasRuralPorMes,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
});


app.get("/api/fornecedores-admin", async (req, res) => {
  try {
    const query = `SELECT id, nome_fornecedor FROM fornecedores ORDER BY nome_fornecedor ASC`;
    const result = await pool.query(query);
    return res.status(200).json(result.rows);
  } catch (error) {
    console.error("Erro ao buscar fornecedores:", error);
    return res.status(500).json({ error: "Erro interno ao buscar fornecedores." });
  }
});
// ====> ROTA PARA RELACIONAR USUÁRIO E FORNECEDOR
// Insere ou atualiza (simples) a relação
app.post("/api/admin/relate-user-fornecedor", async (req, res) => {
  try {
    const { userId, fornecedorId } = req.body;
    // Exemplo de upsert: se já existe vínculo para userId, atualiza; se não, insere
    const upsertQuery = `
      INSERT INTO usuario_fornecedor(usuario_id, fornecedor_id)
    VALUES($1, $2)
      ON CONFLICT(usuario_id)
      DO UPDATE SET fornecedor_id = EXCLUDED.fornecedor_id
    RETURNING *;
    `;
    const result = await pool.query(upsertQuery, [userId, fornecedorId]);
    return res.status(200).json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error("Erro ao relacionar usuário e fornecedor:", error);
    return res.status(500).json({ error: "Erro interno ao relacionar usuário e fornecedor." });
  }
});
app.get("/api/fornecedores", async (req, res) => {
  try {
    const query = `
    SELECT
    id,
      nome_fornecedor,
      tipo_contrato,
      cnpj,
      contato,
      latitude,
      longitude,
      logradouro,
      numero,
      complemento,
      bairro,
      cep
            FROM fornecedores
            ORDER BY id;
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Erro interno do servidor.",
    });
  }
});

// ====================================================================================
// RELACIONAMENTOS: MOTORISTAS / MONITORES -> ROTAS
// ====================================================================================
app.post("/api/motoristas/atribuir-rota", async (req, res) => {
  try {
    const { motorista_id, rota_id } = req.body;
    if (!motorista_id || !rota_id) {
      return res.status(400).json({
        success: false,
        message: "Parâmetros motorista_id e rota_id são obrigatórios.",
      });
    }

    // Log
    const userId = req.session?.userId || null;

    const insertQuery = `
            INSERT INTO motoristas_rotas(motorista_id, rota_id)
    VALUES($1, $2)
            RETURNING id;
    `;
    const result = await pool.query(insertQuery, [motorista_id, rota_id]);
    if (result.rowCount > 0) {
      // Notificação de "atribuição" (opcionalmente pode ser "CREATE" ou "UPDATE")
      const mensagem = `Rota ${rota_id} atribuída ao motorista ${motorista_id} `;
      await pool.query(
        `INSERT INTO notificacoes(user_id, acao, tabela, registro_id, mensagem)
    VALUES($1, 'CREATE', 'motoristas_rotas', $2, $3)`,
        [userId, result.rows[0].id, mensagem]
      );
      return res.json({
        success: true,
        message: "Rota atribuída com sucesso!",
      });
    } else {
      return res
        .status(500)
        .json({ success: false, message: "Não foi possível atribuir a rota." });
    }
  } catch (error) {
    console.error("Erro ao atribuir rota:", error);
    return res.status(500).json({
      success: false,
      message: "Erro interno do servidor ao atribuir rota.",
    });
  }
});

app.post("/api/monitores/atribuir-rota", async (req, res) => {
  try {
    const { monitor_id, rota_id } = req.body;
    if (!monitor_id || !rota_id) {
      return res.status(400).json({
        success: false,
        message: "Parâmetros monitor_id e rota_id são obrigatórios.",
      });
    }

    // Log
    const userId = req.session?.userId || null;

    await pool.query(
      "INSERT INTO monitores_rotas (monitor_id, rota_id) VALUES ($1, $2)",
      [monitor_id, rota_id]
    );

    // Notificação
    const mensagem = `Rota ${rota_id} atribuída ao monitor ${monitor_id} `;
    await pool.query(
      `INSERT INTO notificacoes(user_id, acao, tabela, registro_id, mensagem)
    VALUES($1, 'CREATE', 'monitores_rotas', $2, $3)`,
      [userId, rota_id, mensagem] // ou ID do insert, se quisesse
    );

    res.json({
      success: true,
      message: "Rota atribuída ao monitor com sucesso!",
    });
  } catch (error) {
    console.error("Erro ao atribuir rota para monitor:", error);
    res.json({ success: false, message: error.message });
  }
});

// ====================================================================================
// ROTA DE MOTORISTAS -> PONTOS/ESCOLAS
// ====================================================================================
app.get("/api/motoristas/rota", async (req, res) => {
  try {
    const { motoristaId } = req.query;
    if (!motoristaId) {
      return res
        .status(400)
        .json({ success: false, message: "motoristaId é obrigatório" });
    }
    const rotaIdQuery = `
            SELECT rota_id
            FROM motoristas_rotas
            WHERE motorista_id = $1
            LIMIT 1;
    `;
    const rotaIdResult = await pool.query(rotaIdQuery, [motoristaId]);
    if (rotaIdResult.rows.length === 0) {
      return res.json({
        success: true,
        message: "Nenhuma rota encontrada",
        pontos: [],
      });
    }
    const rotaId = rotaIdResult.rows[0].rota_id;

    const rotaDadosQuery = `
    SELECT
    partida_lat,
      partida_lng,
      chegada_lat,
      chegada_lng
            FROM linhas_rotas
            WHERE id = $1
            LIMIT 1;
    `;
    const rotaDadosRes = await pool.query(rotaDadosQuery, [rotaId]);
    if (rotaDadosRes.rows.length === 0) {
      return res.json({
        success: true,
        message: "Rota não encontrada",
        pontos: [],
      });
    }
    const rd = rotaDadosRes.rows[0];

    const pontosQuery = `
            SELECT p.latitude, p.longitude
            FROM rotas_pontos rp
            JOIN pontos p ON p.id = rp.ponto_id
            WHERE rp.rota_id = $1
            ORDER BY rp.id;
    `;
    const pontosRes = await pool.query(pontosQuery, [rotaId]);
    const pontosParada = pontosRes.rows.map((row) => ({
      lat: row.latitude ? parseFloat(row.latitude) : 0,
      lng: row.longitude ? parseFloat(row.longitude) : 0,
    }));

    const escolasQuery = `
            SELECT e.latitude, e.longitude
            FROM rotas_escolas re
            JOIN escolas e ON e.id = re.escola_id
            WHERE re.rota_id = $1
            ORDER BY re.id;
    `;
    const escolasRes = await pool.query(escolasQuery, [rotaId]);
    const escolasPontos = escolasRes.rows.map((row) => ({
      lat: row.latitude ? parseFloat(row.latitude) : 0,
      lng: row.longitude ? parseFloat(row.longitude) : 0,
    }));

    const listaPontos = [];
    if (rd.partida_lat != null && rd.partida_lng != null) {
      listaPontos.push({
        lat: parseFloat(rd.partida_lat),
        lng: parseFloat(rd.partida_lng),
      });
    }
    listaPontos.push(...pontosParada);
    listaPontos.push(...escolasPontos);
    if (rd.chegada_lat != null && rd.chegada_lng != null) {
      listaPontos.push({
        lat: parseFloat(rd.chegada_lat),
        lng: parseFloat(rd.chegada_lng),
      });
    }

    return res.json({
      success: true,
      message: "Rota carregada com sucesso",
      pontos: listaPontos,
    });
  } catch (error) {
    console.error(error);
    return res
      .status(500)
      .json({ success: false, message: "Erro interno ao buscar rota" });
  }
});

// ====================================================================================
// OUTRAS INFORMAÇÕES (DASHBOARD, ESCOLA COORDENADAS, ETC.)
// ====================================================================================
// ROTA /api/dashboard (atualizada para contar escolas e alunos mapeados)
app.get("/api/dashboard", async (req, res) => {
  try {
    const alunosMapeados = await pool.query(`
      SELECT COUNT(*)::int AS count
      FROM alunos_ativos
      WHERE latitude  IS NOT NULL
        AND longitude IS NOT NULL
        AND LOWER(transporte_escolar_poder_publico) IN('municipal', 'estadual')
    `);

    const rotasAtivas = await pool.query(`
      SELECT COUNT(*)::int AS count 
      FROM linhas_rotas
    `);

    const zoneamentosCount = await pool.query(`
      SELECT COUNT(*)::int AS count 
      FROM zoneamentos
    `);

    const motoristasCount = await pool.query(`
      SELECT COUNT(*)::int AS count 
      FROM motoristas
    `);

    const monitoresCount = await pool.query(`
      SELECT COUNT(*)::int AS count 
      FROM monitores
    `);

    const fornecedoresCount = await pool.query(`
      SELECT COUNT(*)::int AS count 
      FROM fornecedores
    `);

    const pontosCount = await pool.query(`
      SELECT COUNT(*)::int AS count 
      FROM pontos
    `);

    // NOVO: Contar escolas
    const escolasCount = await pool.query(`
      SELECT COUNT(*)::int AS count 
      FROM escolas
    `);

    res.json({
      alunos_mapeados: alunosMapeados.rows[0]?.count || 0, // ← só quem tem lat/lng
      rotas_ativas: rotasAtivas.rows[0]?.count || 0,
      zoneamentos_total: zoneamentosCount.rows[0]?.count || 0,
      motoristas_total: motoristasCount.rows[0]?.count || 0,
      monitores_total: monitoresCount.rows[0]?.count || 0,
      fornecedores_total: fornecedoresCount.rows[0]?.count || 0,
      pontos_total: pontosCount.rows[0]?.count || 0,
      escolas_total: escolasCount.rows[0]?.count || 0, // novo campo mantido
    });
  } catch (error) {
    console.error(error);
    res
      .status(500)
      .json({ success: false, message: "Erro interno do servidor." });
  }
});


// ====================================================================================
// DOWNLOAD DE ROTAS (KML, KMZ, GPX)
// ====================================================================================
function geojsonToKml(geojson) {
  let kml = `<? xml version = "1.0" encoding = "UTF-8" ?>
      <kml xmlns="http://www.opengis.net/kml/2.2">
        <Document>`;

  geojson.features.forEach((f, idx) => {
    const coords = f.geometry.coordinates
      .map((c) => c[0] + "," + c[1])
      .join(" ");
    kml += `
          <Placemark>
            <name>Rota ${f.properties.identificador || idx}</name>
            <description>${f.properties.descricao || ""}</description>
            <LineString>
              <coordinates>${coords}</coordinates>
            </LineString>
          </Placemark>`;
  });
  kml += "\n</Document>\n</kml>";
  return kml;
}

function geojsonToGpx(geojson) {
  let gpx = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
    <gpx version="1.1" creator="MyServer">
  `;
  geojson.features.forEach((f, idx) => {
    gpx += `<trk><name>Rota ${f.properties.identificador || idx
      }</name><trkseg>`;
    f.geometry.coordinates.forEach((c) => {
      gpx += `<trkpt lat="${c[1]}" lon="${c[0]}"></trkpt>`;
    });
    gpx += `</trkseg></trk>\n`;
  });
  gpx += "</gpx>";
  return gpx;
}

app.get("/api/download-rotas-todas", async (req, res) => {
  try {
    const { format } = req.query;
    if (!format || !["kml", "kmz", "gpx"].includes(format.toLowerCase())) {
      return res.status(400).send("Formato inválido. Use kml, kmz ou gpx.");
    }

    const rotasQuery = `
            SELECT 
                rs.id,
                rs.identificador,
                rs.descricao,
                rs.partida_lat,
                rs.partida_lng,
                rs.chegada_lat,
                rs.chegada_lng,
                COALESCE(json_agg(
                  json_build_object('id', p.id, 'latitude', p.latitude, 'longitude', p.longitude)
                ) FILTER (WHERE p.id IS NOT NULL), '[]') as pontos,
                COALESCE(json_agg(
                  json_build_object('id', e.id, 'latitude', e.latitude, 'longitude', e.longitude)
                ) FILTER (WHERE e.id IS NOT NULL), '[]') as escolas
            FROM linhas_rotas rs
            LEFT JOIN rotas_pontos rp ON rp.rota_id = rs.id
            LEFT JOIN pontos p ON p.id = rp.ponto_id
            LEFT JOIN rotas_escolas re ON re.rota_id = rs.id
            LEFT JOIN escolas e ON e.id = re.escola_id
            GROUP BY rs.id
            ORDER BY rs.id;
        `;
    const result = await pool.query(rotasQuery);
    if (result.rows.length === 0) {
      return res.status(404).send("Nenhuma rota encontrada.");
    }

    const features = [];
    result.rows.forEach((r) => {
      const coords = [];
      if (r.partida_lat != null && r.partida_lng != null) {
        coords.push([parseFloat(r.partida_lng), parseFloat(r.partida_lat)]);
      }
      (r.pontos || []).forEach((pt) => {
        if (pt.latitude != null && pt.longitude != null) {
          coords.push([parseFloat(pt.longitude), parseFloat(pt.latitude)]);
        }
      });
      (r.escolas || []).forEach((es) => {
        if (es.latitude != null && es.longitude != null) {
          coords.push([parseFloat(es.longitude), parseFloat(es.latitude)]);
        }
      });
      if (r.chegada_lat != null && r.chegada_lng != null) {
        coords.push([parseFloat(r.chegada_lng), parseFloat(r.chegada_lat)]);
      }
      if (coords.length < 2) {
        return;
      }
      features.push({
        type: "Feature",
        properties: {
          id: r.id,
          identificador: r.identificador,
          descricao: r.descricao,
        },
        geometry: {
          type: "LineString",
          coordinates: coords,
        },
      });
    });

    const geojson = { type: "FeatureCollection", features };
    const lowerFmt = format.toLowerCase();

    if (lowerFmt === "kml") {
      const kmlStr = geojsonToKml(geojson);
      res.setHeader("Content-Type", "application/vnd.google-earth.kml+xml");
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="todas_rotas.kml"'
      );
      return res.send(kmlStr);
    } else if (lowerFmt === "kmz") {
      const kmlStr = geojsonToKml(geojson);
      res.setHeader("Content-Type", "application/vnd.google-earth.kmz");
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="todas_rotas.kmz"'
      );

      const archive = archiver("zip", { zlib: { level: 9 } });
      archive.on("error", (err) => {
        throw err;
      });
      res.on("close", () => { });
      archive.pipe(res);
      archive.append(kmlStr, { name: "doc.kml" });
      archive.finalize();
    } else if (lowerFmt === "gpx") {
      const gpxStr = geojsonToGpx(geojson);
      res.setHeader("Content-Type", "application/gpx+xml");
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="todas_rotas.gpx"'
      );
      res.send(gpxStr);
    } else {
      return res.status(400).send("Formato inválido.");
    }
  } catch (error) {
    console.error("Erro ao gerar download de todas as rotas:", error);
    res.status(500).send("Erro ao gerar download de todas as rotas.");
  }
});

app.get("/api/download-rota/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { format } = req.query;
    if (!format || !["kml", "kmz", "gpx"].includes(format.toLowerCase())) {
      return res.status(400).send("Formato inválido. Use kml, kmz ou gpx.");
    }

    const rotaQuery = `
            SELECT 
                rs.id,
                rs.identificador,
                rs.descricao,
                rs.partida_lat,
                rs.partida_lng,
                rs.chegada_lat,
                rs.chegada_lng,
                COALESCE(json_agg(
                  json_build_object('id', p.id, 'latitude', p.latitude, 'longitude', p.longitude)
                ) FILTER (WHERE p.id IS NOT NULL), '[]') as pontos,
                COALESCE(json_agg(
                  json_build_object('id', e.id, 'latitude', e.latitude, 'longitude', e.longitude)
                ) FILTER (WHERE e.id IS NOT NULL), '[]') as escolas
            FROM linhas_rotas rs
            LEFT JOIN rotas_pontos rp ON rp.rota_id = rs.id
            LEFT JOIN pontos p ON p.id = rp.ponto_id
            LEFT JOIN rotas_escolas re ON re.rota_id = rs.id
            LEFT JOIN escolas e ON e.id = re.escola_id
            WHERE rs.id = $1
            GROUP BY rs.id
            LIMIT 1;
        `;
    const result = await pool.query(rotaQuery, [id]);
    if (result.rows.length === 0) {
      return res.status(404).send("Rota não encontrada.");
    }

    const r = result.rows[0];
    const coords = [];
    if (r.partida_lat != null && r.partida_lng != null) {
      coords.push([parseFloat(r.partida_lng), parseFloat(r.partida_lat)]);
    }
    (r.pontos || []).forEach((pt) => {
      if (pt.latitude != null && pt.longitude != null) {
        coords.push([parseFloat(pt.longitude), parseFloat(pt.latitude)]);
      }
    });
    (r.escolas || []).forEach((es) => {
      if (es.latitude != null && es.longitude != null) {
        coords.push([parseFloat(es.longitude), parseFloat(es.latitude)]);
      }
    });
    if (r.chegada_lat != null && r.chegada_lng != null) {
      coords.push([parseFloat(r.chegada_lng), parseFloat(r.chegada_lat)]);
    }

    if (coords.length < 2) {
      return res.status(400).send("Esta rota não possui pontos suficientes.");
    }

    const feature = {
      type: "Feature",
      properties: {
        id: r.id,
        identificador: r.identificador,
        descricao: r.descricao,
      },
      geometry: {
        type: "LineString",
        coordinates: coords,
      },
    };
    const geojson = { type: "FeatureCollection", features: [feature] };
    const lowerFmt = format.toLowerCase();

    if (lowerFmt === "kml") {
      const kmlStr = geojsonToKml(geojson);
      res.setHeader("Content-Type", "application/vnd.google-earth.kml+xml");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="rota_${r.id}.kml"`
      );
      return res.send(kmlStr);
    } else if (lowerFmt === "kmz") {
      const kmlStr = geojsonToKml(geojson);
      res.setHeader("Content-Type", "application/vnd.google-earth.kmz");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="rota_${r.id}.kmz"`
      );

      const archive = archiver("zip", { zlib: { level: 9 } });
      archive.on("error", (err) => {
        throw err;
      });
      res.on("close", () => { });
      archive.pipe(res);
      archive.append(kmlStr, { name: "doc.kml" });
      archive.finalize();
    } else if (lowerFmt === "gpx") {
      const gpxStr = geojsonToGpx(geojson);
      res.setHeader("Content-Type", "application/gpx+xml");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="rota_${r.id}.gpx"`
      );
      return res.send(gpxStr);
    } else {
      return res.status(400).send("Formato inválido.");
    }
  } catch (error) {
    console.error("Erro ao gerar download da rota específica:", error);
    res.status(500).send("Erro interno ao gerar download da rota específica.");
  }
});


// ====================================================================================
// VEÍCULO POR MOTORISTA
// ====================================================================================
app.get("/api/motoristas/veiculo/:motoristaId", async (req, res) => {
  try {
    const { motoristaId } = req.params;
    const query = `
            SELECT f.*
            FROM frota f
            INNER JOIN frota_motoristas fm ON fm.frota_id = f.id
            WHERE fm.motorista_id = $1
            LIMIT 1;
        `;
    const result = await pool.query(query, [motoristaId]);
    if (result.rows.length === 0) {
      return res.json({
        success: false,
        message: "Nenhum veículo encontrado para este motorista",
      });
    }
    return res.json({
      success: true,
      vehicle: result.rows[0],
    });
  } catch (error) {
    console.error("Erro ao buscar veículo para motorista:", error);
    return res.status(500).json({
      success: false,
      message: "Erro interno do servidor",
    });
  }
});

// ====================================================================================
// CHECKLISTS ÔNIBUS
// ====================================================================================
app.post("/api/checklists_onibus/salvar", async (req, res) => {
  try {
    const {
      motorista_id,
      frota_id,
      data_checklist,
      horario_saida,
      horario_retorno,
      quilometragem_final,
      cnh_valida,
      crlv_atualizado,
      aut_cert_escolar,
      pneus_calibragem,
      pneus_estado,
      pneu_estepe,
      fluido_oleo_motor,
      fluido_freio,
      fluido_radiador,
      fluido_parabrisa,
      freio_pe,
      freio_mao,
      farois,
      lanternas,
      setas,
      luz_freio,
      luz_re,
      iluminacao_interna,
      extintor,
      cintos,
      martelo_emergencia,
      kit_primeiros_socorros,
      lataria_pintura,
      vidros_limpos,
      retrovisores_ok,
      limpador_para_brisa,
      sinalizacao_externa,
      interior_limpo,
      combustivel_suficiente,
      triangulo_sinalizacao,
      macaco_chave_roda,
      material_limpeza,
      acessibilidade,
      obs_saida,
      combustivel_verificar,
      abastecimento,
      pneus_desgaste,
      lataria_avarias,
      interior_limpeza_retorno,
      extintor_retorno,
      cintos_retorno,
      kit_primeiros_socorros_retorno,
      equip_obrigatorio_retorno,
      equip_acessorio_retorno,
      problemas_mecanicos,
      incidentes,
      problema_portas_janelas,
      manutencao_preventiva,
      pronto_prox_dia,
      obs_retorno,
    } = req.body;

    // userId para log
    const userId = req.session?.userId || null;

    const selectQuery = `
            SELECT id FROM checklists_onibus
            WHERE motorista_id=$1 AND frota_id=$2 AND data_checklist=$3
            LIMIT 1
        `;
    const selectResult = await pool.query(selectQuery, [
      motorista_id,
      frota_id,
      data_checklist,
    ]);

    if (selectResult.rows.length > 0) {
      // UPDATE
      const checklistId = selectResult.rows[0].id;
      const updateQuery = `
                UPDATE checklists_onibus
                SET
                  horario_saida = $1,
                  horario_retorno = $2,
                  quilometragem_final = $3,
                  cnh_valida = $4,
                  crlv_atualizado = $5,
                  aut_cert_escolar = $6,
                  pneus_calibragem = $7,
                  pneus_estado = $8,
                  pneu_estepe = $9,
                  fluido_oleo_motor = $10,
                  fluido_freio = $11,
                  fluido_radiador = $12,
                  fluido_parabrisa = $13,
                  freio_pe = $14,
                  freio_mao = $15,
                  farois = $16,
                  lanternas = $17,
                  setas = $18,
                  luz_freio = $19,
                  luz_re = $20,
                  iluminacao_interna = $21,
                  extintor = $22,
                  cintos = $23,
                  martelo_emergencia = $24,
                  kit_primeiros_socorros = $25,
                  lataria_pintura = $26,
                  vidros_limpos = $27,
                  retrovisores_ok = $28,
                  limpador_para_brisa = $29,
                  sinalizacao_externa = $30,
                  interior_limpo = $31,
                  combustivel_suficiente = $32,
                  triangulo_sinalizacao = $33,
                  macaco_chave_roda = $34,
                  material_limpeza = $35,
                  acessibilidade = $36,
                  obs_saida = $37,
                  combustivel_verificar = $38,
                  abastecimento = $39,
                  pneus_desgaste = $40,
                  lataria_avarias = $41,
                  interior_limpeza_retorno = $42,
                  extintor_retorno = $43,
                  cintos_retorno = $44,
                  kit_primeiros_socorros_retorno = $45,
                  equip_obrigatorio_retorno = $46,
                  equip_acessorio_retorno = $47,
                  problemas_mecanicos = $48,
                  incidentes = $49,
                  problema_portas_janelas = $50,
                  manutencao_preventiva = $51,
                  pronto_prox_dia = $52,
                  obs_retorno = $53
                WHERE id=$54
            `;
      const updateValues = [
        horario_saida || null,
        horario_retorno || null,
        quilometragem_final ? parseInt(quilometragem_final, 10) : null,

        cnh_valida === "true",
        crlv_atualizado === "true",
        aut_cert_escolar === "true",

        pneus_calibragem === "true",
        pneus_estado === "true",
        pneu_estepe === "true",

        fluido_oleo_motor === "true",
        fluido_freio === "true",
        fluido_radiador === "true",
        fluido_parabrisa === "true",

        freio_pe === "true",
        freio_mao === "true",

        farois === "true",
        lanternas === "true",
        setas === "true",
        luz_freio === "true",
        luz_re === "true",
        iluminacao_interna === "true",

        extintor === "true",
        cintos === "true",
        martelo_emergencia === "true",
        kit_primeiros_socorros === "true",

        lataria_pintura === "true",
        vidros_limpos === "true",
        retrovisores_ok === "true",
        limpador_para_brisa === "true",
        sinalizacao_externa === "true",
        interior_limpo === "true",

        combustivel_suficiente === "true",
        triangulo_sinalizacao === "true",
        macaco_chave_roda === "true",
        material_limpeza === "true",
        acessibilidade === "true",

        obs_saida || null,

        combustivel_verificar === "true",
        abastecimento === "true",
        pneus_desgaste === "true",
        lataria_avarias === "true",
        interior_limpeza_retorno === "true",
        extintor_retorno === "true",
        cintos_retorno === "true",
        kit_primeiros_socorros_retorno === "true",

        equip_obrigatorio_retorno === "true",
        equip_acessorio_retorno === "true",

        problemas_mecanicos === "true",
        incidentes === "true",
        problema_portas_janelas === "true",

        manutencao_preventiva === "true",
        pronto_prox_dia === "true",
        obs_retorno || null,

        checklistId,
      ];
      await pool.query(updateQuery, updateValues);

      // Notificação: UPDATE
      const mensagem = `Checklist atualizado (ID: ${checklistId}) para motorista ${motorista_id}`;
      await pool.query(
        `INSERT INTO notificacoes (user_id, acao, tabela, registro_id, mensagem)
                 VALUES ($1, 'UPDATE', 'checklists_onibus', $2, $3)`,
        [userId, checklistId, mensagem]
      );

      return res.json({
        success: true,
        message: "Checklist atualizado com sucesso!",
      });
    } else {
      // INSERT
      const insertQuery = `
                INSERT INTO checklists_onibus (
                  motorista_id, frota_id, data_checklist,
                  horario_saida, horario_retorno, quilometragem_final,
                  cnh_valida, crlv_atualizado, aut_cert_escolar,
                  pneus_calibragem, pneus_estado, pneu_estepe,
                  fluido_oleo_motor, fluido_freio, fluido_radiador, fluido_parabrisa,
                  freio_pe, freio_mao,
                  farois, lanternas, setas, luz_freio, luz_re, iluminacao_interna,
                  extintor, cintos, martelo_emergencia, kit_primeiros_socorros,
                  lataria_pintura, vidros_limpos, retrovisores_ok, limpador_para_brisa,
                  sinalizacao_externa, interior_limpo,
                  combustivel_suficiente, triangulo_sinalizacao, macaco_chave_roda,
                  material_limpeza, acessibilidade, obs_saida,
                  combustivel_verificar, abastecimento, pneus_desgaste, lataria_avarias,
                  interior_limpeza_retorno, extintor_retorno, cintos_retorno, kit_primeiros_socorros_retorno,
                  equip_obrigatorio_retorno, equip_acessorio_retorno,
                  problemas_mecanicos, incidentes, problema_portas_janelas,
                  manutencao_preventiva, pronto_prox_dia, obs_retorno
                ) VALUES (
                  $1, $2, $3,
                  $4, $5, $6,
                  $7, $8, $9,
                  $10, $11, $12,
                  $13, $14, $15, $16,
                  $17, $18,
                  $19, $20, $21, $22, $23, $24,
                  $25, $26, $27, $28,
                  $29, $30, $31, $32,
                  $33, $34,
                  $35, $36, $37,
                  $38, $39, $40,
                  $41, $42, $43, $44,
                  $45, $46, $47, $48,
                  $49, $50,
                  $51, $52, $53,
                  $54, $55, $56
                )
                RETURNING id
            `;
      const insertValues = [
        motorista_id,
        frota_id,
        data_checklist,
        horario_saida || null,
        horario_retorno || null,
        quilometragem_final ? parseInt(quilometragem_final, 10) : null,

        cnh_valida === "true",
        crlv_atualizado === "true",
        aut_cert_escolar === "true",
        pneus_calibragem === "true",
        pneus_estado === "true",
        pneu_estepe === "true",

        fluido_oleo_motor === "true",
        fluido_freio === "true",
        fluido_radiador === "true",
        fluido_parabrisa === "true",

        freio_pe === "true",
        freio_mao === "true",

        farois === "true",
        lanternas === "true",
        setas === "true",
        luz_freio === "true",
        luz_re === "true",
        iluminacao_interna === "true",

        extintor === "true",
        cintos === "true",
        martelo_emergencia === "true",
        kit_primeiros_socorros === "true",

        lataria_pintura === "true",
        vidros_limpos === "true",
        retrovisores_ok === "true",
        limpador_para_brisa === "true",

        sinalizacao_externa === "true",
        interior_limpo === "true",

        combustivel_suficiente === "true",
        triangulo_sinalizacao === "true",
        macaco_chave_roda === "true",
        material_limpeza === "true",
        acessibilidade === "true",
        obs_saida || null,

        combustivel_verificar === "true",
        abastecimento === "true",
        pneus_desgaste === "true",
        lataria_avarias === "true",
        interior_limpeza_retorno === "true",
        extintor_retorno === "true",
        cintos_retorno === "true",
        kit_primeiros_socorros_retorno === "true",

        equip_obrigatorio_retorno === "true",
        equip_acessorio_retorno === "true",

        problemas_mecanicos === "true",
        incidentes === "true",
        problema_portas_janelas === "true",

        manutencao_preventiva === "true",
        pronto_prox_dia === "true",
        obs_retorno || null,
      ];
      const result = await pool.query(insertQuery, insertValues);
      if (result.rows.length > 0) {
        const newChecklistId = result.rows[0].id;
        // Notificação: CREATE
        const mensagem = `Checklist criado (ID: ${newChecklistId}) para motorista ${motorista_id}`;
        await pool.query(
          `INSERT INTO notificacoes (user_id, acao, tabela, registro_id, mensagem)
                     VALUES ($1, 'CREATE', 'checklists_onibus', $2, $3)`,
          [userId, newChecklistId, mensagem]
        );

        return res.json({
          success: true,
          message: "Checklist cadastrado com sucesso!",
          id: newChecklistId,
        });
      } else {
        return res.status(500).json({
          success: false,
          message: "Não foi possível inserir o checklist.",
        });
      }
    }
  } catch (error) {
    console.error("Erro ao salvar checklist_onibus:", error);
    return res
      .status(500)
      .json({ success: false, message: "Erro interno do servidor." });
  }
});

app.get("/api/checklists_onibus", async (req, res) => {
  try {
    const { motorista_id, frota_id, data_checklist } = req.query;
    if (!motorista_id || !frota_id || !data_checklist) {
      return res.status(400).json({
        success: false,
        message:
          "Parâmetros motorista_id, frota_id e data_checklist são obrigatórios.",
      });
    }
    const query = `
            SELECT *
            FROM checklists_onibus
            WHERE motorista_id=$1
              AND frota_id=$2
              AND data_checklist=$3
            LIMIT 1
        `;
    const values = [motorista_id, frota_id, data_checklist];
    const result = await pool.query(query, values);
    if (result.rows.length === 0) {
      return res.json({
        success: false,
        message: "Nenhum checklist encontrado para esse dia.",
      });
    }
    return res.json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    console.error("Erro ao buscar checklist_onibus:", error);
    return res
      .status(500)
      .json({ success: false, message: "Erro interno do servidor." });
  }
});

// ====================================================================================
// COCESSAO_ROTA (ALUNOS)
// ====================================================================================
app.get("/api/cocessao-rota", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM cocessao_rota");
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post(
  "/api/enviar-solicitacao",
  upload.fields([
    { name: "laudo_deficiencia", maxCount: 1 },
    { name: "comprovante_endereco", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const {
        nome_responsavel,
        cpf_responsavel,
        celular_responsavel,
        id_matricula_aluno,
        escola_id,
        cep,
        numero,
        endereco,
        zoneamento,
        deficiencia,
        latitude,
        longitude,
        observacoes,
        criterio_direito,
      } = req.body;

      let laudoDeficienciaPath = null;
      let comprovanteEnderecoPath = null;

      // userId para notificação
      const userId = req.session?.userId || null;

      if (
        req.files["laudo_deficiencia"] &&
        req.files["laudo_deficiencia"].length > 0
      ) {
        laudoDeficienciaPath = `uploads/${req.files["laudo_deficiencia"][0].filename}`;
      }
      if (
        req.files["comprovante_endereco"] &&
        req.files["comprovante_endereco"].length > 0
      ) {
        comprovanteEnderecoPath = `uploads/${req.files["comprovante_endereco"][0].filename}`;
      }

      const zoneamentoBool = zoneamento === "sim";
      const deficienciaBool = deficiencia === "sim";

      const insertQuery = `
                INSERT INTO cocessao_rota (
                    nome_responsavel,
                    cpf_responsavel,
                    celular_responsavel,
                    id_matricula_aluno,
                    escola_id,
                    cep,
                    numero,
                    endereco,
                    zoneamento,
                    deficiencia,
                    laudo_deficiencia_path,
                    comprovante_endereco_path,
                    latitude,
                    longitude,
                    observacoes,
                    criterio_direito
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
                        $9, $10, $11, $12, $13, $14, $15, $16)
                RETURNING id
            `;
      const values = [
        nome_responsavel,
        cpf_responsavel,
        celular_responsavel,
        id_matricula_aluno,
        parseInt(escola_id, 10) || null,
        cep,
        numero,
        endereco || null,
        zoneamentoBool,
        deficienciaBool,
        laudoDeficienciaPath,
        comprovanteEnderecoPath,
        latitude ? parseFloat(latitude) : null,
        longitude ? parseFloat(longitude) : null,
        observacoes || null,
        criterio_direito || null,
      ];
      const result = await pool.query(insertQuery, values);

      if (result.rows.length > 0) {
        const newId = result.rows[0].id;

        // Notificação
        const mensagem = `Nova solicitação de rota para aluno: matricula ${id_matricula_aluno}`;
        await pool.query(
          `INSERT INTO notificacoes (user_id, acao, tabela, registro_id, mensagem)
                     VALUES ($1, 'CREATE', 'cocessao_rota', $2, $3)`,
          [userId, newId, mensagem]
        );

        return res.json({
          success: true,
          message: "Solicitação salva com sucesso na tabela cocessao_rota!",
          id: newId,
        });
      } else {
        return res.status(500).json({
          success: false,
          message: "Erro ao inserir registro na tabela cocessao_rota.",
        });
      }
    } catch (error) {
      console.error(
        "Erro ao salvar solicitação na tabela cocessao_rota:",
        error
      );
      return res.status(500).json({
        success: false,
        message: "Erro interno do servidor ao salvar solicitação.",
      });
    }
  }
);
app.get("/api/alunos-transporte-publico", async (req, res) => {
  try {
    const query = `
            SELECT
              id,
              id_matricula,
              pessoa_nome,
              transporte_escolar_poder_publico,
              cep
            FROM alunos_ativos
            WHERE LOWER(transporte_escolar_poder_publico) IN ('estadual', 'municipal')
              AND cep IS NOT NULL
              AND cep <> ''
        `;
    const result = await pool.query(query);
    return res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    console.error("Erro ao buscar alunos para mapear:", error);
    return res.status(500).json({
      success: false,
      message: "Erro interno ao buscar alunos para mapear.",
    });
  }
});

app.get("/api/alunos_ativos", async (req, res) => {
  try {
    const search = req.query.search ? req.query.search.trim() : "";
    if (!search) {
      return res.json(null);
    }

    const query = `
      SELECT
        a.id,
        a.id_pessoa,
        a.id_matricula,
        a.pessoa_nome,
        a.cpf,
        a.cep,
        a.bairro,
        a.numero_pessoa_endereco,
        a.filiacao_1,
        a.numero_telefone,
        a.filiacao_2,
        a.responsavel,
        a.deficiencia,
        a.turma,
        a.data_nascimento,
        e.nome AS escola_nome
      FROM alunos_ativos a
      LEFT JOIN escolas e ON e.id = a.escola_id
      WHERE a.cpf = $1
         OR CAST(a.id_matricula AS TEXT) = $1
         OR CAST(a.id_pessoa     AS TEXT) = $1
         OR a.pessoa_nome ILIKE '%' || $1 || '%'
      LIMIT 1
    `;

    const result = await pool.query(query, [search]);
    if (result.rows.length === 0) {
      return res.json(null);
    }
    return res.json(result.rows[0]);

  } catch (error) {
    console.error("Erro ao buscar aluno:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
});


app.get("/api/escola-coordenadas", async (req, res) => {
  try {
    const { nome_escola } = req.query;
    if (!nome_escola) {
      return res.status(400).json({ error: "Parâmetro nome_escola é obrigatório" });
    }

    const query = `
      SELECT
        e.latitude,
        e.longitude,
        z.id AS zoneamento_id,
        z.nome AS zoneamento_nome,
        ST_AsGeoJSON(z.geom) AS geojson,
        ST_GeometryType(z.geom) AS geom_type
      FROM escolas e
      JOIN escolas_zoneamentos ez ON (e.id = ez.escola_id)
      JOIN zoneamentos z ON (ez.zoneamento_id = z.id)
      WHERE UPPER(e.nome) = UPPER($1)
    `;

    const result = await pool.query(query, [nome_escola]);
    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Escola não encontrada ou não possui zoneamento associado."
      });
    }

    const { latitude, longitude } = result.rows[0];
    if (latitude == null || longitude == null) {
      return res.status(404).json({
        error: "Escola encontrada, mas não possui coordenadas (latitude/longitude)."
      });
    }

    // Monta o array de zoneamentos de modo semelhante ao /api/zoneamentos
    const zoneamentos = result.rows.map((row) => ({
      id: row.zoneamento_id,
      nome: row.zoneamento_nome,
      geojson: JSON.parse(row.geojson),
      geom_type: row.geom_type
    }));

    return res.json({
      latitude: parseFloat(latitude),
      longitude: parseFloat(longitude),
      zoneamentos
    });
  } catch (error) {
    console.error("Erro ao buscar coordenadas da escola:", error);
    return res.status(500).json({ error: "Erro interno do servidor." });
  }
});

app.get("/api/alunos-mapa", async (req, res) => {
  try {
    const { escola_id, busca } = req.query;
    let sql = `
      SELECT a.*,
             e.nome AS escola_nome,
             e.logradouro AS escola_logradouro,
             e.numero AS escola_numero,
             e.bairro AS escola_bairro,
             e.cep AS escola_cep,
             e.latitude AS escola_latitude,
             e.longitude AS escola_longitude
      FROM alunos_ativos a
      LEFT JOIN escolas e ON e.id = a.escola_id
      WHERE 1=1
    `;
    const params = [];

    if (escola_id) {
      params.push(escola_id);
      sql += ` AND a.escola_id = $${params.length}`;
    }
    if (busca) {
      const lowerBusca = `%${busca.toLowerCase()}%`;
      params.push(lowerBusca, lowerBusca, lowerBusca);
      sql += ` AND (
        CAST(a.id_matricula AS TEXT) ILIKE $${params.length - 2}
        OR a.pessoa_nome ILIKE $${params.length - 1}
        OR a.cpf ILIKE $${params.length}
      )`;
    }
    sql += " ORDER BY a.id DESC";
    const result = await pool.query(sql, params);

    let escola = null;
    if (escola_id) {
      const eData = result.rows.find((r) => r.escola_id == escola_id);
      if (eData) {
        escola = {
          id: eData.escola_id,
          nome: eData.escola_nome,
          logradouro: eData.escola_logradouro,
          numero: eData.escola_numero,
          bairro: eData.escola_bairro,
          cep: eData.escola_cep,
          latitude: eData.escola_latitude,
          longitude: eData.escola_longitude,
        };
      }
    }
    return res.json({
      success: true,
      data: result.rows,
      escola,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      success: false,
      message: "Erro ao buscar alunos no mapa.",
    });
  }
});

app.get("/api/zoneamentos/detect", async (req, res) => {
  const client = await pool.connect();
  try {
    const { lat, lng } = req.query;
    if (!lat || !lng) {
      return res.json({ zona: null });
    }

    // Transformar em float
    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);

    // Cria geometria do ponto
    const pointGeom = `ST_SetSRID(ST_MakePoint(${lngNum}, ${latNum}), 4326)`;

    await client.query("BEGIN");

    // Tenta encontrar polígono que contenha o ponto
    const queryPoligono = `
      SELECT id, nome
      FROM zoneamentos
      WHERE ST_Contains(geom, ${pointGeom})
      LIMIT 1
    `;
    const poligono = await client.query(queryPoligono);
    if (poligono.rows.length > 0) {
      await client.query("COMMIT");
      return res.json({ zona: poligono.rows[0].nome });
    }

    // Se não encontrou polígono, procura linha próxima
    const dist = 0.001; // 100m aprox.
    const queryLinhas = `
      SELECT id, nome
      FROM zoneamentos
      WHERE ST_DWithin(geom, ${pointGeom}, ${dist})
      ORDER BY ST_Distance(geom, ${pointGeom})
      LIMIT 1
    `;
    const linha = await client.query(queryLinhas);
    if (linha.rows.length > 0) {
      await client.query("COMMIT");
      return res.json({ zona: linha.rows[0].nome });
    }

    await client.query("COMMIT");
    return res.json({ zona: null });
  } catch (err) {
    await client.query("ROLLBACK");
    return res.json({ zona: null });
  } finally {
    client.release();
  }
});

// Excluir rota
app.delete("/api/rotas-simples/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.session?.userId || null;

    const deleteQuery =
      "DELETE FROM linhas_rotas WHERE id = $1 RETURNING id, identificador";
    const result = await pool.query(deleteQuery, [id]);

    if (result.rowCount > 0) {
      const { identificador } = result.rows[0];
      const mensagem = `Rota simples excluída: ${identificador}`;
      await pool.query(
        `INSERT INTO notificacoes (user_id, acao, tabela, registro_id, mensagem)
                 VALUES ($1, 'DELETE', 'linhas_rotas', $2, $3)`,
        [userId, id, mensagem]
      );
      return res.json({ success: true, message: "Rota excluída com sucesso!" });
    } else {
      return res
        .status(404)
        .json({ success: false, message: "Rota não encontrada." });
    }
  } catch (error) {
    console.error("Erro ao excluir rota:", error);
    return res
      .status(500)
      .json({ success: false, message: "Erro interno do servidor." });
  }
});

// Editar solicitação
app.put(
  "/api/cocessao-rota/:id",
  upload.fields([
    { name: "laudo_deficiencia", maxCount: 1 },
    { name: "comprovante_endereco", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const { id } = req.params;
      const {
        nome_responsavel,
        cpf_responsavel,
        celular_responsavel,
        id_matricula_aluno,
        escola_id,
        cep,
        numero,
        endereco: endStr,
        zoneamento,
        deficiencia,
        latitude,
        longitude,
        observacoes,
        criterio_direito,
      } = req.body;

      // userId para log
      const userId = req.session?.userId || null;

      let laudoDeficienciaPath = null;
      let comprovanteEnderecoPath = null;
      if (
        req.files["laudo_deficiencia"] &&
        req.files["laudo_deficiencia"].length > 0
      ) {
        laudoDeficienciaPath = `uploads/${req.files["laudo_deficiencia"][0].filename}`;
      }
      if (
        req.files["comprovante_endereco"] &&
        req.files["comprovante_endereco"].length > 0
      ) {
        comprovanteEnderecoPath = `uploads/${req.files["comprovante_endereco"][0].filename}`;
      }

      const oldRowRes = await pool.query(
        "SELECT laudo_deficiencia_path, comprovante_endereco_path FROM cocessao_rota WHERE id=$1",
        [id]
      );
      if (oldRowRes.rows.length === 0) {
        return res
          .status(404)
          .json({ success: false, message: "Solicitação não encontrada." });
      }
      const oldRow = oldRowRes.rows[0];

      if (!laudoDeficienciaPath)
        laudoDeficienciaPath = oldRow.laudo_deficiencia_path;
      if (!comprovanteEnderecoPath)
        comprovanteEnderecoPath = oldRow.comprovante_endereco_path;

      const zoneamentoBool = zoneamento === "sim";
      const deficienciaBool = deficiencia === "sim";

      const updateQuery = `
                UPDATE cocessao_rota
                SET
                  nome_responsavel = $1,
                  cpf_responsavel = $2,
                  celular_responsavel = $3,
                  id_matricula_aluno = $4,
                  escola_id = $5,
                  cep = $6,
                  numero = $7,
                  endereco = $8,
                  zoneamento = $9,
                  deficiencia = $10,
                  laudo_deficiencia_path = $11,
                  comprovante_endereco_path = $12,
                  latitude = $13,
                  longitude = $14,
                  observacoes = $15,
                  criterio_direito = $16
                WHERE id = $17
            `;
      const values = [
        nome_responsavel,
        cpf_responsavel,
        celular_responsavel,
        id_matricula_aluno,
        escola_id ? parseInt(escola_id, 10) : null,
        cep,
        numero,
        endStr || null,
        zoneamentoBool,
        deficienciaBool,
        laudoDeficienciaPath,
        comprovanteEnderecoPath,
        latitude ? parseFloat(latitude) : null,
        longitude ? parseFloat(longitude) : null,
        observacoes || null,
        criterio_direito || null,
        parseInt(id, 10),
      ];

      await pool.query(updateQuery, values);

      // NOTIFICAÇÃO
      const mensagem = `Solicitação de rota (ID: ${id}) atualizada. Responsável: ${nome_responsavel}`;
      await pool.query(
        `INSERT INTO notificacoes (user_id, acao, tabela, registro_id, mensagem)
                 VALUES ($1, 'UPDATE', 'cocessao_rota', $2, $3)`,
        [userId, id, mensagem]
      );

      return res.json({
        success: true,
        message: "Solicitação atualizada com sucesso!",
      });
    } catch (error) {
      console.error("Erro ao atualizar solicitação:", error);
      return res
        .status(500)
        .json({ success: false, message: "Erro interno do servidor." });
    }
  }
);

// Excluir solicitação
app.delete("/api/cocessao-rota/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // userId para log
    const userId = req.session?.userId || null;

    // Buscar algo p/ mensagem
    const busca = await pool.query(
      "SELECT nome_responsavel FROM cocessao_rota WHERE id=$1",
      [id]
    );
    if (busca.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Solicitação não encontrada." });
    }
    const nomeResponsavel = busca.rows[0].nome_responsavel;

    const deleteQuery = "DELETE FROM cocessao_rota WHERE id = $1";
    const result = await pool.query(deleteQuery, [id]);
    if (result.rowCount > 0) {
      // NOTIFICAÇÃO
      const mensagem = `Solicitação de rota excluída (ID: ${id}). Responsável: ${nomeResponsavel}`;
      await pool.query(
        `INSERT INTO notificacoes (user_id, acao, tabela, registro_id, mensagem)
                 VALUES ($1, 'DELETE', 'cocessao_rota', $2, $3)`,
        [userId, id, mensagem]
      );

      return res.json({
        success: true,
        message: "Solicitação excluída com sucesso!",
      });
    } else {
      return res
        .status(404)
        .json({ success: false, message: "Solicitação não encontrada." });
    }
  } catch (error) {
    console.error("Erro ao excluir solicitação:", error);
    return res
      .status(500)
      .json({ success: false, message: "Erro interno do servidor." });
  }
});

app.get("/api/memorandos", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM memorandos ORDER BY data_criacao DESC"
    );
    return res.json(result.rows);
  } catch (error) {
    console.error("Erro ao buscar memorandos:", error);
    return res.status(500).json({
      success: false,
      message: "Erro ao buscar memorandos.",
    });
  }
});

// app.post("/api/memorandos/cadastrar", ...) ...
app.post(
  "/api/memorandos/cadastrar",
  memorandoUpload.none(),
  async (req, res) => {
    const { document_type, tipo_memorando, destinatario, corpo } = req.body;

    if (!document_type || !tipo_memorando || !destinatario || !corpo) {
      return res.status(400).json({
        success: false,
        message:
          "Campos obrigatórios não fornecidos (document_type, tipo_memorando, destinatario, corpo).",
      });
    }

    const userId = req.session?.userId || null;
    const data_criacao = moment().format("YYYY-MM-DD");

    try {
      const insertQuery = `
        INSERT INTO memorandos
        (document_type, tipo_memorando, destinatario, corpo, data_criacao)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id;
      `;
      const values = [document_type, tipo_memorando, destinatario, corpo, data_criacao];
      const result = await pool.query(insertQuery, values);

      if (result.rows.length > 0) {
        const newId = result.rows[0].id;
        const mensagem = `Documento criado: ${document_type} - ${tipo_memorando}, destinatário: ${destinatario}`;
        await pool.query(
          `INSERT INTO notificacoes (user_id, acao, tabela, registro_id, mensagem)
           VALUES ($1, 'CREATE', 'memorandos', $2, $3)`,
          [userId, newId, mensagem]
        );

        return res.json({
          success: true,
          memorando: {
            id: newId,
            document_type,
            tipo_memorando,
            destinatario,
            corpo,
            data_criacao,
          },
        });
      } else {
        return res.status(500).json({
          success: false,
          message: "Erro ao cadastrar documento (retorno inesperado).",
        });
      }
    } catch (error) {
      console.error("Erro ao cadastrar documento:", error);
      return res.status(500).json({
        success: false,
        message: "Erro ao cadastrar documento.",
      });
    }
  }
);

// app.put("/api/memorandos/:id", ...) ...
app.put('/api/memorandos/:id', async (req, res) => {
  const { id } = req.params;
  const { document_type, tipo_memorando, destinatario, corpo } = req.body;

  try {
    const queryText = `
      UPDATE memorandos
      SET document_type = $1, tipo_memorando = $2, destinatario = $3, corpo = $4
      WHERE id = $5
      RETURNING *;
    `;

    const result = await pool.query(queryText, [
      document_type,
      tipo_memorando,
      destinatario,
      corpo,
      id
    ]);

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Documento não encontrado.' });
    }

    return res.json({ success: true, memorando: result.rows[0] });
  } catch (error) {
    console.error('Erro ao atualizar documento:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro interno ao atualizar documento.'
    });
  }
});

// app.get("/api/memorandos/:id/gerar-docx", ...) ...
app.get("/api/memorandos/:id/gerar-docx", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query("SELECT * FROM memorandos WHERE id = $1", [id]);
    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Documento não encontrado." });
    }
    const memorando = result.rows[0];

    const fs = require("fs");
    function loadBase64(filePath) {
      if (!fs.existsSync(filePath)) return null;
      const file = fs.readFileSync(filePath);
      return Buffer.from(file).toString("base64");
    }

    const logo1Path = path.join(
      __dirname,
      "public",
      "assets",
      "img",
      "logo_memorando1.png"
    );
    const separadorPath = path.join(
      __dirname,
      "public",
      "assets",
      "img",
      "memorando_separador.png"
    );
    const logo2Path = path.join(
      __dirname,
      "public",
      "assets",
      "img",
      "memorando_logo2.png"
    );

    const logo1Base64 = loadBase64(logo1Path);
    const separadorBase64 = loadBase64(separadorPath);
    const logo2Base64 = loadBase64(logo2Path);

    const headerChildren = [];
    if (logo1Base64) {
      headerChildren.push(
        new Paragraph({
          children: [
            new ImageRun({
              data: Buffer.from(logo1Base64, "base64"),
              transformation: { width: 60, height: 60 },
            }),
          ],
        })
      );
    }
    headerChildren.push(
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [
          new TextRun({
            text: "ESTADO DO PARÁ\nPREFEITURA MUNICIPAL DE CANAÃ DOS CARAJÁS\nSECRETARIA MUNICIPAL DE EDUCAÇÃO",
            bold: true,
            size: 22,
          }),
        ],
      })
    );
    if (separadorBase64) {
      headerChildren.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new ImageRun({
              data: Buffer.from(separadorBase64, "base64"),
              transformation: { width: 510, height: 20 },
            }),
          ],
        })
      );
    }

    const footerChildren = [];
    if (separadorBase64) {
      footerChildren.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new ImageRun({
              data: Buffer.from(separadorBase64, "base64"),
              transformation: { width: 510, height: 20 },
            }),
          ],
        })
      );
    }
    if (logo2Base64) {
      footerChildren.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new ImageRun({
              data: Buffer.from(logo2Base64, "base64"),
              transformation: { width: 160, height: 40 },
            }),
          ],
        })
      );
    }
    footerChildren.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({
            text: "SECRETARIA MUNICIPAL DE EDUCAÇÃO - SEMED\nRua Itamarati s/n - Bairro Novo Horizonte - CEP: 68.356-103 - Canaã dos Carajás - PA\nTelefone: (94) 99293-4500",
            size: 20,
          }),
        ],
      })
    );

    const { Document, Packer, Paragraph, TextRun, Header, Footer, AlignmentType, HeadingLevel, ImageRun } = require("docx");
    const docBody = [];

    const docTitle = memorando.document_type === "OFICIO" ? "OFÍCIO" : "MEMORANDO";

    docBody.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        alignment: AlignmentType.JUSTIFIED,
        children: [
          new TextRun({
            text: `${docTitle} N.º ${memorando.id}/2025 - SECRETARIA MUNICIPAL DE EDUCAÇÃO`,
            bold: true,
            size: 24,
          }),
        ],
      })
    );
    docBody.push(new Paragraph({ text: "" }));
    docBody.push(
      new Paragraph({
        alignment: AlignmentType.JUSTIFIED,
        children: [
          new TextRun({ text: `A: ${memorando.destinatario}`, size: 24 }),
        ],
      })
    );
    docBody.push(
      new Paragraph({
        alignment: AlignmentType.JUSTIFIED,
        children: [
          new TextRun({
            text: `Assunto: ${memorando.tipo_memorando}`,
            size: 24,
          }),
        ],
      })
    );
    docBody.push(new Paragraph({ text: "" }));
    docBody.push(
      new Paragraph({
        alignment: AlignmentType.JUSTIFIED,
        children: [new TextRun({ text: "Prezados(as),", size: 24 })],
      })
    );
    docBody.push(new Paragraph({ text: "" }));
    docBody.push(
      new Paragraph({
        alignment: AlignmentType.JUSTIFIED,
        children: [new TextRun({ text: memorando.corpo || "", size: 24 })],
      })
    );
    docBody.push(new Paragraph({ text: "" }));
    docBody.push(
      new Paragraph({
        alignment: AlignmentType.JUSTIFIED,
        children: [new TextRun({ text: "Atenciosamente,", size: 24 })],
      })
    );
    docBody.push(new Paragraph({ text: "" }));
    docBody.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: "DANILO DE MORAIS GUSTAVO", size: 24 })],
      })
    );
    docBody.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ text: "Gestor de Transporte Escolar", size: 24 }),
        ],
      })
    );
    docBody.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: "Portaria 118/2023 - GP", size: 24 })],
      })
    );

    const doc = new Document({
      sections: [
        {
          headers: {
            default: new Header({ children: headerChildren }),
          },
          footers: {
            default: new Footer({ children: footerChildren }),
          },
          children: docBody,
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);

    res.setHeader(
      "Content-Disposition",
      `attachment; filename=documento_${id}.docx`
    );
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    return res.send(buffer);
  } catch (error) {
    console.error("Erro ao gerar DOCX:", error);
    return res.status(500).json({
      success: false,
      message: "Erro ao gerar .docx do documento.",
    });
  }
});

// app.get("/api/memorandos/:id", ...) ...
app.get("/api/memorandos/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query("SELECT * FROM memorandos WHERE id = $1", [
      id,
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Documento não encontrado.",
      });
    }
    return res.json({
      success: true,
      memorando: result.rows[0],
    });
  } catch (error) {
    console.error("Erro ao buscar documento:", error);
    return res.status(500).json({
      success: false,
      message: "Erro interno do servidor.",
    });
  }
});

// app.delete("/api/memorandos/:id", ...) ...
app.delete("/api/memorandos/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const userId = req.session?.userId || null;
    const buscaMem = await pool.query(
      "SELECT tipo_memorando, document_type FROM memorandos WHERE id = $1",
      [id]
    );
    if (buscaMem.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Documento não encontrado.",
      });
    }
    const tipo = buscaMem.rows[0].tipo_memorando;
    const docType = buscaMem.rows[0].document_type;

    const result = await pool.query(
      "DELETE FROM memorandos WHERE id = $1 RETURNING *",
      [id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Documento não encontrado.",
      });
    }

    const mensagem = `Documento excluído: ${docType} - ${tipo}`;
    await pool.query(
      `INSERT INTO notificacoes (user_id, acao, tabela, registro_id, mensagem)
       VALUES ($1, 'DELETE', 'memorandos', $2, $3)`,
      [userId, id, mensagem]
    );

    return res.json({
      success: true,
      message: "Documento excluído com sucesso.",
    });
  } catch (error) {
    console.error("Erro ao excluir documento:", error);
    return res.status(500).json({
      success: false,
      message: "Erro ao excluir documento.",
    });
  }
});

// app.get("/api/memorandos/:id/gerar-pdf", ...) ...
app.get("/api/memorandos/:id/gerar-pdf", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query("SELECT * FROM memorandos WHERE id = $1", [
      id,
    ]);
    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Documento não encontrado." });
    }
    const memorando = result.rows[0];

    const docTitle = memorando.document_type === "OFICIO" ? "OFÍCIO" : "MEMORANDO";
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    res.setHeader(
      "Content-Disposition",
      `inline; filename=documento_${id}.pdf`
    );
    res.setHeader("Content-Type", "application/pdf");
    doc.pipe(res);

    const logoPath = path.join(
      __dirname,
      "public",
      "assets",
      "img",
      "logo_memorando1.png"
    );
    if (fs.existsSync(logoPath)) {
      doc.image(logoPath, 50, 20, { width: 60 });
    }

    doc
      .fontSize(11)
      .font("Helvetica-Bold")
      .text(
        "ESTADO DO PARÁ\n" +
        "PREFEITURA MUNICIPAL DE CANAÃ DOS CARAJÁS\n" +
        "SECRETARIA MUNICIPAL DE EDUCAÇÃO",
        250,
        20,
        { width: 300, align: "right" }
      );

    const separadorPath = path.join(
      __dirname,
      "public",
      "assets",
      "img",
      "memorando_separador.png"
    );
    if (fs.existsSync(separadorPath)) {
      const separadorX = (doc.page.width - 510) / 2;
      const separadorY = 90;
      doc.image(separadorPath, separadorX, separadorY, { width: 510 });
    }

    doc.y = 130;
    doc.x = 50;

    doc
      .fontSize(12)
      .font("Helvetica-Bold")
      .text(
        `${docTitle} N.º ${memorando.id}/2025 - SECRETARIA MUNICIPAL DE EDUCAÇÃO`,
        {
          align: "justify",
        }
      )
      .moveDown();

    const corpoAjustado = memorando.corpo
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "");
    doc
      .fontSize(12)
      .font("Helvetica")
      .text(`A: ${memorando.destinatario}`, { align: "justify" })
      .text(`Assunto: ${memorando.tipo_memorando}`, { align: "justify" })
      .moveDown()
      .text("Prezados(as),", { align: "justify" })
      .moveDown()
      .text(corpoAjustado, { align: "justify" })
      .moveDown();

    const spaceNeededForSignature = 100;
    if (doc.y + spaceNeededForSignature > doc.page.height - 160) {
      doc.addPage();
    }

    const signatureY = doc.page.height - 270;
    doc.y = signatureY;
    doc.x = 50;

    doc
      .fontSize(12)
      .font("Helvetica")
      .text("Atenciosamente,", { align: "justify" })
      .moveDown(2);

    const signaturePath = path.join(__dirname, "public", "assets", "img", "signature.png");
    if (fs.existsSync(signaturePath)) {
      doc.image(signaturePath, 220, signatureY - 0, { width: 150 });
      doc.moveDown(0);
    }

    doc
      .text("DANILO DE MORAIS GUSTAVO", { align: "center" })
      .text("Gestor de Transporte Escolar", { align: "center" })
      .text("Portaria 118/2023 - GP", { align: "center" });


    if (fs.existsSync(separadorPath)) {
      const footerSepX = (doc.page.width - 510) / 2;
      const footerSepY = doc.page.height - 160;
      doc.image(separadorPath, footerSepX, footerSepY, { width: 510 });
    }
    const logo2Path = path.join(
      __dirname,
      "public",
      "assets",
      "img",
      "memorando_logo2.png"
    );
    if (fs.existsSync(logo2Path)) {
      const logo2X = (doc.page.width - 160) / 2;
      const logo2Y = doc.page.height - 150;
      doc.image(logo2Path, logo2X, logo2Y, { width: 160 });
    }

    doc
      .fontSize(10)
      .font("Helvetica")
      .text(
        "SECRETARIA MUNICIPAL DE EDUCAÇÃO - SEMED",
        50,
        doc.page.height - 85,
        {
          width: doc.page.width - 100,
          align: "center",
        }
      )
      .text(
        "Rua Itamarati s/n - Bairro Novo Horizonte - CEP: 68.356-103 - Canaã dos Carajás - PA",
        {
          align: "center",
        }
      )
      .text("Telefone: (94) 99293-4500", { align: "center" });

    doc.end();
  } catch (error) {
    console.error("Erro ao gerar PDF:", error);
    return res.status(500).json({
      success: false,
      message: "Erro ao gerar PDF.",
    });
  }
});

app.post('/api/reavaliacoes', async (req, res) => {
  try {
    const {
      aluno_id,
      tipo_fluxo,
      nome_aluno,
      cpf_aluno,
      responsavel_aluno,
      latitude,
      longitude,
      calcadas_ausentes,
      pavimentacao_ausente,
      iluminacao_precaria,
      area_de_risco,
      animais_perigosos
    } = req.body;

    const query = `
      INSERT INTO reavaliacoes (
        aluno_id,
        tipo_fluxo,
        nome_aluno,
        cpf_aluno,
        responsavel_aluno,
        latitude,
        longitude,
        calcadas_ausentes,
        pavimentacao_ausente,
        iluminacao_precaria,
        area_de_risco,
        animais_perigosos
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING id
    `;
    const values = [
      aluno_id,
      tipo_fluxo,
      nome_aluno || null,
      cpf_aluno || null,
      responsavel_aluno || null,
      latitude,
      longitude,
      calcadas_ausentes || false,
      pavimentacao_ausente || false,
      iluminacao_precaria || false,
      area_de_risco || false,
      animais_perigosos || false
    ];

    const result = await pool.query(query, values);
    return res.status(201).json({ success: true, reavaliacao_id: result.rows[0].id });
  } catch (error) {
    console.error('Erro ao salvar reavaliação:', error);
    return res.status(500).json({ message: 'Erro interno ao salvar reavaliação.' });
  }
});

app.post("/api/reavaliacoes/:id/aprovar", async (req, res) => {
  try {
    const { id } = req.params;
    const { cpf_aluno } = req.body;

    // Atualiza status da reavaliação
    await pool.query(
      "UPDATE reavaliacoes SET status_reavaliacao = 'APROVADO' WHERE id = $1",
      [id]
    );

    // Atualiza transporte_escolar_poder_publico = 'MUNICIPAL'
    const updateAluno = await pool.query(
      "UPDATE alunos_ativos SET transporte_escolar_poder_publico = 'MUNICIPAL' WHERE cpf = $1 RETURNING id",
      [cpf_aluno]
    );

    if (updateAluno.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Nenhum aluno encontrado para atualizar."
      });
    }

    const alunoId = updateAluno.rows[0].id;

    return res.json({
      success: true,
      message: "Reavaliação aprovada. Campo transporte_escolar_poder_publico = MUNICIPAL.",
      alunoId: alunoId
    });
  } catch (err) {
    console.error("Erro ao aprovar reavaliação:", err);
    return res
      .status(500)
      .json({ success: false, message: "Erro ao aprovar reavaliação." });
  }
});

// Reprovar - muda status_reavaliacao para 'REPROVADO'
app.post("/api/reavaliacoes/:id/reprovar", async (req, res) => {
  try {
    const { id } = req.params;

    // Obter o reav para pegar o cpf e retornar o ID do aluno
    const reavResult = await pool.query(
      "SELECT cpf_aluno FROM reavaliacoes WHERE id = $1",
      [id]
    );
    if (reavResult.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Reavaliação não encontrada." });
    }
    const cpfAluno = reavResult.rows[0].cpf_aluno;

    // Localiza o aluno_ativo
    const alunoResult = await pool.query(
      "SELECT id FROM alunos_ativos WHERE cpf = $1",
      [cpfAluno]
    );
    let alunoId = null;
    if (alunoResult.rows.length > 0) {
      alunoId = alunoResult.rows[0].id;
    }

    await pool.query(
      "UPDATE reavaliacoes SET status_reavaliacao = 'REPROVADO' WHERE id = $1",
      [id]
    );

    return res.json({
      success: true,
      message: "Reavaliação reprovada.",
      alunoId: alunoId
    });
  } catch (err) {
    console.error("Erro ao reprovar reavaliação:", err);
    return res
      .status(500)
      .json({ success: false, message: "Erro ao reprovar reavaliação." });
  }
});


app.get("/api/reavaliacoes", async (req, res) => {
  try {
    const query = `
      SELECT
        id,
        aluno_id,
        tipo_fluxo,
        data_solicitacao,
        nome_aluno,
        cpf_aluno,
        responsavel_aluno,
        latitude,
        longitude,
        calcadas_ausentes,
        pavimentacao_ausente,
        iluminacao_precaria,
        area_de_risco,
        animais_perigosos,
        status_reavaliacao
      FROM reavaliacoes
      ORDER BY id DESC
    `;
    const result = await pool.query(query);

    return res.json(result.rows);
  } catch (err) {
    console.error("Erro ao buscar reavaliações:", err);
    return res.status(500).json({
      success: false,
      message: "Erro ao buscar reavaliações."
    });
  }
});

app.get("/api/comprovante-reavaliacao/:alunoId/gerar-pdf", async (req, res) => {
  const { alunoId } = req.params;
  // Recebe quem assina pelo query param (opcional)
  const signer = req.query.signer || "filiacao1";

  try {
    // Consulta do aluno (ajuste conforme sua tabela)
    const queryAluno = `
      SELECT
        a.id,
        a.pessoa_nome       AS aluno_nome,
        a.cpf,
        e.nome             AS escola_nome,
        a.turma,
        a.filiacao_1,
        a.filiacao_2,
        a.responsavel
      FROM alunos_ativos a
      LEFT JOIN escolas e ON e.id = a.escola_id
      WHERE a.id = $1
    `;
    const resultAluno = await pool.query(queryAluno, [alunoId]);
    if (resultAluno.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Aluno não encontrado." });
    }
    const aluno = resultAluno.rows[0];

    const queryReavaliacao = `
      SELECT
        id AS reavaliacao_id,
        data_solicitacao,
        calcadas_ausentes,
        pavimentacao_ausente,
        iluminacao_precaria,
        area_de_risco,
        animais_perigosos
      FROM reavaliacoes
      WHERE aluno_id = $1
      ORDER BY id DESC
      LIMIT 1
    `;
    const resultReav = await pool.query(queryReavaliacao, [alunoId]);
    if (resultReav.rows.length === 0) {
      // Se não encontrar reavaliação, retornar ou gerar PDF de aviso.
      return res.status(404).json({ success: false, message: "Nenhuma reavaliação encontrada para este aluno." });
    }
    const reav = resultReav.rows[0];

    let signerName = "______________________";
    if (signer === "filiacao2") {
      signerName = aluno.filiacao_2 || "______________________";
    } else if (signer === "responsavel") {
      signerName = aluno.responsavel || "______________________";
    } else {
      signerName = aluno.filiacao_1 || "______________________";
    }

    // Monta a lista de atenuantes que foram marcadas
    const atenuantes = [];
    if (reav.calcadas_ausentes) {
      atenuantes.push("• Ausência de calçadas");
    }
    if (reav.pavimentacao_ausente) {
      atenuantes.push("• Rua não pavimentada");
    }
    if (reav.iluminacao_precaria) {
      atenuantes.push("• Falta de iluminação pública");
    }
    if (reav.area_de_risco) {
      atenuantes.push("• Área de risco com crimes ou assaltos");
    }
    if (reav.animais_perigosos) {
      atenuantes.push("• Presença de animais perigosos (rural)");
    }
    let atenuantesTexto = atenuantes.length > 0 ? atenuantes.join("\n") : "Nenhuma situação atenuante marcada.";

    // Gera PDF usando PDFDocument
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    res.setHeader("Content-Disposition", `inline; filename=reavaliacao_${alunoId}.pdf`);
    res.setHeader("Content-Type", "application/pdf");
    doc.pipe(res);

    const logoPath = path.join(__dirname, "public", "assets", "img", "logo_memorando1.png");
    const separadorPath = path.join(__dirname, "public", "assets", "img", "memorando_separador.png");
    const logo2Path = path.join(__dirname, "public", "assets", "img", "memorando_logo2.png");

    // Cabeçalho com logo e textos
    if (fs.existsSync(logoPath)) {
      doc.image(logoPath, 50, 20, { width: 60 });
    }
    doc
      .fontSize(11)
      .font("Helvetica-Bold")
      .text(
        "ESTADO DO PARÁ\n" +
        "PREFEITURA MUNICIPAL DE CANAÃ DOS CARAJÁS\n" +
        "SECRETARIA MUNICIPAL DE EDUCAÇÃO",
        250,
        20,
        { width: 300, align: "right" }
      );

    // Separador logo abaixo
    if (fs.existsSync(separadorPath)) {
      const separadorX = (doc.page.width - 510) / 2;
      const separadorY = 90;
      doc.image(separadorPath, separadorX, separadorY, { width: 510 });
    }

    doc.y = 130;
    doc.x = 50;
    doc
      .fontSize(12)
      .font("Helvetica-Bold")
      .text("COMPROVANTE DE REAVALIAÇÃO Nº 2025", { align: "justify" })
      .moveDown();

    doc
      .fontSize(12)
      .font("Helvetica")
      .text(`Aluno(a): ${aluno.aluno_nome || ""}`, { align: "justify" })
      .text(`CPF: ${aluno.cpf || ""}`, { align: "justify" })
      .text(`Escola: ${aluno.escola_nome || ""}`, { align: "justify" })
      .text(`Turma: ${aluno.turma || ""}`, { align: "justify" })
      .moveDown()
      .text(
        "Foi solicitada reavaliação para o(a) aluno(a) acima mencionado, considerando possíveis situações atenuantes que possam justificar a concessão do transporte escolar, mesmo sem cumprimento integral dos critérios regulares.",
        { align: "justify" }
      )
      .moveDown()
      .text("Situações atenuantes indicadas:", { align: "justify", underline: true })
      .text(atenuantesTexto, { align: "justify" })
      .moveDown()
      .text(
        `Data da Solicitação de Reavaliação: ${new Date(reav.data_solicitacao).toLocaleString("pt-BR")}`,
        { align: "justify" }
      )
      .moveDown()
      .text(
        `Eu, ${signerName}, declaro ter ciência do processo de reavaliação e confirmo as informações apresentadas.`,
        { align: "justify" }
      )
      .moveDown();

    const spaceNeededForSignature = 100;
    if (doc.y + spaceNeededForSignature > doc.page.height - 160) {
      doc.addPage();
    }

    const signatureY = doc.page.height - 270;
    doc.y = signatureY;
    doc.x = 50;

    doc
      .fontSize(12)
      .font("Helvetica")
      .text("Atenciosamente,", { align: "justify" })
      .moveDown(2);

    const signaturePath = path.join(__dirname, "public", "assets", "img", "signature.png");
    if (fs.existsSync(signaturePath)) {
      doc.image(signaturePath, 220, signatureY - 0, { width: 150 });
      doc.moveDown(0);
    }

    doc
      .text("DANILO DE MORAIS GUSTAVO", { align: "center" })
      .text("Gestor de Transporte Escolar", { align: "center" })
      .text("Portaria 118/2023 - GP", { align: "center" });


    // Rodapé com separador e segunda logo se existir
    if (fs.existsSync(separadorPath)) {
      const footerSepX = (doc.page.width - 510) / 2;
      const footerSepY = doc.page.height - 160;
      doc.image(separadorPath, footerSepX, footerSepY, { width: 510 });
    }
    if (fs.existsSync(logo2Path)) {
      const logo2X = (doc.page.width - 160) / 2;
      const logo2Y = doc.page.height - 150;
      doc.image(logo2Path, logo2X, logo2Y, { width: 160 });
    }
    doc
      .fontSize(10)
      .font("Helvetica")
      .text("SECRETARIA MUNICIPAL DE EDUCAÇÃO - SEMED", 50, doc.page.height - 85, {
        width: doc.page.width - 100,
        align: "center",
      })
      .text("Rua Itamarati s/n - Bairro Novo Horizonte - CEP: 68.356-103 - Canaã dos Carajás - PA", {
        align: "center",
      })
      .text("Telefone: (94) 99293-4500", { align: "center" });

    doc.end();
  } catch (error) {
    console.error("Erro ao gerar PDF (Reavaliação):", error);
    return res.status(500).json({
      success: false,
      message: "Erro ao gerar comprovante de reavaliação.",
    });
  }
});
app.get("/api/comprovante-nao-aprovado/:alunoId/gerar-pdf", async (req, res) => {
  const { alunoId } = req.params;
  // Recebe quem assina pelo query param (opcional)
  const signer = req.query.signer || "filiacao1";
  try {
    // Consulta do aluno
    const query = `
      SELECT
        a.id,
        a.pessoa_nome AS aluno_nome,
        a.cpf,
        e.nome AS escola_nome,
        a.turma,
        a.filiacao_1,
        a.filiacao_2,
        a.responsavel
      FROM alunos_ativos a
      LEFT JOIN escolas e ON e.id = a.escola_id
      WHERE a.id = $1
    `;
    const result = await pool.query(query, [alunoId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Aluno não encontrado." });
    }
    const aluno = result.rows[0];

    let signerName = "______________________";
    if (signer === "filiacao2") {
      signerName = aluno.filiacao_2 || "______________________";
    } else if (signer === "responsavel") {
      signerName = aluno.responsavel || "______________________";
    } else {
      signerName = aluno.filiacao_1 || "______________________";
    }

    // Gera PDF
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    res.setHeader("Content-Disposition", `inline; filename=nao_aprovado_${alunoId}.pdf`);
    res.setHeader("Content-Type", "application/pdf");
    doc.pipe(res);

    const logoPath = path.join(__dirname, "public", "assets", "img", "logo_memorando1.png");
    const separadorPath = path.join(__dirname, "public", "assets", "img", "memorando_separador.png");
    const logo2Path = path.join(__dirname, "public", "assets", "img", "memorando_logo2.png");

    if (fs.existsSync(logoPath)) {
      doc.image(logoPath, 50, 20, { width: 60 });
    }
    doc
      .fontSize(11)
      .font("Helvetica-Bold")
      .text(
        "ESTADO DO PARÁ\n" +
        "PREFEITURA MUNICIPAL DE CANAÃ DOS CARAJÁS\n" +
        "SECRETARIA MUNICIPAL DE EDUCAÇÃO",
        250,
        20,
        { width: 300, align: "right" }
      );

    if (fs.existsSync(separadorPath)) {
      const separadorX = (doc.page.width - 510) / 2;
      const separadorY = 90;
      doc.image(separadorPath, separadorX, separadorY, { width: 510 });
    }

    doc.y = 130;
    doc.x = 50;
    doc
      .fontSize(12)
      .font("Helvetica-Bold")
      .text("COMPROVANTE DE ATENDIMENTO", {
        align: "justify",
      })
      .moveDown();

    doc
      .fontSize(12)
      .font("Helvetica")
      .text(`Aluno(a): ${aluno.aluno_nome || ""}`, { align: "justify" })
      .text(`CPF: ${aluno.cpf || ""}`, { align: "justify" })
      .text(`Escola: ${aluno.escola_nome || ""}`, { align: "justify" })
      .text(`Turma: ${aluno.turma || ""}`, { align: "justify" })
      .moveDown()
      .text("Informamos que o(a) aluno(a) acima mencionado não atende aos critérios estabelecidos para uso do Transporte Escolar. Portanto, não foi possível aprovar seu cadastro.", { align: "justify" })
      .moveDown()
      .text("Motivo da Não Aprovação:", { align: "justify", underline: true })
      .moveDown()
      .text("• Distância insuficiente ou outros critérios não cumpridos;", { align: "justify" })
      .moveDown()
      .text("Em caso de dúvidas, favor dirigir-se à SEMED.", { align: "justify" })
      .moveDown()
      .text(
        `Eu, ${signerName}, declaro ciência do resultado e estou ciente de que, caso haja nova documentação ou mudança de endereço, devo procurar a Secretaria de Educação para nova avaliação.`,
        { align: "justify" }
      )
      .moveDown();

    const spaceNeededForSignature = 100;
    if (doc.y + spaceNeededForSignature > doc.page.height - 160) {
      doc.addPage();
    }
    const signatureY = doc.page.height - 270;
    doc.y = signatureY;
    doc.x = 50;

    doc
      .fontSize(12)
      .font("Helvetica")
      .text("Atenciosamente,", { align: "justify" })
      .moveDown(2);

    const signaturePath = path.join(__dirname, "public", "assets", "img", "signature.png");
    if (fs.existsSync(signaturePath)) {
      doc.image(signaturePath, 220, signatureY - 0, { width: 150 });
      doc.moveDown(0);
    }

    doc
      .text("DANILO DE MORAIS GUSTAVO", { align: "center" })
      .text("Gestor de Transporte Escolar", { align: "center" })
      .text("Portaria 118/2023 - GP", { align: "center" });


    if (fs.existsSync(separadorPath)) {
      const footerSepX = (doc.page.width - 510) / 2;
      const footerSepY = doc.page.height - 160;
      doc.image(separadorPath, footerSepX, footerSepY, { width: 510 });
    }
    if (fs.existsSync(logo2Path)) {
      const logo2X = (doc.page.width - 160) / 2;
      const logo2Y = doc.page.height - 150;
      doc.image(logo2Path, logo2X, logo2Y, { width: 160 });
    }
    doc
      .fontSize(10)
      .font("Helvetica")
      .text("SECRETARIA MUNICIPAL DE EDUCAÇÃO - SEMED", 50, doc.page.height - 85, {
        width: doc.page.width - 100,
        align: "center",
      })
      .text("Rua Itamarati s/n - Bairro Novo Horizonte - CEP: 68.356-103 - Canaã dos Carajás - PA", {
        align: "center",
      })
      .text("Telefone: (94) 99293-4500", { align: "center" });

    doc.end();
  } catch (error) {
    console.error("Erro ao gerar PDF (Não Aprovado Municipal):", error);
    return res.status(500).json({
      success: false,
      message: "Erro ao gerar comprovante de não aprovação.",
    });
  }
});

app.get("/api/comprovante-avaliacao-manual/:alunoId/gerar-pdf", async (req, res) => {
  const { alunoId } = req.params;
  const signer = req.query.signer || "filiacao1";
  try {
    const query = `
      SELECT
        a.id,
        a.pessoa_nome AS aluno_nome,
        a.cpf,
        e.nome AS escola_nome,
        a.turma,
        a.filiacao_1,
        a.filiacao_2,
        a.responsavel
      FROM alunos_ativos a
      LEFT JOIN escolas e ON e.id = a.escola_id
      WHERE a.id = $1
    `;
    const result = await pool.query(query, [alunoId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Aluno não encontrado." });
    }
    const aluno = result.rows[0];

    let signerName = "______________________";
    if (signer === "filiacao2") {
      signerName = aluno.filiacao_2 || "______________________";
    } else if (signer === "responsavel") {
      signerName = aluno.responsavel || "______________________";
    } else {
      signerName = aluno.filiacao_1 || "______________________";
    }

    const solQuery = `
      SELECT id AS solicitacao_id
      FROM solicitacoes_transporte_especial
      WHERE aluno_id = $1
      ORDER BY id DESC
      LIMIT 1
    `;
    const solResult = await pool.query(solQuery, [alunoId]);
    let numeroProtocolo = "000";
    if (solResult.rows.length > 0) {
      numeroProtocolo = solResult.rows[0].solicitacao_id;
    }

    const doc = new PDFDocument({ size: "A4", margin: 50 });
    res.setHeader("Content-Disposition", `inline; filename=avaliacao_manual_${alunoId}.pdf`);
    res.setHeader("Content-Type", "application/pdf");
    doc.pipe(res);

    const logoPath = path.join(__dirname, "public", "assets", "img", "logo_memorando1.png");
    const separadorPath = path.join(__dirname, "public", "assets", "img", "memorando_separador.png");
    const logo2Path = path.join(__dirname, "public", "assets", "img", "memorando_logo2.png");

    if (fs.existsSync(logoPath)) {
      doc.image(logoPath, 50, 20, { width: 60 });
    }

    doc
      .fontSize(11)
      .font("Helvetica-Bold")
      .text(
        "ESTADO DO PARÁ\n" +
        "PREFEITURA MUNICIPAL DE CANAÃ DOS CARAJÁS\n" +
        "SECRETARIA MUNICIPAL DE EDUCAÇÃO",
        250,
        20,
        { width: 300, align: "right" }
      );

    if (fs.existsSync(separadorPath)) {
      const separadorX = (doc.page.width - 510) / 2;
      const separadorY = 90;
      doc.image(separadorPath, separadorX, separadorY, { width: 510 });
    }

    doc.y = 130;
    doc.x = 50;
    doc
      .fontSize(11)
      .font("Helvetica-Bold")
      .text(`COMPROVANTE DE AVALIAÇÃO MANUAL Nº ${numeroProtocolo}`, {
        align: "justify",
      })
      .moveDown();

    doc
      .fontSize(11)
      .font("Helvetica")
      .text(`Aluno(a): ${aluno.aluno_nome || ""}`, { align: "justify" })
      .text(`CPF: ${aluno.cpf || ""}`, { align: "justify" })
      .text(`Escola: ${aluno.escola_nome || ""}`, { align: "justify" })
      .text(`Turma: ${aluno.turma || ""}`, { align: "justify" })
      .moveDown()
      .text(
        "O(a) aluno(a) acima mencionado(a) encontra-se em processo de avaliação manual, por possuir laudo ou indicação de deficiência. O processo de verificação será realizado de forma presencial ou via documentação complementar.",
        { align: "justify" }
      )
      .moveDown();

    doc
      .fontSize(11)
      .font("Helvetica-Bold")
      .text("INFORMAÇÕES IMPORTANTES", { align: "left" })
      .moveDown(0.3)
      .font("Helvetica")
      .text("• A SEMED reserva-se ao direito de solicitar exames ou laudos complementares.")
      .text("• O transporte poderá ser adaptado caso a avaliação comprove a necessidade.")
      .text("• A avaliação manual deve ser finalizada para efetivação do direito ao transporte.")
      .moveDown(1)
      .text(
        `Eu, ${signerName}, declaro estar ciente de que esta avaliação manual é indispensável e assumo a responsabilidade de fornecer informações e documentos verídicos.`,
        { align: "justify" }
      )
      .moveDown(5);

    const spaceNeededForSignature = 80;
    if (doc.y + spaceNeededForSignature > doc.page.height - 160) {
      doc.addPage();
    }

    doc.text("_____________________________________________", { align: "center" });
    doc.font("Helvetica-Bold").text("Assinatura do Responsável", { align: "center" });
    doc.moveDown(1);

    if (fs.existsSync(separadorPath)) {
      const footerSepX = (doc.page.width - 510) / 2;
      const footerSepY = doc.page.height - 160;
      doc.image(separadorPath, footerSepX, footerSepY, { width: 510 });
    }

    if (fs.existsSync(logo2Path)) {
      const logo2X = (doc.page.width - 160) / 2;
      const logo2Y = doc.page.height - 150;
      doc.image(logo2Path, logo2X, logo2Y, { width: 160 });
    }

    doc
      .fontSize(8)
      .font("Helvetica")
      .text("SECRETARIA MUNICIPAL DE EDUCAÇÃO (SEMED) - CANAÃ DOS CARAJÁS - PA", 50, doc.page.height - 90, {
        width: doc.page.width - 100,
        align: "center",
      })
      .text("Rua Itamarati, s/n - Bairro Novo Horizonte - CEP: 68.356-103", { align: "center" })
      .text("Fone: (94) 99293-4500", { align: "center" });

    doc.end();
  } catch (error) {
    console.error("Erro ao gerar PDF da avaliação manual:", error);
    return res.status(500).json({
      success: false,
      message: "Erro ao gerar comprovante de avaliação manual.",
    });
  }
});


app.get("/api/comprovante-aprovado/:alunoId/gerar-pdf", async (req, res) => {
  const { alunoId } = req.params;
  const signer = req.query.signer || "filiacao1";
  try {
    const query = `
      SELECT
        a.id,
        a.pessoa_nome AS aluno_nome,
        a.cpf,
        e.nome AS escola_nome,
        a.turma,
        a.filiacao_1,
        a.filiacao_2,
        a.responsavel
      FROM alunos_ativos a
      LEFT JOIN escolas e ON e.id = a.escola_id
      WHERE a.id = $1
    `;
    const result = await pool.query(query, [alunoId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Aluno não encontrado." });
    }
    const aluno = result.rows[0];

    let signerName = "______________________";
    if (signer === "filiacao2") {
      signerName = aluno.filiacao_2 || "______________________";
    } else if (signer === "responsavel") {
      signerName = aluno.responsavel || "______________________";
    } else {
      signerName = aluno.filiacao_1 || "______________________";
    }

    const solQuery = `
      SELECT id AS solicitacao_id
      FROM solicitacoes_transporte
      WHERE aluno_id = $1
      ORDER BY id DESC
      LIMIT 1
    `;
    const solResult = await pool.query(solQuery, [alunoId]);
    let numeroProtocolo = "000";
    if (solResult.rows.length > 0) {
      numeroProtocolo = solResult.rows[0].solicitacao_id;
    }

    const doc = new PDFDocument({ size: "A4", margin: 50 });
    res.setHeader("Content-Disposition", `inline; filename=aprovado_${alunoId}.pdf`);
    res.setHeader("Content-Type", "application/pdf");
    doc.pipe(res);

    const logoPath = path.join(__dirname, "public", "assets", "img", "logo_memorando1.png");
    const separadorPath = path.join(__dirname, "public", "assets", "img", "memorando_separador.png");
    const logo2Path = path.join(__dirname, "public", "assets", "img", "memorando_logo2.png");

    if (fs.existsSync(logoPath)) {
      doc.image(logoPath, 50, 20, { width: 60 });
    }

    doc
      .fontSize(11)
      .font("Helvetica-Bold")
      .text(
        "ESTADO DO PARÁ\n" +
        "PREFEITURA MUNICIPAL DE CANAÃ DOS CARAJÁS\n" +
        "SECRETARIA MUNICIPAL DE EDUCAÇÃO",
        250,
        20,
        { width: 300, align: "right" }
      );

    if (fs.existsSync(separadorPath)) {
      const separadorX = (doc.page.width - 510) / 2;
      const separadorY = 90;
      doc.image(separadorPath, separadorX, separadorY, { width: 510 });
    }

    doc.y = 130;
    doc.x = 50;
    doc
      .fontSize(11)
      .font("Helvetica-Bold")
      .text(`COMPROVANTE DE ATENDIMENTO Nº ${numeroProtocolo}`, {
        align: "justify",
      })
      .moveDown();

    doc
      .fontSize(11)
      .font("Helvetica")
      .text(`Aluno(a): ${aluno.aluno_nome || ""}`, { align: "justify" })
      .text(`CPF: ${aluno.cpf || ""}`, { align: "justify" })
      .text(`Escola: ${aluno.escola_nome || ""}`, { align: "justify" })
      .text(`Turma: ${aluno.turma || ""}`, { align: "justify" })
      .moveDown()
      .text(
        "O(a) aluno(a) acima mencionado(a) foi aprovado para uso do Transporte Escolar, conforme verificação realizada.",
        { align: "justify" }
      )
      .moveDown();

    doc
      .fontSize(11)
      .font("Helvetica-Bold")
      .text("DIREITOS", { align: "left" })
      .moveDown(0.3)
      .font("Helvetica")
      .text("• Transporte em condições de segurança e higiene.")
      .text("• Veículo em bom estado de conservação, com assentos adequados.")
      .text("• Respeito de motoristas, monitores e colegas.")
      .moveDown(0.8)
      .fontSize(11)
      .font("Helvetica-Bold")
      .text("DEVERES", { align: "left" })
      .moveDown(0.3)
      .font("Helvetica")
      .text("• Usar o cinto de segurança, permanecer sentado.")
      .text("• Não consumir alimentos no ônibus, manter limpeza e conservação.")
      .text("• Respeitar condutores e colegas, acatar instruções.")
      .text("• Evitar eletrônicos que prejudiquem a segurança ou perturbem os demais.")
      .text("• Abster-se de substâncias ilícitas e condutas inseguras.")
      .text("• Descumprimentos graves podem levar à suspensão do direito ao transporte.")
      .moveDown(1)
      .text(
        `Eu, ${signerName}, declaro estar ciente dessas normas e assumo a responsabilidade de manter meus dados atualizados junto à SEMED.`,
        { align: "justify" }
      )
      .moveDown(5);

    const spaceNeededForSignature = 80;
    if (doc.y + spaceNeededForSignature > doc.page.height - 160) {
      doc.addPage();
    }

    doc.text("_____________________________________________", { align: "center" });
    doc.font("Helvetica-Bold").text("Assinatura do Responsável", { align: "center" });
    doc.moveDown(1);

    if (fs.existsSync(separadorPath)) {
      const footerSepX = (doc.page.width - 510) / 2;
      const footerSepY = doc.page.height - 160;
      doc.image(separadorPath, footerSepX, footerSepY, { width: 510 });
    }

    if (fs.existsSync(logo2Path)) {
      const logo2X = (doc.page.width - 160) / 2;
      const logo2Y = doc.page.height - 150;
      doc.image(logo2Path, logo2X, logo2Y, { width: 160 });
    }

    doc
      .fontSize(8)
      .font("Helvetica")
      .text("SECRETARIA MUNICIPAL DE EDUCAÇÃO (SEMED) - CANAÃ DOS CARAJÁS - PA", 50, doc.page.height - 90, {
        width: doc.page.width - 100,
        align: "center",
      })
      .text("Rua Itamarati, s/n - Bairro Novo Horizonte - CEP: 68.356-103", { align: "center" })
      .text("Fone: (94) 99293-4500", { align: "center" });

    doc.end();
  } catch (error) {
    console.error("Erro ao gerar PDF:", error);
    return res.status(500).json({
      success: false,
      message: "Erro ao gerar comprovante de aprovação.",
    });
  }
});

app.get("/api/comprovante-aprovado-estadual/:alunoId/gerar-pdf", async (req, res) => {
  const { alunoId } = req.params;
  const signer = req.query.signer || "filiacao1";
  try {
    const query = `
      SELECT
        a.id,
        a.pessoa_nome AS aluno_nome,
        a.cpf,
        e.nome AS escola_nome,
        a.turma,
        a.turno,
        a.filiacao_1,
        a.filiacao_2,
        a.responsavel
      FROM alunos_ativos_estadual a
      LEFT JOIN escolas e ON e.id = a.escola_id
      WHERE a.id = $1
    `;
    const result = await pool.query(query, [alunoId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Aluno estadual não encontrado." });
    }
    const aluno = result.rows[0];

    let signerName = "______________________";
    if (signer === "filiacao2") {
      signerName = aluno.filiacao_2 || "______________________";
    } else if (signer === "responsavel") {
      signerName = aluno.responsavel || "______________________";
    } else {
      signerName = aluno.filiacao_1 || "______________________";
    }

    const solQuery = `
      SELECT id
      FROM solicitacoes_transporte
      WHERE aluno_id = $1
      ORDER BY id DESC
      LIMIT 1
    `;
    const solResult = await pool.query(solQuery, [alunoId]);
    let numeroProtocolo = "000";
    if (solResult.rows.length > 0) {
      numeroProtocolo = solResult.rows[0].id;
    }

    const doc = new PDFDocument({ size: "A4", margin: 50 });
    res.setHeader(
      "Content-Disposition",
      `inline; filename=aprovado_estadual_${alunoId}.pdf`
    );
    res.setHeader("Content-Type", "application/pdf");
    doc.pipe(res);

    const logoPath = path.join(__dirname, "public", "assets", "img", "logo_memorando1.png");
    const separadorPath = path.join(__dirname, "public", "assets", "img", "memorando_separador.png");
    const logo2Path = path.join(__dirname, "public", "assets", "img", "memorando_logo2.png");

    if (fs.existsSync(logoPath)) {
      doc.image(logoPath, 50, 20, { width: 60 });
    }

    doc
      .fontSize(11)
      .font("Helvetica-Bold")
      .text(
        "ESTADO DO PARÁ\n" +
        "SECRETARIA DE ESTADO DE EDUCAÇÃO (SEDUC)\n" +
        "COORDENAÇÃO DE TRANSPORTE ESCOLAR",
        250,
        20,
        { width: 300, align: "right" }
      );

    if (fs.existsSync(separadorPath)) {
      const separadorX = (doc.page.width - 510) / 2;
      const separadorY = 90;
      doc.image(separadorPath, separadorX, separadorY, { width: 510 });
    }

    doc.y = 130;
    doc.x = 50;
    doc
      .fontSize(11)
      .font("Helvetica-Bold")
      .text(`DECLARAÇÃO DE USO DO TRANSPORTE ESCOLAR Nº ${numeroProtocolo}`, {
        align: "justify",
      })
      .moveDown();

    doc
      .fontSize(11)
      .font("Helvetica")
      .text(`Aluno(a): ${aluno.aluno_nome || ""}`, { align: "justify" })
      .text(`CPF: ${aluno.cpf || ""}`, { align: "justify" })
      .text(`Escola (Estadual): ${aluno.escola_nome || ""}`, { align: "justify" })
      .text(`Turma: ${aluno.turma || ""}`, { align: "justify" })
      .text(`Turno: ${aluno.turno || ""}`, { align: "justify" })
      .moveDown()
      .text(
        "O(a) aluno(a) encontra-se APTO(a) para uso do transporte escolar da rede estadual, segundo critérios verificados.",
        { align: "justify" }
      )
      .moveDown();

    doc
      .fontSize(11)
      .font("Helvetica-Bold")
      .text("DIREITOS", { align: "left" })
      .moveDown(0.3)
      .font("Helvetica")
      .text("• Transporte seguro e higiênico.")
      .text("• Veículo em bom estado e assentos adequados.")
      .text("• Respeito de todos os envolvidos.")
      .moveDown(0.8)
      .fontSize(11)
      .font("Helvetica-Bold")
      .text("DEVERES", { align: "left" })
      .moveDown(0.3)
      .font("Helvetica")
      .text("• Usar cinto e permanecer sentado.")
      .text("• Não comer no ônibus, zelar pela limpeza.")
      .text("• Respeitar condutores e colegas, seguir orientações.")
      .text("• Não usar eletrônicos que prejudiquem a condução ou perturbem terceiros.")
      .text("• Evitar substâncias ilícitas e comportamentos de risco.")
      .text("• Infrações graves podem suspender o direito ao transporte.")
      .moveDown(1)
      .text(
        `Declaro ciência e responsabilidade de manter os dados atualizados junto à SEDUC.\nAssinatura: ${signerName}`,
        { align: "justify" }
      )
      .moveDown(3);

    const signatureSpace = 120;
    if (doc.y + signatureSpace > doc.page.height - 100) {
      doc.addPage();
    }

    doc.moveDown(5);
    doc.text("_____________________________________________", { align: "center" });
    doc.font("Helvetica-Bold").text("Assinatura do Responsável", { align: "center" });
    doc.moveDown(1);

    if (fs.existsSync(separadorPath)) {
      const footerSepX = (doc.page.width - 510) / 2;
      const footerSepY = doc.page.height - 160;
      doc.image(separadorPath, footerSepX, footerSepY, { width: 510 });
    }
    if (fs.existsSync(logo2Path)) {
      const logo2X = (doc.page.width - 160) / 2;
      const logo2Y = doc.page.height - 150;
      doc.image(logo2Path, logo2X, logo2Y, { width: 160 });
    }

    doc
      .fontSize(8)
      .font("Helvetica")
      .text("SECRETARIA DE ESTADO DE EDUCAÇÃO - SEDUC", 50, doc.page.height - 70, {
        width: doc.page.width - 100,
        align: "center",
      })
      .text("Av. Faruk Salmen, s/n - Belém - PA - CEP: 68.000-000", { align: "center" })
      .text("Telefone: (94) 99999-9999", { align: "center" });

    doc.end();
  } catch (error) {
    console.error("Erro ao gerar PDF (Aprovado Estadual):", error);
    return res.status(500).json({
      success: false,
      message: "Erro ao gerar comprovante de aprovação (estadual).",
    });
  }
});

app.get("/api/comprovante-nao-aprovado-estadual/:alunoId/gerar-pdf", async (req, res) => {
  const { alunoId } = req.params;
  const signer = req.query.signer || "filiacao1";
  try {
    const query = `
      SELECT
        a.id,
        a.pessoa_nome AS aluno_nome,
        a.cpf,
        e.nome AS escola_nome,
        a.turma,
        a.turno,
        a.filiacao_1,
        a.filiacao_2,
        a.responsavel
      FROM alunos_ativos_estadual a
      LEFT JOIN escolas e ON e.id = a.escola_id
      WHERE a.id = $1
    `;
    const result = await pool.query(query, [alunoId]);
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Aluno estadual não encontrado."
      });
    }
    const aluno = result.rows[0];

    let signerName = "______________________";
    if (signer === "filiacao2") {
      signerName = aluno.filiacao_2 || "______________________";
    } else if (signer === "responsavel") {
      signerName = aluno.responsavel || "______________________";
    } else {
      signerName = aluno.filiacao_1 || "______________________";
    }

    const doc = new PDFDocument({ size: "A4", margin: 50 });
    res.setHeader(
      "Content-Disposition",
      `inline; filename=nao_aprovado_estadual_${alunoId}.pdf`
    );
    res.setHeader("Content-Type", "application/pdf");
    doc.pipe(res);

    const logoPath = path.join(__dirname, "public", "assets", "img", "logo_memorando1.png");
    const separadorPath = path.join(__dirname, "public", "assets", "img", "memorando_separador.png");
    const logo2Path = path.join(__dirname, "public", "assets", "img", "memorando_logo2.png");

    if (fs.existsSync(logoPath)) {
      doc.image(logoPath, 50, 20, { width: 60 });
    }
    doc
      .fontSize(11)
      .font("Helvetica-Bold")
      .text(
        "ESTADO DO PARÁ\n" +
        "SECRETARIA DE ESTADO DE EDUCAÇÃO (SEDUC)\n" +
        "COORDENAÇÃO DE TRANSPORTE ESCOLAR",
        250,
        20,
        { width: 300, align: "right" }
      );

    if (fs.existsSync(separadorPath)) {
      const separadorX = (doc.page.width - 510) / 2;
      const separadorY = 90;
      doc.image(separadorPath, separadorX, separadorY, { width: 510 });
    }

    doc.y = 130;
    doc.x = 50;
    doc
      .fontSize(12)
      .font("Helvetica-Bold")
      .text("COMPROVANTE DE NÃO APROVAÇÃO Nº 2025", {
        align: "justify",
      })
      .moveDown();

    doc
      .fontSize(12)
      .font("Helvetica")
      .text(`Aluno(a): ${aluno.aluno_nome || ""}`, { align: "justify" })
      .text(`CPF: ${aluno.cpf || ""}`, { align: "justify" })
      .text(`Escola (Estadual): ${aluno.escola_nome || ""}`, { align: "justify" })
      .text(`Turma: ${aluno.turma || ""}`, { align: "justify" })
      .text(`Turno: ${aluno.turno || ""}`, { align: "justify" })
      .moveDown()
      .text(
        `Eu, ${signerName}, responsável legal pelo(a) aluno(a) acima, estou ciente de que a solicitação de transporte escolar não foi aprovada por não atendimento aos critérios estabelecidos.`,
        { align: "justify" }
      )
      .moveDown()
      .text(
        "Para maiores informações, favor dirigir-se à Coordenação de Transporte Escolar da SEDUC.",
        { align: "justify" }
      )
      .moveDown();

    const spaceNeededForSignature = 100;
    if (doc.y + spaceNeededForSignature > doc.page.height - 160) {
      doc.addPage();
    }
    const signatureY = doc.page.height - 270;
    doc.y = signatureY;
    doc.x = 50;
    doc
      .fontSize(12)
      .font("Helvetica")
      .text("Atenciosamente,", { align: "justify" })
      .moveDown(2)
      .text("COORDENAÇÃO DE TRANSPORTE ESCOLAR - SEDUC", { align: "center" })
      .text("Estado do Pará", { align: "center" });

    if (fs.existsSync(separadorPath)) {
      const footerSepX = (doc.page.width - 510) / 2;
      const footerSepY = doc.page.height - 160;
      doc.image(separadorPath, footerSepX, footerSepY, { width: 510 });
    }
    if (fs.existsSync(logo2Path)) {
      const logo2X = (doc.page.width - 160) / 2;
      const logo2Y = doc.page.height - 150;
      doc.image(logo2Path, logo2X, logo2Y, { width: 160 });
    }
    doc
      .fontSize(10)
      .font("Helvetica")
      .text(
        "SECRETARIA DE ESTADO DE EDUCAÇÃO - SEDUC",
        50,
        doc.page.height - 85,
        {
          width: doc.page.width - 100,
          align: "center",
        }
      )
      .text(
        "Endereço: Av. Faruk Salmen, s/n - CEP: 68.000-000 - Belém - PA",
        { align: "center" }
      )
      .text("Telefone: (94) 99999-9999", { align: "center" });

    doc.end();
  } catch (error) {
    console.error("Erro ao gerar PDF (Não Aprovado Estadual):", error);
    return res.status(500).json({
      success: false,
      message: "Erro ao gerar comprovante de não aprovação (estadual).",
    });
  }
});

app.get("/api/termo-cadastro/:id/gerar-pdf", async (req, res) => {
  const { id } = req.params;
  const signer = req.query.signer || "filiacao1";
  try {
    const query = `
      SELECT
        a.id,
        a.pessoa_nome AS aluno_nome,
        a.cpf,
        e.nome AS escola_nome,
        a.turma,
        a.deficiencia,
        a.rua,
        a.bairro,
        a.numero_pessoa_endereco,
        a.latitude,
        a.longitude,
        a.filiacao_1,
        a.filiacao_2,
        a.responsavel
      FROM alunos_ativos a
      LEFT JOIN escolas e ON e.id = a.escola_id
      WHERE a.id = $1
    `;
    const result = await pool.query(query, [id]);
    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Aluno não encontrado." });
    }
    const aluno = result.rows[0];

    let signerName = "______________________";
    if (signer === "filiacao2") {
      signerName = aluno.filiacao_2 || "______________________";
    } else if (signer === "responsavel") {
      signerName = aluno.responsavel || "______________________";
    } else {
      signerName = aluno.filiacao_1 || "______________________";
    }

    const doc = new PDFDocument({ size: "A4", margin: 50 });
    res.setHeader("Content-Disposition", `inline; filename=termo_cadastro_${id}.pdf`);
    res.setHeader("Content-Type", "application/pdf");
    doc.pipe(res);

    const logoPath = path.join(__dirname, "public", "assets", "img", "logo_memorando1.png");
    const separadorPath = path.join(__dirname, "public", "assets", "img", "memorando_separador.png");
    const logo2Path = path.join(__dirname, "public", "assets", "img", "memorando_logo2.png");

    if (fs.existsSync(logoPath)) {
      doc.image(logoPath, 50, 20, { width: 60 });
    }

    doc
      .fontSize(11)
      .font("Helvetica-Bold")
      .text(
        "ESTADO DO PARÁ\n" +
        "PREFEITURA MUNICIPAL DE CANAÃ DOS CARAJÁS\n" +
        "SECRETARIA MUNICIPAL DE EDUCAÇÃO",
        250,
        20,
        { width: 300, align: "right" }
      );

    if (fs.existsSync(separadorPath)) {
      const separadorX = (doc.page.width - 510) / 2;
      const separadorY = 90;
      doc.image(separadorPath, separadorX, separadorY, { width: 510 });
    }

    doc.y = 130;
    doc.x = 50;
    doc
      .fontSize(14)
      .font("Helvetica-Bold")
      .text("TERMO DE CONFIRMAÇÃO DE CRITÉRIOS", {
        align: "center",
        underline: false,
      });
    doc.moveDown(1);

    doc.lineGap(4);
    doc
      .fontSize(12)
      .font("Helvetica")
      .text(`Eu, ${signerName}, `, { align: "justify", continued: true })
      .text("confirmo que sou o(a) responsável pelo(a) aluno(a) ", { continued: true })
      .font("Helvetica-Bold")
      .text(`${aluno.aluno_nome || ""}`, { continued: true })
      .font("Helvetica")
      .text(", portador(a) do CPF nº ", { continued: true })
      .font("Helvetica-Bold")
      .text(`${aluno.cpf || ""}`, { continued: true })
      .font("Helvetica")
      .text(", devidamente matriculado(a) na Escola ", { continued: true })
      .font("Helvetica-Bold")
      .text(`${aluno.escola_nome || ""}`, { continued: true })
      .font("Helvetica")
      .text(". Residente no endereço: ", { continued: true })
      .font("Helvetica-Bold")
      .text(`${aluno.rua || ""}`, { continued: true })
      .font("Helvetica")
      .text(", nº ", { continued: true })
      .font("Helvetica-Bold")
      .text(`${aluno.numero_pessoa_endereco || ""}`, { continued: true })
      .font("Helvetica")
      .text(", Bairro ", { continued: true })
      .font("Helvetica-Bold")
      .text(`${aluno.bairro || ""}`, { continued: true })
      .font("Helvetica")
      .text(
        ". Declaro, para os devidos fins, a veracidade das informações acima, bem como minha plena consciência e responsabilidade sobre os dados fornecidos, estando ciente de que a omissão ou falsidade de dados pode acarretar o cancelamento do direito ao transporte e responsabilizações legais cabíveis."
      );

    doc.moveDown(1);

    doc.font("Helvetica-Bold").text("CRITÉRIOS DE ELEGIBILIDADE:", { align: "left" });
    doc.font("Helvetica");

    const criterios = [
      "Idade Mínima: 4 (quatro) anos completos até 31 de março do ano vigente.",
      "Distância Mínima para Educação Infantil: residência a mais de 1,5 km da escola e para Ensino Fundamental e EJA: residência a mais de 2 km da escola.",
      "Alunos com Necessidades Especiais: apresentar laudo médico. Priorização conforme a necessidade, demandando transporte adaptado."
    ];

    doc.moveDown(0.5).list(criterios, { align: "justify" });
    doc.moveDown(1);
    doc.font("Helvetica").text(
      "Declaro ciência e concordância com os critérios acima descritos para a utilização do Transporte Escolar no Município de Canaã dos Carajás. Estou ciente de que somente após a verificação desses critérios e a efetivação do cadastro o(a) aluno(a) estará habilitado(a) para o uso do transporte escolar, caso necessário. "
    );

    doc.moveDown(1);
    doc.font("Helvetica").text(
      "Por meio deste, autorizo o uso da imagem do(a) aluno(a) para fins de reconhecimento facial no sistema de embarque e desembarque do Transporte Escolar, ciente de que tal procedimento visa exclusivamente à segurança e identificação do(a) aluno(a)."
    );

    doc.moveDown(2);
    doc.text("_____________________________________________", { align: "center" });
    doc.font("Helvetica-Bold").text("Assinatura do Responsável", { align: "center" });
    doc.moveDown(2);

    if (fs.existsSync(separadorPath)) {
      const footerSepX = (doc.page.width - 510) / 2;
      const footerSepY = doc.page.height - 160;
      doc.image(separadorPath, footerSepX, footerSepY, { width: 510 });
    }
    if (fs.existsSync(logo2Path)) {
      const logo2X = (doc.page.width - 160) / 2;
      const logo2Y = doc.page.height - 150;
      doc.image(logo2Path, logo2X, logo2Y, { width: 160 });
    }

    doc
      .fontSize(10)
      .font("Helvetica")
      .text("SECRETARIA MUNICIPAL DE EDUCAÇÃO - SEMED", 50, doc.page.height - 100, {
        width: doc.page.width - 100,
        align: "center",
      })
      .text(
        "Rua Itamarati, s/n - Bairro Novo Horizonte - CEP: 68.356-103 - Canaã dos Carajás - PA",
        { align: "center" }
      )
      .text("Telefone: (94) 99293-4500", { align: "center" });

    doc.end();
  } catch (error) {
    console.error("Erro ao gerar PDF do termo:", error);
    return res.status(500).json({
      success: false,
      message: "Erro ao gerar PDF do termo.",
    });
  }
});

app.get("/api/termo-desembarque/:id/gerar-pdf", async (req, res) => {
  const { id } = req.params;
  // Capturamos o 'signer' da query string. Se não vier nada, definimos como 'responsavel'.
  const { signer = "responsavel" } = req.query;
  try {
    const query = `
      SELECT
        a.id,
        a.pessoa_nome AS aluno_nome,
        a.cpf,
        e.nome AS escola_nome,
        a.turma,
        a.deficiencia,
        a.rua,
        a.bairro,
        a.numero_pessoa_endereco,
        a.latitude,
        a.longitude,
        a.responsavel,
        a.filiacao_1,
        a.filiacao_2
      FROM alunos_ativos a
      LEFT JOIN escolas e ON e.id = a.escola_id
      WHERE a.id = $1
    `;
    const result = await pool.query(query, [id]);
    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Aluno não encontrado." });
    }
    const aluno = result.rows[0];

    // Definimos o nome que será usado para "Eu, XXX, responsável..."
    let signerName = "_______________________________";
    if (signer === "filiacao1") {
      signerName = aluno.filiacao_1 || "_______________________________";
    } else if (signer === "filiacao2") {
      signerName = aluno.filiacao_2 || "_______________________________";
    } else {
      signerName = aluno.responsavel || "_______________________________";
    }

    const doc = new PDFDocument({ size: "A4", margin: 50 });
    res.setHeader("Content-Disposition", `inline; filename=termo_desembarque_${id}.pdf`);
    res.setHeader("Content-Type", "application/pdf");
    doc.pipe(res);

    const logoPath = path.join(__dirname, "public", "assets", "img", "logo_memorando1.png");
    const separadorPath = path.join(__dirname, "public", "assets", "img", "memorando_separador.png");
    const logo2Path = path.join(__dirname, "public", "assets", "img", "memorando_logo2.png");

    if (fs.existsSync(logoPath)) {
      doc.image(logoPath, 50, 20, { width: 60 });
    }

    doc
      .fontSize(11)
      .font("Helvetica-Bold")
      .text(
        "ESTADO DO PARÁ\n" +
        "PREFEITURA MUNICIPAL DE CANAÃ DOS CARAJÁS\n" +
        "SECRETARIA MUNICIPAL DE EDUCAÇÃO",
        250,
        20,
        { width: 300, align: "right" }
      );

    if (fs.existsSync(separadorPath)) {
      const separadorX = (doc.page.width - 510) / 2;
      const separadorY = 90;
      doc.image(separadorPath, separadorX, separadorY, { width: 510 });
    }

    doc.y = 130;
    doc.x = 50;
    doc
      .fontSize(14)
      .font("Helvetica-Bold")
      .text("TERMO DE RESPONSABILIDADE PARA DESEMBARQUE DESACOMPANHADO", {
        align: "center",
        underline: false,
      });
    doc.moveDown(1);

    doc.lineGap(4);
    doc
      .fontSize(12)
      .font("Helvetica")
      .text(
        `Eu, ${signerName}, responsável legal pelo(a) aluno(a) `,
        { align: "justify", continued: true }
      )
      .font("Helvetica-Bold")
      .text(`${aluno.aluno_nome || ""}`, { continued: true })
      .font("Helvetica")
      .text(
        `, CPF: ${aluno.cpf || "___"}, matriculado(a) na escola ${aluno.escola_nome || "___"
        }, turma ${aluno.turma || "___"
        }, autorizo, por meio deste documento, o desembarque desacompanhado do(a) estudante no trajeto de transporte escolar.`
      );

    doc.moveDown(1);
    doc
      .font("Helvetica")
      .text(
        "Declaro estar ciente de que esta autorização exime os responsáveis pelo transporte escolar, bem como a Secretaria Municipal de Educação, de quaisquer responsabilidades relativas à segurança e acompanhamento do(a) aluno(a) após o desembarque. "
      );
    doc.moveDown(1);
    doc
      .text(
        "Reafirmo minha plena ciência de que tal autorização se aplica exclusivamente ao momento de desembarque, devendo ser respeitadas todas as demais regras e orientações estabelecidas pelo serviço de transporte escolar."
      );

    doc.moveDown(2);
    doc.text("_____________________________________________", { align: "center" });
    doc.font("Helvetica-Bold").text("Assinatura do Responsável", { align: "center" });
    doc.moveDown(2);

    if (fs.existsSync(separadorPath)) {
      const footerSepX = (doc.page.width - 510) / 2;
      const footerSepY = doc.page.height - 160;
      doc.image(separadorPath, footerSepX, footerSepY, { width: 510 });
    }
    if (fs.existsSync(logo2Path)) {
      const logo2X = (doc.page.width - 160) / 2;
      const logo2Y = doc.page.height - 150;
      doc.image(logo2Path, logo2X, logo2Y, { width: 160 });
    }

    doc
      .fontSize(10)
      .font("Helvetica")
      .text("SECRETARIA MUNICIPAL DE EDUCAÇÃO - SEMED", 50, doc.page.height - 100, {
        width: doc.page.width - 100,
        align: "center",
      })
      .text(
        "Rua Itamarati, s/n - Bairro Novo Horizonte - CEP: 68.356-103 - Canaã dos Carajás - PA",
        { align: "center" }
      )
      .text("Telefone: (94) 99293-4500", { align: "center" });

    doc.end();
  } catch (error) {
    console.error("Erro ao gerar PDF do termo de desembarque:", error);
    return res.status(500).json({
      success: false,
      message: "Erro ao gerar PDF do termo de desembarque.",
    });
  }
});

app.get("/api/termo-autorizacao-outros-responsaveis/:id/gerar-pdf", async (req, res) => {
  const { id } = req.params;
  const signer = req.query.signer || "filiacao1";

  try {
    const queryAluno = `
      SELECT
        a.id,
        a.pessoa_nome AS aluno_nome,
        a.cpf,
        a.filiacao_1,
        a.filiacao_2,
        a.responsavel,
        e.nome AS escola_nome,
        a.turma
      FROM alunos_ativos a
      LEFT JOIN escolas e ON e.id = a.escola_id
      WHERE a.id = $1
    `;
    const result = await pool.query(queryAluno, [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Aluno não encontrado." });
    }
    const aluno = result.rows[0];

    // Define quem assina (filiacao1, filiacao2, ou responsavel)
    let signerName = "______________________";
    if (signer === "filiacao2") {
      signerName = aluno.filiacao_2 || "______________________";
    } else if (signer === "responsavel") {
      signerName = aluno.responsavel || "______________________";
    } else {
      signerName = aluno.filiacao_1 || "______________________";
    }

    const solQuery = `
      SELECT id
      FROM solicitacoes_transporte
      WHERE aluno_id = $1
      ORDER BY id DESC
      LIMIT 1
    `;
    const solResult = await pool.query(solQuery, [id]);
    let solicitacaoId = "000";
    if (solResult.rows.length > 0) {
      solicitacaoId = solResult.rows[0].id;
    }

    const respOutros = await pool.query(
      "SELECT nome, rg, cpf FROM outros_responsaveis WHERE aluno_id = $1 ORDER BY id ASC",
      [id]
    );
    const listaOutros = respOutros.rows;

    const doc = new PDFDocument({ size: "A4", margin: 50 });
    res.setHeader("Content-Disposition", `inline; filename=termo_outros_responsaveis_${id}.pdf`);
    res.setHeader("Content-Type", "application/pdf");
    doc.pipe(res);

    const logoPath = path.join(__dirname, "public", "assets", "img", "logo_memorando1.png");
    const separadorPath = path.join(__dirname, "public", "assets", "img", "memorando_separador.png");
    const logo2Path = path.join(__dirname, "public", "assets", "img", "memorando_logo2.png");

    if (fs.existsSync(logoPath)) {
      doc.image(logoPath, 50, 20, { width: 60 });
    }

    doc
      .fontSize(11)
      .font("Helvetica-Bold")
      .text(
        "ESTADO DO PARÁ\n" +
        "PREFEITURA MUNICIPAL DE CANAÃ DOS CARAJÁS\n" +
        "SECRETARIA MUNICIPAL DE EDUCAÇÃO",
        250,
        20,
        { width: 300, align: "right" }
      );

    if (fs.existsSync(separadorPath)) {
      const separadorX = (doc.page.width - 510) / 2;
      const separadorY = 90;
      doc.image(separadorPath, separadorX, separadorY, { width: 510 });
    }

    doc.y = 130;
    doc.x = 50;
    doc
      .fontSize(12)
      .font("Helvetica-Bold")
      .text(`TERMO DE AUTORIZAÇÃO Nº ${solicitacaoId} - OUTROS RESPONSÁVEIS`, {
        align: "justify",
      })
      .moveDown(1);

    doc
      .fontSize(12)
      .font("Helvetica")
      .text(`Aluno(a): ${aluno.aluno_nome || ""}`, { align: "justify" })
      .text(`CPF: ${aluno.cpf || ""}`, { align: "justify" })
      .text(`Escola: ${aluno.escola_nome || ""}`, { align: "justify" })
      .text(`Turma: ${aluno.turma || ""}`, { align: "justify" })
      .moveDown()
      .text(
        `Eu, ${signerName}, responsável legal pelo(a) aluno(a) acima, autorizo as pessoas abaixo (sem parentesco direto) a buscá-lo(a) no ponto de embarque/desembarque do Transporte Escolar.`,
        { align: "justify" }
      )
      .moveDown();

    doc
      .text("Pessoas Autorizadas:", { align: "justify" })
      .moveDown(0.5);

    if (listaOutros.length === 0) {
      doc
        .text("Nenhum responsável cadastrado.", { indent: 20 })
        .moveDown(1);
    } else {
      listaOutros.forEach((r) => {
        doc
          .text(`Nome: ${r.nome || "___"}, CPF: ${r.cpf || "___"}, RG: ${r.rg || "___"}`, {
            indent: 20,
          })
          .moveDown(0.5);
      });
      doc.moveDown(1);
    }

    doc
      .text(
        "Declaro que todos os responsáveis indicados possuem mais de 18 anos e que responderei por quaisquer informações inverídicas.",
        { align: "justify" }
      )
      .moveDown();

    doc
      .text(
        "Para receber o(a) aluno(a), cada responsável indicado deverá apresentar um documento de identificação oficial com foto, comprovando ser a pessoa autorizada. Caso não haja ninguém aguardando ou apresentando identificação idônea no momento do desembarque, o(a) aluno(a) será levado(a) de volta à escola, onde será realizado contato com a família. Na impossibilidade de localizar os familiares ou outro responsável, poderão ser acionados os órgãos competentes de proteção à criança e ao adolescente.",
        { align: "justify" }
      )
      .moveDown(1);

    doc
      .text(
        "Caso essa situação de falta de recepção no ponto ocorra mais de uma vez, o direito de uso do transporte escolar pelo(a) aluno(a) ficará suspenso por tempo indeterminado, como forma de penalidade pela reincidência e falta de compromisso.",
        { align: "justify" }
      )
      .moveDown(2);

    const spaceNeededForSignature = 100;
    if (doc.y + spaceNeededForSignature > doc.page.height - 160) {
      doc.addPage();
    }

    const signatureY = doc.page.height - 270;
    doc.y = signatureY;
    doc.x = 50;
    doc
      .fontSize(12)
      .font("Helvetica")
      .text("Atenciosamente,", { align: "justify" })
      .moveDown(2)
      .text("_____________________________________", { align: "center" })
      .text("Assinatura do Responsável", { align: "center" });

    if (fs.existsSync(separadorPath)) {
      const footerSepX = (doc.page.width - 510) / 2;
      const footerSepY = doc.page.height - 160;
      doc.image(separadorPath, footerSepX, footerSepY, { width: 510 });
    }
    if (fs.existsSync(logo2Path)) {
      const logo2X = (doc.page.width - 160) / 2;
      const logo2Y = doc.page.height - 150;
      doc.image(logo2Path, logo2X, logo2Y, { width: 160 });
    }

    doc
      .fontSize(10)
      .font("Helvetica")
      .text("SECRETARIA MUNICIPAL DE EDUCAÇÃO - SEMED", 50, doc.page.height - 85, {
        width: doc.page.width - 100,
        align: "center",
      })
      .text("Rua Itamarati s/n - Bairro Novo Horizonte - CEP: 68.356-103 - Canaã dos Carajás - PA", {
        align: "center",
      })
      .text("Telefone: (94) 99293-4500", { align: "center" });

    doc.end();
  } catch (error) {
    console.error("Erro ao gerar termo de outros responsáveis:", error);
    return res.status(500).json({
      success: false,
      message: "Erro ao gerar termo de outros responsáveis.",
    });
  }
});

app.post("/api/outros-responsaveis", async (req, res) => {
  const { aluno_id, responsaveis } = req.body;
  if (!aluno_id || !Array.isArray(responsaveis)) {
    return res.status(400).json({ success: false, message: "Dados inválidos." });
  }
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Se desejar, pode-se apagar todos os antigos antes:
      await client.query("DELETE FROM outros_responsaveis WHERE aluno_id = $1", [aluno_id]);

      for (const r of responsaveis) {
        await client.query(
          `INSERT INTO outros_responsaveis (aluno_id, nome, rg, cpf, data_nascimento)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            aluno_id,
            r.nome || "",
            r.rg || "",
            r.cpf || "",
            r.dataNascimento || null
          ]
        );
      }
      await client.query("COMMIT");
      return res.json({ success: true });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("Erro ao salvar outros_responsaveis:", err);
      return res.status(500).json({ success: false, message: "Erro ao salvar responsáveis." });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("Erro de conexão:", err);
    return res.status(500).json({ success: false, message: "Erro de conexão." });
  }
});

app.get("/api/termo-desembarque-estadual/:id/gerar-pdf", async (req, res) => {
  const { id } = req.params;
  try {
    const query = `
      SELECT
        a.id,
        a.pessoa_nome AS aluno_nome,
        a.cpf,
        e.nome AS escola_nome,
        a.turma,
        a.turno,
        a.responsavel
      FROM alunos_ativos_estadual a
      LEFT JOIN escolas e ON e.id = a.escola_id
      WHERE a.id = $1
    `;
    const result = await pool.query(query, [id]);
    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Aluno Estadual não encontrado." });
    }
    const aluno = result.rows[0];

    const doc = new PDFDocument({ size: "A4", margin: 50 });
    res.setHeader("Content-Disposition", `inline; filename=termo_desembarque_estadual_${id}.pdf`);
    res.setHeader("Content-Type", "application/pdf");
    doc.pipe(res);

    const logoPath = path.join(__dirname, "public", "assets", "img", "logo_memorando1.png");
    const separadorPath = path.join(__dirname, "public", "assets", "img", "memorando_separador.png");
    const logo2Path = path.join(__dirname, "public", "assets", "img", "memorando_logo2.png");

    if (fs.existsSync(logoPath)) {
      doc.image(logoPath, 50, 20, { width: 60 });
    }

    doc
      .fontSize(11)
      .font("Helvetica-Bold")
      .text(
        "ESTADO DO PARÁ\n" +
        "SECRETARIA DE ESTADO DE EDUCAÇÃO (SEDUC)\n" +
        "COORDENAÇÃO DE TRANSPORTE ESCOLAR",
        250,
        20,
        { width: 300, align: "right" }
      );

    if (fs.existsSync(separadorPath)) {
      const separadorX = (doc.page.width - 510) / 2;
      const separadorY = 90;
      doc.image(separadorPath, separadorX, separadorY, { width: 510 });
    }

    doc.y = 130;
    doc.x = 50;
    doc
      .fontSize(14)
      .font("Helvetica-Bold")
      .text("TERMO DE RESPONSABILIDADE PARA DESEMBARQUE DESACOMPANHADO (Estadual)", {
        align: "center",
        underline: false,
      });
    doc.moveDown(1);

    doc.lineGap(4);
    doc
      .fontSize(12)
      .font("Helvetica")
      .text(
        `Eu, ${aluno.responsavel || "_______________________________"}, responsável legal pelo(a) aluno(a) `,
        { align: "justify", continued: true }
      )
      .font("Helvetica-Bold")
      .text(`${aluno.aluno_nome || ""}`, { continued: true })
      .font("Helvetica")
      .text(
        `, CPF: ${aluno.cpf || "___"}, matriculado(a) na escola (Estadual) ${aluno.escola_nome || "___"}, turma ${aluno.turma || "___"
        }, turno ${aluno.turno || "___"}, autorizo, por meio deste documento, o desembarque desacompanhado do(a) estudante no trajeto de transporte escolar fornecido pela SEDUC.`
      );

    doc.moveDown(1);
    doc
      .font("Helvetica")
      .text(
        "Declaro estar ciente de que esta autorização exime os responsáveis pelo transporte escolar, bem como a Secretaria de Estado de Educação, de quaisquer responsabilidades relativas à segurança e acompanhamento do(a) aluno(a) após o desembarque."
      );
    doc.moveDown(1);
    doc
      .text(
        "Reafirmo minha plena ciência de que tal autorização se aplica exclusivamente ao momento de desembarque, devendo ser respeitadas todas as demais regras e orientações estabelecidas pelo serviço de transporte escolar estadual."
      );

    doc.moveDown(2);
    doc.text("_____________________________________________", { align: "center" });
    doc.font("Helvetica-Bold").text("Assinatura do Responsável", { align: "center" });
    doc.moveDown(2);

    if (fs.existsSync(separadorPath)) {
      const footerSepX = (doc.page.width - 510) / 2;
      const footerSepY = doc.page.height - 160;
      doc.image(separadorPath, footerSepX, footerSepY, { width: 510 });
    }
    if (fs.existsSync(logo2Path)) {
      const logo2X = (doc.page.width - 160) / 2;
      const logo2Y = doc.page.height - 150;
      doc.image(logo2Path, logo2X, logo2Y, { width: 160 });
    }

    doc
      .fontSize(10)
      .font("Helvetica")
      .text("SECRETARIA DE ESTADO DE EDUCAÇÃO - SEDUC", 50, doc.page.height - 100, {
        width: doc.page.width - 100,
        align: "center",
      })
      .text("Endereço: Av. Faruk Salmen, s/n - CEP: 68.000-000 - Belém - PA", {
        align: "center",
      })
      .text("Telefone: (94) 99999-9999", { align: "center" });

    doc.end();
  } catch (error) {
    console.error("Erro ao gerar PDF do termo de desembarque (Estadual):", error);
    return res.status(500).json({
      success: false,
      message: "Erro ao gerar PDF do termo de desembarque (estadual).",
    });
  }
});

app.get("/api/solicitacoes-transporte", async (req, res) => {
  try {
    const query = `
      SELECT
        st.id,
        a.id_matricula AS aluno_id, -- aqui substituímos o ID do aluno pelo ID de matrícula
        st.protocolo,
        st.status,
        st.motivo,
        st.data_solicitacao,
        st.data_resposta,
        st.tipo_fluxo,
        st.menor10_acompanhado,
        st.responsaveis_extras,
        st.desembarque_sozinho_10a12,
        a.escola_id,
        a.ano,
        a.modalidade,
        a.formato_letivo,
        a.turma,
        a.pessoa_nome AS aluno_nome,
        a.cpf,
        a.transporte_escolar_poder_publico,
        a.cep,
        a.rua,
        a.bairro,
        a.numero_pessoa_endereco,
        a.filiacao_1,
        a.numero_telefone,
        a.filiacao_2,
        a.responsavel,
        a.deficiencia,
        a.data_nascimento,
        a.longitude,
        a.latitude,
        e.nome AS escola_nome,
        (
          SELECT COALESCE(json_agg(json_build_object(
            'id', orx.id,
            'nome', orx.nome,
            'rg', orx.rg,
            'cpf', orx.cpf,
            'data_nascimento', orx.data_nascimento
          )), '[]'::json)
          FROM outros_responsaveis orx
          WHERE orx.aluno_id = a.id
        ) AS outros_responsaveis_detalhes
      FROM solicitacoes_transporte st
      LEFT JOIN alunos_ativos a ON a.id = st.aluno_id
      LEFT JOIN escolas e ON e.id = a.escola_id
      ORDER BY st.id DESC
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (err) {
    console.error("Erro ao listar solicitacoes_transporte", err);
    res.status(500).json({
      success: false,
      message: "Erro interno ao listar as solicitações de transporte"
    });
  }
});

app.get("/api/solicitacoes-transporte-especial", async (req, res) => {
  try {
    const query = `
      SELECT
        ste.id,
        ste.protocolo,
        ste.aluno_id,
        ste.status,
        ste.motivo,
        ste.tipo_fluxo,
        ste.menor10_acompanhado,
        ste.responsaveis_extras,
        ste.desembarque_sozinho_10a12,
        TO_CHAR(ste.created_at, 'YYYY-MM-DD HH24:MI:SS') AS created_at,
        TO_CHAR(ste.updated_at, 'YYYY-MM-DD HH24:MI:SS') AS updated_at,

        -- Dados do aluno
        COALESCE(a.id_matricula, 0) AS id_matricula,
        COALESCE(a.cpf, '') AS cpf,
        COALESCE(a.longitude, NULL) AS longitude,
        COALESCE(a.latitude, NULL) AS latitude,

        -- Dados da escola (caso queira retornar também)
        COALESCE(e.nome, '') AS escola_nome,
        COALESCE(e.latitude, NULL) AS escola_latitude,
        COALESCE(e.longitude, NULL) AS escola_longitude

      FROM solicitacoes_transporte_especial ste
      LEFT JOIN alunos_ativos a ON a.id = ste.aluno_id
      LEFT JOIN escolas e ON e.id = a.escola_id
      ORDER BY ste.id DESC
    `;
    const result = await pool.query(query);
    return res.json(result.rows);
  } catch (err) {
    console.error("Erro ao listar solicitacoes_transporte_especial", err);
    return res.status(500).json({
      success: false,
      message: "Erro ao buscar solicitações especiais"
    });
  }
});

app.post("/api/solicitacoes-transporte-especial", async (req, res) => {
  try {
    const {
      aluno_id,
      status,
      motivo,
      tipo_fluxo,
      menor10_acompanhado,
      responsaveis_extras,
      desembarque_sozinho_10a12
    } = req.body
    const protocolo = "P" + Date.now()
    const insertQuery = `
      INSERT INTO solicitacoes_transporte_especial
      (protocolo, aluno_id, status, motivo, tipo_fluxo, menor10_acompanhado, responsaveis_extras, desembarque_sozinho_10a12)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING *
    `
    const result = await pool.query(insertQuery, [
      protocolo,
      aluno_id,
      status,
      motivo || null,
      tipo_fluxo,
      menor10_acompanhado || false,
      JSON.stringify(responsaveis_extras || []),
      desembarque_sozinho_10a12 || false
    ])
    res.status(201).json(result.rows[0])
  } catch (error) {
    res.status(400).json({ message: error.message })
  }
})

// Recebe status ('APROVADO' ou 'NAO_APROVADO') e salva com protocolo gerado
app.post("/api/solicitacoes-transporte", async (req, res) => {
  try {
    const {
      aluno_id,
      status,
      motivo,
      tipo_fluxo,
      menor10_acompanhado,
      responsaveis_extras,
      desembarque_sozinho_10a12,
    } = req.body;

    const protocoloGerado = "PROTO-" + Date.now();

    const insertQuery = `
      INSERT INTO solicitacoes_transporte (
        protocolo,
        aluno_id,
        status,
        motivo,
        tipo_fluxo,
        menor10_acompanhado,
        responsaveis_extras,
        desembarque_sozinho_10a12
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id
    `;

    const values = [
      protocoloGerado,
      aluno_id,
      status,
      motivo || null,
      tipo_fluxo,
      menor10_acompanhado,
      JSON.stringify(responsaveis_extras || []),
      desembarque_sozinho_10a12,
    ];

    const result = await pool.query(insertQuery, values);
    return res.json({ success: true, id: result.rows[0].id });
  } catch (err) {
    console.error("Erro ao criar solicitação de transporte", err);
    return res.status(500).json({
      success: false,
      message: "Erro interno ao criar solicitação"
    });
  }
});


/* ------------------------------------------------------------------ */
/*  ROTAS ::  Importar alunos ativos                                   */
/* ------------------------------------------------------------------ */

/* ---------- utilitário de datas ------------------------------------- */
function normalizeDate(value) {
  if (value === undefined || value === null) return null;

  // número serial do Excel (dias desde 1899-12-30)
  if (typeof value === "number") {
    const excelEpoch = new Date(Math.round((value - 25569) * 86400 * 1000));
    return moment(excelEpoch).format("YYYY-MM-DD");
  }

  // string → tenta vários formatos; string vazia → NULL
  if (typeof value === "string") {
    const s = value.trim();
    if (!s) return null;

    const m = moment(s, ["DD/MM/YYYY", "YYYY-MM-DD", "MM/DD/YYYY"], true);
    return m.isValid() ? m.format("YYYY-MM-DD") : null;
  }

  // qualquer outro tipo → NULL
  return null;
}

function normalizeCpf(value) {
  if (typeof value !== 'string') return null;           // não-string → null
  const digits = value.replace(/\D/g, '');              // só dígitos
  return digits.length ? digits : null;                 // vazio → null
}

/* ---------- rota ----------------------------------------------------- */
app.post('/api/import-alunos-ativos', async (req, res) => {
  const { alunos, escolaId, overrideConflicts = false } = req.body;

  if (!Array.isArray(alunos) || !escolaId) {
    return res.status(400).json({ success: false, message: 'Dados inválidos.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    /* -------------------------------------------------------------------- *
     * 1) Pré-checagem opcional de conflitos (entre escolas diferentes)      *
     * -------------------------------------------------------------------- */
    if (!overrideConflicts) {
      const conflicts = [];
      for (const a of alunos) {
        const cpfNorm = typeof a.cpf === 'string' ? a.cpf.trim() || null : null;

        const { rows } = await client.query(
          `SELECT id, id_pessoa, cpf, escola_id AS currentEscola, id_matricula
             FROM alunos_ativos
            WHERE (
                  id_pessoa    = $1
               OR cpf          = $2
               OR id_matricula = $3
            )
              AND escola_id != $4`,
          [a.id_pessoa, cpfNorm, a.id_matricula, escolaId]
        );

        if (rows.length) conflicts.push(...rows);
      }
      if (conflicts.length) {
        await client.query('ROLLBACK');
        return res.status(409).json({ success: false, type: 'conflicts', conflicts });
      }
    }

    /* -------------------------------------------------------------------- *
     * 2) Importação registro-a-registro                                    *
     * -------------------------------------------------------------------- */
    for (const a of alunos) {
      let {
        id_pessoa,
        id_matricula,
        ANO,
        MODALIDADE,
        FORMATO_LETIVO,
        TURMA,
        pessoa_nome,
        cpf,
        cep,
        bairro,
        numero_pessoa_endereco,
        filiacao_1,
        telefone_filiacao_1,
        filiacao_2,
        RESPONSAVEL,
        deficiencia,
        data_nascimento
      } = a;

      /* normalizações */
      const cpfNorm = typeof cpf === 'string' ? cpf.trim() || null : null;
      let defArray = null;
      if (typeof deficiencia === 'string' && deficiencia.trim()) {
        try { defArray = JSON.parse(deficiencia); }
        catch { defArray = [deficiencia.trim()]; }
      } else if (Array.isArray(deficiencia)) {
        defArray = deficiencia;
      }
      data_nascimento = normalizeDate(data_nascimento);

      /* 2.1) Conflito de pessoa/matrícula/CPF em outra escola */
      const { rowCount: hasConflict, rows: conflictRow } = await client.query(
        `SELECT id
           FROM alunos_ativos
          WHERE (
                id_pessoa    = $1
             OR cpf          = $2
             OR id_matricula = $3
          )
            AND escola_id != $4
          LIMIT 1`,
        [id_pessoa, cpfNorm, id_matricula, escolaId]
      );
      if (hasConflict) {
        if (overrideConflicts) {
          await client.query(
            `UPDATE alunos_ativos SET
               escola_id               = $1,
               ano                     = $2,
               modalidade              = $3,
               formato_letivo          = $4,
               turma                   = $5,
               pessoa_nome             = $6,
               cpf                     = $7,
               cep                     = $8,
               bairro                  = $9,
               numero_pessoa_endereco  = $10,
               filiacao_1              = $11,
               numero_telefone         = $12,
               filiacao_2              = $13,
               responsavel             = $14,
               deficiencia             = $15,
               data_nascimento         = $16
             WHERE id = $17`,
            [
              escolaId,
              ANO, MODALIDADE, FORMATO_LETIVO, TURMA,
              pessoa_nome, cpfNorm, cep, bairro, numero_pessoa_endereco,
              filiacao_1, telefone_filiacao_1, filiacao_2, RESPONSAVEL,
              defArray, data_nascimento,
              conflictRow[0].id
            ]
          );
        }
        continue; // próximo aluno
      }

      /* 2.2) Completa id_pessoa se matrícula existir */
      const { rowCount: fillByMat } = await client.query(
        `UPDATE alunos_ativos
            SET id_pessoa = $1
          WHERE id_matricula = $2
            AND id_pessoa IS NULL
            AND NOT EXISTS (SELECT 1 FROM alunos_ativos WHERE id_pessoa = $1)`,
        [id_pessoa, id_matricula]
      );
      if (fillByMat) continue;

      /* 2.3) Completa id_pessoa se CPF existir */
      if (cpfNorm) {
        const { rowCount: fillByCpf } = await client.query(
          `UPDATE alunos_ativos
              SET id_pessoa = $1
            WHERE cpf = $2
              AND id_pessoa IS NULL
              AND NOT EXISTS (SELECT 1 FROM alunos_ativos WHERE id_pessoa = $1)`,
          [id_pessoa, cpfNorm]
        );
        if (fillByCpf) continue;
      }

      /* 2.4) Pessoa já existe? então ignora */
      const { rowCount: dupPessoa } = await client.query(
        `SELECT 1 FROM alunos_ativos WHERE id_pessoa = $1 LIMIT 1`,
        [id_pessoa]
      );
      if (dupPessoa) continue;

      /* 2.5) Chave duplicada matrícula/CPF já presente? ignora */
      const { rowCount: dupKey } = await client.query(
        `SELECT 1
           FROM alunos_ativos
          WHERE id_matricula = $1
             OR (cpf = $2 AND $2 IS NOT NULL)
          LIMIT 1`,
        [id_matricula, cpfNorm]
      );
      if (dupKey) continue;

      /* 2.6) INSERT/UPSERT — captura CPF duplicado e pula */
      try {
        await client.query(
          `INSERT INTO alunos_ativos (
             id_pessoa, id_matricula, escola_id, ano, modalidade,
             formato_letivo, turma, pessoa_nome, cpf,
             cep, bairro, numero_pessoa_endereco,
             filiacao_1, numero_telefone, filiacao_2, responsavel,
             deficiencia, data_nascimento
           ) VALUES (
             $1,$2,$3,$4,$5,
             $6,$7,$8,$9,
             $10,$11,$12,
             $13,$14,$15,$16,
             $17::text[],$18
           )
           ON CONFLICT ON CONSTRAINT alunos_ativos_id_matricula_uk
           DO UPDATE
             SET id_pessoa = COALESCE(alunos_ativos.id_pessoa, EXCLUDED.id_pessoa)
           WHERE alunos_ativos.id_pessoa IS NULL`,
          [
            id_pessoa, id_matricula, escolaId, ANO, MODALIDADE,
            FORMATO_LETIVO, TURMA, pessoa_nome, cpfNorm,
            cep, bairro, numero_pessoa_endereco,
            filiacao_1, telefone_filiacao_1, filiacao_2, RESPONSAVEL,
            defArray, data_nascimento
          ]
        );
      } catch (err) {
        // CPF duplicado → apenas ignora e segue
        if (err.code === '23505' && err.constraint === 'alunos_ativos_cpf_uk') {
          continue;
        }
        throw err; // qualquer outro erro é fatal
      }
    }

    /* -------------------------------------------------------------------- *
     * 3) Marcar transferidos (saíram desta escola)                         *
     * -------------------------------------------------------------------- */
    const incomingMats = alunos
      .map(a => parseInt(a.id_matricula, 10))
      .filter(n => !isNaN(n));

    if (incomingMats.length) {
      await client.query(
        `UPDATE alunos_ativos
            SET status    = 'transferido',
                escola_id = NULL
          WHERE escola_id = $1
            AND id_matricula <> ALL ($2::int[])`,
        [escolaId, incomingMats]
      );
    }

    await client.query('COMMIT');
    res.json({ success: true, message: 'Importação concluída com sucesso.' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erro na importação:', err);
    res.status(500).json({ success: false, message: 'Erro interno na importação.' });
  } finally {
    client.release();
  }
});


app.get("/api/alunos-ativos", async (req, res) => {
  try {
    const params = [];
    const where = [];
    let idx = 1;

    // ————— filtros atuais —————
    if (req.query.escola_id) {
      where.push(`a.escola_id = $${idx++}`);
      params.push(parseInt(req.query.escola_id, 10));
    }
    if (req.query.bairro) {
      where.push(`a.bairro ILIKE $${idx++}`);
      params.push(`%${req.query.bairro}%`);
    }
    if (req.query.cep) {
      where.push(`a.cep ILIKE $${idx++}`);
      params.push(`%${req.query.cep}%`);
    }
    if (req.query.search) {
      const s = `%${req.query.search}%`;
      where.push(`(
        a.pessoa_nome ILIKE $${idx} OR
        CAST(a.id_matricula AS TEXT) ILIKE $${idx} OR
        a.cpf ILIKE $${idx}
      )`);
      params.push(s);
      idx++;
    }
    if (req.query.transporte) {
      where.push(`a.transporte_escolar_poder_publico ILIKE $${idx++}`);
      params.push(`%${req.query.transporte}%`);
    }
    if (req.query.deficiencia === "sim") {
      where.push(`(a.deficiencia IS NOT NULL AND array_length(a.deficiencia, 1) > 0)`);
    } else if (req.query.deficiencia === "nao") {
      where.push(`(a.deficiencia IS NULL OR array_length(a.deficiencia, 1) = 0)`);
    }
    if (req.query.mapeados === "sim") {
      where.push("(a.latitude IS NOT NULL AND a.longitude IS NOT NULL)");
    } else if (req.query.mapeados === "nao") {
      where.push("(a.latitude IS NULL OR a.longitude IS NULL)");
    }
    if (req.query.turno) {
      where.push(`a.turma ILIKE $${idx++}`);
      params.push(`%-${req.query.turno}`);
    }
    // ————————————————————————————

    // → NOVO FILTRO: associado_rota = sim / nao
    if (req.query.associado_rota === "sim") {
      // Apenas alunos cujo ID apareça em ANY(linhas_rotas.alunos_ids)
      where.push(`
        EXISTS (
          SELECT 1
            FROM public.linhas_rotas lrf
           WHERE a.id = ANY(lrf.alunos_ids)
        )
      `);
    } else if (req.query.associado_rota === "nao") {
      // Apenas alunos que NÃO estejam em nenhuma linha
      where.push(`
        NOT EXISTS (
          SELECT 1
            FROM public.linhas_rotas lrf
           WHERE a.id = ANY(lrf.alunos_ids)
        )
      `);
    }

    // ——— montar SQL principal ———
    const sql = `
  SELECT
    a.*,
    e.nome AS escola_nome,

    /* nome da linha (ex.: “A”, “B”, …) */
    (
      SELECT lr2.nome_linha
        FROM public.linhas_rotas lr2
       WHERE a.id = ANY(lr2.alunos_ids)
       LIMIT 1
    )                               AS linha,

    /* itinerário ligado ao aluno, se houver */
    (
      SELECT lr2.itinerario_id
        FROM public.linhas_rotas lr2
       WHERE a.id = ANY(lr2.alunos_ids)
       LIMIT 1
    )                               AS itinerario_id,

    /* NOVO — ponto de parada associado (primeiro encontrado) */
    (
      SELECT p.nome_ponto
        FROM public.pontos p
       WHERE p.id = a.ponto_id          -- ou JOIN alunos_pontos se preferir
       LIMIT 1
    )                               AS ponto_nome

  FROM public.alunos_ativos a
  LEFT JOIN public.escolas e ON e.id = a.escola_id
  ${where.length ? "WHERE " + where.join(" AND ") : ""}
  ORDER BY a.id DESC
`;

    const { rows } = await pool.query(sql, params);
    res.json(rows);

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Erro ao buscar alunos." });
  }
});

/// PUT /api/alunos-ativos/:id/ponto  – v2
app.put("/api/alunos-ativos/:id/ponto", async (req, res) => {
  const alunoId = Number(req.params.id);
  const pontoId = Number(req.body.ponto_id);
  if (!pontoId) return res.status(400).json({ success: false, message: "ponto_id obrigatório" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    /* procura ponto anterior (se existir) */
    const { rows: oldRows } = await client.query(
      `SELECT ponto_id FROM alunos_pontos WHERE aluno_id = $1`, [alunoId]);
    const oldPontoId = oldRows[0]?.ponto_id;

    /* 1. upsert na tabela pivô */
    await client.query(`
      INSERT INTO alunos_pontos (aluno_id, ponto_id)
           VALUES ($1, $2)
      ON CONFLICT (aluno_id)
      DO UPDATE SET ponto_id = EXCLUDED.ponto_id
    `, [alunoId, pontoId]);

    /* 2. campo direto na tabela de alunos */
    await client.query(`UPDATE alunos_ativos SET ponto_id = $2 WHERE id = $1`,
      [alunoId, pontoId]);

    /* 3. ativa o novo ponto, se necessário */
    await client.query(`UPDATE pontos SET status = 'ativo'
                         WHERE id = $1 AND status <> 'ativo'`, [pontoId]);

    /* 4. desativa o ponto antigo se ficou sem alunos */
    if (oldPontoId && oldPontoId !== pontoId) {
      const { rows } = await client.query(
        `SELECT COUNT(*)::int AS c FROM alunos_pontos WHERE ponto_id = $1`, [oldPontoId]);
      if (rows[0].c === 0) {
        await client.query(`UPDATE pontos SET status = 'inativo' WHERE id = $1`, [oldPontoId]);
      }
    }

    /* 5. saneia todos os pontos (garantia extra) */
    await client.query(`
      UPDATE pontos p
         SET status = 'inativo'
       WHERE status <> 'inativo'
         AND NOT EXISTS (SELECT 1 FROM alunos_pontos ap WHERE ap.ponto_id = p.id);
      UPDATE pontos p
         SET status = 'ativo'
       WHERE status <> 'ativo'
         AND EXISTS (SELECT 1 FROM alunos_pontos ap WHERE ap.ponto_id = p.id);
    `);

    await client.query("COMMIT");
    res.json({ success: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("erro update ponto manual:", err);
    res.status(500).json({ success: false, message: err.detail || "Erro interno" });
  } finally {
    client.release();
  }
});


// GET /api/pontos-proximos?lat=…&lng=…&raio_km=3
app.get("/api/pontos-proximos", async (req, res) => {
  const { lat, lng, raio_km = 3 } = req.query;
  if (!lat || !lng) return res.status(400).json([]);
  const q = `
    SELECT *,
           ( 6371 *
             acos( cos(radians($1)) * cos(radians(latitude))
                 * cos(radians(longitude) - radians($2))
                 + sin(radians($1)) * sin(radians(latitude)) )
           ) AS dist_km
    FROM pontos
    WHERE status = 'ativo'
      AND latitude  IS NOT NULL
      AND longitude IS NOT NULL
    HAVING (6371 * acos(cos(radians($1))*cos(radians(latitude))
          * cos(radians(longitude)-radians($2))
          + sin(radians($1))*sin(radians(latitude)))) <= $3
    ORDER BY dist_km;
  `;
  const { rows } = await pool.query(q, [lat, lng, raio_km]);
  res.json(rows);
});


app.get("/api/alunos_ativos/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const query = `
      SELECT a.*,
             e.nome AS escola_nome,
             e.latitude AS escola_latitude,
             e.longitude AS escola_longitude
      FROM alunos_ativos a
      LEFT JOIN escolas e ON e.id = a.escola_id
      WHERE a.id = $1
    `;
    const result = await pool.query(query, [id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Aluno não encontrado." });
    }

    return res.json(result.rows[0]);
  } catch (err) {
    console.error("Erro ao buscar aluno ativo por ID:", err);
    return res.status(500).json({
      success: false,
      message: "Erro ao buscar aluno ativo."
    });
  }
});

// DELETE /api/alunos-ativos/:id  – versão 2
app.delete("/api/alunos-ativos/:id", async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. tabelas dependentes
    await client.query("DELETE FROM solicitacoes_transporte_especial WHERE aluno_id = $1", [id]);
    await client.query("DELETE FROM alunos_pontos                WHERE aluno_id = $1", [id]);
    await client.query("DELETE FROM alunos_rotas                 WHERE aluno_id = $1", [id]);

    // 2. arrays em linhas_rotas
    await client.query(`
      UPDATE linhas_rotas
         SET alunos_ids = array_remove(alunos_ids, $1)
       WHERE $1 = ANY(alunos_ids)`, [id]);

    // 3. registro principal
    await client.query("DELETE FROM alunos_ativos WHERE id = $1", [id]);

    await client.query("COMMIT");
    res.json({ success: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("erro delete aluno:", err);
    res.status(500).json({ success: false, message: err.detail || "Erro ao excluir" });
  } finally {
    client.release();
  }
});


// PUT /api/alunos-recadastro/:id — não zera mais campos inadvertidamente
app.put('/api/alunos-recadastro/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      cep,
      bairro,
      numero_pessoa_endereco,
      numero_telefone,
      deficiencia,
      latitude,
      longitude,
      rua
    } = req.body;

    // Normaliza deficiências -> text[]
    let defArray = null;
    if (Array.isArray(deficiencia)) {
      defArray = deficiencia
        .map(d => (d && d !== 'NADA INFORMADO' ? d : null))
        .filter(Boolean);
      if (!defArray.length) defArray = null;
    } else if (
      typeof deficiencia === 'string' &&
      deficiencia.trim() &&
      deficiencia.trim() !== 'NADA INFORMADO'
    ) {
      defArray = [deficiencia.trim()];
    }

    const sql = `
      UPDATE alunos_ativos SET
        cep                    = COALESCE(NULLIF($1, '')          , cep),
        bairro                 = COALESCE(NULLIF($2, '')          , bairro),
        numero_pessoa_endereco = COALESCE(NULLIF($3, '')::text    , numero_pessoa_endereco),
        numero_telefone        = COALESCE(NULLIF($4, '')          , numero_telefone),
        deficiencia            = COALESCE($5::text[]              , deficiencia),
        latitude               = COALESCE($6::double precision    , latitude),
        longitude              = COALESCE($7::double precision    , longitude),
        rua                    = COALESCE(NULLIF($8, '')          , rua),
        transporte_escolar_poder_publico = 'MUNICIPAL',
        geom = CASE
                 WHEN $6::double precision IS NOT NULL
                  AND $7::double precision IS NOT NULL
                 THEN ST_SetSRID(
                        ST_MakePoint($7::double precision, $6::double precision),
                        4326
                      )
                 ELSE geom
               END,
        updated_at = NOW()
      WHERE id = $9
      RETURNING id;
    `;

    const params = [
      cep ?? '',
      bairro ?? '',
      numero_pessoa_endereco ?? '',
      numero_telefone ?? '',
      defArray,
      latitude ?? null,
      longitude ?? null,
      rua ?? '',
      id
    ];

    const { rowCount } = await pool.query(sql, params);
    if (!rowCount)
      return res
        .status(404)
        .json({ success: false, message: 'Aluno não encontrado.' });

    res.json({ success: true, message: 'Dados atualizados.' });
  } catch (err) {
    console.error('Erro ao recadastrar aluno:', err);
    res.status(500).json({ success: false, message: 'Erro interno.' });
  }
});


app.post("/api/alunos-ativos-estadual", async (req, res) => {
  try {
    const {
      id_matricula, pessoa_nome, escola_id, turma, turno, cpf,
      cep, rua, bairro, numero_pessoa_endereco, numero_telefone,
      filiacao_1, filiacao_2, responsavel, deficiencia,
      latitude, longitude
    } = req.body;

    const defArray =
      typeof deficiencia === "string" && deficiencia.trim()
        ? JSON.parse(deficiencia)
        : Array.isArray(deficiencia)
          ? deficiencia
          : null;

    const { rows } = await pool.query(
      `INSERT INTO alunos_ativos_estadual (
         id_matricula, pessoa_nome, escola_id, turma, turno, cpf,
         cep, rua, bairro, numero_pessoa_endereco, numero_telefone,
         filiacao_1, filiacao_2, responsavel, deficiencia,
         latitude, longitude, geom
       ) VALUES (
         $1,$2,$3,$4,$5,$6,
         $7,$8,$9,$10,$11,
         $12,$13,$14,$15,
         $16,$17,
         CASE
           WHEN $16 IS NOT NULL AND $17 IS NOT NULL
           THEN ST_SetSRID(ST_MakePoint($17,$16),4326)
           ELSE NULL
         END
       ) RETURNING id`,
      [
        id_matricula || null,
        pessoa_nome,
        escola_id || null,
        turma || null,
        turno || null,
        cpf || null,
        cep || null,
        rua || null,
        bairro || null,
        numero_pessoa_endereco || null,
        numero_telefone || null,
        filiacao_1 || null,
        filiacao_2 || null,
        responsavel || null,
        defArray,
        latitude || null,
        longitude || null
      ]
    );

    return res.status(201).json({ success: true, id: rows[0].id });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false });
  }
});

app.put("/api/alunos-ativos-estadual/:id", async (req, res) => {
  try {
    const {
      id_matricula, pessoa_nome, escola_id, turma, turno, cpf,
      cep, rua, bairro, numero_pessoa_endereco, numero_telefone,
      filiacao_1, filiacao_2, responsavel, deficiencia,
      latitude, longitude
    } = req.body;

    const defArray =
      typeof deficiencia === "string" && deficiencia.trim()
        ? JSON.parse(deficiencia)
        : Array.isArray(deficiencia)
          ? deficiencia
          : null;

    await pool.query(
      `UPDATE alunos_ativos_estadual SET
         id_matricula = $1,
         pessoa_nome  = $2,
         escola_id    = $3,
         turma        = $4,
         turno        = $5,
         cpf          = $6,
         cep          = $7,
         rua          = $8,
         bairro       = $9,
         numero_pessoa_endereco = $10,
         numero_telefone        = $11,
         filiacao_1             = $12,
         filiacao_2             = $13,
         responsavel            = $14,
         deficiencia            = $15,
         latitude               = $16,
         longitude              = $17,
         geom                   = CASE
                                    WHEN $16 IS NOT NULL AND $17 IS NOT NULL
                                    THEN ST_SetSRID(ST_MakePoint($17,$16),4326)
                                    ELSE NULL
                                  END,
         updated_at             = NOW()
       WHERE id = $18`,
      [
        id_matricula || null,
        pessoa_nome || null,
        escola_id || null,
        turma || null,
        turno || null,
        cpf || null,
        cep || null,
        rua || null,
        bairro || null,
        numero_pessoa_endereco || null,
        numero_telefone || null,
        filiacao_1 || null,
        filiacao_2 || null,
        responsavel || null,
        defArray,
        latitude || null,
        longitude || null,
        req.params.id
      ]
    );

    return res.json({ success: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false });
  }
});


// ---------- helpers de saneamento -------------------------------------
const toText = v => (v === "" || v === undefined ? null : v);
const toInt = v => (v === "" || v === undefined ? null : parseInt(v, 10));
const toFloat = v => (v === "" || v === undefined ? null : parseFloat(v));

app.put("/api/alunos-ativos/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      id_matricula,
      escola_id,
      ano,
      modalidade,
      formato_letivo,
      turma,
      pessoa_nome,
      cpf,
      transporte_escolar_poder_publico,
      cep,
      bairro,
      numero_pessoa_endereco,
      filiacao_1,
      numero_telefone,
      filiacao_2,
      responsavel,
      deficiencia,
      longitude,
      latitude,
      rua
    } = req.body;

    /* deficiencia pode vir string JSON ou array */
    const defArray =
      typeof deficiencia === "string" && deficiencia.trim()
        ? JSON.parse(deficiencia)
        : Array.isArray(deficiencia)
          ? deficiencia
          : null;

    await pool.query(
      `UPDATE alunos_ativos SET
         id_matricula                    = COALESCE($1 , id_matricula),
         escola_id                       = COALESCE($2 , escola_id),
         ano                             = COALESCE($3 , ano),
         modalidade                      = COALESCE($4 , modalidade),
         formato_letivo                  = COALESCE($5 , formato_letivo),
         turma                           = COALESCE($6 , turma),
         pessoa_nome                     = COALESCE($7 , pessoa_nome),
         cpf                             = COALESCE($8 , cpf),
         transporte_escolar_poder_publico= COALESCE($9 , transporte_escolar_poder_publico),
         cep                             = COALESCE($10, cep),
         bairro                          = COALESCE($11, bairro),
         numero_pessoa_endereco          = COALESCE($12, numero_pessoa_endereco),
         filiacao_1                      = COALESCE($13, filiacao_1),
         numero_telefone                 = COALESCE($14, numero_telefone),
         filiacao_2                      = COALESCE($15, filiacao_2),
         responsavel                     = COALESCE($16, responsavel),
         deficiencia                     = COALESCE($17, deficiencia),
         longitude                       = COALESCE($18, longitude),
         latitude                        = COALESCE($19, latitude),
         rua                             = COALESCE($20, rua),
         geom = CASE
                   WHEN $18 IS NOT NULL AND $19 IS NOT NULL
                   THEN ST_SetSRID(ST_MakePoint($18,$19),4326)
                   ELSE geom
                 END,
         updated_at = NOW()
       WHERE id = $21`,
      [
        toText(id_matricula),
        toInt(escola_id),
        toInt(ano),
        toText(modalidade),
        toText(formato_letivo),
        toText(turma),
        toText(pessoa_nome),
        toText(cpf),
        toText(transporte_escolar_poder_publico),
        toText(cep),
        toText(bairro),
        toText(numero_pessoa_endereco),
        toText(filiacao_1),
        toText(numero_telefone),
        toText(filiacao_2),
        toText(responsavel),
        defArray,                  // já é array ou null
        toFloat(longitude),
        toFloat(latitude),
        toText(rua),
        id
      ]
    );

    return res.json({ success: true });
  } catch (e) {
    console.error("Erro ao atualizar aluno:", e);
    return res.status(500).json({ success: false, message: "Erro interno." });
  }
});


function getDistanceFromLatLngInKm(lat1, lng1, lat2, lng2) {
  const R = 6371; // Raio da terra em km
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(value) {
  return value * Math.PI / 180;
}

app.get("/api/veiculos-simples", async (req, res) => {
  try {
    const result = await pool.query("SELECT id, placa FROM frota ORDER BY id ASC");
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/frota", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM frota ORDER BY id ASC");
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/frota/localizacao/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const dev = await pool.query("SELECT * FROM gps_devices WHERE veiculo_id=$1 LIMIT 1", [id]);
    if (!dev.rows.length) return res.json({ latitude: 0, longitude: 0 });
    const deviceId = dev.rows[0].id;
    const pos = await pool.query("SELECT latitude, longitude FROM gps_positions WHERE device_id=$1 ORDER BY id DESC LIMIT 1", [deviceId]);
    if (!pos.rows.length) return res.json({ latitude: 0, longitude: 0 });
    res.json({ latitude: pos.rows[0].latitude, longitude: pos.rows[0].longitude });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/admin/devices", async (req, res) => {
  try {
    const devices = await pool.query("SELECT gps_devices.*, frota.placa AS veiculo_placa FROM gps_devices LEFT JOIN frota ON gps_devices.veiculo_id=frota.id ORDER BY gps_devices.id ASC");
    const list = [];
    for (const d of devices.rows) {
      list.push({
        id: d.id,
        modelo: d.modelo,
        imei: d.imei,
        iccid: d.iccid,
        telefone: d.telefone,
        observacao: d.observacao,
        veiculo: d.veiculo_id ? { id: d.veiculo_id, placa: d.veiculo_placa } : null
      });
    }
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/admin/devices", async (req, res) => {
  try {
    const { modelo, imei, iccid, telefone, veiculo_id, observacao } = req.body;
    const q = `INSERT INTO gps_devices (modelo, imei, iccid, telefone, veiculo_id, observacao)
               VALUES($1,$2,$3,$4,$5,$6) RETURNING *`;
    const result = await pool.query(q, [modelo, imei, iccid, telefone, veiculo_id || null, observacao || ""]);
    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/admin/devices/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query("DELETE FROM gps_devices WHERE id=$1", [id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/gps-positions/:deviceId", async (req, res) => {
  try {
    const { deviceId } = req.params;
    const positions = await pool.query("SELECT * FROM gps_positions WHERE device_id=$1 ORDER BY id DESC LIMIT 200", [deviceId]);
    res.json(positions.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/gps-positions/route/:deviceId", async (req, res) => {
  try {
    const { deviceId } = req.params;
    const positions = await pool.query("SELECT * FROM gps_positions WHERE device_id=$1 AND created_at >= NOW() - INTERVAL '2 minutes' ORDER BY id ASC", [deviceId]);
    res.json(positions.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const server = net.createServer(socket => {
  socket.on("data", async data => {
    const buf = Buffer.from(data);
    if (buf.length < 10) return;
    if (buf[0] === 0x78 && buf[1] === 0x78) {
      const protocolNumber = buf[3];
      if (protocolNumber === 0x01) {
        const imeiHex = buf.slice(4, 12);
        let imeiStr = "";
        for (let i = 0; i < imeiHex.length; i++) {
          imeiStr += ("0" + imeiHex[i].toString(16)).slice(-2);
        }
        imeiStr = parseImei(imeiStr);
        const serial = buf.readUInt16BE(12);
        const resp = Buffer.from([0x78, 0x78, 0x05, 0x01, buf[12], buf[13], 0x00, 0x00, 0x0D, 0x0A]);
        const crcVal = crcITU(resp.slice(2, 6));
        resp[6] = (crcVal >> 8) & 0xff;
        resp[7] = crcVal & 0xff;
        socket.write(resp);
      }
      if (protocolNumber === 0x12 || protocolNumber === 0x16) {
        const dateTime = buf.slice(4, 10);
        const qtySat = buf[10];
        const latRaw = buf.readUInt32BE(11);
        const lngRaw = buf.readUInt32BE(15);
        const speed = buf[19];
        const courseStatus = buf.readUInt16BE(20);
        const latitude = (latRaw / 30000.0) / 60.0;
        const longitude = (lngRaw / 30000.0) / 60.0;
        const deviceSerial = buf.readUInt16BE(buf.length - 6);
        let statusStr = "";
        const deviceImei = await findImeiForSocket(socket);
        if (!deviceImei) return;
        const dev = await pool.query("SELECT * FROM gps_devices WHERE imei=$1 LIMIT 1", [deviceImei]);
        if (!dev.rows.length) return;
        const deviceId = dev.rows[0].id;
        await pool.query("INSERT INTO gps_positions (device_id, latitude, longitude, speed, course, status) VALUES($1,$2,$3,$4,$5,$6)", [
          deviceId, latitude, longitude, speed, courseStatus & 0x03FF, statusStr
        ]);
        const resp = Buffer.from([0x78, 0x78, 0x05, protocolNumber, buf[buf.length - 6], buf[buf.length - 5], 0x00, 0x00, 0x0D, 0x0A]);
        const crcVal = crcITU(resp.slice(2, 6));
        resp[6] = (crcVal >> 8) & 0xff;
        resp[7] = crcVal & 0xff;
        socket.write(resp);
      }
    }
  });
  socket.on("error", () => { });
});

function parseImei(hexStr) {
  let res = "";
  for (let i = 0; i < hexStr.length; i += 2) {
    let seg = parseInt(hexStr.slice(i, i + 2), 16).toString();
    if (seg.length < 2) seg = "0" + seg;
    res += seg;
  }
  return res.replace(/^0+/, "");
}

function crcITU(buf) {
  let fcs = 0xffff;
  for (let i = 0; i < buf.length; i++) {
    fcs ^= buf[i];
    for (let j = 0; j < 8; j++) {
      if (fcs & 1) {
        fcs = (fcs >> 1) ^ 0x8408;
      } else {
        fcs >>= 1;
      }
    }
  }
  fcs = ~fcs & 0xffff;
  return fcs;
}

const imeiMap = new Map();

function findImeiForSocket(socket) {
  return new Promise(resolve => {
    for (const [k, v] of imeiMap.entries()) {
      if (v === socket) {
        return resolve(k);
      }
    }
    resolve(null);
  });
}

// capacidade total e já ocupada
app.get("/api/rotas/:id/capacidade", async (req, res) => {
  const { id } = req.params
  const cap = await pool.query(`
    SELECT COALESCE(SUM(f.capacidade),0) AS total
    FROM frota_rotas fr
    JOIN frota f ON f.id = fr.frota_id
    WHERE fr.rota_id = $1
  `, [id])
  const usados = await pool.query(`
    SELECT COUNT(*) FROM alunos_rotas WHERE rota_id = $1
  `, [id])
  res.json({ total: cap.rows[0].total, usados: +usados.rows[0].count })
})

// alunos elegíveis (mesmo ponto e escola, não vinculados ainda)
app.get("/api/rotas/:id/alunos-elegiveis", async (req, res) => {
  const { id } = req.params
  const data = await pool.query(`
    SELECT a.id, a.pessoa_nome AS nome, a.turma, a.escola_id
    FROM alunos_ativos a
    JOIN alunos_pontos ap   ON ap.aluno_id = a.id
    JOIN rotas_pontos  rp   ON rp.ponto_id = ap.ponto_id AND rp.rota_id = $1
    JOIN rotas_escolas re   ON re.escola_id = a.escola_id AND re.rota_id = $1
    LEFT JOIN alunos_rotas ar ON ar.aluno_id = a.id
    WHERE ar.aluno_id IS NULL
  `, [id])
  res.json(data.rows)
})

// vincular alunos a uma rota e garantir que os pontos entrem na rota
app.post("/api/rotas/:id/alunos", async (req, res) => {
  const { id: rotaId } = req.params;
  const { alunos } = req.body;     // array de IDs (int)

  if (!Array.isArray(alunos) || !alunos.length)
    return res.status(400).json({ success: false, message: "Lista vazia" });

  /* 1. checa lotação da frota */
  const caps = await pool.query(`
      SELECT COALESCE(SUM(f.capacidade),0) AS total
        FROM frota_rotas fr
        JOIN frota f ON f.id = fr.frota_id
       WHERE fr.rota_id = $1
  `, [rotaId]);
  const total = +caps.rows[0].total;
  const usados = +(await pool.query(
    `SELECT COUNT(*) FROM alunos_rotas WHERE rota_id = $1`, [rotaId]
  )).rows[0].count;

  if (usados + alunos.length > total)
    return res.status(409).json({ success: false, message: "Lotação excedida" });

  /* 2. transação completa */
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    /* 2a. insere alunos na tabela pivô */
    const insAluno = `
      INSERT INTO alunos_rotas (aluno_id, rota_id)
      VALUES ($1,$2)
      ON CONFLICT DO NOTHING`;
    for (const aid of alunos) {
      await client.query(insAluno, [aid, rotaId]);
    }

    /* 2b. coleta os pontos desses alunos */
    const { rows: pontos } = await client.query(`
      SELECT DISTINCT ponto_id
        FROM alunos_pontos
       WHERE aluno_id = ANY($1::int[])
         AND ponto_id IS NOT NULL
    `, [alunos]);
    const pontoIds = pontos.map(r => r.ponto_id);

    if (pontoIds.length) {
      /* 2c. garante link em rotas_pontos */
      await client.query(`
        INSERT INTO rotas_pontos (rota_id, ponto_id)
        SELECT $1, UNNEST($2::int[])
        ON CONFLICT DO NOTHING
      `, [rotaId, pontoIds]);

      /* 2d. atualiza array paradas_ids da linha */
      await client.query(`
        UPDATE linhas_rotas
           SET paradas_ids = (
                 SELECT ARRAY(
                   SELECT DISTINCT unnest(paradas_ids || $2::int[])
                 )
               )
         WHERE id = $1
      `, [rotaId, pontoIds]);
    }

    await client.query("COMMIT");
    res.json({ success: true });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("erro vincular alunos:", e);
    res.status(500).json({ success: false, message: e.detail || "Erro interno" });
  } finally {
    client.release();
  }
});


// ====================================================================================
// MOTORISTAS ADMINISTRATIVOS
// ====================================================================================

// Middleware de autenticação JWT
function verificarTokenJWT(req, res, next) {
  const authHeader = req.headers['authorization'] || req.headers['Authorization'];
  if (!authHeader) {
    return res.status(401).json({ success: false, message: "Token não informado" });
  }

  // Formato esperado: "Bearer <token>"
  const partes = authHeader.split(' ');
  if (partes.length !== 2 || partes[0] !== 'Bearer') {
    return res.status(401).json({ success: false, message: "Token malformado" });
  }
  const token = partes[1];

  try {
    const secretKey = process.env.JWT_SECRET || 'chave-secreta';
    const decodificado = jwt.verify(token, secretKey);  // lança erro se inválido
    req.user = decodificado;  // podemos anexar os dados decodificados do usuário no request
    return next();  // token ok, prossegue para a rota
  } catch (err) {
    return res.status(401).json({ success: false, message: "Token inválido ou expirado" });
  }
}

// Rota: Verificar se CPF existe e se tem senha definida
app.post('/api/admin-motoristas/verificar-cpf', async (req, res) => {
  try {
    const cpfRaw = req.body.cpf || '';
    const cpf = cpfRaw.replace(/\D/g, '');
    if (!cpf) {
      return res.status(400).json({ success: false, message: "CPF é obrigatório" });
    }

    const query = `
      SELECT id, senha
      FROM motoristas_administrativos
      WHERE regexp_replace(cpf, '[^0-9]', '', 'g') = $1
      LIMIT 1
    `;
    const result = await pool.query(query, [cpf]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Motorista não encontrado" });
    }

    const { senha } = result.rows[0];
    if (!senha) {
      return res.status(200).json({
        success: true,
        firstAccess: true,
        message: "Senha não cadastrada (primeiro acesso)"
      });
    } else {
      return res.status(200).json({
        success: true,
        firstAccess: false,
        message: "Senha já cadastrada"
      });
    }
  } catch (error) {
    console.error("Erro ao verificar CPF:", error);
    return res.status(500).json({ success: false, message: "Erro interno do servidor" });
  }
});

app.post('/api/admin-motoristas/primeiro-acesso', async (req, res) => {
  try {
    const cpfRaw = req.body.cpf || '';
    const cpf = cpfRaw.replace(/\D/g, '');
    const { senha } = req.body;
    if (!cpf || !senha) {
      return res.status(400).json({ success: false, message: "CPF e senha são obrigatórios" });
    }

    const check = `
      SELECT id
      FROM motoristas_administrativos
      WHERE regexp_replace(cpf, '[^0-9]', '', 'g') = $1
      LIMIT 1
    `;
    const chk = await pool.query(check, [cpf]);
    if (chk.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Motorista não encontrado" });
    }

    const hashed = await bcrypt.hash(senha, 10);
    const update = `
      UPDATE motoristas_administrativos
         SET senha = $1
       WHERE regexp_replace(cpf, '[^0-9]', '', 'g') = $2
    `;
    await pool.query(update, [hashed, cpf]);

    return res.status(200).json({
      success: true,
      message: "Senha cadastrada com sucesso. Faça login para continuar."
    });
  } catch (error) {
    console.error("Erro no primeiro acesso:", error);
    return res.status(500).json({ success: false, message: "Erro interno do servidor" });
  }
});

app.post('/api/admin-motoristas/login', async (req, res) => {
  try {
    const cpfRaw = req.body.cpf || '';
    const cpf = cpfRaw.replace(/\D/g, '');
    const { senha } = req.body;
    if (!cpf || !senha) {
      return res.status(400).json({ success: false, message: "CPF e senha são obrigatórios" });
    }

    const query = `
      SELECT id, nome_motorista, email, senha
      FROM motoristas_administrativos
      WHERE regexp_replace(cpf, '[^0-9]', '', 'g') = $1
      LIMIT 1
    `;
    const result = await pool.query(query, [cpf]);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "CPF não cadastrado" });
    }

    const motorista = result.rows[0];
    if (!motorista.senha) {
      return res.status(403).json({
        success: false,
        firstAccess: true,
        message: "Senha não definida. Cadastre a senha no primeiro acesso."
      });
    }

    const match = await bcrypt.compare(senha, motorista.senha);
    if (!match) {
      return res.status(401).json({ success: false, message: "Senha incorreta" });
    }

    const payload = {
      id: motorista.id,
      nome: motorista.nome_motorista,
      email: motorista.email
    };
    const token = jwt.sign(payload, process.env.JWT_SECRET || 'chave-secreta', { expiresIn: '8h' });

    return res.status(200).json({
      success: true,
      message: "Login realizado com sucesso",
      token,
      motorista: {
        id: motorista.id,
        nome: motorista.nome_motorista,
        email: motorista.email
      }
    });
  } catch (error) {
    console.error("Erro no login:", error);
    return res.status(500).json({ success: false, message: "Erro interno do servidor" });
  }
});

// Rota protegida de exemplo: detalhes do perfil do motorista administrativo logado

// [GET] Perfil do motorista administrativo com dados do veículo
app.get('/api/admin-motoristas/perfil', verificarTokenJWT, async (req, res) => {
  try {
    const id = req.user.id;

    // 1) Busca dados do motorista
    const motoristaQ = `
      SELECT 
        m.id,
        m.nome_motorista,
        m.cpf,
        m.rg,
        to_char(m.data_nascimento, 'YYYY-MM-DD')       AS data_nascimento,
        m.telefone,
        m.email,
        m.endereco,
        m.cidade,
        m.estado,
        m.cep,
        m.numero_cnh,
        to_char(m.validade_cnh, 'YYYY-MM-DD')          AS validade_cnh,
        m.cnh_pdf,
        m.carro_id
      FROM motoristas_administrativos m
      WHERE m.id = $1
      LIMIT 1
    `;
    const motoRes = await pool.query(motoristaQ, [id]);
    if (motoRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Motorista não encontrado' });
    }
    const motorista = motoRes.rows[0];

    // 2) Busca veículo associado (usando carro_id), agora com alias tipo_veiculo → modelo
    let carro = null;
    if (motorista.carro_id) {
      const carroQ = `
        SELECT
          id,
          tipo_veiculo   AS modelo,
          placa,
          documento      AS documento_url
        FROM frota_administrativa
        WHERE id = $1
        LIMIT 1
      `;
      const carroRes = await pool.query(carroQ, [motorista.carro_id]);
      if (carroRes.rows.length > 0) {
        carro = carroRes.rows[0];
      }
    }

    return res.json({
      success: true,
      motorista,
      carro  // null se não houver veículo
    });
  } catch (error) {
    console.error('Erro ao obter perfil:', error);
    return res.status(500).json({ success: false, message: 'Erro interno do servidor' });
  }
});


// =============================================================================
// FROTA ADMINISTRATIVA
// =============================================================================

// [GET] Listar todos os veículos administrativos
app.get("/api/frota_administrativa", async (req, res) => {
  try {
    const query = `
      SELECT 
        v.id,
        v.placa,
        v.tipo_veiculo,
        v.capacidade,
        v.ano,
        v.cor_veiculo,
        v.marca,
        v.ar_condicionado,
        v.rastreador,
        v.freios_abs,
        v.airbags,
        v.trava_eletrica,
        v.alarme,
        v.vidros_eletricos,
        v.tomada_12v,
        v.fornecedor_id,
        v.documento,
        f.nome_fornecedor AS fornecedor_nome
      FROM frota_administrativa v
      LEFT JOIN fornecedores_administrativos f ON f.id = v.fornecedor_id
      ORDER BY v.id;
    `;
    const result = await pool.query(query);
    return res.json(result.rows);
  } catch (error) {
    console.error("Erro ao listar frota_administrativa:", error);
    return res.status(500).json({ success: false, message: "Erro interno ao listar veículos." });
  }
});

// [POST] Cadastrar novo veículo administrativo (com upload de documento opcional)
app.post("/api/frota_administrativa/cadastrar", uploadFrota.single("documento"), async (req, res) => {
  try {
    const {
      placa,
      tipo_veiculo,
      capacidade,
      cor_veiculo,
      ano,
      marca,
      ar_condicionado,
      rastreador,
      freios_abs,
      airbags,
      trava_eletrica,
      alarme,
      vidros_eletricos,
      tomada_12v,
      fornecedor_id
    } = req.body;

    if (!placa || !tipo_veiculo || !capacidade || !fornecedor_id) {
      return res.status(400).json({ success: false, message: "Campos obrigatórios não fornecidos." });
    }

    let docPath = null;
    if (req.file?.filename) {
      docPath = "/uploads/" + req.file.filename;
    }

    const insertQuery = `
      INSERT INTO frota_administrativa (
        placa, tipo_veiculo, capacidade, cor_veiculo,
        ano, marca,
        ar_condicionado, rastreador, freios_abs, airbags,
        trava_eletrica, alarme, vidros_eletricos, tomada_12v,
        fornecedor_id, documento
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6,
        $7, $8, $9, $10,
        $11, $12, $13, $14,
        $15, $16
      ) RETURNING id;
    `;
    const values = [
      placa,
      tipo_veiculo,
      parseInt(capacidade, 10),
      cor_veiculo || null,
      ano ? parseInt(ano, 10) : null,
      marca || null,
      ar_condicionado === "Sim",
      rastreador === "Sim",
      freios_abs === "Sim",
      airbags === "Sim",
      trava_eletrica === "Sim",
      alarme === "Sim",
      vidros_eletricos === "Sim",
      tomada_12v === "Sim",
      parseInt(fornecedor_id, 10),
      docPath
    ];
    await pool.query(insertQuery, values);
    return res.json({ success: true, message: "Veículo cadastrado com sucesso!" });
  } catch (error) {
    console.error("Erro ao cadastrar veículo administrativo:", error);
    return res.status(500).json({ success: false, message: "Erro interno ao cadastrar veículo." });
  }
});


app.get("/api/frota_administrativa/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const query = `
      SELECT 
        id, placa, tipo_veiculo, capacidade, ano,
        cor_veiculo, marca,
        ar_condicionado, rastreador, freios_abs, airbags,
        trava_eletrica, alarme, vidros_eletricos, tomada_12v,
        fornecedor_id, documento
      FROM frota_administrativa
      WHERE id = $1
      LIMIT 1;
    `;
    const result = await pool.query(query, [id]);
    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: "Veículo não encontrado." });
    }
    return res.json(result.rows[0]);
  } catch (error) {
    console.error("Erro ao buscar veículo administrativo:", error);
    return res.status(500).json({ success: false, message: "Erro interno ao buscar veículo." });
  }
});

// [PUT] Editar veículo administrativo existente
app.put("/api/frota_administrativa/:id", uploadFrota.single("documento"), async (req, res) => {
  try {
    const { id } = req.params;
    const {
      placa,
      tipo_veiculo,
      capacidade,
      cor_veiculo,
      ano,
      marca,
      ar_condicionado,
      rastreador,
      freios_abs,
      airbags,
      trava_eletrica,
      alarme,
      vidros_eletricos,
      tomada_12v
    } = req.body;

    const check = await pool.query(`SELECT id FROM frota_administrativa WHERE id = $1`, [id]);
    if (!check.rows.length) {
      return res.status(404).json({ success: false, message: "Veículo não encontrado." });
    }

    let docPath = null;
    if (req.file?.filename) {
      docPath = "/uploads/" + req.file.filename;
    }

    const fields = [];
    const vals = [];
    let idx = 1;
    if (placa != null) { fields.push(`placa=$${idx++}`); vals.push(placa); }
    if (tipo_veiculo != null) { fields.push(`tipo_veiculo=$${idx++}`); vals.push(tipo_veiculo); }
    if (capacidade != null) { fields.push(`capacidade=$${idx++}`); vals.push(parseInt(capacidade, 10)); }
    if (cor_veiculo != null) { fields.push(`cor_veiculo=$${idx++}`); vals.push(cor_veiculo); }
    if (ano != null) { fields.push(`ano=$${idx++}`); vals.push(parseInt(ano, 10)); }
    if (marca != null) { fields.push(`marca=$${idx++}`); vals.push(marca); }
    fields.push(`ar_condicionado=$${idx++}`); vals.push(ar_condicionado === "Sim");
    fields.push(`rastreador=$${idx++}`); vals.push(rastreador === "Sim");
    fields.push(`freios_abs=$${idx++}`); vals.push(freios_abs === "Sim");
    fields.push(`airbags=$${idx++}`); vals.push(airbags === "Sim");
    fields.push(`trava_eletrica=$${idx++}`); vals.push(trava_eletrica === "Sim");
    fields.push(`alarme=$${idx++}`); vals.push(alarme === "Sim");
    fields.push(`vidros_eletricos=$${idx++}`); vals.push(vidros_eletricos === "Sim");
    fields.push(`tomada_12v=$${idx++}`); vals.push(tomada_12v === "Sim");
    if (docPath) { fields.push(`documento=$${idx++}`); vals.push(docPath); }

    const updateQ = `
      UPDATE frota_administrativa
      SET ${fields.join(", ")}
      WHERE id = $${idx}
      RETURNING id;
    `;
    vals.push(id);
    await pool.query(updateQ, vals);
    return res.json({ success: true, message: "Veículo atualizado com sucesso!" });
  } catch (error) {
    console.error("Erro ao editar veículo administrativo:", error);
    return res.status(500).json({ success: false, message: "Erro interno ao atualizar veículo." });
  }
});

// [DELETE] Excluir veículo administrativo
app.delete("/api/frota_administrativa/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query("DELETE FROM frota_administrativa WHERE id = $1 RETURNING id", [id]);
    if (!result.rowCount) {
      return res.status(404).json({ success: false, message: "Veículo não encontrado." });
    }
    return res.json({ success: true, message: "Veículo excluído com sucesso!" });
  } catch (error) {
    console.error("Erro ao excluir veículo administrativo:", error);
    return res.status(500).json({ success: false, message: "Erro interno ao excluir veículo." });
  }
});

app.get('/api/geo/directions', async (req, res) => {
  try {
    const key = process.env.GOOGLE_MAPS_KEY;
    if (!key) {
      console.error('Directions proxy: GOOGLE_MAPS_KEY ausente');
      return res.status(500).json({ status: 'REQUEST_DENIED', error_message: 'Missing GOOGLE_MAPS_KEY' });
    }

    const { origin, destination, waypoints } = req.query;
    if (!origin || !destination) {
      return res.status(400).json({ status: 'INVALID_REQUEST', error_message: 'origin and destination are required' });
    }

    // Monta URL do Google mantendo os mesmos parâmetros do app
    const params = new URLSearchParams({
      origin,
      destination,
      mode: 'driving',
      departure_time: 'now',
      traffic_model: 'best_guess',
      language: 'pt-BR',
      region: 'br',
      key
    });
    if (waypoints) params.set('waypoints', waypoints); // ex: "optimize:true|lat,lng|lat,lng"

    const url = `https://maps.googleapis.com/maps/api/directions/json?${params.toString()}`;
    console.log('Directions proxy ->', url);

    const g = await fetch(url, { method: 'GET' });
    const text = await g.text();

    // CORS para web (se necessário)
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Content-Type', 'application/json');

    // Repassa exatamente o que o Google respondeu (inclui status, legs, overview_polyline, etc.)
    res.status(g.status).send(text);
  } catch (err) {
    console.error('Erro no proxy Directions:', err);
    res.status(500).json({ status: 'UNKNOWN_ERROR', error_message: 'Proxy failure' });
  }
});

// GET /api/admin-motoristas/checklist-itens
app.get('/api/admin-motoristas/checklist-itens', verificarTokenJWT, async (req, res) => {
  try {
    const motoristaId = req.user.id;

    // 🚗 pega veículo do motorista na frota_administrativa
    // Se na sua tabela de motoristas a coluna se chamar 'frota_id' (e não 'carro_id'),
    // troque m.carro_id por m.frota_id na linha do JOIN, ok?
    const veic = await pool.query(`
      SELECT f.id AS carro_id,
             f.tipo_veiculo,
             f.marca,
             f.placa
      FROM motoristas_administrativos m
      JOIN frota_administrativa f ON f.id = m.carro_id
      WHERE m.id = $1
      LIMIT 1
    `, [motoristaId]);

    if (!veic.rowCount) {
      return res.status(400).json({ message: 'Motorista sem veículo associado.' });
    }

    const { carro_id, tipo_veiculo, marca, placa } = veic.rows[0];

    // 🔎 Filtra itens pelo tipo do veículo (ou "todos")
    // Ajuste a coluna de tipagem em 'checklist_itens' caso seja diferente.
    // Aqui estou assumindo que existe 'checklist_itens.tipo' com valores como
    // 'caminhonete', 'caminhao', 'sedan', 'hatch', 'van', 'microonibus', 'onibus' ou 'todos'.
    const itens = await pool.query(`
      SELECT id, descricao
      FROM checklist_itens
      WHERE (ativo IS TRUE OR ativo IS NULL)
        AND (
          LOWER(tipo) = LOWER($1)
          OR LOWER(tipo) = 'todos'
        )
      ORDER BY COALESCE(ordem, 9999), id
    `, [tipo_veiculo]);

    return res.json({
      tipoVeiculo: tipo_veiculo,
      veiculoModelo: marca,
      placa,
      itens: itens.rows,
    });
  } catch (err) {
    console.error('Erro ao buscar checklist-itens:', err);
    return res.status(500).json({ message: 'Erro ao buscar itens' });
  }
});


// POST → grava checklist (único handler oficial)
app.post('/api/admin-motoristas/checklist', verificarTokenJWT, async (req, res) => {
  const client = await pool.connect();
  try {
    const zone = 'America/Belem'; // ajuste se usa isso acima
    const agora = DateTime.now().setZone(zone);
    const allowedDays = [1]; // 1 = segunda (ou [1,2,3,4,5] p/ seg-sex)

    const motoristaId = req.user.id;

    // 1) Dia permitido?
    if (!allowedDays.includes(agora.weekday)) {
      return res.status(403).json({ message: 'Checklist liberado apenas na segunda-feira.' });
    }

    // 2) Motorista tem veículo?
    const carroRes = await client.query(
      'SELECT carro_id FROM motoristas_administrativos WHERE id = $1',
      [motoristaId]
    );
    const carroId = carroRes.rows[0]?.carro_id;
    if (!carroId) {
      return res.status(400).json({ message: 'Motorista sem veículo associado.' });
    }

    // 3) Já enviou hoje?
    const jaRes = await client.query(
      `SELECT 1
         FROM checklist_envios
        WHERE motorista_id = $1
          AND enviado_em::date = $2
        LIMIT 1`,
      [motoristaId, agora.toISODate()]
    );
    if (jaRes.rowCount) {
      return res.status(409).json({ message: 'Checklist já enviado hoje.' });
    }

    // 4) Corpo da requisição
    const respostas = Array.isArray(req.body.respostas) ? req.body.respostas : [];
    const observacoesExtras = (req.body.observacoesExtras ?? req.body.observacoes_extras ?? null) || null;

    await client.query('BEGIN');

    // 5) Cria envio
    const envioRes = await client.query(
      `INSERT INTO checklist_envios (motorista_id, carro_id, enviado_em)
       VALUES ($1,$2, NOW())
       RETURNING id`,
      [motoristaId, carroId]
    );
    const envioId = envioRes.rows[0].id;

    // 6) Insere respostas vinculadas ao envio
    if (respostas.length > 0) {
      const values = [];
      const params = [];
      let p = 1;
      for (const r of respostas) {
        values.push(`($${p++}, $${p++}, $${p++}, $${p++})`);
        params.push(envioId, r.item_id, !!r.ok, r.observacao || null);
      }
      await client.query(
        `INSERT INTO checklist_respostas (envio_id, item_id, ok, observacao)
         VALUES ${values.join(',')}`,
        params
      );
    }

    // 7) Observações extras (se tiver tabela própria)
    if (observacoesExtras) {
      await client.query(
        `INSERT INTO checklist_extras (envio_id, motorista_id, carro_id, observacoes)
         VALUES ($1,$2,$3,$4)`,
        [envioId, motoristaId, carroId, observacoesExtras]
      );
    }

    await client.query('COMMIT');
    return res.json({ success: true, envioId });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erro ao enviar checklist:', err);
    return res.status(500).json({ message: 'Erro interno' });
  } finally {
    client.release();
  }
});


// [GET] Listar todos os checklists
app.get("/api/checklists", async (req, res) => {
  try {
    const { motorista_id, carro_id, fornecedor_id, data_inicio, data_fim } = req.query;

    let sql = `
      SELECT
        ce.id,
        ce.created_at    AS data_envio,
        m.nome_motorista,
        v.placa,
        v.tipo_veiculo
      FROM checklist_extras ce
      JOIN motoristas_administrativos m ON m.id = ce.motorista_id
      JOIN frota_administrativa   v ON v.id = ce.carro_id
    `;
    const params = [];
    const conds = [];

    if (motorista_id) {
      params.push(motorista_id);
      conds.push(`ce.motorista_id = $${params.length}`);
    }
    if (carro_id) {
      params.push(carro_id);
      conds.push(`ce.carro_id = $${params.length}`);
    }
    if (data_inicio) {
      params.push(data_inicio);
      conds.push(`ce.created_at >= $${params.length}`);
    }
    if (data_fim) {
      params.push(data_fim);
      conds.push(`ce.created_at <= $${params.length}`);
    }
    if (fornecedor_id) {
      params.push(fornecedor_id, fornecedor_id);
      conds.push(`(m.fornecedor_id = $${params.length - 1} OR v.fornecedor_id = $${params.length})`);
    }

    if (conds.length) {
      sql += " WHERE " + conds.join(" AND ");
    }
    sql += " ORDER BY ce.created_at DESC;";

    const { rows } = await pool.query(sql, params);
    return res.json(rows);
  } catch (error) {
    console.error("Erro ao listar checklists:", error);
    return res.status(500).json({ success: false, message: "Erro interno do servidor." });
  }
});


// [GET] Detalhes de um checklist por ID
app.get("/api/checklists/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // 1) buscar extras e metadados
    const infoQ = `
      SELECT
        ce.id,
        ce.created_at        AS data_envio,
        ce.motorista_id,
        ce.carro_id,
        ce.observacoes,
        m.nome_motorista,
        v.placa,
        v.tipo_veiculo
      FROM checklist_extras ce
      JOIN motoristas_administrativos m ON m.id = ce.motorista_id
      JOIN frota_administrativa   v ON v.id = ce.carro_id
      WHERE ce.id = $1
      LIMIT 1
    `;
    const infoR = await pool.query(infoQ, [id]);
    if (infoR.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Checklist não encontrado." });
    }
    const chk = infoR.rows[0];

    // 2) buscar itens/respostas vinculados (mesma combinação de motorista_id, carro_id e timestamp)
    const itensQ = `
      SELECT
        i.descricao  AS nome_item,
        r.ok         AS resposta
      FROM checklist_respostas r
      JOIN checklist_itens      i ON i.id = r.item_id
      WHERE
        r.motorista_id = $1
        AND r.carro_id     = $2
        AND r.created_at   = $3
      ORDER BY r.id
    `;
    const itensR = await pool.query(itensQ, [
      chk.motorista_id,
      chk.carro_id,
      chk.data_envio
    ]);

    chk.itens = itensR.rows;
    return res.json({ success: true, data: chk });
  } catch (error) {
    console.error("Erro ao buscar checklist:", error);
    return res.status(500).json({ success: false, message: "Erro interno do servidor." });
  }
});

// [PUT] Atualizar as observações de um checklist
app.put("/api/checklists/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { observacoes } = req.body;
    const updateQuery = "UPDATE checklist_extras SET observacoes = $1 WHERE id = $2;";
    const result = await pool.query(updateQuery, [observacoes || "", id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Checklist não encontrado." });
    }
    return res.json({ success: true, message: "Observações atualizadas com sucesso." });
  } catch (error) {
    console.error("Erro ao atualizar checklist:", error);
    return res.status(500).json({ success: false, message: "Erro interno do servidor." });
  }
});

// [DELETE] Remover um checklist
app.delete("/api/checklists/:id", async (req, res) => {
  try {
    const { id } = req.params;
    // Apagar respostas associadas e depois o checklist em si
    await pool.query("DELETE FROM checklist_respostas WHERE checklist_id = $1;", [id]);
    const result = await pool.query("DELETE FROM checklist_extras WHERE id = $1;", [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Checklist não encontrado." });
    }
    return res.json({ success: true, message: "Checklist removido com sucesso." });
  } catch (error) {
    console.error("Erro ao remover checklist:", error);
    return res.status(500).json({ success: false, message: "Erro interno do servidor." });
  }
});

app.get('/api/viagens', async (req, res) => {
  try {
    const q = `
      SELECT v.*,
             to_char(v.data_saida, 'YYYY-MM-DD"T"HH24:MI') AS data_saida,
             to_char(v.data_retorno, 'YYYY-MM-DD"T"HH24:MI') AS data_retorno,
             m.nome_motorista AS motorista_nome
      FROM viagens v
      JOIN motoristas_administrativos m ON m.id = v.motorista_id
      ORDER BY v.data_saida DESC
    `;
    const result = await pool.query(q);
    return res.json(result.rows);
  } catch (err) {
    console.error('Erro ao listar viagens:', err);
    return res.status(500).json({ success: false, message: 'Erro interno.' });
  }
});


app.post('/api/viagens', async (req, res) => {
  try {
    const {
      motorista_id, tipo, data_saida, data_retorno,
      vai_esperar, origem, origem_lat, origem_lng,
      destino, destino_lat, destino_lng,
      pontos_intermediarios, observacoes, recorrencia
    } = req.body;

    const q = `
      INSERT INTO viagens (
        motorista_id, tipo, data_saida, data_retorno,
        vai_esperar, origem, origem_lat, origem_lng,
        destino, destino_lat, destino_lng,
        pontos_intermediarios, observacoes, recorrencia
      ) VALUES (
        $1,$2,$3,$4,
        $5,$6,$7,$8,
        $9,$10,$11,
        $12::json, $13, $14
      ) RETURNING id
    `;
    const vals = [
      motorista_id,
      tipo,
      data_saida,
      data_retorno || null,
      vai_esperar === 'on' || vai_esperar === true,
      origem,
      origem_lat || null,
      origem_lng || null,
      destino,
      destino_lat || null,
      destino_lng || null,
      pontos_intermediarios || null,
      observacoes || null,
      recorrencia || 'unica'
    ];

    const result = await pool.query(q, vals);
    return res.json({ id: result.rows[0].id });
  } catch (err) {
    console.error('Erro ao criar viagem:', err);
    return res.status(500).json({ success: false, message: 'Não foi possível agendar a viagem.' });
  }
});



// [PUT] Atualizar viagem
app.put('/api/viagens/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      motorista_id, tipo, data_saida, data_retorno,
      retorna_origem, origem, origem_lat, origem_lng,
      destino, destino_lat, destino_lng,
      pontos_intermediarios, observacoes, recorrencia
    } = req.body;

    const q = `
      UPDATE viagens SET
        motorista_id=$1, tipo=$2,
        data_saida=$3, data_retorno=$4,
        vai_esperar=$5,
        origem=$6, origem_lat=$7, origem_lng=$8,
        destino=$9, destino_lat=$10, destino_lng=$11,
        pontos_intermediarios=$12::json,
        observacoes=$13,
        recorrencia=$14,
        updated_at=NOW()
      WHERE id=$15
      RETURNING id
    `;
    const vals = [
      motorista_id,
      tipo,
      data_saida,
      data_retorno || null,
      retorna_origem === 'on' || retorna_origem === true,
      origem,
      origem_lat || null,
      origem_lng || null,
      destino,
      destino_lat || null,
      destino_lng || null,
      pontos_intermediarios || null,
      observacoes || null,
      recorrencia || 'unica',
      id
    ];

    const result = await pool.query(q, vals);
    return res.json({ id: result.rows[0].id });
  } catch (err) {
    console.error('Erro ao atualizar viagem:', err);
    return res.status(500).json({ success: false, message: 'Não foi possível atualizar a viagem.' });
  }
});

// [DELETE] Excluir viagem
app.delete('/api/viagens/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM viagens WHERE id = $1', [id]);
    return res.json({ success: true });
  } catch (err) {
    console.error('Erro ao excluir viagem:', err);
    return res.status(500).json({ success: false, message: 'Não foi possível excluir a viagem.' });
  }
});

// … suas importações iniciais, incluindo verificarTokenJWT e pool …

// [GET] Listar todas as viagens atribuídas ao motorista autenticado
app.get('/api/admin-motoristas/viagens', verificarTokenJWT, async (req, res) => {
  try {
    const motoristaId = req.user.id;
    const query = `
      SELECT
        v.id,
        v.tipo,
        v.data_saida,
        v.data_retorno,
        v.vai_esperar,
        v.origem,
        v.origem_lat,
        v.origem_lng,
        v.destino,
        v.destino_lat,
        v.destino_lng,
        v.pontos_intermediarios,
        v.observacoes,
        v.status
      FROM viagens v
      WHERE v.motorista_id = $1
      ORDER BY v.data_saida DESC;
    `;
    const result = await pool.query(query, [motoristaId]);
    return res.json(result.rows);
  } catch (error) {
    console.error('Erro ao listar viagens do motorista:', error);
    return res.status(500).json({ success: false, message: 'Erro interno ao listar viagens.' });
  }
});

// [GET] Detalhar uma viagem específica
app.get('/api/admin-motoristas/viagens/:id', verificarTokenJWT, async (req, res) => {
  try {
    const motoristaId = req.user.id;
    const viagemId = req.params.id;
    const infoQuery = `
      SELECT
        v.id,
        v.tipo,
        to_char(v.data_saida, 'YYYY-MM-DD"T"HH24:MI:SS')   AS data_saida,
        to_char(v.data_retorno, 'YYYY-MM-DD"T"HH24:MI:SS') AS data_retorno,
        json_build_object(
          'descricao', v.origem,
          'latitude',  v.origem_lat,
          'longitude', v.origem_lng
        ) AS origem,
        json_build_object(
          'descricao', v.destino,
          'latitude',  v.destino_lat,
          'longitude', v.destino_lng
        ) AS destino,
        v.pontos_intermediarios,
        v.observacoes,
        v.status
      FROM viagens v
      WHERE v.motorista_id = $1
        AND v.id = $2
      LIMIT 1;
    `;
    const infoResult = await pool.query(infoQuery, [motoristaId, viagemId]);
    if (infoResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Viagem não encontrada.' });
    }
    return res.json({ success: true, data: infoResult.rows[0] });
  } catch (error) {
    console.error('Erro ao detalhar viagem:', error);
    return res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
  }
});
// Atualizar status para "Em andamento"
app.put('/api/admin-motoristas/viagens/:id/atender', verificarTokenJWT, async (req, res) => {
  try {
    const motoristaId = req.user.id;
    const viagemId = req.params.id;
    // Atualiza status apenas se a viagem pertencer ao motorista autenticado
    const result = await pool.query(
      "UPDATE viagens SET status = 'Em andamento' WHERE id = $1 AND motorista_id = $2 RETURNING id",
      [viagemId, motoristaId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Viagem não encontrada.' });
    }
    return res.sendStatus(204); // sucesso
  } catch (error) {
    console.error('Erro ao iniciar viagem:', error);
    return res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
  }
});

// Atualizar status para "Concluída"
app.put('/api/admin-motoristas/viagens/:id/finalizar', verificarTokenJWT, async (req, res) => {
  try {
    const motoristaId = req.user.id;
    const viagemId = req.params.id;
    const result = await pool.query(
      "UPDATE viagens SET status = 'Concluída' WHERE id = $1 AND motorista_id = $2 RETURNING id",
      [viagemId, motoristaId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Viagem não encontrada.' });
    }
    return res.sendStatus(204);
  } catch (error) {
    console.error('Erro ao finalizar viagem:', error);
    return res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
  }
});

// Atualiza o campo `status` na tabela motoristas_administrativos
app.put('/api/admin-motoristas/status', verificarTokenJWT, async (req, res) => {
  try {
    const motoristaId = req.user.id;
    const { status } = req.body;             // ex: 'Em demanda' ou 'Livre'
    const result = await pool.query(
      `UPDATE motoristas_administrativos 
       SET status = $1 
       WHERE id = $2`,
      [status, motoristaId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Motorista não encontrado.' });
    }
    return res.sendStatus(204);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Erro interno do servidor.' });
  }
});


// [POST] Registrar avaliação do passageiro ao final da viagem (nota e observação)
// Grava nota e observação na tabela viagens
app.post('/api/admin-motoristas/viagens/:id/avaliar', verificarTokenJWT, async (req, res) => {
  try {
    const motoristaId = req.user.id;
    const viagemId = req.params.id;
    const { nota, observacao } = req.body;
    const result = await pool.query(
      `UPDATE viagens 
         SET avaliacao_nota = $1,
             avaliacao_obs  = $2
       WHERE id = $3
         AND motorista_id = $4`,
      [nota, observacao || '', viagemId, motoristaId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Viagem não encontrada.' });
    }
    return res.sendStatus(201);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Erro interno do servidor.' });
  }
});


app.get('/api/dashboard-administrativo', isAdmin, async (req, res) => {
  try {
    // 1) Total de motoristas administrativos
    const motoristaCount = await pool.query(
      `SELECT COUNT(*) AS total
         FROM motoristas_administrativos`
    );

    // 2) Total de veículos da frota administrativa
    const frotaCount = await pool.query(
      `SELECT COUNT(*) AS total
         FROM frota_administrativa`
    );

    // 3) Total de fornecedores administrativos
    const fornecedorAdmCount = await pool.query(
      `SELECT COUNT(*) AS total
         FROM fornecedores_administrativos`
    );

    // 4) Total de viagens internas agendadas
    //    * Ajuste o nome da tabela se você tiver definido outro
    const viagensCount = await pool.query(
      `SELECT COUNT(*) AS total
         FROM viagens`
    );

    // Envia o JSON esperado pelo front
    return res.json({
      motoristas_adm_total: parseInt(motoristaCount.rows[0].total, 10),
      frota_total: parseInt(frotaCount.rows[0].total, 10),
      fornecedores_adm_total: parseInt(fornecedorAdmCount.rows[0].total, 10),
      viagens_agendadas_total: parseInt(viagensCount.rows[0].total, 10)
    });
  } catch (error) {
    console.error('Erro ao carregar dados do dashboard administrativo:', error);
    return res.status(500).json({
      error: 'Não foi possível carregar os dados do dashboard administrativo.'
    });
  }
});

// LISTEN (FINAL)

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
