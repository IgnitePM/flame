import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isDrivePermissionAlreadyExistsError,
  portalEmailsFromClient,
} from './driveShareHelpers.mjs';

describe('portalEmailsFromClient', () => {
  it('normalizes and dedupes clientEmails', () => {
    assert.deepEqual(
      portalEmailsFromClient({
        clientEmails: ['Alice@Co.com', ' alice@co.com ', 'bob@co.com', 'nope'],
      }),
      ['alice@co.com', 'bob@co.com'],
    );
  });

  it('returns empty for missing emails', () => {
    assert.deepEqual(portalEmailsFromClient({}), []);
    assert.deepEqual(portalEmailsFromClient(null), []);
  });
});

describe('isDrivePermissionAlreadyExistsError', () => {
  it('detects conflict status and message', () => {
    assert.equal(isDrivePermissionAlreadyExistsError({ status: 409 }), true);
    assert.equal(
      isDrivePermissionAlreadyExistsError({ message: 'Permission already exists' }),
      true,
    );
    assert.equal(isDrivePermissionAlreadyExistsError({ status: 500 }), false);
  });
});
