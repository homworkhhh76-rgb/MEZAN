/**
 * Backend reference implementation for a Turso/libSQL-like transaction API.
 * It validates Debit = Credit before writing, then relies on the SQL trigger
 * as a second line of defense when the draft is posted.
 */
export async function saveJournalEntry(db, entry) {
  const lines = Array.isArray(entry.lines) ? entry.lines : [];
  if (lines.length < 2) throw new Error('Journal entry requires at least two lines.');

  let debit = 0;
  let credit = 0;
  for (const line of lines) {
    const d = Number(line.debit || 0);
    const c = Number(line.credit || 0);
    if (!Number.isFinite(d) || !Number.isFinite(c) || d < 0 || c < 0) {
      throw new Error('Debit and credit must be valid non-negative numbers.');
    }
    if ((d > 0 && c > 0) || (d === 0 && c === 0)) {
      throw new Error('Each journal line must contain either debit or credit, not both.');
    }
    debit += d;
    credit += c;
  }

  debit = Math.round(debit * 100) / 100;
  credit = Math.round(credit * 100) / 100;
  if (Math.abs(debit - credit) > 0.009) {
    throw new Error(`Unbalanced journal. Debit=${debit.toFixed(2)}, Credit=${credit.toFixed(2)}`);
  }
  if (debit <= 0) throw new Error('Journal total must be greater than zero.');

  const tx = await db.transaction('write');
  try {
    await tx.execute({
      sql: `INSERT INTO journal_entries
            (id, company_id, branch_id, fiscal_period_id, entry_no, entry_date,
             description, reference_type, reference_id, status, automatic, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
      args: [entry.id, entry.companyId, entry.branchId, entry.fiscalPeriodId || null,
        entry.entryNo, entry.entryDate, entry.description, entry.referenceType || null,
        entry.referenceId || null, entry.automatic ? 1 : 0, entry.createdBy]
    });

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      await tx.execute({
        sql: `INSERT INTO journal_lines
              (journal_id, line_no, account_id, party_id, description, debit, credit)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [entry.id, i + 1, line.accountId, line.partyId || null,
          line.description || null, Number(line.debit || 0), Number(line.credit || 0)]
      });
    }

    // The SQL trigger verifies the sums again at database level.
    await tx.execute({
      sql: `UPDATE journal_entries
            SET status='posted', posted_at=datetime('now')
            WHERE id=? AND status='draft'`,
      args: [entry.id]
    });

    await tx.commit();
    return { id: entry.id, debit, credit, status: 'posted' };
  } catch (error) {
    await tx.rollback();
    throw error;
  }
}
