import * as vscode from 'vscode';

/*
TODO: allow user-contributed shortcuts like

"shortcuts": [
  {
    "key": "F",
    "description": "foo",
    "command": "workbench.focusFoo"
  },
  {
    "key": "B",
    "description": "bar",
    "command": "workbench.focusBar"
  },
  {
    "key": "x",
    "description": "close editor",
    "selectEditor": true,
    "command": "workbench.action.closeGroup",
  }
]
*/

/*
TODO: write an extension that allows for modal shortcuts with the popup, then
      perhaps this extension can just leverage that? or it can be separate

      specifically, we can have per-focus modals, ie, ctrl+d or something will
      bring up a window with keybindings for the currently focused view

  "modals": [
    {
      "id": "myId",
      "commands": [
        {
          "key": "B",
          "description": "boo!",
          "command": "host.boo"
        },
        {
          "key": "F",
          "description": "foo!",
          "command": "host.foo"
        }
      ]
    }
  ]

  then you bind via

  {
    "key": <foo>,
    "command": "genericModal.show",
    "args": "myId"
  }

  Assuming we can upstream a built-in toggle-to-last-focus command, then this
  extension can be just a config/maybe a helper extension to show the picker for
  each editor.
*/

// Decoration used to show hit target to switch window.
const kDecoration = vscode.window.createTextEditorDecorationType({
  before: {
    color: "#efefef",
    backgroundColor: "#555555",
  },
  // isWholeLine: true,
  // color: "#646464",
  // backgroundColor: "#DCDCDC4C",
});

// Is the quick pick window being shown?
let currentlyShowing = false;

// Most recently viewed editor is at the front.
let editorHistory: Array<Shortcut> = [];

// Should the jump history be shown?
const showJumpHistory: boolean = false;

function pushHistory(shortcut: Shortcut) {
  editorHistory.unshift(shortcut);
  if (editorHistory.length > 2)
    editorHistory.length = 2;
}

function cycleHistory() {
  const tmp = editorHistory[0];
  editorHistory[0] = editorHistory[1];
  editorHistory[1] = tmp;
}

class ShownEditor {
  constructor(readonly key: string, readonly editor: vscode.TextEditor) { }
}

class Shortcut {
  viewColumn: vscode.ViewColumn | undefined;
  action: (() => Promise<void>) | undefined;
  editorAction: ((editor: vscode.TextEditor) => Promise<void>) | undefined;
  recordInHistory: boolean;

  constructor(readonly key: string, readonly description: string) {
    this.recordInHistory = true;
  }

  withViewColumn(viewColumn: vscode.ViewColumn) {
    this.viewColumn = viewColumn;
    return this;
  }

  withAction(action: () => Promise<void>) {
    this.action = action;
    return this;
  }

  withEditorAction(editorAction: (editor: vscode.TextEditor) => Promise<void>) {
    this.editorAction = editorAction;
    return this;
  }

  doNotRecordInHistory() {
    this.recordInHistory = false;
    return this;
  }

  async activate() {
    if (this.viewColumn)
      await focusViewColumn(this.viewColumn);
    if (this.action)
      await this.action();
  }
  async activateWithEditor(editor: vscode.TextEditor) {
    if (this.editorAction)
      await this.editorAction(editor);
  }
}

function buildShortcutLabels(shortcutGroups: Array<Array<Shortcut>>): Array<vscode.QuickPickItem> {
  // Single quick pick item with all entries.
  let allResults = [];
  for (let shortcutGroup of shortcutGroups) {
    let result = '';
    for (let shortcut of shortcutGroup) {
      if (result != '')
        result += ', ';
      result += `${shortcut.key}: ${shortcut.description}`;
    }
    allResults.push({ label: result })
  }
  return allResults;


  // Separate quick-pick item for each entry.
  // let result = [];
  // for (let shortcutGroup of shortcutGroups) {
  //   for (let shortcut of shortcutGroup)
  //     result.push({ label: shortcut.key, description: shortcut.description });
  // }
  // return result;
}

// Helper to construct decorations over a given range.
function makeDecorations(range: vscode.Range, label: string): Array<vscode.DecorationOptions> {
  let decorations = [];
  for (let y = Math.max(range.start.line - 1, 0); y <= range.end.line + 1; ++y) {
    decorations.push({
      range: new vscode.Range(y, 0, y, 0),
      renderOptions: {
        before: {
          contentText: label,
        }
      }
    });
  }
  return decorations;
}

// Focus the given editor.
async function focusEditor(editor: vscode.TextEditor) {
  await vscode.window.showTextDocument(editor.document, editor.viewColumn, false);
}

// Focus a specific ViewColumn.
async function focusViewColumn(viewColumn: vscode.ViewColumn) {
  for (let editor of vscode.window.visibleTextEditors) {
    if (editor.viewColumn == viewColumn) {
      await focusEditor(editor);
      return;
    }
  }
}

// Execute a command.
async function command(command: string) {
  await vscode.commands.executeCommand(command);
}

// Get the key for a given editor index.
function getKeyForIndex(i: number) {
  let keys = 'asdfjklASDFJKL';
  return keys.charAt(i);
}

function findShortcut(shortcuts: Shortcut[], key: string): Shortcut | undefined {
  for (let shortcut of shortcuts) {
    if (shortcut.key == key)
      return shortcut;
  }
  return undefined;
}

function findEditor(editors: ShownEditor[], key: string): vscode.TextEditor | undefined {
  for (let item of editors) {
    if (item.key == key)
      return item.editor;
  }
  return undefined;
}

async function handle(
  shortcuts: Shortcut[], editors: ShownEditor[],
  shortcutWithEditor: Shortcut | undefined, picked: string) {

  // handle shortcut that needs an editor
  if (shortcutWithEditor) {
    let editor = findEditor(editors, picked);
    if (editor)
      await shortcutWithEditor.activateWithEditor(editor);
    return;
  }

  // handle shortcut
  let shortcut = findShortcut(shortcuts, picked);
  if (shortcut) {
    await shortcut.activate();
    if (shortcut.recordInHistory)
      pushHistory(shortcut);
    return;
  }

  // handle editor focus
  let editor = findEditor(editors, picked);
  if (editor) {
    // history tracking happens in onDidChangeActiveTextEditor
    // TODO: insert history here, onDidChangeActiveTextEditor is not called if
    // we go from for example editorA->search->git->editorA since the active
    // editor never changed
    await focusEditor(editor);
    return;
  }
}

// https://stackoverflow.com/a/15030117
function flatten<T>(arr: any) {
  return arr.reduce(function (flat: any, toFlatten: any) {
    return flat.concat(Array.isArray(toFlatten) ? flatten(toFlatten) : toFlatten);
  }, []);
}

// Command to switch between editors.
async function editorJumpJump() {
  if (currentlyShowing)
    return;
  currentlyShowing = true;
  try {
    let editors: Array<ShownEditor> = [];

    let i = 0;
    for (let editor of vscode.window.visibleTextEditors) {
      let key = getKeyForIndex(i);
      if (!key)
        continue;

      editors.push(new ShownEditor(key, editor));
      editor.setDecorations(kDecoration, makeDecorations(editor.visibleRanges[0], key));
      ++i;
    }

    var shortcutGroups = [
      [
        new Shortcut('q', 'search').withAction(() => command('workbench.view.search')),
        new Shortcut('w', 'git').withAction(() => command('workbench.view.scm')),
        new Shortcut('e', 'explorer').withAction(() => command('workbench.view.explorer')),
        new Shortcut('r', 'references').withAction(() => command('workbench.view.extension.references-view')),
        new Shortcut('u', 'problems').withAction(() => command('workbench.action.problems.focus')),
        new Shortcut('i', 'terminal').withAction(() => command('workbench.action.terminal.focus')),
        new Shortcut('o', 'outline').withAction(() => command('outline.focus')),
      ],
      [
        new Shortcut('x', 'close').withEditorAction(async editor => {
          await focusEditor(editor);
          await command('workbench.action.closeGroup');
        }),
        new Shortcut('h', 'split horizontally').withEditorAction(async editor => {
          await focusEditor(editor);
          await command('workbench.action.splitEditorRight');
        }),
        new Shortcut('v', 'split vertically').withEditorAction(async editor => {
          await focusEditor(editor);
          await command('workbench.action.splitEditorDown');
        }),
      ],
      [
        new Shortcut(';', 'focus previous').doNotRecordInHistory().withAction(() => {
          let action = editorHistory[1];
          if (action) {
            cycleHistory();
            return action.activate();
          }
          return new Promise<void>(resolve => resolve());
        }),
      ],
    ]
    var shortcuts: Shortcut[] = flatten(shortcutGroups);

    let shortcutWithEditor: Shortcut | undefined;

    // Show quick pick.
    let picked: string | undefined = await new Promise<string | undefined>(resolve => {
      const input = vscode.window.createQuickPick();
      let items: Array<vscode.QuickPickItem> = buildShortcutLabels(shortcutGroups);
      if (showJumpHistory) {
        for (let h of editorHistory)
          items.push({ label: `History`, description: `${h.description}` });
      }
      input.items = items;
      input.onDidChangeValue((value: string) => {
        let shortcut = findShortcut(shortcuts, value);
        // see if the shortcut wants to capture an editor
        if (shortcut && shortcut.editorAction) {
          shortcutWithEditor = shortcut;

          // Automatically activate a single editor.
          if (editors.length == 1) {
            resolve(editors[0].key);
            input.dispose();
            return;
          }

          // Otherwise prompt the user for the editor to use.
          input.title = `Select an editor to ${shortcut.description}`;
          input.items = [];
          input.value = '';
          return;
        }

        // handle the key without a specific editor
        resolve(value);
        input.dispose();
      });
      input.onDidHide(() => resolve(undefined));
      input.show();
    });

    if (picked)
      handle(shortcuts, editors, shortcutWithEditor, picked);

    // dispose all decorations
    for (let item of editors)
      item.editor.setDecorations(kDecoration, []);
  } finally {
    currentlyShowing = false;
  }
}

export function activate(context: vscode.ExtensionContext) {
  // Track editor activations that happen outside of this extension.
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(e => {
      // If the same editor was focused don't track it again.
      if (!e || !e.viewColumn || editorHistory[0] && editorHistory[0].viewColumn == e.viewColumn)
        return;
      pushHistory(new Shortcut('', `ViewColumn ${e.viewColumn}`).withViewColumn(e.viewColumn));
    }));

  context.subscriptions.push(
    vscode.commands.registerCommand('editorJump.jump', editorJumpJump));
}
