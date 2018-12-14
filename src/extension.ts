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
  }
]
*/

/*
TODO: write an extension that allows for modal shortcuts with the popup, then
      perhaps this extension can just leverage that? or it can be separate

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

/*
TODO: allow for actions with a window, ie
 - X then the editor group to close
 - H then the editor group to split horizontally
 - V then the editor group to split vertically
*/

// Decoration used to show hit target to switch window.
const kDecoration = vscode.window.createTextEditorDecorationType({
  before: {
    color: "#efefef",
    backgroundColor: "#555555",
  }
});

// Is the quick pick window being shown?
let currentlyShowing = false;

// Most recently viewed editor is at the front.
let editorHistory: Array<Shortcut> = [];

// Should the jump history be shown?
const showJumpHistory: boolean = true;

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
  editor: vscode.TextEditor | undefined;
  action: (() => Promise<void>) | undefined;
  recordInHistory: boolean;

  constructor(readonly key: string, readonly description: string) {
    this.recordInHistory = true;
  }

  withEditor(editor: vscode.TextEditor) {
    this.editor = editor;
    return this;
  }

  withAction(action: () => Promise<void>) {
    this.action = action;
    return this;
  }

  doNotRecordInHistory() {
    this.recordInHistory = false;
    return this;
  }

  async activate() {
    if (this.editor)
      await focusEditor(this.editor);
    if (this.action)
      await this.action();
  }
}

function buildShortcutLabels(shortcuts: Array<Shortcut>): Array<vscode.QuickPickItem> {
  // Single quick pick item with all entries.
  let result = '';
  for (let shortcut of shortcuts) {
    if (result != '')
      result += ', ';
    result += `${shortcut.key}: ${shortcut.description}`;
  }
  return [{ label: result }];


  // Separate quick-pick item for each entry.
  // let result = [];
  // for (let shortcut of shortcuts)
  //   result.push({label: shortcut.key, description: shortcut.description});
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
  if (editor)
    await vscode.window.showTextDocument(editor.document, editor.viewColumn, false);
}

// Execute a command.
async function command(command: string) {
  await vscode.commands.executeCommand(command);
}

// Get the key for a given editor index.
function getKeyForIndex(i: number) {
  let keys = 'asdfjklqweruiop';
  return keys.charAt(i);
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

    var shortcuts = [
      new Shortcut(';', 'previous editor').doNotRecordInHistory().withAction(() => {
        let action = editorHistory[1];
        if (action) {
          cycleHistory();
          return action.activate();
        }
        return new Promise<void>(resolve => resolve());
      }),
      new Shortcut('S', 'search').withAction(() => command('workbench.view.search')),
      new Shortcut('G', 'git').withAction(() => command('workbench.view.scm')),
      new Shortcut('R', 'references').withAction(() => command('workbench.view.extension.references-view')),
      new Shortcut('E', 'explorer').withAction(() => command('workbench.view.explorer')),
      new Shortcut('P', 'problems').withAction(() => command('workbench.action.problems.focus')),
      new Shortcut('T', 'terminal').withAction(() => command('workbench.action.terminal.focus')),
      new Shortcut('O', 'outline').withAction(() => command('outline.focus')),
    ]

    // Show quick pick.
    let picked: string | undefined = await new Promise<string | undefined>(resolve => {
      const input = vscode.window.createQuickPick();
      let items: Array<vscode.QuickPickItem> = buildShortcutLabels(shortcuts);
      if (showJumpHistory) {
        for (let h of editorHistory)
          items.push({ label: `History`, description: `${h.description}` });
      }
      input.items = items;
      input.onDidChangeValue((value: string) => {
        resolve(value);
        input.dispose();
      });
      input.onDidHide(() => resolve(undefined));
      input.show();
    });

    // activate shortcut
    for (let shortcut of shortcuts) {
      if (shortcut.key == picked) {
        await shortcut.activate();
        if (shortcut.recordInHistory)
          pushHistory(shortcut);
      }
    }

    // activate editor
    for (let item of editors) {
      if (item.key == picked) {
        pushHistory(new Shortcut('', `internally-focused editor ${item.editor.document.fileName}`).withEditor(item.editor));
        await focusEditor(item.editor);
      }
      item.editor.setDecorations(kDecoration, []);
    }
  } finally {
    currentlyShowing = false;
  }
}

export function activate(context: vscode.ExtensionContext) {
  // Track editor activations that happen outside of this extension.
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(e => {
      if (!e || editorHistory[0] && editorHistory[0].editor == e)
        return;
      pushHistory(new Shortcut('', `externally-focused editor ${e.document.fileName}`).withEditor(e));
    }));

  context.subscriptions.push(
    vscode.commands.registerCommand('editorJump.jump', editorJumpJump));
}
