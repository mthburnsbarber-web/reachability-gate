// Every test spawns the real CLI and checks its exit code and output.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(ROOT, "reachability-gate.mjs");
const FIXTURES = path.join(ROOT, "test", "fixtures");
const EXAMPLE_CONFIG = path.join(ROOT, "examples", "reachability.json");

const temps = [];
after(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix = "reachability-gate-") {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

// A scratch copy of one fixture, so a test can edit it.
function copyFixture(name) {
  const dir = path.join(tempDir(), name);
  cpSync(path.join(FIXTURES, name), dir, { recursive: true });
  return dir;
}

function run(args, cwd = ROOT) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

// 1-based line of the first line in a fixture file that contains `needle`.
function lineOf(file, needle) {
  const index = readFileSync(file, "utf8").split("\n").findIndex((line) => line.includes(needle));
  assert.notEqual(index, -1, `${needle} not found in ${file}`);
  return index + 1;
}

const unreachableLines = (text) => text.split("\n").filter((line) => line.startsWith("UNREACHABLE"));
const fixture = (...parts) => path.join(FIXTURES, ...parts);

// ---------------------------------------------------------------- action-bus

test("private mode trap: the exit action is only dispatched from a test, so the gate fails (exit 1)", () => {
  const r = run(["test/fixtures/private-mode-trap"]);
  assert.equal(r.code, 1, r.out + r.err);
  assert.match(r.out, /4 registered, 3 reachable from a user surface \(preset action-bus\)/);
  const registeredAt = lineOf(fixture("private-mode-trap", "src/main/actions.js"), '"privateMode.exit"');
  const testAt = lineOf(fixture("private-mode-trap", "test/private-mode.test.js"), '"privateMode.exit"');
  assert.deepEqual(unreachableLines(r.err), [
    `UNREACHABLE  privateMode.exit  registered at src/main/actions.js:${registeredAt}, only dispatched internally at test/private-mode.test.js:${testAt}`,
  ]);
  assert.match(r.err, /1 unreachable in test\/fixtures\/private-mode-trap/);
});

test("private mode trap: with no dispatch at all, the reason says so", () => {
  const dir = copyFixture("private-mode-trap");
  rmSync(path.join(dir, "test"), { recursive: true });
  const r = run([dir]);
  assert.equal(r.code, 1, r.out + r.err);
  assert.match(r.err, /UNREACHABLE {2}privateMode\.exit {2}registered at src\/main\/actions\.js:\d+, no dispatch site anywhere/);
});

test("toggle panel: a dispatch inside a function wired to the tray and hotkey passes (exit 0)", () => {
  const r = run(["test/fixtures/toggle-panel"]);
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /3 registered, 3 reachable/);
  assert.match(r.out, /CLEAN \(test\/fixtures\/toggle-panel\)/);
  assert.equal(r.err, "");

  const json = JSON.parse(run(["test/fixtures/toggle-panel", "--json"]).out);
  const exit = json.actions.find((a) => a.id === "privateMode.exit");
  assert.match(exit.via, /^src\/main\/index\.js:\d+ \(wired function togglePanel\)$/);
});

test("toggle panel: unwire togglePanel and the exit action is unreachable again", () => {
  const dir = copyFixture("toggle-panel");
  const index = path.join(dir, "src/main/index.js");
  const kept = readFileSync(index, "utf8")
    .split("\n")
    .filter((line) => !line.includes("togglePanel);"))
    .join("\n");
  writeFileSync(index, kept);
  const r = run([dir]);
  assert.equal(r.code, 1, r.out + r.err);
  const at = lineOf(index, '"privateMode.exit"');
  assert.match(r.err, new RegExp(`UNREACHABLE  privateMode\\.exit  .*only dispatched internally at src/main/index\\.js:${at}`));
});

// ---------------------------------------------------------------- comments

test("comments: commented-out registrations and dispatches never count; strings with // are not comments", () => {
  const r = run(["test/fixtures/comments", "--json"]);
  assert.equal(r.code, 1, r.out + r.err);
  const json = JSON.parse(r.out);
  assert.equal(json.registered, 5);
  assert.doesNotMatch(r.out, /ghost/);

  const status = Object.fromEntries(json.actions.map((a) => [a.id, a.status]));
  assert.deepEqual(status, {
    "help.open": "reachable",
    "docs.open": "reachable",
    "link.check": "reachable",
    "label.show": "reachable",
    "export.run": "unreachable",
  });
  // export.run is dispatched only from a // comment, a /* */ comment, an
  // HTML comment and a comment inside <script>. None of those count.
  assert.deepEqual(json.findings, [
    {
      kind: "unreachable",
      id: "export.run",
      registeredAt: `src/main/actions.js:${lineOf(fixture("comments", "src/main/actions.js"), '"export.run"')}`,
      reason: "no dispatch site anywhere",
    },
  ]);
});

test("zero-registrations guard: a tree with nothing registered is a usage error (exit 2)", () => {
  const empty = tempDir();
  const r = run([empty]);
  assert.equal(r.code, 2);
  assert.match(r.err, /found no registrations under .*Wrong tree, or the register call was renamed/);
  assert.equal(r.out, "");

  // The only registration is commented out: still zero.
  const commented = tempDir();
  writeFileSync(path.join(commented, "actions.js"), '// bus.register("a.b", () => {});\n/* bus.register("c.d") */\n');
  const c = run([commented]);
  assert.equal(c.code, 2, c.out + c.err);
  assert.match(c.err, /found no registrations/);

  // The wrong preset for the tree finds nothing either.
  const wrong = run(["test/fixtures/electron-app"]);
  assert.equal(wrong.code, 2, wrong.out + wrong.err);
  assert.match(wrong.err, /found no registrations/);
});

// ---------------------------------------------------------------- options

test("--allow with a reason declares an action deliberate and prints it (exit 0)", () => {
  const r = run(["test/fixtures/private-mode-trap", "--allow", "privateMode.exit", "--reason", "Left from the tray in 2.1"]);
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /4 registered, 3 reachable from a user surface, 1 allowed/);
  assert.match(r.out, /ALLOWED {2}privateMode\.exit {2}registered at src\/main\/actions\.js:\d+: Left from the tray in 2\.1/);
  assert.match(r.out, /CLEAN/);
});

test("--allow without a reason is a usage error (exit 2)", () => {
  const cases = [
    ["--allow", "privateMode.exit"],
    ["--allow", "privateMode.exit", "--reason"],
    ["--allow", "privateMode.exit", "--reason", ""],
    ["--allow", "privateMode.exit", "--reason", "   "],
    ["--allow", "privateMode.exit", "--quiet", "--reason", "why"],
    ["--reason", "why"],
    ["--allow"],
  ];
  for (const args of cases) {
    const r = run(["test/fixtures/private-mode-trap", ...args]);
    assert.equal(r.code, 2, `${args.join(" ")}: ${r.out}${r.err}`);
    assert.match(r.err, /--allow|--reason/, args.join(" "));
    assert.equal(r.out, "", args.join(" "));
  }
});

test("--allow for something that is reachable or not registered prints a note", () => {
  const r = run([
    "test/fixtures/private-mode-trap",
    "--allow", "privateMode.exit", "--reason", "tracked separately",
    "--allow", "notes.open", "--reason", "old entry",
    "--allow", "no.such.action", "--reason", "typo",
  ]);
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.err, /note: --allow notes\.open is not needed: notes\.open is reachable/);
  assert.match(r.err, /note: --allow no\.such\.action matches nothing registered/);
});

test("--json prints the whole result and keeps the exit code", () => {
  const r = run(["test/fixtures/private-mode-trap", "--json"]);
  assert.equal(r.code, 1);
  assert.equal(r.err, "");
  const json = JSON.parse(r.out);
  assert.equal(json.ok, false);
  assert.equal(json.preset, "action-bus");
  assert.equal(json.registered, 4);
  assert.equal(json.reachable, 3);
  assert.equal(json.findings.length, 1);
  assert.equal(json.findings[0].id, "privateMode.exit");
  assert.match(json.findings[0].reason, /^only dispatched internally at test\/private-mode\.test\.js:\d+$/);
  assert.deepEqual(
    json.actions.map((a) => [a.id, a.status]),
    [
      ["notes.open", "reachable"],
      ["notes.search", "reachable"],
      ["privateMode.enter", "reachable"],
      ["privateMode.exit", "unreachable"],
    ],
  );

  const clean = run(["test/fixtures/toggle-panel", "--json"]);
  assert.equal(clean.code, 0);
  assert.equal(JSON.parse(clean.out).ok, true);

  const empty = run([tempDir(), "--json"]);
  assert.equal(empty.code, 2);
  assert.match(JSON.parse(empty.out).error, /found no registrations/);
});

test("--quiet prints nothing when clean and only the findings when not", () => {
  const clean = run(["test/fixtures/toggle-panel", "--quiet"]);
  assert.equal(clean.code, 0);
  assert.equal(clean.out + clean.err, "");

  const failing = run(["test/fixtures/private-mode-trap", "--quiet"]);
  assert.equal(failing.code, 1);
  assert.equal(failing.out, "");
  assert.equal(unreachableLines(failing.err).length, 1);
});

test("usage errors exit 2", () => {
  const cases = [
    [[], /missing <dir>/],
    [["test/fixtures/toggle-panel", "--frobnicate"], /unknown option --frobnicate/],
    [["test/fixtures/toggle-panel", "test/fixtures/comments"], /unexpected argument/],
    [["test/fixtures/no-such-dir"], /no such directory: test\/fixtures\/no-such-dir/],
    [["package.json"], /not a directory/],
    [["test/fixtures/toggle-panel", "--preset", "qt"], /unknown preset "qt"/],
    [["test/fixtures/toggle-panel", "--preset"], /--preset needs a value/],
    [["test/fixtures/toggle-panel", "--config", "missing.json"], /cannot read missing\.json/],
  ];
  for (const [args, pattern] of cases) {
    const r = run(args);
    assert.equal(r.code, 2, `${args.join(" ")}: ${r.out}${r.err}`);
    assert.match(r.err, pattern, args.join(" "));
  }
});

test("--version and --help", () => {
  const v = run(["--version"]);
  assert.equal(v.code, 0);
  assert.equal(v.out.trim(), JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).version);
  const h = run(["--help"]);
  assert.equal(h.code, 0);
  assert.match(h.out, /usage: reachability-gate <dir>/);
  assert.match(h.out, /--allow <id> --reason/);
});

// ---------------------------------------------------------------- vscode

test("vscode: palette and keybinding commands pass; hidden, uncontributed and unregistered commands fail", () => {
  const r = run(["test/fixtures/vscode-extension", "--preset", "vscode"]);
  assert.equal(r.code, 1, r.out + r.err);
  assert.match(r.out, /5 registered, 2 reachable from a user surface \(preset vscode\)/);
  const ext = fixture("vscode-extension", "src/extension.ts");
  const at = (id) => `src/extension.ts:${lineOf(ext, `"${id}"`)}`;
  const testAt = lineOf(fixture("vscode-extension", "src/test/extension.test.ts"), "sampleNotes.reindex");
  const findings = r.err.split("\n").filter((line) => /^UN(REACHABLE|REGISTERED)/.test(line));
  assert.deepEqual(findings, [
    `UNREACHABLE  sampleNotes.archiveAll  registered at ${at("sampleNotes.archiveAll")}, contributed but hidden from the palette (when: false) and in no menu or keybinding`,
    `UNREACHABLE  sampleNotes.pinNote  registered at ${at("sampleNotes.pinNote")}, in contributes.menus.editor/title but not in contributes.commands, so VS Code drops the menu item`,
    `UNREACHABLE  sampleNotes.reindex  registered at ${at("sampleNotes.reindex")}, not contributed in package.json, and only invoked internally at src/test/extension.test.ts:${testAt}`,
    "UNREGISTERED  sampleNotes.exportNotes  contributed in package.json, never registered in code (a dead menu item)",
  ]);
  assert.match(r.err, /3 unreachable, 1 unregistered in test\/fixtures\/vscode-extension/);
  assert.doesNotMatch(r.out + r.err, /importLegacy/); // commented out

  const json = JSON.parse(run(["test/fixtures/vscode-extension", "--preset", "vscode", "--json"]).out);
  const via = Object.fromEntries(json.actions.filter((a) => a.status === "reachable").map((a) => [a.id, a.via]));
  assert.deepEqual(via, {
    "sampleNotes.newNote": "contributes.commands (Command Palette)",
    "sampleNotes.quickCapture": "contributes.keybindings (ctrl+alt+n)",
  });
});

test("vscode: menus, status bar, tree items, command links, webview messages and command chains pass", () => {
  const r = run(["test/fixtures/vscode-clean", "--preset", "vscode", "--json"]);
  assert.equal(r.code, 0, r.out + r.err);
  const json = JSON.parse(r.out);
  const via = Object.fromEntries(json.actions.map((a) => [a.id, a.via.replace(/:\d+/, ":N")]));
  assert.deepEqual(via, {
    "sampleNotes.openPanel": "contributes.commands (Command Palette)",
    "sampleNotes.focusList": "src/extension.ts:N (in the handler of sampleNotes.openPanel)",
    "sampleNotes.refresh": "contributes.menus.view/title",
    "sampleNotes.showStats": "src/extension.ts:N (command field)",
    "sampleNotes.createFirst": "command link in contributes.viewsWelcome[0].contents",
    "sampleNotes.openNote": "src/tree.ts:N (command field)",
    "sampleNotes.exportAll": "src/panel.ts:N (surface block)",
  });
});

test("vscode: a command invoked only from an unreachable command is unreachable too", () => {
  const dir = copyFixture("vscode-clean");
  const pkgFile = path.join(dir, "package.json");
  const pkg = JSON.parse(readFileSync(pkgFile, "utf8"));
  pkg.contributes.menus.commandPalette.push({ command: "sampleNotes.openPanel", when: "false" });
  writeFileSync(pkgFile, JSON.stringify(pkg, null, 2));
  const r = run([dir, "--preset", "vscode"]);
  assert.equal(r.code, 1, r.out + r.err);
  assert.match(r.err, /UNREACHABLE {2}sampleNotes\.openPanel {2}.*hidden from the palette/);
  assert.match(
    r.err,
    /UNREACHABLE {2}sampleNotes\.focusList {2}registered at src\/extension\.ts:\d+, not contributed in package\.json, and only invoked from the handler of sampleNotes\.openPanel at src\/extension\.ts:\d+, which is unreachable/,
  );
});

test("vscode: enablement false and submenus are honored", () => {
  const dir = copyFixture("vscode-clean");
  const pkgFile = path.join(dir, "package.json");
  const pkg = JSON.parse(readFileSync(pkgFile, "utf8"));
  pkg.contributes.commands.find((c) => c.command === "sampleNotes.refresh").enablement = "false";
  pkg.contributes.commands.push({ command: "sampleNotes.openNote", title: "Open Note" });
  pkg.contributes.menus.commandPalette.push({ command: "sampleNotes.openNote", when: "false" });
  pkg.contributes.submenus = [{ id: "sampleNotes.more", label: "More" }];
  pkg.contributes.menus["sampleNotes.more"] = [{ command: "sampleNotes.openNote" }];
  writeFileSync(pkgFile, JSON.stringify(pkg, null, 2));
  // Keep openNote off the tree item so only the submenu can reach it.
  const tree = path.join(dir, "src/tree.ts");
  writeFileSync(tree, readFileSync(tree, "utf8").replace(/\n\s*item\.command = .*\n/, "\n"));

  let r = run([dir, "--preset", "vscode"]);
  assert.equal(r.code, 1, r.out + r.err);
  assert.match(r.err, /UNREACHABLE {2}sampleNotes\.refresh {2}.*contributed with enablement false/);
  assert.match(r.err, /UNREACHABLE {2}sampleNotes\.openNote {2}.*hidden from the palette/); // submenu is shown nowhere

  pkg.contributes.menus["view/item/context"] = [{ submenu: "sampleNotes.more" }];
  writeFileSync(pkgFile, JSON.stringify(pkg, null, 2));
  r = run([dir, "--preset", "vscode", "--json"]);
  const openNote = JSON.parse(r.out).actions.find((a) => a.id === "sampleNotes.openNote");
  assert.equal(openNote.via, "contributes.menus.sampleNotes.more");
});

test("vscode: a tree without engines.vscode in package.json is a usage error (exit 2)", () => {
  const r = run(["test/fixtures/private-mode-trap", "--preset", "vscode"]);
  assert.equal(r.code, 2);
  assert.match(r.err, /no engines\.vscode, so this is not a VS Code extension root/);
  const none = run(["test/fixtures/comments", "--preset", "vscode"]);
  assert.equal(none.code, 2);
  assert.match(none.err, /no package\.json/);
});

test("vscode: --allow covers an unregistered contributed command", () => {
  const r = run([
    "test/fixtures/vscode-extension", "--preset", "vscode", "--json",
    "--allow", "sampleNotes.exportNotes", "--reason", "Registered by the companion extension",
  ]);
  const json = JSON.parse(r.out);
  assert.equal(r.code, 1);
  assert.ok(!json.findings.some((f) => f.id === "sampleNotes.exportNotes"));
  assert.deepEqual(json.allowed, [
    { id: "sampleNotes.exportNotes", registeredAt: null, reason: "Registered by the companion extension", source: "--allow" },
  ]);
});

// ---------------------------------------------------------------- electron

test("electron: an ipcMain.handle no renderer or preload calls is unreachable (exit 1)", () => {
  const r = run(["test/fixtures/electron-app", "--preset", "electron"]);
  assert.equal(r.code, 1, r.out + r.err);
  assert.match(r.out, /6 registered, 4 reachable from a user surface \(preset electron\)/);
  const ipc = fixture("electron-app", "src/main/ipc.js");
  const testAt = lineOf(fixture("electron-app", "test/ipc.test.js"), "settings:reset");
  assert.deepEqual(unreachableLines(r.err), [
    `UNREACHABLE  notes:purge  registered at src/main/ipc.js:${lineOf(ipc, "notes:purge")}, no dispatch site anywhere`,
    `UNREACHABLE  settings:reset  registered at src/main/ipc.js:${lineOf(ipc, "settings:reset")}, only dispatched internally at test/ipc.test.js:${testAt}`,
  ]);

  const json = JSON.parse(run(["test/fixtures/electron-app", "--preset", "electron", "--json"]).out);
  const via = Object.fromEntries(json.actions.filter((a) => a.via).map((a) => [a.id, a.via.replace(/:\d+/, ":N")]));
  assert.deepEqual(via, {
    "notes:list": "src/preload/index.js:N (ipcRenderer call)",
    "notes:save": "src/preload/index.js:N (ipcRenderer call)",
    "window:minimize": "src/preload/index.js:N (ipcRenderer call)",
    "privacy:toggle": "src/main/index.js:N (surface context)",
  });
});

// ---------------------------------------------------------------- custom rules

test("custom rules: the example config scans an app with different call names (exit 0)", () => {
  const r = run(["test/fixtures/custom-rules", "--config", "examples/reachability.json"]);
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /3 registered, 2 reachable from a user surface, 1 allowed \(preset action-bus, config examples\/reachability\.json\)/);
  assert.match(r.out, /ALLOWED {2}cart\/expireStale {2}registered at src\/actions\.js:\d+: Runs from the hourly timer/);

  // Without the config, the default preset finds nothing: wrong tree.
  const bare = run(["test/fixtures/custom-rules"]);
  assert.equal(bare.code, 2);
  assert.match(bare.err, /found no registrations/);
});

test("custom rules: dropping the allow entry fails, and --allow on the command line works the same way", () => {
  const dir = tempDir();
  const config = JSON.parse(readFileSync(EXAMPLE_CONFIG, "utf8"));
  delete config.allow;
  const file = path.join(dir, "rules.json");
  writeFileSync(file, JSON.stringify(config));
  const r = run(["test/fixtures/custom-rules", "--config", file]);
  assert.equal(r.code, 1, r.out + r.err);
  assert.match(r.err, /UNREACHABLE {2}cart\/expireStale {2}registered at src\/actions\.js:\d+, only dispatched internally at src\/timers\.js:\d+/);

  const allowed = run(["test/fixtures/custom-rules", "--config", file, "--allow", "cart/expireStale", "--reason", "timer"]);
  assert.equal(allowed.code, 0, allowed.out + allowed.err);
});

test("custom rules: bad configs are usage errors (exit 2)", () => {
  const dir = tempDir();
  const base = JSON.parse(readFileSync(EXAMPLE_CONFIG, "utf8"));
  const cases = [
    [{ ...base, allow: [{ id: "cart/expireStale" }] }, /allow\[0\] \(cart\/expireStale\) needs a "reason"/],
    [{ ...base, allow: [{ id: "cart/expireStale", reason: " " }] }, /needs a "reason"/],
    [{ ...base, surfacePath: ["src/**"] }, /unknown key "surfacePath"/],
    [{ ...base, register: ["actions\\.register\\(\\s*{id}("] }, /register: Invalid regular expression/],
    [{ ...base, register: [] }, /register: needs at least one pattern/],
    [{ ...base, wiring: ["click:\\s*"] }, /wiring: .* needs \{fn\}/],
    [{ ...base, contextLines: [6] }, /contextLines must be/],
    [{ ...base, preset: "qt" }, /unknown preset "qt"/],
    ["[1, 2]", /must be a JSON object/],
    ["{ not json", /rules\.json: /],
  ];
  for (const [config, pattern] of cases) {
    const file = path.join(dir, "rules.json");
    writeFileSync(file, typeof config === "string" ? config : JSON.stringify(config));
    const r = run(["test/fixtures/custom-rules", "--config", file]);
    assert.equal(r.code, 2, `${JSON.stringify(config)}: ${r.out}${r.err}`);
    assert.match(r.err, pattern);
  }
});

test("custom rules: a config can switch presets and extend a preset list with \"...\"", () => {
  const dir = tempDir();
  const file = path.join(dir, "rules.json");

  // A list replaces the preset's list. With no internal paths, the test
  // file's ipcRenderer.invoke counts, so only the orphan is left.
  writeFileSync(file, JSON.stringify({ preset: "electron", internalPaths: [] }));
  let r = run(["test/fixtures/electron-app", "--config", file]);
  assert.equal(r.code, 1, r.out + r.err);
  assert.match(r.out, /preset electron, config /);
  assert.deepEqual(unreachableLines(r.err).map((line) => line.split("  ")[1]), ["notes:purge"]);

  // "..." keeps the preset's entries. Skipping test/ as well hides the test
  // file entirely, so settings:reset now has no dispatch site at all.
  writeFileSync(file, JSON.stringify({ preset: "electron", skipDirs: ["...", "test"] }));
  r = run(["test/fixtures/electron-app", "--config", file]);
  assert.equal(r.code, 1, r.out + r.err);
  assert.match(r.err, /UNREACHABLE {2}settings:reset {2}registered at src\/main\/ipc\.js:\d+, no dispatch site anywhere/);

  // --preset on the command line wins over the config's preset.
  const wins = run(["test/fixtures/electron-app", "--config", file, "--preset", "action-bus"]);
  assert.equal(wins.code, 2);
  assert.match(wins.err, /found no registrations/);
});

// ---------------------------------------------------------------- install

test("runs through an npm bin symlink from a path with spaces", { skip: process.platform === "win32" }, () => {
  // Lay out <tmp>/my project/node_modules the way npm does, then run the .bin link.
  const project = path.join(tempDir("reachability gate "), "my project");
  const pkg = path.join(project, "node_modules", "reachability-gate");
  const bin = path.join(project, "node_modules", ".bin");
  mkdirSync(bin, { recursive: true });
  mkdirSync(pkg, { recursive: true });
  copyFileSync(path.join(ROOT, "package.json"), path.join(pkg, "package.json"));
  copyFileSync(CLI, path.join(pkg, "reachability-gate.mjs"));
  chmodSync(path.join(pkg, "reachability-gate.mjs"), 0o755);
  symlinkSync("../reachability-gate/reachability-gate.mjs", path.join(bin, "reachability-gate"));
  cpSync(fixture("private-mode-trap"), path.join(project, "app source"), { recursive: true });

  const env = { ...process.env, PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH}` };
  const r = spawnSync(path.join(bin, "reachability-gate"), ["app source"], { cwd: project, env, encoding: "utf8" });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /UNREACHABLE {2}privateMode\.exit {2}registered at src\/main\/actions\.js:\d+/);
  assert.match(r.stderr, /1 unreachable in app source/);

  // Even when Node is told to keep the symlink path, the script finds its own files.
  const v = spawnSync(process.execPath, ["--preserve-symlinks", "--preserve-symlinks-main", path.join(bin, "reachability-gate"), "--version"], {
    cwd: project,
    encoding: "utf8",
  });
  assert.equal(v.status, 0, v.stdout + v.stderr);
  assert.equal(v.stdout.trim(), JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).version);

  // Run from a different working directory with an absolute path that has spaces.
  const abs = spawnSync(path.join(bin, "reachability-gate"), [path.join(project, "app source"), "--quiet"], { cwd: tmpdir(), env, encoding: "utf8" });
  assert.equal(abs.status, 1, abs.stdout + abs.stderr);
  assert.equal(abs.stdout, "");
});
