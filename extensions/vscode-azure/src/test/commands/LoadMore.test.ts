/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import { describe, it } from 'mocha';
import * as vscode from 'vscode';
import { defaultLoadMoreOptions } from '../../commands/LoadMore';

describe('defaultLoadMoreOptions (unit)', () => {
    const options = defaultLoadMoreOptions(vscode);

    it('should identify load-more keys by suffix', () => {
        expect(options.isLoadMoreKey('parent/~loadMore')).to.be.true;
        expect(options.isLoadMoreKey('regular-item')).to.be.false;
    });

    it('should generate a load-more key from a parent key', () => {
        expect(options.getLoadMoreKey('parent')).to.equal('parent/~loadMore');
    });

    it('should derive the parent key from a load-more key', () => {
        expect(options.getParentKey('parent/~loadMore')).to.equal('parent');
    });

    it('should create a view item from a load-more key', () => {
        expect(options.createViewItem('parent/~loadMore')).to.equal('parent/~loadMore');
    });

    it('should return a tree item with Load More label when not loading', () => {
        const item = options.getTreeItem('parent', false);
        expect(item.label).to.include('Load More');
        expect(item.command).to.not.be.undefined;
    });

    it('should return a tree item with Loading label and spinner when loading', () => {
        const item = options.getTreeItem('parent', true);
        expect(item.label).to.include('Loading');
        expect(item.command).to.be.undefined;
        expect(item.iconPath).to.not.be.undefined;
    });
});
