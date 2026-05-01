#!/usr/bin/env node

/*
Book rewrite pipeline

Setup:
  npm install
  export OPENAI_API_KEY="your_key_here"

Usage examples:
  node scripts/rewrite-book.js
  node scripts/rewrite-book.js --dry-run
  node scripts/rewrite-book.js --file "src/Part 2 chapter 4 section 1.txt"
*/

import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import dotenv from "dotenv";
import OpenAI from "openai";
import { z } from "zod";

const DEFAULT_INPUT = "src";
const DEFAULT_OUTPUT = "output";
const DEFAULT_SUMMARY_INPUT = "output";
const DEFAULT_SUMMARY_OUTPUT = "output_summary";
const DEFAULT_MODEL = "gpt-5.4";
const DEFAULT_CONCURRENCY = 3;
const DEFAULT_MINIMAL_EXPANSION_RATIO = 1.12;
const CACHE_FILENAME = ".rewrite-cache.json";
const SUMMARY_CACHE_FILENAME = ".summary-cache.json";
const REPORT_FILENAME = "rewrite-report.json";
const SUMMARY_REPORT_FILENAME = "rewrite-report-summary.json";
const CONSISTENCY_OUTPUT_DIR = "output_consistency";
const SUMMARY_GROUP_OUTPUT_DIR = "output_summary_chapters";
const FAILURE_OUTPUT_DIR = "rewrite-failures";

dotenv.config();

const REWRITE_SCHEMA = z.object({
  title: z.string(),
  markdown: z.string(),
});

const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "output",
  "output_consistency",
]);

const SUPPORTED_EXTS = new Set([".txt", ".md", ".markdown"]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseArgs(argv) {
  const args = {
    input: null,
    output: null,
    file: null,
    force: false,
    dryRun: false,
    concurrency: DEFAULT_CONCURRENCY,
    model: DEFAULT_MODEL,
    temperature: null,
    verbose: false,
    consistency: false,
    summarize: false,
    minimalProse: false,
    allowMetaSummary: false,
    summaryMaxRatio: 0.65,
    inputProvided: false,
    outputProvided: false,
  };

  const tokens = [...argv];
  const requireValue = (flag) => {
    if (!tokens.length) {
      throw new Error(`${flag} requires a value`);
    }
    return tokens.shift();
  };
  while (tokens.length) {
    const token = tokens.shift();
    switch (token) {
      case "--input":
        args.input = requireValue("--input");
        args.inputProvided = true;
        break;
      case "--output":
        args.output = requireValue("--output");
        args.outputProvided = true;
        break;
      case "--file":
        args.file = requireValue("--file");
        break;
      case "--force":
        args.force = true;
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      case "--concurrency":
        args.concurrency = Number(requireValue("--concurrency"));
        break;
      case "--model":
        args.model = requireValue("--model");
        break;
      case "--temperature":
        args.temperature = Number(requireValue("--temperature"));
        break;
      case "--summary-max-ratio":
        args.summaryMaxRatio = Number(requireValue("--summary-max-ratio"));
        break;
      case "--verbose":
        args.verbose = true;
        break;
      case "--consistency":
        args.consistency = true;
        break;
      case "--summarize":
        args.summarize = true;
        break;
      case "--minimal-prose":
        args.minimalProse = true;
        break;
      case "--allow-meta-summary":
        args.allowMetaSummary = true;
        break;
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!args.inputProvided) {
    args.input = args.summarize ? DEFAULT_SUMMARY_INPUT : DEFAULT_INPUT;
  }
  if (!args.outputProvided) {
    args.output = args.summarize ? DEFAULT_SUMMARY_OUTPUT : DEFAULT_OUTPUT;
  }

  if (!args.input) throw new Error("--input is required");
  if (!args.output) throw new Error("--output is required");
  if (args.concurrency <= 0 || Number.isNaN(args.concurrency)) {
    throw new Error("--concurrency must be a positive number");
  }
  if (args.temperature !== null && Number.isNaN(args.temperature)) {
    throw new Error("--temperature must be a number");
  }
  if (Number.isNaN(args.summaryMaxRatio)) {
    throw new Error("--summary-max-ratio must be a number");
  }
  if (args.summaryMaxRatio <= 0 || args.summaryMaxRatio >= 1) {
    throw new Error("--summary-max-ratio must be between 0 and 1");
  }
  return args;
}

function buildMinimalRewriteInstructions() {
  const developer = [
    "You are converting source material from question-and-answer form into direct book prose with minimal rewriting.",
    "Preserve all source ideas and only source ideas.",
    "Keep the same order as the source.",
    "Do not explain, interpret, amplify, generalize, or add examples.",
    "Do not add transitions except the smallest amount needed for grammatical prose.",
    "Do not restate the same point in different words.",
    "If the source wording already works as prose, keep it nearly unchanged.",
    "Transform question and answer material into direct declarative prose.",
    "If an answer depends on the question wording, incorporate only the minimum wording needed to make the prose self-contained.",
    "Omit footnote and editorial apparatus.",
    "Preserve meaningful hierarchy and grouped labels from the source.",
    "Do not flatten numbered or named classifications.",
    "Use Markdown. Start with exactly one H2 heading using the section title.",
    "Use H3 or H4 only when the source contains real subgroup labels or headings that should be preserved.",
    "Do not use meta-summary language.",
    "Return ONLY valid JSON matching the schema with keys: title, markdown.",
  ].join(" ");

  const buildUser = ({ filename, titleHint, content, repair, invalidJson, errorMessage, sourceLabels }) => {
    const labelBlock = sourceLabels
      ? [
          "Source hierarchy labels to preserve (verbatim where possible):",
          sourceLabels.join("\n"),
        ].join("\n")
      : "";

    const header = [
      `Filename: ${filename}`,
      titleHint ? `Suggested section title: ${titleHint}` : "",
      labelBlock,
    ]
      .filter(Boolean)
      .join("\n\n");

    if (repair) {
      return [
        header,
        "The previous output was invalid or failed validation.",
        errorMessage ? `Error: ${errorMessage}` : "",
        "Invalid output:",
        "---",
        invalidJson || "",
        "---",
        "Rewrite as minimal direct prose.",
        "Do not add any ideas not present in the source.",
        "Keep the output close in length to the cleaned source.",
        "Return only the corrected JSON.",
      ]
        .filter(Boolean)
        .join("\n");
    }

    return [
      header,
      "Cleaned source content (Q/A labels and editorial apparatus already removed where applicable):",
      "---",
      content,
      "---",
    ].join("\n");
  };

  return { developer, buildUser };
}

function isHiddenDir(name) {
  return name.startsWith(".");
}

function isIgnoredDir(name) {
  return IGNORE_DIRS.has(name) || isHiddenDir(name);
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function scanDirectory(rootDir) {
  const entries = [];

  async function walk(currentDir) {
    const dirents = await fs.readdir(currentDir, { withFileTypes: true });
    for (const dirent of dirents) {
      const fullPath = path.join(currentDir, dirent.name);
      if (dirent.isDirectory()) {
        if (isIgnoredDir(dirent.name)) continue;
        await walk(fullPath);
      } else if (dirent.isFile()) {
        const ext = path.extname(dirent.name).toLowerCase();
        if (SUPPORTED_EXTS.has(ext)) {
          entries.push(fullPath);
        }
      }
    }
  }

  await walk(rootDir);
  return entries;
}

function getRelativeKey(filePath, inputDir) {
  const relative = path.relative(inputDir, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return path.basename(filePath);
  }
  return relative;
}

function getOutputPath(filePath, inputDir, outputDir) {
  const relative = getRelativeKey(filePath, inputDir);
  const parsed = path.parse(relative);
  return path.join(outputDir, parsed.dir, `${parsed.name}.md`);
}

function computeHash(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function loadCache(cachePath, verbose) {
  return fs
    .readFile(cachePath, "utf8")
    .then((text) => JSON.parse(text))
    .catch((err) => {
      if (verbose) {
        console.warn(`Cache not loaded: ${err.message}`);
      }
      return { version: 1, files: {} };
    });
}

async function saveCache(cachePath, cache) {
  const payload = JSON.stringify(cache, null, 2);
  await fs.writeFile(cachePath, payload, "utf8");
}

function buildRewriteInstructions(exampleMarkdown) {
  const bannedPhrases = [
    "this section",
    "the text",
    "the passage",
    "the author",
    "the chapter",
    "the main point",
    "it begins",
    "it then explains",
    "this part",
    "the text warns",
    "the text makes",
    "this section begins",
  ];

  const styleBlock = [
    "STYLE TEMPLATE (match closely):",
    "---",
    exampleMarkdown.trim(),
    "---",
  ].join("\n");

  const badGoodBlock = [
    "Bad (commentary about the source):",
    "- \"This section begins with a simple but central statement...\"",
    "- \"The text then explains...\"",
    "- \"The main point is...\"",
    "Good (direct book prose):",
    "- \"Spirits exist at different levels of development.\"",
    "- \"These differences are based on what they have learned, the qualities they have developed, and the imperfections they have overcome.\"",
    "",
    "Bad (flattened hierarchy):",
    "#### Impure Spirits",
    "#### Frivolous Spirits",
    "#### Pseudo-Learned Spirits",
    "Good (preserved hierarchy):",
    "#### Tenth Class: Impure Spirits",
    "#### Ninth Class: Frivolous Spirits",
    "#### Eighth Class: Pseudo-Learned Spirits",
  ].join("\n");

  const baseDeveloper = [
    "You are rewriting source Q&A into a readable educational book section.",
    "Write the final book section itself, not commentary or summary of the source.",
    "Do not mention the source, the author, the chapter, or the text.",
    "Do not use phrases like: this section, the text, the passage, the author, the chapter, the main point, it begins, it then explains.",
    `Never use any of these phrases: ${bannedPhrases.map((p) => `"${p}"`).join(", ")}.`,
    "Do not use the words: section, text, passage, author, chapter.",
    "Remove Q&A framing. Present ideas directly as polished book prose.",
    "Preserve meaningful source hierarchy exactly where it carries conceptual meaning.",
    "If the source includes numbered classes, orders, ranks, or levels, keep them in the rewritten markdown headings.",
    "Do not flatten numbered classifications into unnumbered subsection titles.",
    "If a heading is a subcategory under a larger category (numbered or not), preserve the subcategory label in the output.",
    "Preserve meaning and important examples. Do not omit important doctrinal or conceptual points.",
    "Use Markdown. Start with exactly one H2 heading using the section title.",
    "Use H3 subsections when they help structure the section.",
    "If numbered or named classes are sub-groups under an H3 heading, use H4 for those class headings.",
    "Default to flowing paragraphs; avoid bullet lists unless genuinely necessary.",
    "If categories would improve clarity, create them using headings or lists.",
    "Reduce repetition. Avoid sounding like notes or a study guide.",
    "Do not add citations. Do not invent facts or add new doctrine.",
    "If wording is outdated or harsh, modernize tone without changing meaning.",
    "If material is sensitive, keep it faithful but calm and clear.",
    "Match the style, pacing, and paragraph rhythm of the style template.",
    "Return ONLY valid JSON matching the schema with keys: title, markdown.",
  ].join(" ");

  const buildUser = ({
    filename,
    titleHint,
    content,
    repair,
    invalidJson,
    errorMessage,
    sourceLabels,
    repairDraft,
  }) => {
    const bannedBlock = [
      "Forbidden meta-summary phrases (do not use any of these):",
      bannedPhrases.map((p) => `- ${p}`).join("\n"),
    ].join("\n");
    const labelBlock = sourceLabels
      ? [
          "Source hierarchy labels to preserve (verbatim where possible):",
          sourceLabels.join("\n"),
        ].join("\n")
      : "";
    const header = [
      `Filename: ${filename}`,
      titleHint ? `Suggested section title: ${titleHint}` : "",
      styleBlock,
      badGoodBlock,
      labelBlock,
    ]
      .filter(Boolean)
      .join("\n\n");

    if (repair) {
      const metaBlock =
        errorMessage && errorMessage.toLowerCase().includes("meta-summary")
          ? [
              "Remove all meta-summary framing and avoid the forbidden phrases listed above.",
              "Do not use the words: section, text, passage, author, chapter.",
              bannedBlock,
              repairDraft
                ? [
                    "Draft markdown to rewrite (keep meaning, remove meta-summary language):",
                    "---",
                    repairDraft,
                    "---",
                  ].join("\n")
                : "",
            ].join("\n")
          : "";
      return [
        header,
        "The previous output was invalid or failed validation.",
        errorMessage ? `Error: ${errorMessage}` : "",
        "Invalid output:",
        "---",
        invalidJson || "",
        "---",
        "Rewrite this as direct book prose, not commentary about the source.",
        "Preserve the hierarchy labels listed above.",
        "Remove all meta-summary framing. Match the style of the template above.",
        metaBlock,
        "Return only the corrected JSON.",
      ]
        .filter(Boolean)
        .join("\n");
    }

    return [
      header,
      "Source content (verbatim):",
      "---",
      content,
      "---",
    ].join("\n");
  };

  return {
    developer: baseDeveloper,
    buildUser,
  };
}

function buildSummaryInstructions(exampleMarkdown, summaryExampleMarkdown) {
  const styleBlock = [
    "STYLE TEMPLATE (structure reference):",
    "---",
    exampleMarkdown.trim(),
    "---",
  ].join("\n");

  const summaryStyleBlock = summaryExampleMarkdown
    ? [
        "SUMMARY STYLE TEMPLATE (preferred for summary mode):",
        "---",
        summaryExampleMarkdown.trim(),
        "---",
      ].join("\n")
    : "";

  const examplesBlock = [
    "Example transformation:",
    "Full: These differences are based on what they have learned, the qualities they have developed, and the imperfections they have overcome.",
    "Summary: Spirits are at different levels of growth. These levels depend on what they have learned and how much they have overcome their faults.",
    "Full: For this reason, any classification is only a way of helping us understand. The divisions are not absolute.",
    "Summary: These groups are only a way to help us understand. The lines between them are not exact.",
  ].join("\n");

  const baseDeveloper = [
    "You are rewriting a full book section into a shorter, simpler edition for lay readers.",
    "Write the final book section itself, not commentary or summary about the source.",
    "Use plain, modern English with everyday vocabulary.",
    "Make paragraphs shorter and reduce density.",
    "Merge adjacent paragraphs when possible; prefer fewer, longer paragraphs over many short ones.",
    "Aim for about 35–55% of the original length.",
    "Combine adjacent paragraphs when possible without losing meaning.",
    "Remove long chains of proof or argument when the concept is already clear.",
    "Remove at least half of supporting sentences where ideas are already clear.",
    "Preserve all key concepts and doctrinal meaning. Do not invent new ideas.",
    "Keep it book-like and mostly paragraph-based; avoid bullet-heavy notes.",
    "Preserve meaningful hierarchy and grouping labels from the input (orders, classes, ranks, levels, subcategories).",
    "Do not flatten numbered classifications into unnumbered headings.",
    "Keep the same heading structure as the input (H2 section title, H3 subsections, H4 subcategories when present).",
    "Do not add citations.",
    "Do not use meta-summary language like 'this section explains' or 'the text says'.",
    "Return ONLY valid JSON matching the schema with keys: title, markdown.",
  ].join(" ");

  const compressDeveloper = [
    "You are compressing a draft summary into a shorter, simpler edition.",
    "Target 35–55% of the original full text length.",
    "Keep all headings and hierarchy labels exactly; do not delete or rename them.",
    "Remove secondary explanations, repeated points, and extra examples.",
    "Keep key concepts and doctrinal meaning intact.",
    "Do not add new content or commentary about the source.",
    "Return ONLY valid JSON matching the schema with keys: title, markdown.",
  ].join(" ");

  const buildUser = ({
    filename,
    titleHint,
    content,
    repair,
    invalidJson,
    errorMessage,
    sourceLabels,
  }) => {
    const labelBlock = sourceLabels
      ? [
          "Input hierarchy labels to preserve (verbatim where possible):",
          sourceLabels.join("\n"),
        ].join("\n")
      : "";
    const header = [
      `Filename: ${filename}`,
      titleHint ? `Suggested section title: ${titleHint}` : "",
      styleBlock,
      summaryStyleBlock,
      examplesBlock,
      labelBlock,
    ]
      .filter(Boolean)
      .join("\n\n");

    if (repair) {
      return [
        header,
        "The previous output was invalid or failed validation.",
        errorMessage ? `Error: ${errorMessage}` : "",
        "Invalid output:",
        "---",
        invalidJson || "",
        "---",
        "Rewrite into shorter, simpler book prose for lay readers.",
        "Preserve headings and hierarchy labels.",
        "Avoid meta-summary language.",
        "Return only the corrected JSON.",
      ]
        .filter(Boolean)
        .join("\n");
    }

    return [
      header,
      "Full rewritten content (verbatim):",
      "---",
      content,
      "---",
    ].join("\n");
  };

  const buildCompressUser = ({ filename, titleHint, draft, headings }) => {
    const headingBlock = headings && headings.length
      ? [
          "Headings to preserve (verbatim):",
          headings.map((h) => `${"#".repeat(h.level)} ${h.text}`).join("\n"),
        ].join("\n")
      : "";
    return [
      `Filename: ${filename}`,
      titleHint ? `Suggested section title: ${titleHint}` : "",
      styleBlock,
      summaryStyleBlock,
      headingBlock,
      "Draft summary to compress (verbatim):",
      "---",
      draft,
      "---",
    ]
      .filter(Boolean)
      .join("\n\n");
  };

  return {
    developer: baseDeveloper,
    buildUser,
    compressDeveloper,
    buildCompressUser,
  };
}

function buildConsistencyPrompt({ groupTitle }) {
  const developer = [
    "You are a careful editor performing a consistency pass across a chapter.",
    "Ensure terminology is consistent and transitions are smooth.",
    "Do not remove important content or add new doctrine.",
    "Keep a calm, clear, modern tone. Use Markdown.",
    "Start with exactly one H2 heading using the chapter title.",
    "Return ONLY valid JSON matching the schema with keys: title, markdown.",
  ].join(" ");

  const user = [
    `Chapter title: ${groupTitle}`,
    "Combined content to clean (verbatim):",
    "---",
    "{{SOURCE_CONTENT}}",
    "---",
  ].join("\n");

  return { developer, user };
}

function normalizeMarkdown(markdown) {
  let text = markdown.replace(/\r\n/g, "\n");
  text = text.replace(/^\s*\n+/, "");
  text = text.replace(/\n+\s*$/, "");
  const lines = text.split("\n");
  const out = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^#{1,6}\s+/.test(line)) {
      out.push(line);
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === "") {
        j += 1;
      }
      if (j < lines.length) {
        out.push("");
      }
      i = j - 1;
      continue;
    }
    out.push(line);
  }

  return out.join("\n");
}

function normalizeTitle(title) {
  if (!title) return "";
  return title.replace(/\s+/g, " ").trim();
}

function normalizeLabel(label) {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeForSearch(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function comparisonLength(text) {
  if (!text) return 0;
  return text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim().length;
}

function rewriteTooExpanded(rewritten, source, maxRatio = DEFAULT_MINIMAL_EXPANSION_RATIO) {
  const rewrittenLen = comparisonLength(rewritten);
  const sourceLen = comparisonLength(source);
  if (!rewrittenLen || !sourceLen) return false;
  return rewrittenLen / sourceLen > maxRatio;
}

function cleanSourceForMinimalProse(content) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const kept = [];
  let skipEditorialBlock = false;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/g, "");
    const trimmed = line.trim();

    if (skipEditorialBlock) {
      if (!trimmed) {
        skipEditorialBlock = false;
      }
      continue;
    }

    if (/^\d+\s+The passages placed between quotation marks/i.test(trimmed)) {
      skipEditorialBlock = true;
      continue;
    }

    if (/^Question\s*\d+\s*:/i.test(trimmed)) {
      continue;
    }

    if (/^Answer\s*:/i.test(trimmed)) {
      continue;
    }

    kept.push(line);
  }

  const text = kept.join("\n").replace(/([.?!"'”’])\d{1,3}(?=\s|$)/g, "$1");
  const blocks = text
    .split(/\n{2,}/)
    .map((block) => block.split("\n").map((line) => line.trim()).filter(Boolean))
    .filter((block) => block.length > 0)
    .map((block) => block.join(" "));

  return blocks.join("\n\n").trim();
}

function sanitizeMetaPhrases(markdown) {
  return markdown.replace(/\bthe passage\b/gi, "the transition");
}

function extractHeadingsFromMarkdown(markdown) {
  const headings = [];
  const lines = markdown.split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^(#{2,4})\s+(.+)$/);
    if (!match) continue;
    const level = match[1].length;
    const text = match[2].trim();
    if (!text || text.length > 100) continue;
    headings.push({ level, text, normalized: normalizeLabel(text) });
  }
  return headings;
}

function summaryTooCloseToOriginal(summary, original, maxRatio = 0.65) {
  const sumLen = summary.replace(/\s+/g, " ").trim().length;
  const origLen = original.replace(/\s+/g, " ").trim().length;
  if (!origLen || !sumLen) return false;
  return sumLen / origLen > maxRatio;
}

function summaryTooShort(summary, original) {
  const sumLen = summary.replace(/\s+/g, " ").trim().length;
  const origLen = original.replace(/\s+/g, " ").trim().length;
  if (!origLen || !sumLen) return false;
  return sumLen / origLen < 0.35;
}

function lengthRatio(summary, original) {
  const sumLen = summary.replace(/\s+/g, " ").trim().length;
  const origLen = original.replace(/\s+/g, " ").trim().length;
  if (!origLen || !sumLen) return null;
  return sumLen / origLen;
}

function countParagraphs(markdown) {
  const blocks = markdown
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p && !/^#{1,6}\s+/.test(p));
  return blocks.length;
}

function summaryTooManyParagraphs(summary, original) {
  const sumCount = countParagraphs(summary);
  const origCount = countParagraphs(original);
  if (!origCount || !sumCount) return false;
  return sumCount / origCount > 0.9;
}

function summaryStructureLossDetected(inputHeadings, outputMarkdown) {
  if (!inputHeadings.length) return false;
  const outputNorm = normalizeForSearch(outputMarkdown);
  const h3h4 = inputHeadings.filter((h) => h.level >= 3);
  if (!h3h4.length) return false;
  const missing = h3h4.filter((h) => !outputNorm.includes(h.normalized));
  return missing.length > 0;
}

function extractGroupingLabelsFromSource(content) {
  const lines = content.split(/\r?\n/);
  const numbered = new Set();
  const subcategories = new Set();
  const displayLabels = new Set();

  const ordinalWords = [
    "first",
    "second",
    "third",
    "fourth",
    "fifth",
    "sixth",
    "seventh",
    "eighth",
    "ninth",
    "tenth",
    "eleventh",
    "twelfth",
  ];
  const ordinalPattern = `(?:${ordinalWords.join("|")}|\\d+(?:st|nd|rd|th)?)`;
  const typePattern = "(?:order|class|rank|level)s?";
  const numberedRegex = new RegExp(
    `\\b(${ordinalPattern})\\s+(${typePattern})\\b`,
    "i"
  );

  for (const rawLine of lines) {
    if (!rawLine.trim()) continue;
    let line = rawLine.trim();
    line = line.replace(/^question\s*\d+\s*:\s*/i, "");

    const headingMatch = line.match(/^#{2,6}\s+(.+)$/);
    if (headingMatch) {
      const candidate = headingMatch[1].trim();
      if (candidate && candidate.length <= 80 && !candidate.endsWith("?")) {
        subcategories.add(normalizeLabel(candidate));
        displayLabels.add(candidate.replace(/[\s.]+$/g, ""));
      }
    }

    const numberedMatch = line.match(numberedRegex);
    if (numberedMatch) {
      const ordinal = numberedMatch[1];
      const type = numberedMatch[2];
      const canon = normalizeLabel(`${ordinal} ${type}`);
      numbered.add(canon);
      displayLabels.add(`${ordinal} ${type}`.replace(/\b\w/g, (c) => c.toUpperCase()));

      const after = line.slice(numberedMatch.index + numberedMatch[0].length).trim();
      const labelMatch = after.match(/[:.\-–—]\s*(.+)$/);
      const labelCandidate = labelMatch ? labelMatch[1].trim() : "";
      if (labelCandidate && labelCandidate.length <= 80) {
        const cleaned = labelCandidate.replace(/[\s.]+$/g, "");
        if (cleaned && !cleaned.endsWith("?")) {
          subcategories.add(normalizeLabel(cleaned));
          displayLabels.add(cleaned);
        }
      }
    }

    const bulletMatch = line.match(/^\s*([-*+]\s+|\d+\.\s+)(.+)$/);
    if (bulletMatch) {
      const candidate = bulletMatch[2].trim();
      if (candidate && candidate.length <= 80 && !candidate.endsWith("?")) {
        const cleanedCandidate = candidate.replace(/[\s.]+$/g, "");
        subcategories.add(normalizeLabel(cleanedCandidate));
        displayLabels.add(cleanedCandidate);
      }
    }

    if (/^[A-Z\s\-–—]+$/.test(line) && line.length <= 80) {
      const cleaned = line.replace(/[\s.]+$/g, "");
      if (cleaned && cleaned.length > 2) {
        subcategories.add(normalizeLabel(cleaned));
        displayLabels.add(cleaned);
      }
    }
  }

  const normalizedNumbered = Array.from(numbered);
  const normalizedSubcats = Array.from(subcategories);

  return {
    numbered: normalizedNumbered,
    subcategories: normalizedSubcats,
    display: Array.from(displayLabels),
    normalized: {
      numbered: normalizedNumbered,
      subcategories: normalizedSubcats,
    },
  };
}

function extractTitleFromSource(content) {
  const lines = content.split(/\r?\n/);
  for (const rawLine of lines.slice(0, 12)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^(q|a)\s*:/i.test(line)) continue;
    if (/^\d+[\).\s]/.test(line)) continue;
    if (line.length > 80) continue;
    const headingMatch = line.match(/^#{1,6}\s+(.*)$/);
    const candidate = headingMatch ? headingMatch[1].trim() : line;
    if (!candidate) continue;
    if (/[.?!]$/.test(candidate)) continue;
    return normalizeTitle(candidate);
  }
  return null;
}

function applyTitleToMarkdown(markdown, title) {
  const cleanTitle = normalizeTitle(title);
  const trimmed = markdown.replace(/^\s+/, "");
  if (trimmed.startsWith("## ")) {
    return trimmed.replace(/^##\s+.*$/m, `## ${cleanTitle}`);
  }
  return `## ${cleanTitle}\n\n${trimmed}`;
}

function getMetaSummaryMatches(markdown) {
  const text = markdown.toLowerCase();
  const phrases = [
    "this section",
    "the text",
    "the passage",
    "the chapter",
    "the main point",
    "it begins",
    "it then explains",
    "this part",
    "the text warns",
    "the text makes",
    "this section begins",
  ];
  const phraseMatches = phrases.filter((phrase) => {
    const escaped = phrase.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
    const pattern = new RegExp(`\\b${escaped}\\b`, "i");
    return pattern.test(text);
  });

  const authorMetaPatterns = [
    /\bthe author\s+(?:says|said|writes|wrote|argues|argued|explains|explained|states|stated|notes|noted|begins)\b/i,
    /\baccording to the author\b/i,
  ];

  const authorMetaMatches = authorMetaPatterns.some((pattern) => pattern.test(text))
    ? ["the author"]
    : [];

  return [...phraseMatches, ...authorMetaMatches];
}

function passesStyleHeuristics(markdown) {
  const trimmed = markdown.trim();
  if (!trimmed.startsWith("## ")) return false;

  const lines = trimmed.split("\n");
  const h3Index = lines.findIndex((line) => /^###\s+/.test(line));
  const h4Index = lines.findIndex((line) => /^####\s+/.test(line));
  if (h4Index !== -1 && (h3Index === -1 || h4Index < h3Index)) {
    return false;
  }

  const listLines = lines.filter((line) =>
    /^\s*([-*+]\s+|\d+\.\s+)/.test(line)
  );

  if (listLines.length > 16 && listLines.length / lines.length > 0.35) {
    return false;
  }

  const paragraphs = trimmed
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p && !/^#{1,6}\s+/.test(p));

  if (paragraphs.length > 6) {
    const short = paragraphs.filter((p) => p.length < 60).length;
    if (short / paragraphs.length > 0.5) return false;
  }

  return true;
}

function structureLossDetected(sourceLabels, markdown) {
  if (!sourceLabels) return false;
  const { numbered, subcategories } = sourceLabels;
  if (!numbered.length && !subcategories.length) return false;

  const outputNorm = normalizeForSearch(markdown);
  const presentNumbered = numbered.filter((label) =>
    outputNorm.includes(label)
  );
  const presentSubcats = subcategories.filter((label) =>
    outputNorm.includes(label)
  );

  if (numbered.length >= 2 && presentNumbered.length === 0) {
    return true;
  }

  if (subcategories.length >= 2 && presentSubcats.length === 0) {
    return true;
  }

  if (numbered.length >= 2 && presentSubcats.length > 0 && presentNumbered.length === 0) {
    return true;
  }

  return false;
}

function extractResponseText(response) {
  if (typeof response?.output_text === "string" && response.output_text.trim()) {
    return response.output_text;
  }
  if (Array.isArray(response?.output)) {
    for (const item of response.output) {
      if (Array.isArray(item?.content)) {
        const combined = item.content
          .map((part) => part?.text)
          .filter(Boolean)
          .join("");
        if (combined.trim()) return combined;
      }
    }
  }
  return "";
}

function getTitleHint(filePath) {
  const base = path.basename(filePath, path.extname(filePath));
  return base.replace(/[_-]+/g, " ");
}

function shouldRetry(err) {
  const status = err?.status;
  if ([408, 429, 500, 502, 503, 504].includes(status)) return true;
  const code = err?.code;
  if (["ETIMEDOUT", "ECONNRESET", "EAI_AGAIN"].includes(code)) return true;
  return false;
}

function isTemperatureUnsupported(err) {
  const msg = `${err?.message || ""}`.toLowerCase();
  if (!msg.includes("temperature")) return false;
  return (
    msg.includes("not supported") ||
    msg.includes("unsupported") ||
    msg.includes("unknown parameter") ||
    msg.includes("unrecognized")
  );
}

function isTextFormatUnsupported(err) {
  const msg = `${err?.message || ""}`.toLowerCase();
  if (!msg.includes("text.format") && !msg.includes("text format")) return false;
  return (
    msg.includes("not supported") ||
    msg.includes("unsupported") ||
    msg.includes("unknown parameter") ||
    msg.includes("unrecognized")
  );
}

async function withRetry(fn, { maxAttempts = 5, verbose = false }) {
  let attempt = 0;
  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      return await fn();
    } catch (err) {
      if (!shouldRetry(err) || attempt === maxAttempts) {
        throw err;
      }
      const delay = Math.min(8000, 500 * 2 ** (attempt - 1)) + Math.random() * 250;
      if (verbose) {
        console.warn(`Transient error, retrying in ${Math.round(delay)}ms...`);
      }
      await sleep(delay);
    }
  }
  throw new Error("Retry attempts exhausted");
}

async function createStructuredResponse({
  client,
  model,
  temperature,
  developer,
  user,
  verbose,
}) {
  const jsonSchemaFormat = {
    type: "json_schema",
    name: "rewrite_output",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["title", "markdown"],
      properties: {
        title: { type: "string" },
        markdown: { type: "string" },
      },
    },
    strict: true,
  };

  const buildRequest = ({ includeTemperature, useTextFormat }) => {
    const base = {
      model,
      input: [
        { role: "developer", content: developer },
        { role: "user", content: user },
      ],
      ...(includeTemperature ? { temperature } : {}),
    };
    if (useTextFormat) {
      return {
        ...base,
        text: { format: jsonSchemaFormat },
      };
    }
    return {
      ...base,
      response_format: jsonSchemaFormat,
    };
  };

  try {
    const response = await withRetry(
      () =>
        client.responses.create(
          buildRequest({ includeTemperature: temperature !== null, useTextFormat: true })
        ),
      { verbose }
    );
    const text = extractResponseText(response);
    if (!text) throw new Error("Empty response output");
    return text;
  } catch (err) {
    if (isTextFormatUnsupported(err)) {
      if (verbose) {
        console.warn("text.format not supported, retrying with response_format.");
      }
      const response = await withRetry(
        () =>
          client.responses.create(
            buildRequest({ includeTemperature: temperature !== null, useTextFormat: false })
          ),
        { verbose }
      );
      const text = extractResponseText(response);
      if (!text) throw new Error("Empty response output");
      return text;
    }
    if (temperature !== null && isTemperatureUnsupported(err)) {
      if (verbose) {
        console.warn("Temperature not supported, retrying without it.");
      }
      try {
        const response = await withRetry(
          () =>
            client.responses.create(
              buildRequest({ includeTemperature: false, useTextFormat: true })
            ),
          { verbose }
        );
        const text = extractResponseText(response);
        if (!text) throw new Error("Empty response output");
        return text;
      } catch (retryErr) {
        if (isTextFormatUnsupported(retryErr)) {
          const response = await withRetry(
            () =>
              client.responses.create(
                buildRequest({ includeTemperature: false, useTextFormat: false })
              ),
            { verbose }
          );
          const text = extractResponseText(response);
          if (!text) throw new Error("Empty response output");
          return text;
        }
        throw retryErr;
      }
    }
    throw err;
  }
}

async function getValidatedOutput({
  client,
  model,
  temperature,
  filename,
  titleHint,
  content,
  verbose,
  promptBuilder,
  sourceLabels,
  inputMarkdown,
  summaryMode,
  allowMetaSummary,
  summaryMaxRatio,
  minimalSourceContent,
  maxExpansionRatio,
}) {
  const { developer, buildUser, compressDeveloper, buildCompressUser } = promptBuilder;

  let lastOutput = null;
  let lastError = null;
  let lastDraft = null;
  const maxAttempts = 5;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (attempt >= 3 && lastError && !lastError.toLowerCase().includes("meta-summary")) {
      break;
    }
    const user = buildUser({
      filename,
      titleHint,
      content,
      repair: attempt > 0,
      invalidJson: lastOutput || "",
      errorMessage: lastError || "Unknown validation error",
      sourceLabels: sourceLabels?.display || null,
      repairDraft: lastDraft,
    });

    const responseText = await createStructuredResponse({
      client,
      model,
      temperature,
      developer,
      user,
      verbose,
    });

    lastOutput = responseText;

    try {
      const parsed = JSON.parse(responseText);
      const result = REWRITE_SCHEMA.safeParse(parsed);
      if (!result.success) {
        lastError = result.error.message;
        continue;
      }

      const normalized = normalizeMarkdown(result.data.markdown);
      const sanitized = sanitizeMetaPhrases(normalized);
      lastDraft = sanitized;
      if (!allowMetaSummary) {
        const metaMatches = getMetaSummaryMatches(sanitized);
        if (metaMatches.length) {
          lastError = `Meta-summary phrasing detected: ${metaMatches.join(", ")}`;
          continue;
        }
      }
      if (!passesStyleHeuristics(sanitized)) {
        lastError = "Style heuristics failed";
        continue;
      }
      if (structureLossDetected(sourceLabels?.normalized, sanitized)) {
        lastError = "Structure loss: numbered/grouped labels dropped";
        continue;
      }
      if (summaryMode && inputMarkdown) {
        const inputHeadings = extractHeadingsFromMarkdown(inputMarkdown);
        if (summaryTooCloseToOriginal(sanitized, inputMarkdown, summaryMaxRatio)) {
          lastError = "Summary too close to original";
          if (compressDeveloper && buildCompressUser) {
            const compressUser = buildCompressUser({
              filename,
              titleHint,
              draft: sanitized,
              headings: inputHeadings,
            });
            const compressResponse = await createStructuredResponse({
              client,
              model,
              temperature,
              developer: compressDeveloper,
              user: compressUser,
              verbose,
            });
            lastOutput = compressResponse;
            try {
              const parsedCompress = JSON.parse(compressResponse);
              const compressResult = REWRITE_SCHEMA.safeParse(parsedCompress);
              if (compressResult.success) {
                const compressed = normalizeMarkdown(compressResult.data.markdown);
                const compressedSanitized = sanitizeMetaPhrases(compressed);
                lastDraft = compressedSanitized;
                if (!allowMetaSummary) {
                  const compressMeta = getMetaSummaryMatches(compressedSanitized);
                  if (compressMeta.length) {
                    lastError = `Meta-summary phrasing detected: ${compressMeta.join(", ")}`;
                    continue;
                  }
                }
                if (!passesStyleHeuristics(compressedSanitized)) {
                  lastError = "Style heuristics failed";
                } else if (structureLossDetected(sourceLabels?.normalized, compressedSanitized)) {
                  lastError = "Structure loss: numbered/grouped labels dropped";
                } else if (
                  summaryTooCloseToOriginal(
                    compressedSanitized,
                    inputMarkdown,
                    summaryMaxRatio
                  )
                ) {
                  lastError = "Summary too close to original";
                } else if (summaryTooShort(compressedSanitized, inputMarkdown)) {
                  lastError = "Summary too short";
                } else if (summaryTooManyParagraphs(compressedSanitized, inputMarkdown)) {
                  lastError = "Summary too paragraph-heavy";
                } else if (summaryStructureLossDetected(inputHeadings, compressedSanitized)) {
                  lastError = "Summary dropped key headings";
                } else {
                  return {
                    ...compressResult.data,
                    markdown: compressedSanitized,
                  };
                }
              }
            } catch (err) {
              lastError = err.message;
            }
          }
          continue;
        }
        if (summaryTooShort(sanitized, inputMarkdown)) {
          lastError = "Summary too short";
          continue;
        }
        if (summaryTooManyParagraphs(sanitized, inputMarkdown)) {
          lastError = "Summary too paragraph-heavy";
          continue;
        }
        if (summaryStructureLossDetected(inputHeadings, sanitized)) {
          lastError = "Summary dropped key headings";
          continue;
        }
      }

      if (minimalSourceContent && rewriteTooExpanded(sanitized, minimalSourceContent, maxExpansionRatio)) {
        lastError = "Rewrite too expanded";
        continue;
      }

      return {
        ...result.data,
        markdown: sanitized,
      };
    } catch (err) {
      lastError = err.message;
    }
  }

  const error = new Error(
    `Failed to produce valid JSON after retries: ${lastError}`
  );
  if (summaryMode && inputMarkdown && lastDraft) {
    error.summaryRatio = lengthRatio(lastDraft, inputMarkdown);
  }
  error.rawOutput = lastOutput;
  error.lastDraft = lastDraft;
  error.validationError = lastError;
  throw error;
}

async function getValidatedConsistencyOutput({
  client,
  model,
  temperature,
  groupTitle,
  content,
  verbose,
}) {
  const { developer, user } = buildConsistencyPrompt({ groupTitle });
  const userContent = user.replace("{{SOURCE_CONTENT}}", content);

  let lastOutput = null;
  let lastError = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const repairUser = [
      `Chapter title: ${groupTitle}`,
      "The previous output was invalid or failed validation.",
      lastError ? `Error: ${lastError}` : "",
      "Invalid output:",
      "---",
      lastOutput || "",
      "---",
      "Rewrite this as direct book prose, not commentary about the source.",
      "Return only the corrected JSON.",
    ]
      .filter(Boolean)
      .join("\n");

    const responseText = await createStructuredResponse({
      client,
      model,
      temperature,
      developer,
      user: attempt === 0 ? userContent : repairUser,
      verbose,
    });

    lastOutput = responseText;

    try {
      const parsed = JSON.parse(responseText);
      const result = REWRITE_SCHEMA.safeParse(parsed);
      if (result.success) {
        return result.data;
      }
      lastError = result.error.message;
    } catch (err) {
      lastError = err.message;
    }
  }

  throw new Error(`Failed to produce valid JSON after retries: ${lastError}`);
}

async function processFiles({
  files,
  inputDir,
  outputDir,
  client,
  model,
  temperature,
  concurrency,
  force,
  dryRun,
  verbose,
  cache,
  report,
  promptBuilder,
  summaryMode,
  minimalProse,
  allowMetaSummary,
  summaryMaxRatio,
}) {
  let processed = 0;
  let skipped = 0;
  let failed = 0;

  const workerCount = Math.max(1, Math.min(concurrency, files.length));
  let index = 0;

  async function worker() {
    while (true) {
      const current = index;
      index += 1;
      if (current >= files.length) return;
      const filePath = files[current];
      const relativeKey = getRelativeKey(filePath, inputDir);
      const outputPath = getOutputPath(filePath, inputDir, outputDir);

      try {
        const content = await fs.readFile(filePath, "utf8");
        const cleanedContent = minimalProse ? cleanSourceForMinimalProse(content) : content;
        const hash = computeHash(content);
        const cacheEntry = cache.files[relativeKey];
        const outputExists = await exists(outputPath);

        let skipReason = null;
        if (!force && outputExists) {
          skipReason = "output-exists";
        } else if (force && outputExists && cacheEntry?.hash === hash) {
          skipReason = "cache-unchanged";
        }

        cache.files[relativeKey] = {
          hash,
          outputPath,
          updatedAt: new Date().toISOString(),
        };

        if (skipReason) {
          skipped += 1;
          report.files.push({
            file: relativeKey,
            output: outputPath,
            status: "skipped",
            reason: skipReason,
          });
          if (verbose) {
            console.log(`SKIP ${relativeKey} (${skipReason})`);
          } else {
            console.log(`SKIP ${relativeKey}`);
          }
          continue;
        }

        if (dryRun) {
          skipped += 1;
          report.files.push({
            file: relativeKey,
            output: outputPath,
            status: "dry-run",
          });
          console.log(`DRY-RUN ${relativeKey}`);
          continue;
        }

        const titleHint = getTitleHint(filePath);
        const sourceLabels = extractGroupingLabelsFromSource(content);
        const result = await getValidatedOutput({
          client,
          model,
          temperature,
          filename: relativeKey,
          titleHint,
          content: cleanedContent,
          verbose,
          promptBuilder,
          sourceLabels,
          inputMarkdown: summaryMode ? cleanedContent : null,
          summaryMode,
          allowMetaSummary,
          summaryMaxRatio,
          minimalSourceContent: minimalProse ? cleanedContent : null,
          maxExpansionRatio: DEFAULT_MINIMAL_EXPANSION_RATIO,
        });

        const sourceTitle = extractTitleFromSource(content);
        const resolvedTitle =
          sourceTitle || normalizeTitle(result.title) || titleHint;
        const withTitle = applyTitleToMarkdown(result.markdown, resolvedTitle);
        const normalized = normalizeMarkdown(withTitle);
        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        await fs.writeFile(outputPath, normalized, "utf8");

        processed += 1;
        report.files.push({
          file: relativeKey,
          output: outputPath,
          status: "success",
        });
        if (summaryMode) {
          const originalLen = content.length;
          const summaryLen = normalized.length;
          const ratio = originalLen ? summaryLen / originalLen : 0;
          const percentShorter = Math.round((1 - ratio) * 100);
          console.log(`OK ${relativeKey} (summary ${percentShorter}% shorter)`);
        } else {
          console.log(`OK ${relativeKey}`);
        }
      } catch (err) {
        if (err?.rawOutput) {
          try {
            const failureDir = path.resolve(process.cwd(), FAILURE_OUTPUT_DIR);
            const relative = getRelativeKey(filePath, inputDir);
            const parsed = path.parse(relative);
            const failurePath = path.join(
              failureDir,
              parsed.dir,
              `${parsed.name}.json`
            );
            const payload = {
              file: relative,
              output: outputPath,
              error: err.message,
              validationError: err.validationError || null,
              summaryRatio: err.summaryRatio ?? null,
              rawOutput: err.rawOutput,
              lastDraft: err.lastDraft || null,
              createdAt: new Date().toISOString(),
            };
            await fs.mkdir(path.dirname(failurePath), { recursive: true });
            await fs.writeFile(failurePath, JSON.stringify(payload, null, 2), "utf8");
          } catch (writeErr) {
            console.error(`FAILURE LOG ERROR ${relativeKey}: ${writeErr.message}`);
          }
        }
        failed += 1;
        report.files.push({
          file: relativeKey,
          output: outputPath,
          status: "failed",
          error: err.message,
        });
        console.error(`FAIL ${relativeKey}: ${err.message}`);
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return { processed, skipped, failed };
}

function groupByChapter(files) {
  const groups = new Map();
  for (const filePath of files) {
    const base = path.basename(filePath, path.extname(filePath));
    const match = base.match(/^(.*?chapter\s+\d+)/i);
    const key = match ? match[1] : base;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(filePath);
  }
  return groups;
}

async function runConsistencyPass({
  groups,
  inputDir,
  baseOutputDir,
  outputDir,
  client,
  model,
  temperature,
  verbose,
  dryRun,
  report,
}) {
  for (const [groupTitle, groupFiles] of groups.entries()) {
    const outputPath = path.join(outputDir, `${groupTitle}.md`);
    try {
      const sections = [];
      for (const filePath of groupFiles) {
        const baseOutput = getOutputPath(filePath, inputDir, baseOutputDir);
        if (await exists(baseOutput)) {
          const content = await fs.readFile(baseOutput, "utf8");
          sections.push(content);
        }
      }

      if (!sections.length) continue;

      if (dryRun) {
        report.consistency.push({
          group: groupTitle,
          output: outputPath,
          status: "dry-run",
        });
        console.log(`DRY-RUN CONSISTENCY ${groupTitle}`);
        continue;
      }

      const combined = sections.join("\n\n");
      const result = await getValidatedConsistencyOutput({
        client,
        model,
        temperature,
        groupTitle,
        content: combined,
        verbose,
      });

      const normalized = normalizeMarkdown(result.markdown);
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.writeFile(outputPath, normalized, "utf8");

      report.consistency.push({
        group: groupTitle,
        output: outputPath,
        status: "success",
      });
      console.log(`OK CONSISTENCY ${groupTitle}`);
    } catch (err) {
      report.consistency.push({
        group: groupTitle,
        output: outputPath,
        status: "failed",
        error: err.message,
      });
      console.error(`FAIL CONSISTENCY ${groupTitle}: ${err.message}`);
    }
  }
}

async function runSummaryGroupingPass({
  groups,
  inputDir,
  baseOutputDir,
  outputDir,
  dryRun,
  report,
}) {
  for (const [groupTitle, groupFiles] of groups.entries()) {
    const outputPath = path.join(outputDir, `${groupTitle}.md`);
    try {
      const sections = [];
      for (const filePath of groupFiles) {
        const baseOutput = getOutputPath(filePath, inputDir, baseOutputDir);
        if (await exists(baseOutput)) {
          const content = await fs.readFile(baseOutput, "utf8");
          sections.push(content);
        }
      }

      if (!sections.length) continue;

      if (dryRun) {
        report.summaryGroups.push({
          group: groupTitle,
          output: outputPath,
          status: "dry-run",
        });
        console.log(`DRY-RUN SUMMARY GROUP ${groupTitle}`);
        continue;
      }

      const combined = sections.join("\n\n");
      const normalized = normalizeMarkdown(combined);
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.writeFile(outputPath, normalized, "utf8");

      report.summaryGroups.push({
        group: groupTitle,
        output: outputPath,
        status: "success",
      });
      console.log(`OK SUMMARY GROUP ${groupTitle}`);
    } catch (err) {
      report.summaryGroups.push({
        group: groupTitle,
        output: outputPath,
        status: "failed",
        error: err.message,
      });
      console.error(`FAIL SUMMARY GROUP ${groupTitle}: ${err.message}`);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputDir = path.resolve(process.cwd(), args.input);
  const outputDir = path.resolve(process.cwd(), args.output);
  const cachePath = path.resolve(
    process.cwd(),
    args.summarize ? SUMMARY_CACHE_FILENAME : CACHE_FILENAME
  );
  const reportPath = path.resolve(
    process.cwd(),
    args.summarize ? SUMMARY_REPORT_FILENAME : REPORT_FILENAME
  );
  const examplePath = path.resolve(process.cwd(), "example.md");
  const summaryExamplePath = path.resolve(process.cwd(), "example_summary.md");

  if (!process.env.OPENAI_API_KEY) {
    console.error("Missing OPENAI_API_KEY. Set it in your environment and try again.");
    process.exit(1);
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const cache = await loadCache(cachePath, args.verbose);
  if (!args.minimalProse && !(await exists(examplePath))) {
    throw new Error(`Missing example.md style template at: ${examplePath}`);
  }
  const exampleMarkdown = !args.minimalProse
    ? await fs.readFile(examplePath, "utf8")
    : "";
  const summaryExampleMarkdown = (await exists(summaryExamplePath))
    ? await fs.readFile(summaryExamplePath, "utf8")
    : null;
  const promptBuilder = args.summarize
    ? buildSummaryInstructions(exampleMarkdown, summaryExampleMarkdown)
    : args.minimalProse
      ? buildMinimalRewriteInstructions()
      : buildRewriteInstructions(exampleMarkdown);

  let files = [];
  if (args.file) {
    const filePath = path.resolve(process.cwd(), args.file);
    if (!(await exists(filePath))) {
      throw new Error(`File not found: ${filePath}`);
    }
    files = [filePath];
  } else {
    if (!(await exists(inputDir))) {
      throw new Error(`Input directory not found: ${inputDir}`);
    }
    files = await scanDirectory(inputDir);
  }

  console.log(`Found ${files.length} file(s) to consider.`);

  const report = {
    startedAt: new Date().toISOString(),
    input: inputDir,
    output: outputDir,
    model: args.model,
    mode: args.summarize ? "summary" : "full",
    totalFound: files.length,
    totalProcessed: 0,
    totalSkipped: 0,
    totalFailed: 0,
    elapsedMs: 0,
    files: [],
    consistency: [],
    summaryGroups: [],
  };

  const start = Date.now();
  const { processed, skipped, failed } = await processFiles({
    files,
    inputDir,
    outputDir,
    client,
    model: args.model,
    temperature: args.temperature,
    concurrency: args.concurrency,
    force: args.force,
    dryRun: args.dryRun,
    verbose: args.verbose,
    cache,
    report,
    promptBuilder,
    summaryMode: args.summarize,
    minimalProse: args.minimalProse,
    allowMetaSummary: args.allowMetaSummary,
    summaryMaxRatio: args.summaryMaxRatio,
  });

  report.totalProcessed = processed;
  report.totalSkipped = skipped;
  report.totalFailed = failed;

  if (args.consistency && !args.summarize) {
    const groups = groupByChapter(files);
    const consistencyOutput = path.resolve(process.cwd(), CONSISTENCY_OUTPUT_DIR);
    await runConsistencyPass({
      groups,
      inputDir,
      baseOutputDir: outputDir,
      outputDir: consistencyOutput,
      client,
      model: args.model,
      temperature: args.temperature,
      verbose: args.verbose,
      dryRun: args.dryRun,
      report,
    });
  }

  if (args.summarize) {
    const groups = groupByChapter(files);
    const summaryGroupOutput = path.resolve(process.cwd(), SUMMARY_GROUP_OUTPUT_DIR);
    await runSummaryGroupingPass({
      groups,
      inputDir,
      baseOutputDir: outputDir,
      outputDir: summaryGroupOutput,
      dryRun: args.dryRun,
      report,
    });
  }

  report.elapsedMs = Date.now() - start;

  if (!args.dryRun) {
    await saveCache(cachePath, cache);
  }
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");

  console.log(
    `Done. Processed: ${processed}, Skipped: ${skipped}, Failed: ${failed}.`
  );
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
