/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

import { Logger } from '../logger';
import { MarkdownContentProvider } from './previewContentProvider';
import { MarkdownPreview, PreviewSettings } from './preview';
import { disposeAll } from '../util/dispose';
import { MarkdownFileTopmostLineMonitor } from '../util/topmostLineMonitor';
import { isMarkdownFile } from '../util/file';
import { MarkdownPreviewConfigurationManager } from './previewConfig';
import { MarkdownContributions } from '../markdownExtensions';

export class MarkdownPreviewManager implements vscode.WebviewSerializer {
	private static readonly markdownPreviewActiveContextKey = 'markdownPreviewFocus';

	private readonly topmostLineMonitor = new MarkdownFileTopmostLineMonitor();
	private readonly previewConfigurations = new MarkdownPreviewConfigurationManager();
	private readonly previews: MarkdownPreview[] = [];
	private activePreview: MarkdownPreview | undefined = undefined;
	private readonly disposables: vscode.Disposable[] = [];

	public constructor(
		private readonly contentProvider: MarkdownContentProvider,
		private readonly logger: Logger,
		private readonly contributions: MarkdownContributions
	) {
		vscode.window.onDidChangeActiveTextEditor(editor => {
			if (editor && isMarkdownFile(editor.document)) {
				for (const preview of this.previews.filter(preview => !preview.locked)) {
					preview.update(editor.document.uri);
				}
			}
		}, null, this.disposables);

		this.disposables.push(vscode.window.registerWebviewSerializer(MarkdownPreview.viewType, this));
	}

	public dispose(): void {
		disposeAll(this.disposables);
		disposeAll(this.previews);
	}

	public refresh() {
		for (const preview of this.previews) {
			preview.refresh();
		}
	}

	public updateConfiguration() {
		for (const preview of this.previews) {
			preview.updateConfiguration();
		}
	}

	public preview(
		resource: vscode.Uri,
		previewSettings: PreviewSettings
	): void {
		let preview = this.getExistingPreview(resource, previewSettings);
		if (preview) {
			preview.reveal(previewSettings.previewColumn);
		} else {
			preview = this.createNewPreview(resource, previewSettings);
		}

		preview.update(resource);
	}

	public get activePreviewResource() {
		return this.activePreview && this.activePreview.resource;
	}

	public toggleLock() {
		const preview = this.activePreview;
		if (preview) {
			preview.toggleLock();

			// Close any previews that are now redundant, such as having two dynamic previews in the same editor group
			for (const otherPreview of this.previews) {
				if (otherPreview !== preview && preview.matches(otherPreview)) {
					otherPreview.dispose();
				}
			}
		}
	}

	public async deserializeWebview(
		webview: vscode.Webview,
		state: any
	): Promise<boolean> {
		const preview = MarkdownPreview.revive(
			webview,
			state,
			this.contentProvider,
			this.previewConfigurations,
			this.logger,
			this.topmostLineMonitor);

		this.registerPreview(preview);
		preview.refresh();
		return true;
	}

	public async serializeWebview(
		webview: vscode.Webview,
	): Promise<any> {
		const preview = this.previews.find(preview => preview.isWebviewOf(webview));
		return preview ? preview.state : undefined;
	}

	private getExistingPreview(
		resource: vscode.Uri,
		previewSettings: PreviewSettings
	): MarkdownPreview | undefined {
		return this.previews.find(preview =>
			preview.matchesResource(resource, previewSettings.previewColumn, previewSettings.locked));
	}

	private createNewPreview(
		resource: vscode.Uri,
		previewSettings: PreviewSettings
	): MarkdownPreview {
		const preview = MarkdownPreview.create(
			resource,
			previewSettings.previewColumn,
			previewSettings.locked,
			this.contentProvider,
			this.previewConfigurations,
			this.logger,
			this.topmostLineMonitor,
			this.contributions);

		return this.registerPreview(preview);
	}

	private registerPreview(
		preview: MarkdownPreview
	): MarkdownPreview {
		this.previews.push(preview);

		preview.onDispose(() => {
			const existing = this.previews.indexOf(preview!);
			if (existing >= 0) {
				this.previews.splice(existing, 1);
			}
		});

		preview.onDidChangeViewState(({ active }) => {
			disposeAll(this.previews.filter(otherPreview => preview !== otherPreview && preview!.matches(otherPreview)));

			vscode.commands.executeCommand('setContext', MarkdownPreviewManager.markdownPreviewActiveContextKey,
				active);

			this.activePreview = active ? preview : undefined;
		});

		return preview;
	}
}

