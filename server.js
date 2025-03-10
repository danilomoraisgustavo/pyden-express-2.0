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

app.use("/assets", express.static(path.join(__dirname, "public", "assets")));
app.use(
  "/pages",
  isAuthenticated,
  express.static(path.join(__dirname, "public", "pages"))
);


// ROTAS PRINCIPAIS
// Rota para carregar a página HTML do painel admin
app.get("/admin", isAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin-dashboard.html"));
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/login-cadastro.html"));
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
      LEFT JOIN frota_motoristas fm ON fm.frota_id = f.id
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

      // Relacionamento com motoristas, se houver
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

    // Verifica se a rota está associada a este fornecedor (rotas_simples + fornecedores_rotas)
    const checkRota = await pool.query(
      `
        SELECT r.id
        FROM rotas_simples r
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
      FROM rotas_simples r
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
      FROM rotas_simples r
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

    // Verifica se a rota está associada a este fornecedor (rotas_simples + fornecedores_rotas)
    const checkRota = await pool.query(
      `
        SELECT r.id
        FROM rotas_simples r
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
// PONTOS DE PARADA (ROTAS)
// ====================================================================================

// Rota para cadastrar UM único ponto
app.post("/api/pontos/cadastrar", async (req, res) => {
  try {
    const {
      latitudePonto,
      longitudePonto,
      area,
      logradouroPonto,
      numeroPonto,
      complementoPonto,
      pontoReferenciaPonto,
      bairroPonto,
      cepPonto
    } = req.body;

    const zoneamentosPonto = JSON.parse(req.body.zoneamentosPonto || "[]");
    const userId = req.session?.userId || null;

    const insertPontoQuery = `
      INSERT INTO pontos (
          nome_ponto, latitude, longitude, area,
          logradouro, numero, complemento, ponto_referencia,
          bairro, cep
      )
      VALUES (
          'TEMP', $1, $2, $3,
          $4, $5, $6, $7,
          $8, $9
      )
      RETURNING id
    `;
    const values = [
      latitudePonto ? parseFloat(latitudePonto) : null,
      longitudePonto ? parseFloat(longitudePonto) : null,
      area,
      logradouroPonto || null,
      numeroPonto || null,
      complementoPonto || null,
      pontoReferenciaPonto || null,
      bairroPonto || null,
      cepPonto || null
    ];
    const result = await pool.query(insertPontoQuery, values);
    if (result.rows.length === 0) {
      return res.status(500).json({
        success: false,
        message: "Erro ao cadastrar ponto."
      });
    }
    const pontoId = result.rows[0].id;

    await pool.query("UPDATE pontos SET nome_ponto = $1 WHERE id = $2", [
      pontoId.toString(),
      pontoId
    ]);

    if (zoneamentosPonto.length > 0) {
      const insertZonaPontoQuery = `
        INSERT INTO pontos_zoneamentos (ponto_id, zoneamento_id)
        VALUES ($1, $2)
      `;
      for (const zid of zoneamentosPonto) {
        await pool.query(insertZonaPontoQuery, [pontoId, zid]);
      }
    }

    const mensagem = `Ponto de parada criado. ID = ${pontoId}`;
    await pool.query(
      `INSERT INTO notificacoes (user_id, acao, tabela, registro_id, mensagem)
       VALUES ($1, 'CREATE', 'pontos', $2, $3)`,
      [userId, pontoId, mensagem]
    );

    return res.json({
      success: true,
      message: "Ponto de parada cadastrado com sucesso!"
    });
  } catch (error) {
    console.error("Erro interno ao cadastrar ponto:", error);
    return res.status(500).json({
      success: false,
      message: "Erro interno do servidor."
    });
  }
});

// Rota para cadastrar MÚLTIPLOS pontos
app.post("/api/pontos/cadastrar-multiplos", async (req, res) => {
  const client = await pool.connect();
  try {
    const { pontos, zoneamentos } = req.body;
    const userId = req.session?.userId || null;

    if (!pontos || !Array.isArray(pontos) || pontos.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Nenhum ponto fornecido."
      });
    }

    await client.query("BEGIN");

    for (const p of pontos) {
      const {
        latitude,
        longitude,
        area,
        logradouro,
        numero,
        complemento,
        referencia,
        bairro,
        cep,
        zona
      } = p;

      const insertPontoQuery = `
        INSERT INTO pontos (
          nome_ponto, latitude, longitude, area,
          logradouro, numero, complemento, ponto_referencia,
          bairro, cep
        )
        VALUES (
          'TEMP', $1, $2, $3,
          $4, $5, $6, $7,
          $8, $9
        )
        RETURNING id
      `;
      const values = [
        latitude != null ? parseFloat(latitude) : null,
        longitude != null ? parseFloat(longitude) : null,
        area || null,
        logradouro || null,
        numero || null,
        complemento || null,
        referencia || null,
        bairro || null,
        cep || null
      ];
      const result = await client.query(insertPontoQuery, values);
      const pontoId = result.rows[0].id;

      await client.query("UPDATE pontos SET nome_ponto = $1 WHERE id = $2", [
        pontoId.toString(),
        pontoId
      ]);

      if (zona && zona !== "N/A") {
        const zonaResult = await client.query(
          `SELECT id FROM zoneamentos WHERE nome = $1 LIMIT 1`,
          [zona]
        );
        let zoneamentoId;
        if (zonaResult.rowCount > 0) {
          zoneamentoId = zonaResult.rows[0].id;
        } else {
          const insertZona = await client.query(
            `INSERT INTO zoneamentos (nome) VALUES ($1) RETURNING id`,
            [zona]
          );
          zoneamentoId = insertZona.rows[0].id;
        }
        await client.query(
          `INSERT INTO pontos_zoneamentos (ponto_id, zoneamento_id)
           VALUES ($1, $2)`,
          [pontoId, zoneamentoId]
        );
      }

      if (zoneamentos && zoneamentos.length > 0) {
        const insertZonaPontoQuery = `
          INSERT INTO pontos_zoneamentos (ponto_id, zoneamento_id)
          VALUES ($1, $2)
        `;
        for (const zid of zoneamentos) {
          await client.query(insertZonaPontoQuery, [pontoId, zid]);
        }
      }

      const mensagem = `Ponto de parada criado (Múltiplo). ID = ${pontoId}`;
      await client.query(
        `INSERT INTO notificacoes (user_id, acao, tabela, registro_id, mensagem)
         VALUES ($1, 'CREATE', 'pontos', $2, $3)`,
        [userId, pontoId, mensagem]
      );
    }

    await client.query("COMMIT");

    return res.json({
      success: true,
      message: "Pontos de parada cadastrados com sucesso!"
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Erro ao cadastrar múltiplos pontos:", error);
    return res.status(500).json({
      success: false,
      message: "Erro interno do servidor ao cadastrar múltiplos pontos."
    });
  } finally {
    client.release();
  }
});

app.get("/api/pontos", async (req, res) => {
  try {
    const query = `
      SELECT p.id,
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
             COALESCE(
               json_agg(
                 json_build_object('id', z.id, 'nome', z.nome)
               ) FILTER (WHERE z.id IS NOT NULL),
               '[]'
             ) AS zoneamentos
      FROM pontos p
      LEFT JOIN pontos_zoneamentos pz ON pz.ponto_id = p.id
      LEFT JOIN zoneamentos z ON z.id = pz.zoneamento_id
      GROUP BY p.id
      ORDER BY p.id;
    `;
    const result = await pool.query(query);
    const pontos = result.rows.map((row) => ({
      id: row.id,
      nome_ponto: row.nome_ponto,
      latitude: row.latitude,
      longitude: row.longitude,
      area: row.area,
      logradouro: row.logradouro,
      numero: row.numero,
      complemento: row.complemento,
      ponto_referencia: row.ponto_referencia,
      bairro: row.bairro,
      cep: row.cep,
      zoneamentos: row.zoneamentos,
    }));
    res.json(pontos);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Erro interno do servidor.",
    });
  }
});

app.delete("/api/pontos/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.session?.userId || null;

    const busca = await pool.query(
      "SELECT nome_ponto FROM pontos WHERE id = $1",
      [id]
    );
    if (busca.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Ponto não encontrado.",
      });
    }
    const nomePonto = busca.rows[0].nome_ponto;

    const deleteQuery = "DELETE FROM pontos WHERE id = $1";
    const result = await pool.query(deleteQuery, [id]);
    if (result.rowCount > 0) {
      const mensagem = `Ponto de parada excluído: ${nomePonto}`;
      await pool.query(
        `INSERT INTO notificacoes (user_id, acao, tabela, registro_id, mensagem)
         VALUES ($1, 'DELETE', 'pontos', $2, $3)`,
        [userId, id, mensagem]
      );
      res.json({
        success: true,
        message: "Ponto excluído com sucesso!",
      });
    } else {
      res.status(404).json({
        success: false,
        message: "Ponto não encontrado.",
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Erro interno do servidor.",
    });
  }
});

app.put("/api/pontos/atualizar/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      latitudePontoEdit,
      longitudePontoEdit,
      areaEdit,
      logradouroPontoEdit,
      numeroPontoEdit,
      complementoPontoEdit,
      pontoReferenciaPontoEdit,
      bairroPontoEdit,
      cepPontoEdit,
    } = req.body;

    const zoneamentosPontoEdit = JSON.parse(req.body.zoneamentosPontoEdit || "[]");
    const userId = req.session?.userId || null;

    const buscaPonto = await pool.query(
      "SELECT id, nome_ponto FROM pontos WHERE id = $1",
      [id]
    );
    if (buscaPonto.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Ponto não encontrado." });
    }

    const updatePontoQuery = `
      UPDATE pontos
      SET
          latitude = $1,
          longitude = $2,
          area = $3,
          logradouro = $4,
          numero = $5,
          complemento = $6,
          ponto_referencia = $7,
          bairro = $8,
          cep = $9
      WHERE id = $10
      RETURNING id, nome_ponto
    `;
    const updateValues = [
      latitudePontoEdit ? parseFloat(latitudePontoEdit) : null,
      longitudePontoEdit ? parseFloat(longitudePontoEdit) : null,
      areaEdit || null,
      logradouroPontoEdit || null,
      numeroPontoEdit || null,
      complementoPontoEdit || null,
      pontoReferenciaPontoEdit || null,
      bairroPontoEdit || null,
      cepPontoEdit || null,
      id,
    ];
    const updateResult = await pool.query(updatePontoQuery, updateValues);

    if (updateResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Falha ao atualizar (ponto inexistente).",
      });
    }

    await pool.query("DELETE FROM pontos_zoneamentos WHERE ponto_id = $1", [id]);

    if (zoneamentosPontoEdit.length > 0) {
      const insertZonaPontoQuery = `
        INSERT INTO pontos_zoneamentos (ponto_id, zoneamento_id)
        VALUES ($1, $2)
      `;
      for (const zid of zoneamentosPontoEdit) {
        await pool.query(insertZonaPontoQuery, [id, zid]);
      }
    }

    const nomePonto = updateResult.rows[0].nome_ponto;
    const mensagem = `Ponto de parada ID ${id} (nome_ponto: ${nomePonto}) foi atualizado.`;
    await pool.query(
      `INSERT INTO notificacoes (user_id, acao, tabela, registro_id, mensagem)
       VALUES ($1, 'UPDATE', 'pontos', $2, $3)`,
      [userId, id, mensagem]
    );

    return res.json({
      success: true,
      message: "Ponto atualizado com sucesso!",
    });
  } catch (error) {
    console.error("Erro ao atualizar ponto:", error);
    return res.status(500).json({
      success: false,
      message: "Erro interno do servidor ao atualizar ponto.",
    });
  }
});

// ====================================================================================
// ENDPOINT DE NOTIFICAÇÕES
// ====================================================================================
app.get("/api/notificacoes", async (req, res) => {
  try {
    // Verifica se o usuário está logado
    if (!req.session || !req.session.userId) {
      return res.json({ success: false, message: "Não logado" });
    }
    const userId = req.session.userId;

    // Consulta as 10 notificações mais recentes para esse user
    // ou notificações cujo user_id é NULL (notificações gerais).
    const query = `
            SELECT id,
                   acao,
                   tabela,
                   registro_id,
                   mensagem,
                   datahora,
                   is_read
            FROM notificacoes
            WHERE user_id = $1 OR user_id IS NULL
            ORDER BY datahora DESC
            LIMIT 10
        `;
    const { rows } = await pool.query(query, [userId]);

    // Formata o "tempo" relativo (ex.: "Há 15 minutos")
    const now = Date.now();
    const notifications = rows.map((r) => {
      const diffMs = now - r.datahora.getTime();
      const diffMin = Math.floor(diffMs / 60000);

      let tempoStr = `Há ${diffMin} minuto(s)`;
      if (diffMin >= 60) {
        const horas = Math.floor(diffMin / 60);
        tempoStr = `Há ${horas} hora(s)`;
      }

      return {
        id: r.id,
        acao: r.acao,
        tabela: r.tabela,
        registro_id: r.registro_id,
        mensagem: r.mensagem,
        datahora: r.datahora, // data/hora real do banco
        is_read: r.is_read, // para o front saber se está lida ou não
        tempo: tempoStr, // ex.: "Há 12 minutos"
      };
    });

    return res.json({
      success: true,
      notifications,
    });
  } catch (err) {
    console.error("Erro ao buscar notificacoes:", err);
    return res.status(500).json({
      success: false,
      message: "Erro interno do servidor.",
    });
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

    // 3) Atualiza no banco
    // Caso deseje garantir que o user atual só possa marcar notificações dele:
    //   "UPDATE notificacoes SET is_read = TRUE
    //    WHERE id = ANY($1) AND (user_id = $2 OR user_id IS NULL)"
    // Se quiser que ele possa marcar qualquer uma, basta remover a checagem do user.
    const updateQuery = `
        UPDATE notificacoes
        SET is_read = TRUE
        WHERE id = ANY($1)
          AND (user_id = $2 OR user_id IS NULL)
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

// ====================================================================================
// ROTAS SIMPLES
// ====================================================================================
// ====> API para cadastrar rota simples, incluindo associação a fornecedores
// ====> server.js (ou equivalente) - Rotas de Cadastro / Edição

// Cadastrar rota simples
app.post("/api/rotas/cadastrar-simples", async (req, res) => {
  try {
    const {
      identificador,
      descricao,
      partidaLat,
      partidaLng,
      chegadaLat,
      chegadaLng,
      pontosParada,
      escolas,
      fornecedores,
      areaZona,
    } = req.body;

    if (!identificador || !descricao || partidaLat == null || partidaLng == null || !areaZona) {
      return res.status(400).json({ success: false, message: "Dados incompletos." });
    }

    const userId = req.session?.userId || null;

    const insertRotaQuery = `
      INSERT INTO rotas_simples
      (identificador, descricao, partida_lat, partida_lng, chegada_lat, chegada_lng, area_zona)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id;
    `;
    const rotaValues = [
      identificador,
      descricao,
      partidaLat,
      partidaLng,
      chegadaLat || partidaLat,
      chegadaLng || partidaLng,
      areaZona,
    ];
    const rotaResult = await pool.query(insertRotaQuery, rotaValues);
    if (rotaResult.rows.length === 0) {
      return res.status(500).json({ success: false, message: "Falha ao cadastrar rota." });
    }
    const rotaId = rotaResult.rows[0].id;

    if (pontosParada && Array.isArray(pontosParada)) {
      const insertPontoQuery = `INSERT INTO rotas_pontos (rota_id, ponto_id) VALUES ($1, $2)`;
      for (const pId of pontosParada) {
        await pool.query(insertPontoQuery, [rotaId, pId]);
      }
    }

    if (escolas && Array.isArray(escolas)) {
      const insertEscolaQuery = `INSERT INTO rotas_escolas (rota_id, escola_id) VALUES ($1, $2)`;
      for (const eId of escolas) {
        await pool.query(insertEscolaQuery, [rotaId, eId]);
      }
    }

    if (fornecedores && Array.isArray(fornecedores)) {
      const insertFornQuery = `INSERT INTO fornecedores_rotas (rota_id, fornecedor_id) VALUES ($1, $2)`;
      for (const fId of fornecedores) {
        await pool.query(insertFornQuery, [rotaId, fId]);
      }
    }

    const mensagem = `Rota simples criada: ${identificador}`;
    await pool.query(
      `INSERT INTO notificacoes (user_id, acao, tabela, registro_id, mensagem)
       VALUES ($1, 'CREATE', 'rotas_simples', $2, $3)`,
      [userId, rotaId, mensagem]
    );

    return res.json({ success: true, message: "Rota cadastrada com sucesso!", id: rotaId });
  } catch (error) {
    console.error("Erro ao cadastrar rota simples:", error);
    return res.status(500).json({ success: false, message: "Erro interno do servidor." });
  }
});

// Editar rota simples
app.put("/api/rotas-simples/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      identificador,
      descricao,
      partidaLat,
      partidaLng,
      chegadaLat,
      chegadaLng,
      pontosParada,
      escolas,
      fornecedores,
      areaZona,
    } = req.body;

    if (!identificador || !descricao || partidaLat == null || partidaLng == null || !areaZona) {
      return res.status(400).json({ success: false, message: "Dados incompletos." });
    }

    const userId = req.session?.userId || null;

    const checkQuery = "SELECT id FROM rotas_simples WHERE id = $1 LIMIT 1";
    const checkResult = await pool.query(checkQuery, [id]);
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Rota não encontrada." });
    }

    const updateQuery = `
      UPDATE rotas_simples
      SET identificador = $1,
          descricao = $2,
          partida_lat = $3,
          partida_lng = $4,
          chegada_lat = $5,
          chegada_lng = $6,
          area_zona = $7
      WHERE id = $8
    `;
    await pool.query(updateQuery, [
      identificador,
      descricao,
      partidaLat,
      partidaLng,
      chegadaLat || partidaLat,
      chegadaLng || partidaLng,
      areaZona,
      id,
    ]);

    await pool.query("DELETE FROM rotas_pontos WHERE rota_id = $1", [id]);
    if (pontosParada && Array.isArray(pontosParada)) {
      const insertPontoQuery = `INSERT INTO rotas_pontos (rota_id, ponto_id) VALUES ($1, $2)`;
      for (const pId of pontosParada) {
        await pool.query(insertPontoQuery, [id, pId]);
      }
    }

    await pool.query("DELETE FROM rotas_escolas WHERE rota_id = $1", [id]);
    if (escolas && Array.isArray(escolas)) {
      const insertEscolaQuery = `INSERT INTO rotas_escolas (rota_id, escola_id) VALUES ($1, $2)`;
      for (const eId of escolas) {
        await pool.query(insertEscolaQuery, [id, eId]);
      }
    }

    await pool.query("DELETE FROM fornecedores_rotas WHERE rota_id = $1", [id]);
    if (fornecedores && Array.isArray(fornecedores)) {
      const insertFornQuery = `INSERT INTO fornecedores_rotas (rota_id, fornecedor_id) VALUES ($1, $2)`;
      for (const fId of fornecedores) {
        await pool.query(insertFornQuery, [id, fId]);
      }
    }

    const mensagem = `Rota simples atualizada: ${identificador}`;
    await pool.query(
      `INSERT INTO notificacoes (user_id, acao, tabela, registro_id, mensagem)
       VALUES ($1, 'UPDATE', 'rotas_simples', $2, $3)`,
      [userId, id, mensagem]
    );

    return res.json({ success: true });
  } catch (error) {
    console.error("Erro ao atualizar rota simples:", error);
    return res.status(500).json({ success: false, message: "Erro interno do servidor." });
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
                EXTRACT(MONTH FROM created_at)::int AS mes,
                area_zona,
                COUNT(*) AS total
            FROM rotas_simples
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

app.get("/api/rotas_simples", async (req, res) => {
  try {
    const query = `
            SELECT 
                id,
                identificador,
                descricao,
                partida_lat AS "partidaLat",
                partida_lng AS "partidaLng",
                chegada_lat AS "chegadaLat",
                chegada_lng AS "chegadaLng"
            FROM rotas_simples
            ORDER BY id;
        `;
    const result = await pool.query(query);
    return res.json(result.rows);
  } catch (error) {
    console.error("Erro ao buscar rotas:", error);
    return res
      .status(500)
      .json({ success: false, message: "Erro interno do servidor." });
  }
});

app.get("/api/rotas_simples/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const rotaQuery = `
            SELECT 
                rs.id,
                rs.partida_lat AS "partidaLat",
                rs.partida_lng AS "partidaLng",
                rs.chegada_lat AS "chegadaLat",
                rs.chegada_lng AS "chegadaLng"
            FROM rotas_simples rs
            WHERE rs.id = $1
            LIMIT 1;
        `;
    const rotaResult = await pool.query(rotaQuery, [id]);
    if (rotaResult.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Rota não encontrada." });
    }
    const rota = rotaResult.rows[0];

    const pontosParadaQuery = `
            SELECT p.id, p.nome_ponto, p.latitude, p.longitude
            FROM rotas_pontos rp
            JOIN pontos p ON p.id = rp.ponto_id
            WHERE rp.rota_id = $1;
        `;
    const pontosResult = await pool.query(pontosParadaQuery, [id]);

    const escolasQuery = `
            SELECT e.id, e.nome, e.latitude, e.longitude
            FROM rotas_escolas re
            JOIN escolas e ON e.id = re.escola_id
            WHERE re.rota_id = $1;
        `;
    const escolasResult = await pool.query(escolasQuery, [id]);

    const detalhesRota = {
      partidaLat: rota.partidaLat,
      partidaLng: rota.partidaLng,
      chegadaLat: rota.chegadaLat,
      chegadaLng: rota.chegadaLng,
      pontosParada: pontosResult.rows.map((r) => ({
        id: r.id,
        nome_ponto: r.nome_ponto,
        latitude: r.latitude,
        longitude: r.longitude,
      })),
      escolas: escolasResult.rows.map((r) => ({
        id: r.id,
        nome: r.nome,
        latitude: r.latitude,
        longitude: r.longitude,
      })),
    };
    res.json(detalhesRota);
  } catch (error) {
    console.error("Erro ao buscar detalhes da rota:", error);
    res.status(500).json({
      success: false,
      message: "Erro interno ao buscar detalhes da rota.",
    });
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
      INSERT INTO usuario_fornecedor (usuario_id, fornecedor_id)
      VALUES ($1, $2)
      ON CONFLICT (usuario_id)
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
            INSERT INTO motoristas_rotas (motorista_id, rota_id)
            VALUES ($1, $2)
            RETURNING id;
        `;
    const result = await pool.query(insertQuery, [motorista_id, rota_id]);
    if (result.rowCount > 0) {
      // Notificação de "atribuição" (opcionalmente pode ser "CREATE" ou "UPDATE")
      const mensagem = `Rota ${rota_id} atribuída ao motorista ${motorista_id}`;
      await pool.query(
        `INSERT INTO notificacoes (user_id, acao, tabela, registro_id, mensagem)
                 VALUES ($1, 'CREATE', 'motoristas_rotas', $2, $3)`,
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
    const mensagem = `Rota ${rota_id} atribuída ao monitor ${monitor_id}`;
    await pool.query(
      `INSERT INTO notificacoes (user_id, acao, tabela, registro_id, mensagem)
             VALUES ($1, 'CREATE', 'monitores_rotas', $2, $3)`,
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
            FROM rotas_simples
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
// ROTA /api/dashboard (atualizada para contar escolas)
app.get("/api/dashboard", async (req, res) => {
  try {
    const alunosAtivos = await pool.query(`
      SELECT COUNT(*)::int AS count
      FROM alunos_ativos
      WHERE LOWER(transporte_escolar_poder_publico) IN ('municipal','estadual')
    `);
    const rotasAtivas = await pool.query(`
      SELECT COUNT(*)::int AS count 
      FROM rotas_simples
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
      alunos_ativos: alunosAtivos.rows[0]?.count || 0,
      rotas_ativas: rotasAtivas.rows[0]?.count || 0,
      zoneamentos_total: zoneamentosCount.rows[0]?.count || 0,
      motoristas_total: motoristasCount.rows[0]?.count || 0,
      monitores_total: monitoresCount.rows[0]?.count || 0,
      fornecedores_total: fornecedoresCount.rows[0]?.count || 0,
      pontos_total: pontosCount.rows[0]?.count || 0,
      // Novo campo
      escolas_total: escolasCount.rows[0]?.count || 0,
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
  let kml = `<?xml version="1.0" encoding="UTF-8"?>
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
            FROM rotas_simples rs
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
            FROM rotas_simples rs
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

app.get("/api/rotas-simples-detalhes", async (req, res) => {
  try {
    const query = `
            WITH re AS (
                SELECT 
                    r.id AS rota_id,
                    r.identificador,
                    r.descricao,
                    r.area_zona,

                    array_agg(DISTINCT p.id) FILTER (WHERE p.id IS NOT NULL) AS pontos_ids,
                    array_agg(DISTINCT p.nome_ponto) FILTER (WHERE p.id IS NOT NULL) AS pontos_nomes,

                    array_agg(DISTINCT z.id) FILTER (WHERE z.id IS NOT NULL) AS zoneamentos_ids,
                    array_agg(DISTINCT z.nome) FILTER (WHERE z.id IS NOT NULL) AS zoneamentos_nomes,

                    array_agg(DISTINCT e.id) FILTER (WHERE e.id IS NOT NULL) AS escolas_ids,
                    array_agg(DISTINCT e.nome) FILTER (WHERE e.id IS NOT NULL) AS escolas_nomes,

                    array_agg(DISTINCT f.id) FILTER (WHERE f.id IS NOT NULL) AS forn_ids,
                    array_agg(DISTINCT f.nome_fornecedor) FILTER (WHERE f.id IS NOT NULL) AS forn_nomes

                FROM rotas_simples r
                LEFT JOIN rotas_pontos rp ON rp.rota_id = r.id
                LEFT JOIN pontos p ON p.id = rp.ponto_id
                LEFT JOIN pontos_zoneamentos pz ON pz.ponto_id = p.id
                LEFT JOIN zoneamentos z ON z.id = pz.zoneamento_id

                LEFT JOIN rotas_escolas re2 ON re2.rota_id = r.id
                LEFT JOIN escolas e ON e.id = re2.escola_id

                LEFT JOIN fornecedores_rotas fr ON fr.rota_id = r.id
                LEFT JOIN fornecedores f ON f.id = fr.fornecedor_id

                GROUP BY r.id
            )
            SELECT 
                rota_id AS id,
                identificador,
                descricao,
                area_zona,

                pontos_ids,
                pontos_nomes,
                zoneamentos_ids,
                zoneamentos_nomes,
                escolas_ids,
                escolas_nomes,
                forn_ids,
                forn_nomes

            FROM re
            ORDER BY rota_id;
        `;
    const result = await pool.query(query);

    const data = result.rows.map((row) => {
      let pontos = [];
      let zoneamentos = [];
      let escolas = [];
      let fornecedores = [];

      if (row.pontos_ids && row.pontos_ids.length) {
        pontos = row.pontos_ids.map((pid, idx) => ({
          id: pid,
          nome_ponto: row.pontos_nomes[idx],
        }));
      }

      if (row.zoneamentos_ids && row.zoneamentos_ids.length) {
        zoneamentos = row.zoneamentos_ids.map((zid, idx) => ({
          id: zid,
          nome: row.zoneamentos_nomes[idx],
        }));
      }

      if (row.escolas_ids && row.escolas_ids.length) {
        escolas = row.escolas_ids.map((eid, idx) => ({
          id: eid,
          nome: row.escolas_nomes[idx],
        }));
      }

      if (row.forn_ids && row.forn_ids.length) {
        fornecedores = row.forn_ids.map((fid, idx) => ({
          id: fid,
          nome_fornecedor: row.forn_nomes[idx],
        }));
      }

      return {
        id: row.id,
        identificador: row.identificador,
        descricao: row.descricao,
        area_zona: row.area_zona,
        pontos,
        zoneamentos,
        escolas,
        fornecedores,
      };
    });

    return res.json(data);
  } catch (err) {
    console.error("Erro ao buscar rotas detalhadas:", err);
    return res.status(500).json({
      success: false,
      message: "Erro interno ao buscar rotas detalhadas.",
    });
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

// ENDPOINT ATUALIZADO (com campo data_nascimento)
app.get("/api/alunos_ativos", async (req, res) => {
  try {
    const search = req.query.search ? req.query.search.trim() : "";
    if (!search) {
      return res.json(null);
    }

    // Consulta que retorna também data_nascimento
    const query = `
      SELECT
        a.id,
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
      LIMIT 1
    `;
    const result = await pool.query(query, [search]);

    if (result.rows.length === 0) {
      return res.json(null);
    }
    return res.json(result.rows[0]);
  } catch (error) {
    console.error("Erro ao buscar aluno por CPF/ID:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
});


// 2) Rota para buscar as coordenadas de uma escola por NOME
app.get("/api/escola-coordenadas", async (req, res) => {
  try {
    const { nome_escola } = req.query;
    if (!nome_escola) {
      return res.status(400).json({ error: "Parâmetro nome_escola é obrigatório" });
    }

    // Ajuste a query conforme o nome real da coluna 'nome' na tabela 'escolas'
    // Aqui usamos case-insensitive:
    const query = `
      SELECT latitude, longitude
      FROM escolas
      WHERE UPPER(nome) = UPPER($1)
      LIMIT 1
    `;
    const result = await pool.query(query, [nome_escola]);

    if (result.rows.length === 0) {
      // Não achou escola
      return res.status(404).json({ error: "Escola não encontrada pelo nome informado." });
    }

    const { latitude, longitude } = result.rows[0];
    if (latitude == null || longitude == null) {
      return res.status(404).json({
        error: "Escola encontrada, mas não possui coordenadas (latitude/longitude)."
      });
    }

    // Retorna exatamente { latitude, longitude } no corpo JSON
    return res.json({
      latitude: parseFloat(latitude),
      longitude: parseFloat(longitude)
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
      "DELETE FROM rotas_simples WHERE id = $1 RETURNING id, identificador";
    const result = await pool.query(deleteQuery, [id]);

    if (result.rowCount > 0) {
      const { identificador } = result.rows[0];
      const mensagem = `Rota simples excluída: ${identificador}`;
      await pool.query(
        `INSERT INTO notificacoes (user_id, acao, tabela, registro_id, mensagem)
                 VALUES ($1, 'DELETE', 'rotas_simples', $2, $3)`,
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

// ====================================================================================
// MEMORANDOS
// ====================================================================================

// app.get("/api/memorandos", ...) ...
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

    // Exemplo de insert no Postgres usando pool (ajuste conforme seu código):
    // Usando async/await (com pool.query)
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
// Exemplo de endpoint para buscar todas as reavaliações
// Ajuste nomes de campos/tabelas conforme seu banco de dados e estrutura
// Exemplo de endpoints para aprovar/reprovar a reavaliação

// Aprovar - muda status_reavaliacao para 'APROVADO',
// atualiza alunos_ativos transporte_escolar_poder_publico = 'MUNICIPAL'
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

    // Consulta da reavaliação mais recente do aluno
    // (ajuste conforme a forma que você armazena; ex: pega a última reavaliação via ORDER BY id DESC)
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

// ============================================================================
// COMPROVANTE NÃO APROVADO - MUNICIPAL
// ============================================================================
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

// ============================================================================
// COMPROVANTE NÃO APROVADO - ESTADUAL
// ============================================================================
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


// ============================================================================
// TERMO DE CADASTRO (MUNICIPAL) COM ESCOLHA DE FILIAÇÃO
// ============================================================================
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


// ============================================================================
// TERMO DE DESEMBARQUE (MUNICIPAL) - MANTÉM COMO ESTAVA
// ============================================================================

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

// ============================================================================
// TERMO DE AUTORIZAÇÃO DE OUTROS RESPONSÁVEIS (MUNICIPAL)
// ============================================================================
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


// ============================================================================
// TERMO DE DESEMBARQUE - ESTADUAL (se desejar ter outro endpoint para estadual)
// ============================================================================
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
      motivo || null,                       // caso o motivo não venha preenchido
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


// Import alunos ativos
app.post("/api/import-alunos-ativos", async (req, res) => {
  try {
    const { alunos, escolaId } = req.body;
    if (!alunos || !Array.isArray(alunos)) {
      return res.json({ success: false, message: "Dados inválidos." });
    }
    if (!escolaId) {
      return res.json({
        success: false,
        message: "É necessário informar uma escola.",
      });
    }

    const userId = req.session?.userId || null;

    const buscaEscola = await pool.query(
      `SELECT id FROM escolas WHERE id = $1`,
      [escolaId]
    );
    if (buscaEscola.rows.length === 0) {
      return res.json({ success: false, message: "Escola não encontrada." });
    }

    for (const aluno of alunos) {
      const {
        id_matricula,
        UNIDADE_ENSINO,
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
        numero_telefone,
        filiacao_2,
        RESPONSAVEL,
        deficiencia,
        data_nascimento
      } = aluno;

      let defArray = [];
      try {
        if (typeof deficiencia === "string") {
          defArray = JSON.parse(deficiencia);
          if (!Array.isArray(defArray)) defArray = [];
        }
      } catch {
        defArray = [];
      }

      let alreadyExists = false;
      if (cpf) {
        const check = await pool.query(
          `SELECT id FROM alunos_ativos 
           WHERE (cpf = $1 AND cpf <> '')
              OR (id_matricula = $2 AND id_matricula IS NOT NULL)`,
          [cpf, id_matricula]
        );
        if (check.rows.length > 0) {
          alreadyExists = true;
        }
      } else if (id_matricula) {
        const check = await pool.query(
          `SELECT id FROM alunos_ativos 
           WHERE id_matricula = $1 AND id_matricula IS NOT NULL`,
          [id_matricula]
        );
        if (check.rows.length > 0) {
          alreadyExists = true;
        }
      }

      if (alreadyExists) {
        continue;
      }

      await pool.query(
        `INSERT INTO alunos_ativos(
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
            data_nascimento
         )
         VALUES (
            $1,  $2,  $3,  $4,  $5,
            $6,  $7,  $8,  null, $9,
            $10, $11, $12, $13, $14,
            $15, $16, $17
         )`,
        [
          id_matricula || null,
          escolaId,
          ANO || null,
          MODALIDADE || null,
          FORMATO_LETIVO || null,
          TURMA || null,
          pessoa_nome || null,
          cpf || null,
          cep || null,
          bairro || null,
          numero_pessoa_endereco || null,
          filiacao_1 || null,
          numero_telefone || null,
          filiacao_2 || null,
          RESPONSAVEL || null,
          defArray,
          data_nascimento || null
        ]
      );
    }

    const mensagem = `Importados alunos para a escola ID ${escolaId}`;
    await pool.query(
      `INSERT INTO notificacoes (user_id, acao, tabela, registro_id, mensagem)
       VALUES ($1, 'CREATE', 'alunos_ativos', 0, $2)`,
      [userId, mensagem]
    );

    return res.json({
      success: true,
      message: "Alunos importados com sucesso!",
    });
  } catch (err) {
    console.error(err);
    return res.json({ success: false, message: "Erro ao importar os alunos." });
  }
});



// Rotas (exemplo) - Ajustando para permitir filtros na query
app.get("/api/alunos-ativos", async (req, res) => {
  try {
    let { escola, bairro, cep, search } = req.query;
    escola = escola || "";
    bairro = bairro || "";
    cep = cep || "";
    search = search || "";

    // Ajuste ou substitua conforme sua lógica de WHERE
    // Exemplo simples:
    let whereClauses = [];
    if (escola) {
      whereClauses.push(`e.nome ILIKE '%${escola}%'`);
    }
    if (bairro) {
      whereClauses.push(`a.bairro ILIKE '%${bairro}%'`);
    }
    if (cep) {
      whereClauses.push(`a.cep ILIKE '%${cep}%'`);
    }
    if (search) {
      whereClauses.push(`
        (a.pessoa_nome ILIKE '%${search}%'
         OR a.id_matricula ILIKE '%${search}%'
         OR a.cpf ILIKE '%${search}%')
      `);
    }
    let whereStr = "";
    if (whereClauses.length) {
      whereStr = "WHERE " + whereClauses.join(" AND ");
    }

    const query = `
      SELECT a.*,
             e.nome AS escola_nome
      FROM alunos_ativos a
      LEFT JOIN escolas e ON e.id = a.escola_id
      ${whereStr}
      ORDER BY a.id DESC
    `;
    const result = await pool.query(query);
    return res.json(result.rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      success: false,
      message: "Erro ao buscar alunos.",
    });
  }
});

app.delete("/api/alunos-ativos/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const check = await pool.query(
      "SELECT id FROM alunos_ativos WHERE id = $1",
      [id]
    );
    if (check.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Aluno não encontrado." });
    }
    await pool.query("DELETE FROM alunos_ativos WHERE id = $1", [id]);
    return res.json({ success: true, message: "Aluno excluído com sucesso." });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      success: false,
      message: "Erro ao excluir o aluno.",
    });
  }
});

// PUT /api/alunos-recadastro/:id
// Exemplo de ajuste para evitar erro de array malformado quando o valor for "NADA INFORMADO":
// Dentro do PUT /api/alunos-recadastro/:id

app.put("/api/alunos-recadastro/:id", async (req, res) => {
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

    // Se a deficiencia for "NADA INFORMADO" ou vazia, seta como null
    let defArray = null;
    if (Array.isArray(deficiencia)) {
      defArray = deficiencia.map(item => item === "NADA INFORMADO" ? null : item).filter(Boolean);
      if (defArray.length === 0) defArray = null;
    } else if (typeof deficiencia === "string") {
      if (deficiencia.trim() && deficiencia.trim() !== "NADA INFORMADO") {
        defArray = [deficiencia.trim()];
      } else {
        defArray = null;
      }
    }

    const query = `
      UPDATE alunos_ativos
      SET
        cep = $1,
        bairro = $2,
        numero_pessoa_endereco = $3,
        numero_telefone = $4,
        deficiencia = $5,
        latitude = $6,
        longitude = $7,
        rua = $8
      WHERE id = $9
      RETURNING id
    `;

    // deficiencia em $5 deve receber defArray ou null
    const values = [
      cep || null,
      bairro || null,
      numero_pessoa_endereco || null,
      numero_telefone || null,
      defArray, // text[] ou null
      latitude || null,
      longitude || null,
      rua || null,
      id
    ];

    const result = await pool.query(query, values);
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Aluno não encontrado." });
    }

    return res.json({ success: true, message: "Dados atualizados com sucesso." });
  } catch (error) {
    console.error("Erro ao atualizar aluno:", error);
    return res.status(500).json({ success: false, message: "Erro ao atualizar aluno." });
  }
});


/***************************************************************
 * POST /api/alunos-ativos-estadual
 * Cria um novo aluno estadual na tabela alunos_ativos_estadual
 ***************************************************************/
app.post("/api/alunos-ativos-estadual", async (req, res) => {
  try {
    const {
      id_matricula,
      pessoa_nome,
      escola_id,
      turma,
      turno,
      cpf,
      cep,
      rua,
      bairro,
      numero_pessoa_endereco,
      numero_telefone,
      filiacao_1,
      filiacao_2,
      responsavel,
      deficiencia,
      latitude,
      longitude
    } = req.body;

    // Validações básicas (exemplo)
    if (!pessoa_nome) {
      return res.status(400).json({
        message: "O campo 'pessoa_nome' é obrigatório."
      });
    }

    // Para o campo deficiencia do tipo TEXT[] em PostgreSQL, 
    // basta enviar como array no body. Ex: deficiencia: ["auditiva", "visual"]
    // Se preferir armazenar como string, seria necessária conversão (mas aqui vamos armazenar nativo em array).

    const insertSQL = `
      INSERT INTO alunos_ativos_estadual (
        id_matricula,
        pessoa_nome,
        escola_id,
        turma,
        turno,
        cpf,
        cep,
        rua,
        bairro,
        numero_pessoa_endereco,
        numero_telefone,
        filiacao_1,
        filiacao_2,
        responsavel,
        deficiencia,
        latitude,
        longitude
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      RETURNING id
    `;

    const values = [
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
      // deficiencia como array (nativo no PostgreSQL)
      Array.isArray(deficiencia) && deficiencia.length > 0 ? deficiencia : null,
      // Latitude e longitude
      latitude || null,
      longitude || null
    ];

    const result = await pool.query(insertSQL, values);

    return res.status(201).json({
      success: true,
      message: "Aluno estadual cadastrado com sucesso.",
      id: result.rows[0].id
    });
  } catch (error) {
    console.error("Erro no POST /api/alunos-ativos-estadual:", error);
    return res.status(500).json({
      message: "Erro interno ao criar aluno estadual."
    });
  }
});


/***************************************************************
 * PUT /api/alunos-ativos-estadual/:id
 * Atualiza os dados de um aluno estadual já existente
 ***************************************************************/
app.put("/api/alunos-ativos-estadual/:id", async (req, res) => {
  try {
    const alunoId = req.params.id;
    const {
      id_matricula,
      pessoa_nome,
      escola_id,
      turma,
      turno,
      cpf,
      cep,
      rua,
      bairro,
      numero_pessoa_endereco,
      numero_telefone,
      filiacao_1,
      filiacao_2,
      responsavel,
      deficiencia,
      latitude,
      longitude
    } = req.body;

    if (!alunoId) {
      return res.status(400).json({ message: "ID do aluno não informado." });
    }

    // Aqui também armazenamos deficiencia como array:
    const updateSQL = `
      UPDATE alunos_ativos_estadual
      SET
        id_matricula = $1,
        pessoa_nome = $2,
        escola_id = $3,
        turma = $4,
        turno = $5,
        cpf = $6,
        cep = $7,
        rua = $8,
        bairro = $9,
        numero_pessoa_endereco = $10,
        numero_telefone = $11,
        filiacao_1 = $12,
        filiacao_2 = $13,
        responsavel = $14,
        deficiencia = $15,
        latitude = $16,
        longitude = $17,
        updated_at = NOW()
      WHERE id = $18
      RETURNING id
    `;

    const values = [
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
      // deficiencia como array (nativo no PostgreSQL)
      Array.isArray(deficiencia) && deficiencia.length > 0 ? deficiencia : null,
      latitude || null,
      longitude || null,
      alunoId
    ];

    const result = await pool.query(updateSQL, values);

    if (result.rowCount === 0) {
      return res.status(404).json({
        message: "Aluno não encontrado ou não foi possível atualizar."
      });
    }

    return res.json({
      success: true,
      message: "Dados do aluno estadual atualizados com sucesso.",
      updatedId: result.rows[0].id
    });
  } catch (error) {
    console.error("Erro no PUT /api/alunos-ativos-estadual/:id:", error);
    return res.status(500).json({
      message: "Erro interno ao atualizar o aluno estadual."
    });
  }
});

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
      rua  // NOVO CAMPO
    } = req.body;

    // Busca o aluno
    const check = await pool.query("SELECT * FROM alunos_ativos WHERE id = $1", [id]);
    if (check.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Aluno não encontrado." });
    }

    const oldData = check.rows[0];
    // Ajusta a lista de deficiências
    let defArray = oldData.deficiencia || null;
    try {
      if (typeof deficiencia === "string" && deficiencia.trim() !== "") {
        defArray = JSON.parse(deficiencia);
      } else if (Array.isArray(deficiencia)) {
        defArray = deficiencia;
      }
    } catch (e) {
      // se der erro no parse, ignora e mantém oldData.deficiencia
    }

    const newData = {
      id_matricula: (id_matricula !== undefined ? id_matricula : oldData.id_matricula),
      escola_id: (escola_id !== undefined ? escola_id : oldData.escola_id),
      ano: (ano !== undefined ? ano : oldData.ano),
      modalidade: (modalidade !== undefined ? modalidade : oldData.modalidade),
      formato_letivo: (formato_letivo !== undefined ? formato_letivo : oldData.formato_letivo),
      turma: (turma !== undefined ? turma : oldData.turma),
      pessoa_nome: (pessoa_nome !== undefined ? pessoa_nome : oldData.pessoa_nome),
      cpf: (cpf !== undefined ? cpf : oldData.cpf),
      transporte_escolar_poder_publico: (
        transporte_escolar_poder_publico !== undefined
          ? transporte_escolar_poder_publico
          : oldData.transporte_escolar_poder_publico
      ),
      cep: (cep !== undefined ? cep : oldData.cep),
      bairro: (bairro !== undefined ? bairro : oldData.bairro),
      numero_pessoa_endereco: (
        numero_pessoa_endereco !== undefined
          ? numero_pessoa_endereco
          : oldData.numero_pessoa_endereco
      ),
      filiacao_1: (filiacao_1 !== undefined ? filiacao_1 : oldData.filiacao_1),
      numero_telefone: (
        numero_telefone !== undefined
          ? numero_telefone
          : oldData.numero_telefone
      ),
      filiacao_2: (filiacao_2 !== undefined ? filiacao_2 : oldData.filiacao_2),
      responsavel: (responsavel !== undefined ? responsavel : oldData.responsavel),
      deficiencia: (defArray !== null ? defArray : oldData.deficiencia),
      longitude: (longitude !== undefined ? longitude : oldData.longitude),
      latitude: (latitude !== undefined ? latitude : oldData.latitude),
      rua: (rua !== undefined ? rua : oldData.rua) // NOVO
    };

    const updateQuery = `
      UPDATE alunos_ativos
      SET
        id_matricula = $1,
        escola_id = $2,
        ano = $3,
        modalidade = $4,
        formato_letivo = $5,
        turma = $6,
        pessoa_nome = $7,
        cpf = $8,
        transporte_escolar_poder_publico = $9,
        cep = $10,
        bairro = $11,
        numero_pessoa_endereco = $12,
        filiacao_1 = $13,
        numero_telefone = $14,
        filiacao_2 = $15,
        responsavel = $16,
        deficiencia = $17,
        longitude = $18,
        latitude = $19,
        rua = $20
      WHERE id = $21
    `;

    await pool.query(updateQuery, [
      newData.id_matricula,
      newData.escola_id,
      newData.ano,
      newData.modalidade,
      newData.formato_letivo,
      newData.turma,
      newData.pessoa_nome,
      newData.cpf,
      newData.transporte_escolar_poder_publico,
      newData.cep,
      newData.bairro,
      newData.numero_pessoa_endereco,
      newData.filiacao_1,
      newData.numero_telefone,
      newData.filiacao_2,
      newData.responsavel,
      newData.deficiencia,
      newData.longitude,
      newData.latitude,
      newData.rua,
      id
    ]);

    return res.json({
      success: true,
      message: "Aluno atualizado com sucesso."
    });
  } catch (err) {
    console.error("Erro ao atualizar aluno:", err);
    return res.status(500).json({
      success: false,
      message: "Erro ao atualizar o aluno."
    });
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


// LISTEN (FINAL)

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
