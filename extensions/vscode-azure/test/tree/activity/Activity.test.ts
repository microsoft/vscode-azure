/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import { isActivity, isTerminalActivityStatus } from '../../../src/tree/activity/Activity';
import { makeActivity } from './mockActivity';

describe('Activity (unit)', () => {
    describe('isActivity', () => {
        it('should return true for a valid activity object', () => {
            expect(isActivity(makeActivity())).to.be.true;
        });

        it('should return false for null', () => {
            expect(isActivity(null)).to.be.false;
        });

        it('should return false for undefined', () => {
            expect(isActivity(undefined)).to.be.false;
        });

        it('should return false for an object missing required fields', () => {
            expect(isActivity({ id: '1', type: 'generic' })).to.be.false;
        });

        it('should return false for a non-object', () => {
            expect(isActivity('string')).to.be.false;
        });
    });

    describe('isTerminalActivityStatus', () => {
        it('should return true for Completed', () => {
            expect(isTerminalActivityStatus('Completed')).to.be.true;
        });

        it('should return true for Failed', () => {
            expect(isTerminalActivityStatus('Failed')).to.be.true;
        });

        it('should return true for Canceled', () => {
            expect(isTerminalActivityStatus('Canceled')).to.be.true;
        });

        it('should return true for Info', () => {
            expect(isTerminalActivityStatus('Info')).to.be.true;
        });

        it('should return true for Warn', () => {
            expect(isTerminalActivityStatus('Warn')).to.be.true;
        });

        it('should return false for InProgress', () => {
            expect(isTerminalActivityStatus('InProgress')).to.be.false;
        });

        it('should return false for NotStarted', () => {
            expect(isTerminalActivityStatus('NotStarted')).to.be.false;
        });
    });
});
