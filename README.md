# reachability-gate

Fails the build when an action is registered in code but nothing a person can click, press or pick reaches it.

```text
$ reachability-gate test/fixtures/private-mode-trap
reachability-gate: 4 registered, 3 reachable from a user surface (preset action-bus)

UNREACHABLE  privateMode.exit  registered at src/main/actions.js:8, only dispatched internally at test/private-mode.test.js:10

reachability-gate: 1 unreachable in test/fixtures/private-mode-trap
Give each one a control a person can use, or declare it with --allow <id> --reason "<why>".
$ echo $?
1
```

The tray menu in that fixture enters Private Mode. The menu item that left it is commented out. The only code that dispatches `privateMode.exit` is a test, and the test passes. Nobody can leave Private Mode.

## Why

A desktop app shipped a Private Mode that was a one-way trap. The exit action was registered on the app's action bus and allowlisted for Private Mode. Nothing a person could click dispatched it: no button, no tray item, no hotkey. One click on the tray entered Private Mode, and the only way out was to delete a file by hand.

The test suite had 87 passing tests at the time. The Private Mode tests dispatched the exit action directly on the bus, which is the one thing a person cannot do. The tests exercised the layer below the defect.

A capability is not shipped because a handler exists. It is shipped when a person can reach it.

reachability-gate asks that question for every registered action: is there a path to it from something a person can use? A handler with no such path is dead code, and the feature list is probably advertising it.

## Usage

Needs Node.js 20 or newer. No dependencies.

```sh
npx github:mthburnsbarber-web/reachability-gate src                        # action-bus rules (default)
npx github:mthburnsbarber-web/reachability-gate . --preset vscode          # a VS Code extension root
npx github:mthburnsbarber-web/reachability-gate . --preset electron        # an Electron app
npx github:mthburnsbarber-web/reachability-gate . --config reachability.json
```

| Option | Meaning |
|---|---|
| `--preset <name>` | `action-bus` (default), `vscode` or `electron`. |
| `--config <file>` | Custom rules as JSON. See [Custom rules](#custom-rules). |
| `--allow <id> --reason "<why>"` | Declare one action deliberately unreachable. Repeatable. `--reason` must follow `--allow`, and must not be empty. |
| `--json` | Print the result as JSON. The exit code does not change. |
| `--quiet` | Print nothing when clean. Findings are still printed. |

Exit codes: `0` clean, `1` unreachable action found, `2` usage error or no registrations found.

A `2` is a failure too. If the gate finds no registrations at all, it was pointed at the wrong tree or the register call was renamed. A gate that finds nothing to check must not pass.

### How an action counts as reachable

Every registered action needs at least one dispatch site that a person can reach. A dispatch site counts when:

1. its file matches a surface path, such as a renderer directory;
2. it sits near code a person touches: a DOM listener, a menu or tray template, a hotkey (6 lines above to 2 below, by default);
3. it sits inside a named function that such code wires up, such as a `togglePanel()` attached to the tray click and the hotkey;
4. it matches a pattern that is a user surface wherever it appears, such as a VS Code `command:` field or an Electron `ipcRenderer.invoke`;
5. in the `vscode` and `electron` presets, it sits inside another action's handler, and that action is reachable.

Dispatches in internal paths never count, and registrations there are ignored. In the `vscode` and `electron` presets, internal paths are `test/`, `tests/`, `__tests__/`, `__mocks__/` and `e2e/` folders and `*.test.*` and `*.spec.*` files. The `action-bus` preset has none: a test file counts only when it matches rules 1 to 3. Set `internalPaths` in a config to change that.

Comments never count. `//`, `/* */` and `<!-- -->` are blanked before matching. Strings, template literals and regex literals are tracked, so `"http://example.com"` is not a comment.

Each finding is one line: the id, where it is registered, and why nothing reaches it. `--json` adds every reachable action and the site that reaches it.

## Presets

### action-bus

The default. For apps that register handlers on an action bus and dispatch action objects.

- Registered: `bus.register("id", handler)`.
- Dispatched: `{ kind: "id" }`.
- Surface paths: any file under a `renderer/`, `overlay/` or `preload/` directory.
- Surface context: `addEventListener(`, `onclick`, `click:`, `Menu.buildFromTemplate`, `globalShortcut.register`, `bindAction(` or `setContextMenu` within 6 lines above or 2 below.
- One level of indirection: a function passed to `x.on("event", fn)`, `click: fn` or `globalShortcut.register(accelerator, fn)`.
- Scans `.ts`, `.tsx`, `.js`, `.mjs` and `.html`. Skips `node_modules`, `.git`, `dist`, `release`, `build` and `test-results`.

If your bus uses other names, see [Custom rules](#custom-rules).

### vscode

For VS Code extensions. Point it at the extension root, the folder with `package.json`.

A command registered with `vscode.commands.registerCommand("id", …)` or `registerTextEditorCommand` is reachable when:

- it is in `contributes.commands`, which puts it in the Command Palette, unless every `contributes.menus.commandPalette` entry for it has `"when": "false"`;
- it is in any other `contributes.menus` entry and also in `contributes.commands`. VS Code drops a menu item whose command is not declared in `contributes.commands`. A submenu counts only when a visible menu shows it;
- it is bound in `contributes.keybindings`;
- a contribution such as `viewsWelcome` links to it with `[label](command:id)`;
- reachable code invokes it: a `command:` field on a status bar item, tree item or code lens; `executeCommand` in a webview `onDidReceiveMessage` handler or next to `showInformationMessage` or `showQuickPick`; or `executeCommand` inside the handler of another reachable command.

`"enablement": "false"` disables a command in the palette, every menu and every keybinding. Other `when` and `enablement` clauses are not evaluated, so an entry with any other clause counts.

A command in `contributes.commands` that no code registers is reported as `UNREGISTERED`. That is a palette entry or menu item that does nothing.

```text
$ reachability-gate test/fixtures/vscode-extension --preset vscode
reachability-gate: 5 registered, 2 reachable from a user surface (preset vscode)

UNREACHABLE  sampleNotes.archiveAll  registered at src/extension.ts:18, contributed but hidden from the palette (when: false) and in no menu or keybinding
UNREACHABLE  sampleNotes.pinNote  registered at src/extension.ts:21, in contributes.menus.editor/title but not in contributes.commands, so VS Code drops the menu item
UNREACHABLE  sampleNotes.reindex  registered at src/extension.ts:24, not contributed in package.json, and only invoked internally at src/test/extension.test.ts:6
UNREGISTERED  sampleNotes.exportNotes  contributed in package.json, never registered in code (a dead menu item)

reachability-gate: 3 unreachable, 1 unregistered in test/fixtures/vscode-extension
Give each one a control a person can use, or declare it with --allow <id> --reason "<why>".
Register each unregistered command in code, or remove it from package.json.
```

The same fixture's palette command and its keybinding-only command pass.

### electron

For Electron apps that talk over IPC.

- Registered: `ipcMain.handle("channel", …)`, `handleOnce`, `on`, `once`, and the same calls on `webContents.ipc`.
- Reachable when `ipcRenderer.invoke`, `send`, `sendSync` or `postMessage` uses the channel outside test files. `ipcRenderer` only runs in a renderer or preload, so every such call counts.
- `ipcMain.emit("channel")` in the main process counts when it sits in a menu, tray or hotkey context, as in the action-bus preset.

```text
$ reachability-gate test/fixtures/electron-app --preset electron
reachability-gate: 6 registered, 4 reachable from a user surface (preset electron)

UNREACHABLE  notes:purge  registered at src/main/ipc.js:7, no dispatch site anywhere
UNREACHABLE  settings:reset  registered at src/main/ipc.js:8, only dispatched internally at test/ipc.test.js:6

reachability-gate: 2 unreachable in test/fixtures/electron-app
Give each one a control a person can use, or declare it with --allow <id> --reason "<why>".
```

It does not check messages from main to a renderer (`webContents.send` to `ipcRenderer.on`). If your preload exposes a generic `invoke(channel)`, the renderer's calls are not `ipcRenderer` calls. Add their pattern to `dispatch` in a config.

## Custom rules

Pass a JSON file with `--config`. Every key is optional. [`examples/reachability.json`](examples/reachability.json) scans an app that registers with `actions.register("id", fn)` and dispatches `{ type: "id" }`:

```json
{
  "preset": "action-bus",
  "extensions": ["...", ".jsx"],
  "idPattern": "[\\w./-]+",
  "register": ["actions.register("],
  "dispatch": ["type:"],
  "surfacePaths": ["src/ui/**"],
  "internalPaths": ["test/**", "**/*.test.*"],
  "surfaceContext": ["...", "onClick="],
  "allow": [
    {
      "id": "cart/expireStale",
      "reason": "Runs from the hourly timer in src/timers.js. No person triggers it."
    }
  ]
}
```

| Key | Meaning |
|---|---|
| `preset` | The preset to start from. `--preset` on the command line wins. |
| `register` | Where actions are registered. An entry is either a literal call prefix, such as `"bus.register("`, meaning that prefix, optional spaces, then a quoted id; or a regular expression with `{id}` where the quoted id goes. |
| `dispatch` | Where actions are dispatched, in the same two forms. `{bareid}` matches an id without quotes. An object `{ "pattern": "…", "surface": true, "label": "…" }` marks a pattern that counts wherever it appears outside internal paths. |
| `idPattern` | What an id may contain, as a regular expression. Default `[\w.]+` for action-bus and `[\w.:/@+-]+` for vscode and electron. |
| `surfacePaths` | Globs. Every dispatch in a matching file counts. |
| `internalPaths` | Globs. Dispatches in a matching file never count, and registrations there are ignored. This wins over every other rule. |
| `surfaceContext` | Regular expressions. A dispatch counts when one matches within `contextLines` of it. |
| `contextLines` | `[before, after]`. Default `[6, 2]`. |
| `surfaceBlocks` | Regular expressions that end at a call's `(`. Every dispatch inside that call's arguments counts. |
| `wiring` | Regular expressions with `{fn}`. A dispatch inside function `fn` counts when one matches anywhere in the same file. |
| `functionPatterns` | Regular expressions with one capture group for a function name. The function a line belongs to is the nearest match at or above it. |
| `followHandlers` | `true`: a dispatch inside another action's handler counts only if that action is reachable. `false`, the action-bus default: it is judged by the other rules. |
| `extensions` | File extensions to scan. |
| `skipDirs` | Directory names never scanned. |
| `allow` | `[{ "id": "…", "reason": "…" }]`. An entry without a reason is a usage error. |

A list replaces the preset's list. A `"..."` entry keeps the preset's entries at that point. Keys that start with `$` are ignored, so `"$comment"` works. Any other unknown key is a usage error, so a typo cannot quietly turn a rule off.

Globs support `**` (any depth), `*` (within one folder), `?` and `{a,b}`. They are matched against the path relative to the scanned directory, ignoring case. A glob with no `/` matches at any depth.

### Allowing an action

Some actions have no control on purpose: a timer tick, a startup check. Declare each one with a reason:

```sh
reachability-gate src --allow scheduler.tick --reason "Fired by the minute timer"
```

Allowed actions are printed on every run, so an exception stays visible. `--allow` without `--reason` is a usage error. An allow entry that matches nothing registered, or matches an action that is now reachable, prints a note.

## In CI

Run it before you package or publish. Exit `1` or `2` fails the job.

```yaml
jobs:
  reachability:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - name: reachability-gate
        run: npx github:mthburnsbarber-web/reachability-gate . --preset vscode
```

To pin a version, append `#<tag or commit>` to the package spec.

## What it doesn't do

- It reads source text with patterns. It does not parse an AST or run the app. An unusual spelling can slip past a pattern, and a lookalike can match one.
- It cannot follow ids built at runtime, such as `registerCommand(prefix + name, …)`. Ids held in constants are not resolved either. Those registrations are not seen, and those dispatches do not count. Use string literals, or `--allow` with a reason.
- It follows one level of indirection. A dispatch inside a named function counts when a surface wires up that function. A function that calls the function that dispatches is not followed. Command-to-command calls inside handlers are the one exception: they are followed through any number of commands.
- It proves that a path exists in code. It does not prove that the control is visible, enabled, or works. Pair it with a real click-through of the built app.

## License

MIT
