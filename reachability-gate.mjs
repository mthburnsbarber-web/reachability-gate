#!/usr/bin/env node
// reachability-gate: fail when an action is registered but nothing a person
// can use reaches it.
//
// A capability is not shipped because a handler exists. It is shipped when a
// person can reach it: a button, a menu or tray item, a hotkey, a palette
// entry. Tests that call a handler directly prove the handler works. They do
// not prove that anyone can get to it.
//
// The gate reads source text. It finds every place an action is registered
// and every place one is dispatched, decides which dispatch sites sit behind
// something a person can use, and fails when a registered action has none.
//
// Exit codes: 0 clean, 1 unreachable action found, 2 usage error or no
// registrations found (wrong tree, or the register call was renamed).

import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Resolve through symlinks so package.json is found when this file runs from
// an npm bin link, from npx, or from a path that contains spaces.
const SCRIPT = realpathSync(fileURLToPath(import.meta.url));
const ROOT = path.dirname(SCRIPT);
const TOOL = "reachability-gate";

export class UsageError extends Error {}
class NoRegistrationsError extends UsageError {}

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const toArray = (v) => (Array.isArray(v) ? v : isObject(v) ? [v] : []);
const isFalse = (v) => v === false || (typeof v === "string" && v.trim() === "false");
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const uniq = (list) => [...new Set(list)];

// ---------------------------------------------------------------- presets

const SKIP_DIRS = ["node_modules", ".git", "dist", "release", "build", "test-results"];
const TEST_PATHS = [
  "**/test/**",
  "**/tests/**",
  "**/__tests__/**",
  "**/__mocks__/**",
  "**/e2e/**",
  "**/*.test.*",
  "**/*.spec.*",
];

// `function name(` and `const name = (`: the two shapes the action-bus rules
// have always followed.
const SIMPLE_FUNCTIONS = [
  "^\\s*(?:async\\s+)?function\\s+(\\w+)\\s*\\(",
  "^\\s*(?:const|let)\\s+(\\w+)\\s*=\\s*(?:async\\s*)?\\(",
];

// Adds exports, `var`, arrow functions without parentheses, class methods and
// class fields that hold an arrow function.
const FUNCTIONS = [
  "^\\s*(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?function\\s*\\*?\\s*(\\w+)\\s*\\(",
  "^\\s*(?:export\\s+)?(?:const|let|var)\\s+(\\w+)\\s*(?::[^=]+)?=\\s*(?:async\\s+)?(?:function\\b|\\(|\\w+\\s*=>)",
  "^\\s*(?:(?:public|private|protected|static|async|override)\\s+)*(?!(?:if|for|while|switch|catch|with|return|function|else)\\b)(\\w+)\\s*\\([^()]*\\)\\s*(?::\\s*[^={]+)?\\{",
  "^\\s*(?:(?:public|private|protected|static|readonly)\\s+)*(\\w+)\\s*(?::[^=]+)?=\\s*(?:async\\s+)?(?:\\([^)]*\\)\\s*(?::[^=]+)?=>|\\w+\\s*=>)",
];

// Code near one of these is something a person touches: a DOM listener, a
// menu or tray template, a global hotkey.
const MENU_CONTEXT = [
  "addEventListener\\(",
  "onclick",
  "click:",
  "Menu\\.buildFromTemplate",
  "globalShortcut\\.register",
  "bindAction\\(",
  "setContextMenu",
];

// A named function counts as a surface when one of these wires it up.
const MENU_WIRING = [
  "on\\(\\s*[\"'`]\\w+[\"'`]\\s*,\\s*{fn}\\b",
  "click:\\s*{fn}\\b",
  "globalShortcut\\.register\\([^,]+,\\s*{fn}\\b",
];

export const PRESETS = {
  "action-bus": {
    description: "bus.register(\"id\") handlers, dispatched with { kind: \"id\" }",
    verb: "dispatched",
    extensions: [".ts", ".tsx", ".js", ".mjs", ".html"],
    skipDirs: SKIP_DIRS,
    idPattern: "[\\w.]+",
    register: ["bus\\.register\\(\\s*{id}"],
    dispatch: ["kind:\\s*{id}"],
    surfacePaths: ["**/renderer/**", "**/overlay/**", "**/preload/**"],
    internalPaths: [],
    surfaceContext: MENU_CONTEXT,
    contextLines: [6, 2],
    surfaceBlocks: [],
    wiring: MENU_WIRING,
    functionPatterns: SIMPLE_FUNCTIONS,
    followHandlers: false,
  },
  vscode: {
    description: "VS Code extension commands against package.json contributes",
    verb: "invoked",
    manifest: "vscode",
    extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"],
    skipDirs: [...SKIP_DIRS, "out", "coverage", ".vscode-test"],
    idPattern: "[\\w.:/@+-]+",
    register: ["\\bcommands\\s*\\.\\s*register(?:TextEditor)?Command\\s*\\(\\s*{id}"],
    dispatch: [
      "\\bcommands\\s*\\.\\s*executeCommand\\s*(?:<[^>()]*>)?\\s*\\(\\s*{id}",
      { pattern: "\\bcommand\\s*:\\s*{id}", surface: true, label: "command field" },
      { pattern: "\\.command\\s*=\\s*{id}", surface: true, label: "command field" },
      { pattern: "[(\"'`]command:{bareid}", surface: true, label: "command link" },
    ],
    surfacePaths: [],
    internalPaths: TEST_PATHS,
    surfaceContext: [
      "show(?:Information|Warning|Error)Message\\s*\\(",
      "showQuickPick\\s*\\(",
    ],
    contextLines: [6, 2],
    surfaceBlocks: ["onDidReceiveMessage\\s*\\("],
    wiring: [
      "onDidReceiveMessage\\s*\\(\\s*(?:this\\.)?{fn}\\b",
      "onDidReceiveMessage\\s*\\(\\s*(?:\\(\\s*\\w*\\s*\\)|\\w+)\\s*=>\\s*(?:this\\.)?{fn}\\s*\\(",
    ],
    functionPatterns: FUNCTIONS,
    followHandlers: true,
  },
  electron: {
    description: "ipcMain.handle/on channels against ipcRenderer.invoke/send",
    verb: "dispatched",
    extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".html", ".vue", ".svelte"],
    skipDirs: [...SKIP_DIRS, "out", "coverage"],
    idPattern: "[\\w.:/@+-]+",
    register: ["(?:\\bipcMain|\\.ipc)\\s*\\.\\s*(?:handle|handleOnce|on|once|addListener)\\s*\\(\\s*{id}"],
    dispatch: [
      {
        pattern: "\\bipcRenderer\\s*\\.\\s*(?:invoke|send|sendSync|postMessage)\\s*\\(\\s*{id}",
        surface: true,
        label: "ipcRenderer call",
      },
      "\\bipcMain\\s*\\.\\s*emit\\s*\\(\\s*{id}",
    ],
    surfacePaths: [],
    internalPaths: TEST_PATHS,
    surfaceContext: [...MENU_CONTEXT, "\\.on\\(\\s*[\"'`](?:click|right-click|double-click|middle-click)[\"'`]"],
    contextLines: [6, 2],
    surfaceBlocks: [],
    wiring: [
      "on\\(\\s*[\"'`][\\w-]+[\"'`]\\s*,\\s*{fn}\\b",
      "click:\\s*{fn}\\b",
      "globalShortcut\\.register\\([^,]+,\\s*{fn}\\b",
    ],
    functionPatterns: FUNCTIONS,
    followHandlers: true,
  },
};

const DEFAULT_PRESET = "action-bus";
const RULE_KEYS = [
  "extensions",
  "skipDirs",
  "idPattern",
  "register",
  "dispatch",
  "surfacePaths",
  "internalPaths",
  "surfaceContext",
  "contextLines",
  "surfaceBlocks",
  "wiring",
  "functionPatterns",
  "followHandlers",
];

// ---------------------------------------------------------------- config

function readJson(file, label) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (err) {
    throw new UsageError(`cannot read ${label}: ${err.code ?? err.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new UsageError(`${label}: ${err.message}`);
  }
}

export function loadConfig(file, label = file) {
  const config = readJson(file, label);
  if (!isObject(config)) throw new UsageError(`${label}: must be a JSON object`);
  for (const key of Object.keys(config)) {
    if (key.startsWith("$")) continue; // "$comment" and friends
    if (key !== "preset" && key !== "allow" && !RULE_KEYS.includes(key)) {
      throw new UsageError(`${label}: unknown key "${key}"`);
    }
  }
  if ("preset" in config && typeof config.preset !== "string") {
    throw new UsageError(`${label}: preset must be a string`);
  }
  if ("allow" in config) validateAllow(config.allow, label);
  return config;
}

// Every allow entry needs an id and a reason. A bare allow hides a failure
// without saying why, so it is a usage error.
function validateAllow(list, label) {
  if (!Array.isArray(list)) throw new UsageError(`${label}: allow must be an array`);
  list.forEach((entry, i) => {
    if (!isObject(entry) || typeof entry.id !== "string" || !entry.id.trim()) {
      throw new UsageError(`${label}: allow[${i}] needs an "id"`);
    }
    if (typeof entry.reason !== "string" || !entry.reason.trim()) {
      throw new UsageError(`${label}: allow[${i}] (${entry.id}) needs a "reason"`);
    }
  });
}

// A list in a config replaces the preset's list. A "..." entry splices the
// preset's list in at that point.
function mergeList(key, value, base, label) {
  if (!Array.isArray(value)) throw new UsageError(`${label}: ${key} must be an array`);
  const out = [];
  for (const entry of value) {
    if (entry === "...") out.push(...(base ?? []));
    else out.push(entry);
  }
  return out;
}

export function resolveRules(presetName = DEFAULT_PRESET, config = null, label = "config") {
  const preset = PRESETS[presetName];
  if (!preset) {
    throw new UsageError(`unknown preset "${presetName}"; use one of ${Object.keys(PRESETS).join(", ")}`);
  }
  const rules = { name: presetName, ...preset };
  if (!config) return rules;
  for (const key of RULE_KEYS) {
    if (!(key in config)) continue;
    const value = config[key];
    if (key === "idPattern") {
      if (typeof value !== "string" || !value) throw new UsageError(`${label}: idPattern must be a non-empty string`);
      rules[key] = value;
    } else if (key === "followHandlers") {
      if (typeof value !== "boolean") throw new UsageError(`${label}: followHandlers must be true or false`);
      rules[key] = value;
    } else if (key === "contextLines") {
      if (!Array.isArray(value) || value.length !== 2 || !value.every((n) => Number.isInteger(n) && n >= 0)) {
        throw new UsageError(`${label}: contextLines must be [linesBefore, linesAfter]`);
      }
      rules[key] = value;
    } else {
      const list = mergeList(key, value, preset[key], label);
      for (const entry of list) {
        const ok =
          typeof entry === "string" ||
          (key === "dispatch" && isObject(entry) && typeof entry.pattern === "string");
        if (!ok) throw new UsageError(`${label}: ${key} has an entry that is not a string: ${JSON.stringify(entry)}`);
      }
      rules[key] = list;
    }
  }
  return rules;
}

// ---------------------------------------------------------------- compile

// Minimal glob: ** (any depth), * (within one segment), ?, {a,b}. Matched
// against the path relative to the scanned root, case-insensitive. A pattern
// with no "/" matches at any depth.
function globToRegExp(glob) {
  const source = glob.includes("/") ? glob : `**/${glob}`;
  const body = (g) => {
    let re = "";
    for (let i = 0; i < g.length; i++) {
      const c = g[i];
      if (c === "*" && g[i + 1] === "*") {
        const segmentStart = i === 0 || g[i - 1] === "/";
        if (segmentStart && g[i + 2] === "/") {
          re += "(?:.*/)?";
          i += 2;
        } else {
          re += ".*";
          i += 1;
        }
      } else if (c === "*") re += "[^/]*";
      else if (c === "?") re += "[^/]";
      else if (c === "{") {
        const close = g.indexOf("}", i);
        if (close === -1) re += "\\{";
        else {
          re += `(?:${g.slice(i + 1, close).split(",").map(body).join("|")})`;
          i = close;
        }
      } else re += escapeRegExp(c);
    }
    return re;
  };
  return new RegExp(`^${body(source.replace(/^\.\//, ""))}$`, "i");
}

function compileRules(rules, label) {
  const where = (key) => (label ? `${label}: ${key}` : key);
  const regex = (key, source, flags = "") => {
    try {
      return new RegExp(source, flags);
    } catch (err) {
      throw new UsageError(`${where(key)}: ${err.message}`);
    }
  };
  regex("idPattern", rules.idPattern);
  const quoted = `["'\`](?<id>${rules.idPattern})["'\`]`;
  const bare = `(?<id>${rules.idPattern})`;
  const idRegex = (key, entry) => {
    const placeholders = entry.match(/\{(?:bare)?id\}/g) ?? [];
    if (placeholders.length > 1) throw new UsageError(`${where(key)}: use {id} once in ${JSON.stringify(entry)}`);
    // No {id}: the entry is a literal call prefix such as "bus.register(".
    const source = placeholders.length
      ? entry.replace("{id}", quoted).replace("{bareid}", bare)
      : `${/^[\w$]/.test(entry) ? "(?<![\\w$])" : ""}${escapeRegExp(entry)}\\s*${quoted}`;
    return regex(key, source, "g");
  };

  if (!rules.register.length) throw new UsageError(`${where("register")}: needs at least one pattern`);
  const globs = (key) => {
    const res = rules[key].map(globToRegExp);
    return (rel) => res.some((re) => re.test(rel));
  };
  for (const [i, source] of rules.functionPatterns.entries()) {
    const groups = regex("functionPatterns", `${source}|`).exec("").length - 1;
    if (groups < 1) throw new UsageError(`${where("functionPatterns")}[${i}]: needs a capture group for the name`);
  }
  for (const entry of rules.wiring) {
    if (!entry.includes("{fn}")) throw new UsageError(`${where("wiring")}: ${JSON.stringify(entry)} needs {fn}`);
    regex("wiring", entry.replaceAll("{fn}", "name"));
  }

  return {
    register: rules.register.map((entry) => idRegex("register", entry)),
    dispatch: rules.dispatch.map((entry) =>
      typeof entry === "string"
        ? { re: idRegex("dispatch", entry), surface: false, label: null }
        : {
            re: idRegex("dispatch", entry.pattern),
            surface: entry.surface === true,
            label: typeof entry.label === "string" ? entry.label : null,
          },
    ),
    extensions: new Set(rules.extensions.map((e) => e.toLowerCase())),
    skipDirs: new Set(rules.skipDirs),
    isSurfacePath: globs("surfacePaths"),
    isInternalPath: globs("internalPaths"),
    surfaceContext: rules.surfaceContext.length ? regex("surfaceContext", rules.surfaceContext.join("|")) : null,
    contextBefore: rules.contextLines[0],
    contextAfter: rules.contextLines[1],
    surfaceBlocks: rules.surfaceBlocks.map((source) => regex("surfaceBlocks", source, "g")),
    wiring: rules.wiring.length
      ? (fn) => new RegExp(rules.wiring.map((w) => w.replaceAll("{fn}", escapeRegExp(fn))).join("|"))
      : null,
    functionPatterns: rules.functionPatterns.map((source) => regex("functionPatterns", source)),
  };
}

// ---------------------------------------------------------------- lexing

// Comments must never count as registrations or dispatches. lex() returns
// two copies of the source with the same length and line breaks:
//   code      comments blanked, strings kept (patterns run here)
//   skeleton  comments, string, template and regex contents blanked
//             (bracket matching runs here)
// Strings are tracked, so "http://example.com" is not a comment.

const REGEX_AFTER_WORD = new Set([
  "return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "await",
]);
const REGEX_AFTER_PUNCT = new Set("(,=:[!&|?{};+-*%<>~^}".split(""));

function regexEnd(src, start, end) {
  let inClass = false;
  for (let j = start + 1; j < end; j++) {
    const ch = src[j];
    if (ch === "\n") return -1;
    if (ch === "\\") {
      j++;
      continue;
    }
    if (inClass) {
      if (ch === "]") inClass = false;
    } else if (ch === "[") inClass = true;
    else if (ch === "/") return j;
  }
  return -1;
}

function lexJs(src, code, skel, start, end) {
  const blank = (a, b, alsoCode) => {
    for (let k = a; k < b; k++) {
      if (src[k] === "\n" || src[k] === "\r") continue;
      skel[k] = " ";
      if (alsoCode) code[k] = " ";
    }
  };
  let i = start;
  let prev = ""; // last significant token: a punctuation char, or "w"
  let word = "";
  let depth = 0;
  let inTemplate = false;
  const templateDepths = [];
  while (i < end) {
    const c = src[i];
    if (inTemplate) {
      if (c === "\\") {
        blank(i, Math.min(i + 2, end));
        i += 2;
      } else if (c === "`") {
        inTemplate = false;
        prev = "w";
        word = "";
        i++;
      } else if (c === "$" && src[i + 1] === "{") {
        templateDepths.push(depth);
        depth++;
        inTemplate = false;
        prev = "{";
        i += 2;
      } else {
        blank(i, i + 1);
        i++;
      }
      continue;
    }
    const next = src[i + 1];
    if (c === "/" && next === "/") {
      let j = i;
      while (j < end && src[j] !== "\n") j++;
      blank(i, j, true);
      i = j;
      continue;
    }
    if (c === "/" && next === "*") {
      const close = src.indexOf("*/", i + 2);
      const j = close === -1 || close + 2 > end ? end : close + 2;
      blank(i, j, true);
      i = j;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < end && src[j] !== c && src[j] !== "\n") j += src[j] === "\\" ? 2 : 1;
      j = Math.min(j, end);
      blank(i + 1, j);
      i = src[j] === c ? j + 1 : j; // an unterminated string stops at the line end
      prev = "w";
      word = "";
      continue;
    }
    if (c === "`") {
      inTemplate = true;
      i++;
      continue;
    }
    if (c === "/") {
      const regexAllowed = prev === "" || REGEX_AFTER_PUNCT.has(prev) || (prev === "w" && REGEX_AFTER_WORD.has(word));
      const close = regexAllowed ? regexEnd(src, i, end) : -1;
      if (close !== -1) {
        blank(i + 1, close);
        i = close + 1;
        while (i < end && /[A-Za-z]/.test(src[i])) i++;
        prev = "w";
        word = "";
        continue;
      }
      prev = "/";
      i++;
      continue;
    }
    if (/[A-Za-z0-9_$]/.test(c)) {
      let j = i + 1;
      while (j < end && /[\w$]/.test(src[j])) j++;
      word = src.slice(i, j);
      prev = "w";
      i = j;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      if (templateDepths.length && templateDepths[templateDepths.length - 1] === depth - 1) {
        templateDepths.pop();
        depth--;
        inTemplate = true;
        i++;
        continue;
      }
      depth--;
    }
    if (!/\s/.test(c)) {
      prev = c;
      word = "";
    }
    i++;
  }
}

const MARKUP_EXT = new Set([".html", ".htm", ".vue", ".svelte"]);

function lex(src, ext) {
  const code = src.split("");
  const skel = src.split("");
  if (!MARKUP_EXT.has(ext)) {
    lexJs(src, code, skel, 0, src.length);
  } else {
    // Markup: blank <!-- --> comments, and lex the body of each <script>.
    const lower = src.toLowerCase();
    let i = 0;
    while (i < src.length) {
      if (src.startsWith("<!--", i)) {
        const close = src.indexOf("-->", i + 4);
        const j = close === -1 ? src.length : close + 3;
        for (let k = i; k < j; k++) {
          if (src[k] !== "\n" && src[k] !== "\r") code[k] = skel[k] = " ";
        }
        i = j;
      } else if (lower.startsWith("<script", i) && /[\s>]/.test(src[i + 7] ?? "")) {
        const open = src.indexOf(">", i);
        if (open === -1) break;
        const close = lower.indexOf("</script", open + 1);
        const j = close === -1 ? src.length : close;
        lexJs(src, code, skel, open + 1, j);
        i = j === src.length ? j : j + 8;
      } else i++;
    }
  }
  return { code: code.join(""), skeleton: skel.join("") };
}

// Index of the bracket that closes the level `from` sits in, or the end.
function closingIndex(skel, from) {
  let depth = 0;
  for (let i = from; i < skel.length; i++) {
    const c = skel[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      if (depth === 0) return i;
      depth--;
    }
  }
  return skel.length;
}

function lineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  return starts;
}

function lineIndex(starts, offset) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

// For each line, the nearest function declared at or above it.
function functionNames(lines, patterns) {
  const names = new Array(lines.length);
  let current = null;
  for (let i = 0; i < lines.length; i++) {
    for (const re of patterns) {
      const m = re.exec(lines[i]);
      const name = m?.slice(1).find(Boolean);
      if (name) {
        current = name;
        break;
      }
    }
    names[i] = current;
  }
  return names;
}

// ---------------------------------------------------------------- scan

function listFiles(rootAbs, compiled) {
  const out = [];
  const walk = (dir, rel) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      throw new UsageError(`cannot read ${rel || "."}: ${err.code ?? err.message}`);
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!compiled.skipDirs.has(entry.name)) walk(path.join(dir, entry.name), childRel);
      } else if (entry.isFile() && compiled.extensions.has(path.extname(entry.name).toLowerCase())) {
        out.push(childRel);
      }
    }
  };
  walk(rootAbs, "");
  return out;
}

function scanTree(rootAbs, rules, compiled) {
  const registrations = [];
  const sites = [];
  const needFunctions = compiled.wiring !== null || rules.followHandlers;

  for (const rel of listFiles(rootAbs, compiled)) {
    let src;
    try {
      src = readFileSync(path.join(rootAbs, rel), "utf8");
    } catch (err) {
      throw new UsageError(`cannot read ${rel}: ${err.code ?? err.message}`);
    }
    const { code, skeleton } = lex(src, path.extname(rel).toLowerCase());
    const starts = lineStarts(code);
    const lines = code.split("\n");
    const internal = compiled.isInternalPath(rel);
    const surfacePath = compiled.isSurfacePath(rel);

    // Registrations in internal paths (tests, mocks) are scaffolding, not
    // capabilities, so they are not counted.
    const fileRegs = [];
    if (!internal) {
      for (const re of compiled.register) {
        for (const m of code.matchAll(re)) {
          const after = m.index + m[0].length;
          const named = /^\s*,\s*(?:this\s*\.\s*)?([A-Za-z_$][\w$]*)\s*(?:[,)]|\.\s*bind\s*\()/.exec(
            code.slice(after, after + 300),
          );
          fileRegs.push({
            id: m.groups.id,
            file: rel,
            line: lineIndex(starts, m.index) + 1,
            start: after,
            end: closingIndex(skeleton, after),
            handlerName: named?.[1] ?? null,
          });
        }
      }
      fileRegs.sort((a, b) => a.start - b.start);
      registrations.push(...fileRegs);
    }

    const fnAt = needFunctions ? functionNames(lines, compiled.functionPatterns) : null;
    const blocks = [];
    for (const re of compiled.surfaceBlocks) {
      for (const m of code.matchAll(re)) {
        const s = m.index + m[0].length;
        blocks.push([s, closingIndex(skeleton, s)]);
      }
    }
    const wired = new Map();
    const isWired = (fn) => {
      if (!wired.has(fn)) wired.set(fn, compiled.wiring !== null && compiled.wiring(fn).test(code));
      return wired.get(fn);
    };

    for (const rule of compiled.dispatch) {
      for (const m of code.matchAll(rule.re)) {
        const offset = m.index;
        const index = lineIndex(starts, offset);
        const site = { id: m.groups.id, file: rel, at: `${rel}:${index + 1}`, internalPath: internal, how: null };
        sites.push(site);
        if (internal) continue;

        let owner = null; // innermost registration whose handler holds this site
        for (const r of fileRegs) if (r.start <= offset && offset < r.end) owner = r;
        site.ownerId = owner?.id ?? null;
        site.fn = fnAt?.[index] ?? null;

        // In a surface file every dispatch is user-initiated. Elsewhere a
        // dispatch counts when it sits in a click handler, a menu template
        // or a hotkey registration, or inside a named function that one of
        // those wires up. Following that one level matters: a togglePanel()
        // attached to the tray click and the hotkey is a working control,
        // and a gate that reports working controls as dead gets switched off.
        if (rule.surface) site.how = rule.label ?? "surface pattern";
        else if (surfacePath) site.how = "surface path";
        else if (
          compiled.surfaceContext &&
          compiled.surfaceContext.test(
            lines.slice(Math.max(0, index - compiled.contextBefore), index + compiled.contextAfter + 1).join("\n"),
          )
        ) site.how = "surface context";
        else if (blocks.some(([s, e]) => s <= offset && offset < e)) site.how = "surface block";
        else if (site.fn && isWired(site.fn)) site.how = `wired function ${site.fn}`;
      }
    }
  }
  return { registrations, sites };
}

// ---------------------------------------------------------------- vscode

function walkStrings(value, where, visit) {
  if (typeof value === "string") visit(value, where);
  else if (Array.isArray(value)) value.forEach((v, i) => walkStrings(v, `${where}[${i}]`, visit));
  else if (isObject(value)) for (const [k, v] of Object.entries(value)) walkStrings(v, `${where}.${k}`, visit);
}

function readVscodeManifest(rootAbs, display, rules) {
  const file = path.join(rootAbs, "package.json");
  const label = `${display}/package.json`;
  if (!existsSync(file)) {
    throw new UsageError(`${display}: no package.json. The vscode preset needs the extension's root directory.`);
  }
  const pkg = readJson(file, label);
  if (!isObject(pkg) || !isObject(pkg.engines) || typeof pkg.engines.vscode !== "string") {
    throw new UsageError(`${label} has no engines.vscode, so this is not a VS Code extension root`);
  }
  const contributes = isObject(pkg.contributes) ? pkg.contributes : {};
  const commands = new Map();
  for (const entry of toArray(contributes.commands)) {
    if (isObject(entry) && typeof entry.command === "string" && !commands.has(entry.command)) {
      commands.set(entry.command, entry);
    }
  }
  const links = [];
  const linkRe = new RegExp(`\\]\\(command:(${rules.idPattern})`, "g");
  walkStrings(contributes, "contributes", (value, where) => {
    if (/^contributes\.(?:commands|menus|keybindings)\b/.test(where)) return;
    for (const m of value.matchAll(linkRe)) links.push({ id: m[1], where });
  });
  return {
    commands,
    menus: isObject(contributes.menus) ? contributes.menus : {},
    submenus: new Set(toArray(contributes.submenus).filter((s) => isObject(s) && typeof s.id === "string").map((s) => s.id)),
    keybindings: toArray(contributes.keybindings).filter(isObject),
    links,
  };
}

// Which contribution points put each command in front of a person.
//   contributes.commands      in the Command Palette, unless every
//                             menus.commandPalette entry for it says
//                             "when": "false"
//   contributes.menus.<menu>  shown in that menu, but only if the command is
//                             also in contributes.commands: VS Code drops a
//                             menu item whose command is not declared there
//   contributes.keybindings   bound to a key (no contributes.commands entry needed)
//   "[label](command:id)"     a command link in welcome views or walkthroughs
// "enablement": "false" disables a command in every menu and keybinding.
function vscodeRoutes(manifest) {
  const info = new Map();
  const get = (id) => {
    if (!info.has(id)) {
      info.set(id, { routes: [], droppedMenus: [], hidden: false, disabled: false, inCommands: manifest.commands.has(id) });
    }
    return info.get(id);
  };

  // A contributed submenu is visible only if a visible menu shows it.
  const shownSubmenus = new Set();
  for (let grew = true; grew; ) {
    grew = false;
    for (const [key, items] of Object.entries(manifest.menus)) {
      if (key === "commandPalette" || (manifest.submenus.has(key) && !shownSubmenus.has(key))) continue;
      for (const item of toArray(items)) {
        if (isObject(item) && manifest.submenus.has(item.submenu) && !isFalse(item.when) && !shownSubmenus.has(item.submenu)) {
          shownSubmenus.add(item.submenu);
          grew = true;
        }
      }
    }
  }

  const palette = toArray(manifest.menus.commandPalette).filter(isObject);
  for (const [id, entry] of manifest.commands) {
    const rec = get(id);
    rec.disabled = isFalse(entry.enablement);
    const entries = palette.filter((item) => item.command === id);
    rec.hidden = entries.length > 0 && entries.every((item) => isFalse(item.when));
    if (!rec.disabled && !rec.hidden) rec.routes.push("contributes.commands (Command Palette)");
  }
  for (const [key, items] of Object.entries(manifest.menus)) {
    if (key === "commandPalette") continue;
    for (const item of toArray(items)) {
      if (!isObject(item)) continue;
      for (const id of [item.command, item.alt]) {
        if (typeof id !== "string") continue;
        const rec = get(id);
        if (!rec.inCommands) {
          rec.droppedMenus.push(key);
          continue;
        }
        if (rec.disabled || isFalse(item.when)) continue;
        if (manifest.submenus.has(key) && !shownSubmenus.has(key)) continue;
        rec.routes.push(`contributes.menus.${key}`);
      }
    }
  }
  for (const binding of manifest.keybindings) {
    if (typeof binding.command !== "string" || binding.command.startsWith("-") || isFalse(binding.when)) continue;
    const key = [binding.key, binding.mac, binding.linux, binding.win].find((k) => typeof k === "string" && k.trim());
    if (!key) continue;
    const rec = get(binding.command);
    if (!rec.disabled) rec.routes.push(`contributes.keybindings (${key})`);
  }
  for (const link of manifest.links) {
    const rec = get(link.id);
    if (!rec.disabled) rec.routes.push(`command link in ${link.where}`);
  }
  return info;
}

// ---------------------------------------------------------------- evaluate

function listSites(list) {
  const shown = list.slice(0, 2).join(", ");
  return list.length > 2 ? `${shown} and ${list.length - 2} more` : shown;
}

/**
 * Scan a tree and decide, for every registered action, whether a person can
 * reach it. Throws UsageError on bad input or when nothing is registered.
 */
export function checkReachability(root, options = {}) {
  const display = (options.display ?? root).replace(/(.)[\\/]+$/, "$1");
  const rootAbs = path.resolve(root);
  let stat;
  try {
    stat = statSync(rootAbs);
  } catch {
    throw new UsageError(`no such directory: ${display}`);
  }
  if (!stat.isDirectory()) throw new UsageError(`not a directory: ${display}`);

  const config = options.config ?? null;
  const configLabel = options.configLabel ?? "config";
  const presetName = options.preset ?? config?.preset ?? DEFAULT_PRESET;
  const rules = resolveRules(presetName, config, configLabel);
  const compiled = compileRules(rules, config ? configLabel : null);
  const manifest = rules.manifest === "vscode" ? readVscodeManifest(rootAbs, display, rules) : null;

  // Allowlist: every entry needs a reason, and every one is printed.
  const allow = new Map();
  validateAllow(config?.allow ?? [], configLabel);
  for (const entry of config?.allow ?? []) allow.set(entry.id, { reason: entry.reason, source: configLabel });
  validateAllow(options.allow ?? [], "--allow");
  for (const entry of options.allow ?? []) allow.set(entry.id, { reason: entry.reason, source: "--allow" });

  const { registrations, sites } = scanTree(rootAbs, rules, compiled);
  const registered = new Map();
  for (const r of registrations) if (!registered.has(r.id)) registered.set(r.id, r);
  if (registered.size === 0) {
    throw new NoRegistrationsError(
      `found no registrations under ${display}. Wrong tree, or the register call was renamed. ` +
        `Looked for: ${rules.register.join(", ")}`,
    );
  }

  // Classify every dispatch site.
  const byHandler = new Map();
  for (const r of registrations) {
    if (!r.handlerName) continue;
    if (!byHandler.has(r.handlerName)) byHandler.set(r.handlerName, []);
    byHandler.get(r.handlerName).push(r);
  }
  const surface = new Map();
  const internal = new Map();
  const edges = [];
  const push = (map, id, value) => {
    if (!map.has(id)) map.set(id, []);
    map.get(id).push(value);
  };
  for (const site of sites) {
    if (site.internalPath) {
      push(internal, site.id, site.at);
      continue;
    }
    let ownerId = site.ownerId;
    if (!ownerId && rules.followHandlers && site.fn && byHandler.has(site.fn)) {
      const candidates = byHandler.get(site.fn);
      ownerId = (candidates.find((r) => r.file === site.file) ?? candidates[0]).id;
    }
    if (rules.followHandlers && ownerId) {
      // Reachable only if the action whose handler holds it is reachable.
      if (ownerId === site.id) push(internal, site.id, site.at);
      else edges.push({ from: ownerId, to: site.id, at: site.at });
    } else if (site.how) push(surface, site.id, `${site.at} (${site.how})`);
    else push(internal, site.id, site.at);
  }

  const routes = manifest ? vscodeRoutes(manifest) : new Map();
  const via = new Map();
  for (const id of registered.keys()) {
    const route = routes.get(id)?.routes[0];
    if (route) via.set(id, route);
    else if (surface.has(id)) via.set(id, surface.get(id)[0]);
  }
  for (let changed = true; changed; ) {
    changed = false;
    for (const edge of edges) {
      if (via.has(edge.from) && registered.has(edge.to) && !via.has(edge.to)) {
        via.set(edge.to, `${edge.at} (in the handler of ${edge.from})`);
        changed = true;
      }
    }
  }

  const explainCode = (id) => {
    const blocked = edges.filter((e) => e.to === id && !via.has(e.from));
    const inside = internal.get(id) ?? [];
    const parts = [];
    if (inside.length) parts.push(`only ${rules.verb} internally at ${listSites(inside)}`);
    if (blocked.length) {
      const owners = uniq(blocked.map((e) => e.from));
      const text = `from the handler of ${owners.join(", ")} at ${listSites(blocked.map((e) => e.at))}, which ${owners.length > 1 ? "are" : "is"} unreachable`;
      parts.push(inside.length ? `or ${text}` : `only ${rules.verb} ${text}`);
    }
    return parts.length ? parts.join(", ") : null;
  };
  const explain = (id) => {
    const code = explainCode(id);
    if (!manifest) return code ?? "no dispatch site anywhere";
    const rec = routes.get(id);
    let part;
    if (rec && !rec.inCommands && rec.droppedMenus.length) {
      const menus = uniq(rec.droppedMenus).map((m) => `contributes.menus.${m}`).join(", ");
      part = `in ${menus} but not in contributes.commands, so VS Code drops the menu item`;
    } else if (rec?.inCommands && rec.disabled) {
      part = "contributed with enablement false, so it is disabled in every menu and keybinding";
    } else if (rec?.inCommands && rec.hidden) {
      part = "contributed but hidden from the palette (when: false) and in no menu or keybinding";
    } else {
      part = "not contributed in package.json";
      if (!code) return `${part} and never invoked from code`;
    }
    return code ? `${part}, and ${code}` : part;
  };

  const actions = [];
  const findings = [];
  const allowed = [];
  for (const [id, r] of [...registered].sort(([, a], [, b]) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1))) {
    const registeredAt = `${r.file}:${r.line}`;
    if (via.has(id)) {
      actions.push({ id, registeredAt, status: "reachable", via: via.get(id) });
      continue;
    }
    const reason = explain(id);
    if (allow.has(id)) {
      const a = allow.get(id);
      allowed.push({ id, registeredAt, reason: a.reason, source: a.source });
      actions.push({ id, registeredAt, status: "allowed", reason: a.reason, unreachableBecause: reason });
    } else {
      findings.push({ kind: "unreachable", id, registeredAt, reason });
      actions.push({ id, registeredAt, status: "unreachable", reason });
    }
  }
  if (manifest) {
    for (const id of manifest.commands.keys()) {
      if (registered.has(id)) continue;
      const reason = "contributed in package.json, never registered in code (a dead menu item)";
      if (allow.has(id)) {
        const a = allow.get(id);
        allowed.push({ id, registeredAt: null, reason: a.reason, source: a.source });
      } else findings.push({ kind: "unregistered", id, registeredAt: null, reason });
    }
  }

  const notes = [];
  for (const [id, a] of allow) {
    if (via.has(id)) notes.push(`${a.source} ${id} is not needed: ${id} is reachable`);
    else if (!registered.has(id) && !manifest?.commands.has(id)) notes.push(`${a.source} ${id} matches nothing registered`);
  }

  return {
    root: display,
    preset: presetName,
    config: config ? configLabel : null,
    ok: findings.length === 0,
    registered: registered.size,
    reachable: via.size,
    allowedCount: allowed.length,
    findings,
    allowed,
    notes,
    actions,
  };
}

// ---------------------------------------------------------------- CLI

const USAGE = `usage: ${TOOL} <dir> [options]

Fails when an action is registered in code but nothing a person can use reaches it.

options:
  --preset <name>                action-bus (default), vscode or electron
${Object.entries(PRESETS)
  .map(([name, preset]) => `                                   ${name.padEnd(11)}${preset.description}`)
  .join("\n")}
  --config <file>                custom rules as JSON (see examples/reachability.json)
  --allow <id> --reason "<why>"  declare one action deliberately unreachable (repeatable)
  --json                         print the result as JSON
  --quiet                        print nothing when clean
  --version                      print the version
  --help                         print this help

exit codes: 0 clean, 1 unreachable action found, 2 usage error or no registrations found`;

function parseArgs(argv) {
  const opts = { root: null, preset: null, config: null, allow: [], json: false, quiet: false, help: false, version: false };
  const value = (i, flag) => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) throw new UsageError(`${flag} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") opts.help = true;
    else if (arg === "--version" || arg === "-v") opts.version = true;
    else if (arg === "--json") opts.json = true;
    else if (arg === "--quiet" || arg === "-q") opts.quiet = true;
    else if (arg === "--preset") opts.preset = value(i++, "--preset");
    else if (arg === "--config") opts.config = value(i++, "--config");
    else if (arg === "--allow") {
      const id = value(i++, "--allow");
      if (argv[i + 1] !== "--reason") throw new UsageError(`--allow ${id} needs --reason "<why>" right after it`);
      i++;
      const reason = argv[i + 1];
      if (reason === undefined || reason.startsWith("--") || !reason.trim()) {
        throw new UsageError(`--allow ${id} needs a non-empty --reason "<why>"`);
      }
      i++;
      opts.allow.push({ id, reason });
    } else if (arg === "--reason") throw new UsageError("--reason must follow --allow <id>");
    else if (arg.startsWith("-")) throw new UsageError(`unknown option ${arg}`);
    else if (opts.root === null) opts.root = arg;
    else throw new UsageError(`unexpected argument ${arg}; give one directory`);
  }
  return opts;
}

function version() {
  return JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
}

function report(result, opts) {
  const out = (line = "") => process.stdout.write(`${line}\n`);
  const err = (line = "") => process.stderr.write(`${line}\n`);
  for (const note of result.notes) err(`${TOOL}: note: ${note}`);
  if (!opts.quiet) {
    const extra = result.allowedCount ? `, ${result.allowedCount} allowed` : "";
    const config = result.config ? `, config ${result.config}` : "";
    out(`${TOOL}: ${result.registered} registered, ${result.reachable} reachable from a user surface${extra} (preset ${result.preset}${config})`);
    for (const a of result.allowed) out(`ALLOWED  ${a.id}  ${a.registeredAt ? `registered at ${a.registeredAt}` : "contributed in package.json"}: ${a.reason}`);
  }
  if (result.ok) {
    if (!opts.quiet) out(`${TOOL}: CLEAN (${result.root})`);
    return 0;
  }
  err();
  for (const f of result.findings) {
    if (f.kind === "unreachable") err(`UNREACHABLE  ${f.id}  registered at ${f.registeredAt}, ${f.reason}`);
    else err(`UNREGISTERED  ${f.id}  ${f.reason}`);
  }
  const unreachable = result.findings.filter((f) => f.kind === "unreachable").length;
  const unregistered = result.findings.length - unreachable;
  const counts = [unreachable && `${unreachable} unreachable`, unregistered && `${unregistered} unregistered`].filter(Boolean);
  err();
  err(`${TOOL}: ${counts.join(", ")} in ${result.root}`);
  if (unreachable) err('Give each one a control a person can use, or declare it with --allow <id> --reason "<why>".');
  if (unregistered) err("Register each unregistered command in code, or remove it from package.json.");
  return 1;
}

export function main(argv) {
  const opts = parseArgs(argv);
  if (opts.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  if (opts.version) {
    process.stdout.write(`${version()}\n`);
    return 0;
  }
  if (opts.root === null) throw new UsageError(`missing <dir>\n${USAGE}`);
  const config = opts.config === null ? null : loadConfig(path.resolve(opts.config), opts.config);
  const result = checkReachability(opts.root, {
    preset: opts.preset ?? undefined,
    config,
    configLabel: opts.config ?? undefined,
    allow: opts.allow,
  });
  if (opts.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    for (const note of result.notes) process.stderr.write(`${TOOL}: note: ${note}\n`);
    return result.ok ? 0 : 1;
  }
  return report(result, opts);
}

function isMain() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === SCRIPT;
  } catch {
    return false;
  }
}

if (isMain()) {
  const argv = process.argv.slice(2);
  try {
    // exitCode, not process.exit(): a piped stdout must be flushed first.
    process.exitCode = main(argv);
  } catch (err) {
    const message = err instanceof UsageError ? err.message : err.stack;
    if (argv.includes("--json") && err instanceof UsageError) {
      process.stdout.write(`${JSON.stringify({ ok: false, error: err.message }, null, 2)}\n`);
    }
    process.stderr.write(`${TOOL}: ${message}\n`);
    process.exitCode = 2;
  }
}
