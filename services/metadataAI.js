const Anthropic = require("@anthropic-ai/sdk");
const fs = require("fs");
const path = require("path");
const { getCacheEntries } = require("./metadataCache");
const logger = require("../logger");

const client = new Anthropic();

const IMAGE_MIME = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

const MAX_TEXT_BYTES  = 100 * 1024;       // 100 KB cap for text files
const MAX_PDF_BYTES   = 20 * 1024 * 1024; // 20 MB cap for PDFs
const MAX_IMAGE_BYTES =  5 * 1024 * 1024; // 5 MB cap for images

/**
 * Build the content blocks to send to Claude for a given file path.
 * Returns an array of Anthropic content block objects.
 */
function buildFileContent(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const fileName = path.basename(filePath);
  const intro = `File name: ${fileName}`;

  // PDF
  if (ext === ".pdf") {
    try {
      const data = fs.readFileSync(filePath);
      if (data.length > MAX_PDF_BYTES) {
        logger.warn({ filePath, bytes: data.length }, "metadataAI: PDF exceeds size limit — using filename only");
        return [{ type: "text", text: `${intro} (PDF too large to analyse: ${Math.round(data.length / 1024 / 1024)} MB)` }];
      }
      return [
        { type: "text", text: intro },
        {
          type: "document",
          source: {
            type: "base64",
            media_type: "application/pdf",
            data: data.toString("base64"),
          },
        },
      ];
    } catch (e) {
      logger.warn({ filePath, err: e.message }, "metadataAI: cannot read PDF — using filename only");
      return [{ type: "text", text: `${intro} (unreadable PDF)` }];
    }
  }

  // Image
  if (IMAGE_MIME[ext]) {
    try {
      const data = fs.readFileSync(filePath);
      if (data.length > MAX_IMAGE_BYTES) {
        logger.warn({ filePath, bytes: data.length }, "metadataAI: image exceeds size limit — using filename only");
        return [{ type: "text", text: `${intro} (image too large to analyse: ${Math.round(data.length / 1024 / 1024)} MB)` }];
      }
      return [
        { type: "text", text: intro },
        {
          type: "image",
          source: {
            type: "base64",
            media_type: IMAGE_MIME[ext],
            data: data.toString("base64"),
          },
        },
      ];
    } catch (e) {
      logger.warn({ filePath, err: e.message }, "metadataAI: cannot read image — using filename only");
      return [{ type: "text", text: `${intro} (unreadable image)` }];
    }
  }

  // Plain text / other
  try {
    const raw = fs.readFileSync(filePath);
    const text = raw.slice(0, MAX_TEXT_BYTES).toString("utf-8");
    return [{ type: "text", text: `${intro}\n\nContent:\n${text}` }];
  } catch (e) {
    logger.warn({ filePath, err: e.message }, "metadataAI: cannot read file — using filename only");
    return [{ type: "text", text: `${intro} (binary or unreadable file)` }];
  }
}

/**
 * Analyse a single file and return suggested metadata IDs/names.
 * Any field where confidence < 0.5 is returned as null.
 *
 * @param {string} filePath  Absolute path to the file on disk
 * @returns {{ organization, location, product, batch, reasoning }}
 */
exports.analyzeFileForMetadata = async (filePath) => {
  const orgs      = getCacheEntries("organization");
  const locations = getCacheEntries("location");
  const products  = getCacheEntries("product");
  const batches   = getCacheEntries("batch");

  const fileContent = buildFileContent(filePath);

  const systemPrompt = `You are a metadata classification assistant. Given a document and lists of available metadata options, determine which organization, location, product, and product batch best describes the document.

Respond with a single JSON object — no markdown fences, no extra text:
{
  "organization":    { "id": "<id>", "name": "<name>", "confidence": <0.0–1.0> } | null,
  "location":        { "id": "<id>", "name": "<name>", "confidence": <0.0–1.0> } | null,
  "product":         { "id": "<id>", "name": "<name>", "confidence": <0.0–1.0> } | null,
  "batch":           { "id": "<id>", "name": "<name>", "confidence": <0.0–1.0> } | null,
  "effective_date":  { "value": "<YYYY-MM-DD>", "confidence": <0.0–1.0> } | null,
  "expiration_date": { "value": "<YYYY-MM-DD>", "confidence": <0.0–1.0> } | null,
  "reasoning":       "<one or two sentences>"
}

Rules:
- Set a field to null if you are less than 50% confident (confidence < 0.5).
- IDs must exactly match one of the options listed below.
- If no options exist for a category, set that field to null.
- Dates must be in YYYY-MM-DD format. Look for effective/valid/issue dates and expiry/expiration dates in the document. Set to null if not found or confidence < 0.5.

Available options:
ORGANIZATIONS: ${JSON.stringify(orgs.map((o) => ({ id: o.id, name: o.name })))}
LOCATIONS: ${JSON.stringify(locations.map((l) => ({ id: l.id, name: l.name, org: l.org_name })))}
PRODUCTS: ${JSON.stringify(products.map((p) => ({ id: p.id, name: p.name, org: p.org_name })))}
BATCHES: ${JSON.stringify(batches.map((b) => ({ id: b.id, name: b.name, org: b.org_name, product: b.product_name })))}`;

  // Cache the system prompt (metadata lists) across file analyses in the same batch.
  // The cache key is based on exact content, so a metadata refresh naturally
  // produces a new cache entry. TTL defaults to 5 minutes, which covers any
  // typical batch run. This reduces input token cost by ~90% per file after
  // the first request when the metadata lists haven't changed.
  const response = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 1024,
    system: [
      {
        type: "text",
        text: systemPrompt,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: [
          ...fileContent,
          {
            type: "text",
            text: "Determine the appropriate metadata for this file. Return ONLY the JSON object.",
          },
        ],
      },
    ],
  }, { timeout: 30_000 });

  logger.debug(
    {
      cache_creation_tokens: response.usage?.cache_creation_input_tokens,
      cache_read_tokens:     response.usage?.cache_read_input_tokens,
      input_tokens:          response.usage?.input_tokens,
      output_tokens:         response.usage?.output_tokens,
    },
    "metadataAI: token usage"
  );

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock) throw new Error("No text response from Claude");

  let parsed;
  try {
    // Strip markdown code fences if Claude adds them despite instructions
    const jsonText = textBlock.text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    parsed = JSON.parse(jsonText);
  } catch (e) {
    throw new Error(`Failed to parse Claude JSON response: ${textBlock.text.slice(0, 200)}`);
  }

  const threshold = (field) => {
    if (!field || typeof field.confidence !== "number" || field.confidence < 0.5) return null;
    return { id: field.id, name: field.name, confidence: field.confidence };
  };

  const thresholdDate = (field) => {
    if (!field || typeof field.confidence !== "number" || field.confidence < 0.5) return null;
    if (!field.value || !/^\d{4}-\d{2}-\d{2}$/.test(field.value)) return null;
    return { value: field.value, confidence: field.confidence };
  };

  return {
    organization:    threshold(parsed.organization),
    location:        threshold(parsed.location),
    product:         threshold(parsed.product),
    batch:           threshold(parsed.batch),
    effective_date:  thresholdDate(parsed.effective_date),
    expiration_date: thresholdDate(parsed.expiration_date),
    reasoning:       parsed.reasoning || "",
  };
};
