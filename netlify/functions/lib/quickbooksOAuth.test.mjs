import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  invoiceStatus,
  normalizeCustomerId,
  normalizeRealmId,
  quickbooksSearchTerm,
  safeInvoicePayUrl,
  shapeBilling,
} from './quickbooksOAuth.mjs';

describe('quickbooks customer ids', () => {
  it('keeps digits and drops everything else', () => {
    assert.equal(normalizeCustomerId(' 12-34 '), '1234');
    assert.equal(normalizeCustomerId('abc'), '');
    assert.equal(normalizeCustomerId(''), '');
    assert.equal(normalizeRealmId('9341455555555555'), '9341455555555555');
  });
});

describe('quickbooks search', () => {
  it('strips quotes and wildcards', () => {
    assert.equal(quickbooksSearchTerm("O'Brien %_\\"), 'O Brien');
    assert.equal(quickbooksSearchTerm('  Bosch Services  '), 'Bosch Services');
  });
});

describe('invoice pay links', () => {
  it('allows intuit https links only', () => {
    assert.equal(
      safeInvoicePayUrl('https://connect.intuit.com/portal/app/pay?id=1'),
      'https://connect.intuit.com/portal/app/pay?id=1',
    );
    assert.equal(safeInvoicePayUrl('https://evil.example/pay'), '');
    assert.equal(safeInvoicePayUrl('http://intuit.com/pay'), '');
  });
});

describe('invoice status', () => {
  it('marks paid, overdue, partial, and open', () => {
    assert.equal(invoiceStatus({ Balance: 0, TotalAmt: 100 }, '2026-09-29'), 'paid');
    assert.equal(
      invoiceStatus({ Balance: 40, TotalAmt: 100, DueDate: '2026-09-01' }, '2026-09-29'),
      'overdue',
    );
    assert.equal(
      invoiceStatus({ Balance: 40, TotalAmt: 100, DueDate: '2026-10-15' }, '2026-09-29'),
      'partial',
    );
    assert.equal(
      invoiceStatus({ Balance: 100, TotalAmt: 100, DueDate: '2026-10-15' }, '2026-09-29'),
      'open',
    );
  });
});

describe('shapeBilling', () => {
  it('returns a client-safe snapshot', () => {
    const shaped = shapeBilling({
      todayYmd: '2026-09-29',
      customer: { Id: '9', DisplayName: 'Bosch', Balance: 40, CurrencyRef: { value: 'CAD' } },
      invoices: [
        {
          Id: '1',
          DocNumber: '1042',
          TxnDate: '2026-09-01',
          DueDate: '2026-09-15',
          TotalAmt: 100,
          Balance: 40,
          InvoiceLink: 'https://connect.intuit.com/pay/1',
          PrivateNote: 'internal',
        },
      ],
      payments: [{ Id: '7', TxnDate: '2026-09-10', TotalAmt: 60, PaymentRefNum: 'EFT', UnappliedAmt: 0 }],
    });
    assert.equal(shaped.currency, 'CAD');
    assert.equal(shaped.customer.balance, 40);
    assert.equal(shaped.invoices[0].status, 'overdue');
    assert.equal(shaped.invoices[0].payUrl, 'https://connect.intuit.com/pay/1');
    assert.equal(shaped.invoices[0].PrivateNote, undefined);
    assert.equal(shaped.payments[0].amount, 60);
  });
});
