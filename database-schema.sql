-- AlMezan Pro ERP - Relational Schema (SQLite / Turso compatible)
-- Designed for strict foreign keys, double-entry accounting, invoices, inventory and RBAC.
-- Enable this on every connection.
PRAGMA foreign_keys = ON;

BEGIN;

CREATE TABLE IF NOT EXISTS companies (
  id              TEXT PRIMARY KEY,
  name_ar         TEXT NOT NULL,
  name_en         TEXT,
  tax_number      TEXT,
  base_currency   TEXT NOT NULL DEFAULT 'ILS',
  timezone        TEXT NOT NULL DEFAULT 'Asia/Gaza',
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS branches (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  code            TEXT NOT NULL,
  name_ar         TEXT NOT NULL,
  name_en         TEXT,
  active          INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  UNIQUE(company_id, code)
);

CREATE TABLE IF NOT EXISTS warehouses (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  branch_id       TEXT NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  code            TEXT NOT NULL,
  name_ar         TEXT NOT NULL,
  name_en         TEXT,
  active          INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  UNIQUE(company_id, code)
);

-- ========================= RBAC =========================
CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  branch_id       TEXT REFERENCES branches(id) ON DELETE RESTRICT,
  username        TEXT NOT NULL,
  password_hash   TEXT NOT NULL,
  display_name    TEXT NOT NULL,
  language        TEXT NOT NULL DEFAULT 'ar' CHECK (language IN ('ar','en')),
  active          INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(company_id, username)
);

CREATE TABLE IF NOT EXISTS roles (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code            TEXT NOT NULL,
  name_ar         TEXT NOT NULL,
  name_en         TEXT,
  UNIQUE(company_id, code)
);

CREATE TABLE IF NOT EXISTS permissions (
  code            TEXT PRIMARY KEY,
  name_ar         TEXT NOT NULL,
  name_en         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id         TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY(user_id, role_id)
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id         TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_code TEXT NOT NULL REFERENCES permissions(code) ON DELETE CASCADE,
  PRIMARY KEY(role_id, permission_code)
);

-- ========================= Accounting =========================
CREATE TABLE IF NOT EXISTS accounts (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  parent_id       TEXT REFERENCES accounts(id) ON DELETE RESTRICT,
  code            TEXT NOT NULL,
  name_ar         TEXT NOT NULL,
  name_en         TEXT,
  account_type    TEXT NOT NULL CHECK (account_type IN ('asset','liability','equity','revenue','expense')),
  normal_side     TEXT NOT NULL CHECK (normal_side IN ('debit','credit')),
  is_postable     INTEGER NOT NULL DEFAULT 1 CHECK (is_postable IN (0,1)),
  active          INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  show_in_payments INTEGER NOT NULL DEFAULT 0 CHECK (show_in_payments IN (0,1)),
  UNIQUE(company_id, code)
);

CREATE INDEX IF NOT EXISTS idx_accounts_parent ON accounts(company_id, parent_id);

-- ========================= Customer & Price Groups =========================
CREATE TABLE IF NOT EXISTS price_groups (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  code            TEXT NOT NULL,
  name_ar         TEXT NOT NULL,
  name_en         TEXT,
  active          INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  UNIQUE(company_id, code)
);

CREATE TABLE IF NOT EXISTS customer_groups (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  code            TEXT NOT NULL,
  name_ar         TEXT NOT NULL,
  name_en         TEXT,
  price_group_id  TEXT NOT NULL REFERENCES price_groups(id) ON DELETE RESTRICT,
  default_credit_limit NUMERIC NOT NULL DEFAULT 0 CHECK (default_credit_limit >= 0),
  payment_terms_days INTEGER NOT NULL DEFAULT 0 CHECK (payment_terms_days >= 0),
  default_discount_percent NUMERIC NOT NULL DEFAULT 0 CHECK (default_discount_percent >= 0 AND default_discount_percent <= 100),
  active          INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  UNIQUE(company_id, code)
);

-- ========================= Parties =========================
CREATE TABLE IF NOT EXISTS parties (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  party_type      TEXT NOT NULL CHECK (party_type IN ('customer','supplier','both')),
  code            TEXT,
  name_ar         TEXT NOT NULL,
  name_en         TEXT,
  phone           TEXT,
  tax_number      TEXT,
  credit_limit    NUMERIC NOT NULL DEFAULT 0 CHECK (credit_limit >= 0),
  customer_group_id TEXT REFERENCES customer_groups(id) ON DELETE RESTRICT,
  price_group_override_id TEXT REFERENCES price_groups(id) ON DELETE RESTRICT,
  extra_discount_percent NUMERIC NOT NULL DEFAULT 0 CHECK (extra_discount_percent >= 0 AND extra_discount_percent <= 100),
  payment_terms_days INTEGER NOT NULL DEFAULT 0 CHECK (payment_terms_days >= 0),
  receivable_account_id TEXT REFERENCES accounts(id) ON DELETE RESTRICT,
  payable_account_id    TEXT REFERENCES accounts(id) ON DELETE RESTRICT,
  active          INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  UNIQUE(company_id, code)
);



-- ========================= Multi-currency / Cost Centers / Financial Years =========================
CREATE TABLE IF NOT EXISTS currencies (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  code            TEXT NOT NULL,
  name_ar         TEXT NOT NULL,
  name_en         TEXT,
  symbol          TEXT NOT NULL,
  decimal_places  INTEGER NOT NULL DEFAULT 2 CHECK(decimal_places BETWEEN 0 AND 6),
  is_base_currency INTEGER NOT NULL DEFAULT 0 CHECK(is_base_currency IN (0,1)),
  active          INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  UNIQUE(company_id, code)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_company_base_currency ON currencies(company_id) WHERE is_base_currency=1;

CREATE TABLE IF NOT EXISTS exchange_rates (
  id              TEXT PRIMARY KEY,
  currency_id     TEXT NOT NULL REFERENCES currencies(id) ON DELETE RESTRICT,
  rate_date       TEXT NOT NULL,
  exchange_rate   NUMERIC NOT NULL CHECK(exchange_rate > 0),
  created_at      TEXT NOT NULL DEFAULT(datetime('now')),
  UNIQUE(currency_id, rate_date)
);

CREATE TABLE IF NOT EXISTS cost_centers (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  parent_id       TEXT REFERENCES cost_centers(id) ON DELETE RESTRICT,
  code            TEXT NOT NULL,
  name_ar         TEXT NOT NULL,
  name_en         TEXT,
  active          INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  UNIQUE(company_id, code)
);

CREATE TABLE IF NOT EXISTS financial_years (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  name_ar         TEXT NOT NULL,
  starts_on       TEXT NOT NULL,
  ends_on         TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
  closed_at       TEXT,
  closed_by       TEXT REFERENCES users(id) ON DELETE RESTRICT,
  CHECK(starts_on <= ends_on)
);

CREATE TABLE IF NOT EXISTS financial_year_archives (
  id              TEXT PRIMARY KEY,
  financial_year_id TEXT NOT NULL REFERENCES financial_years(id) ON DELETE RESTRICT,
  snapshot_json   TEXT NOT NULL,
  archived_at     TEXT NOT NULL DEFAULT(datetime('now'))
);

CREATE TABLE IF NOT EXISTS cashier_shifts (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  branch_id       TEXT NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  shift_no        TEXT NOT NULL,
  opened_at       TEXT NOT NULL,
  closed_at       TEXT,
  opening_cash    NUMERIC NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
  blind_close_json TEXT,
  z_report_json   TEXT,
  UNIQUE(company_id, shift_no)
);

CREATE TABLE IF NOT EXISTS fiscal_periods (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  starts_on       TEXT NOT NULL,
  ends_on         TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','locked')),
  CHECK (starts_on <= ends_on)
);

CREATE TABLE IF NOT EXISTS journal_entries (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  branch_id       TEXT NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  fiscal_period_id TEXT REFERENCES fiscal_periods(id) ON DELETE RESTRICT,
  entry_no        TEXT NOT NULL,
  entry_date      TEXT NOT NULL,
  description     TEXT NOT NULL,
  reference_type  TEXT,
  reference_id    TEXT,
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted','reversed')),
  automatic       INTEGER NOT NULL DEFAULT 0 CHECK (automatic IN (0,1)),
  created_by      TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  posted_at       TEXT,
  UNIQUE(company_id, entry_no)
);

CREATE TABLE IF NOT EXISTS journal_lines (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  journal_id      TEXT NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  line_no         INTEGER NOT NULL,
  account_id      TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  party_id        TEXT REFERENCES parties(id) ON DELETE RESTRICT,
  cost_center_id  TEXT REFERENCES cost_centers(id) ON DELETE RESTRICT,
  currency_id     TEXT REFERENCES currencies(id) ON DELETE RESTRICT,
  exchange_rate   NUMERIC NOT NULL DEFAULT 1 CHECK(exchange_rate > 0),
  foreign_amount  NUMERIC NOT NULL DEFAULT 0,
  local_amount    NUMERIC NOT NULL DEFAULT 0,
  description     TEXT,
  debit           NUMERIC NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit          NUMERIC NOT NULL DEFAULT 0 CHECK (credit >= 0),
  CHECK ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0)),
  UNIQUE(journal_id, line_no)
);

CREATE INDEX IF NOT EXISTS idx_journal_lines_account ON journal_lines(account_id, journal_id);
CREATE INDEX IF NOT EXISTS idx_journal_entries_date ON journal_entries(company_id, entry_date, status);

-- A posted journal is immutable at line level.
CREATE TRIGGER IF NOT EXISTS trg_journal_lines_no_insert_posted
BEFORE INSERT ON journal_lines
WHEN (SELECT status FROM journal_entries WHERE id = NEW.journal_id) <> 'draft'
BEGIN
  SELECT RAISE(ABORT, 'Journal lines can only be added while entry is draft');
END;

CREATE TRIGGER IF NOT EXISTS trg_journal_lines_no_update_posted
BEFORE UPDATE ON journal_lines
WHEN (SELECT status FROM journal_entries WHERE id = OLD.journal_id) <> 'draft'
BEGIN
  SELECT RAISE(ABORT, 'Posted journal lines are immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_journal_lines_no_delete_posted
BEFORE DELETE ON journal_lines
WHEN (SELECT status FROM journal_entries WHERE id = OLD.journal_id) <> 'draft'
BEGIN
  SELECT RAISE(ABORT, 'Posted journal lines are immutable');
END;

-- The key accounting guard: changing a journal from draft -> posted is rejected unless balanced.
CREATE TRIGGER IF NOT EXISTS trg_journal_require_balance_before_post
BEFORE UPDATE OF status ON journal_entries
WHEN NEW.status = 'posted' AND OLD.status = 'draft'
BEGIN
  SELECT CASE
    WHEN (SELECT COUNT(*) FROM journal_lines WHERE journal_id = NEW.id) < 2
      THEN RAISE(ABORT, 'Journal requires at least two lines')
    WHEN ROUND(COALESCE((SELECT SUM(debit) FROM journal_lines WHERE journal_id = NEW.id),0),2)
       <> ROUND(COALESCE((SELECT SUM(credit) FROM journal_lines WHERE journal_id = NEW.id),0),2)
      THEN RAISE(ABORT, 'Unbalanced journal: Debit must equal Credit')
    WHEN ROUND(COALESCE((SELECT SUM(debit) FROM journal_lines WHERE journal_id = NEW.id),0),2) <= 0
      THEN RAISE(ABORT, 'Journal amount must be greater than zero')
  END;
END;

-- ========================= Inventory =========================
CREATE TABLE IF NOT EXISTS item_categories (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  parent_id       TEXT REFERENCES item_categories(id) ON DELETE RESTRICT,
  name_ar         TEXT NOT NULL,
  name_en         TEXT
);

CREATE TABLE IF NOT EXISTS items (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  category_id     TEXT REFERENCES item_categories(id) ON DELETE RESTRICT,
  sku             TEXT,
  name_ar         TEXT NOT NULL,
  name_en         TEXT,
  item_type       TEXT NOT NULL DEFAULT 'stock' CHECK (item_type IN ('stock','service','assembly')),
  costing_method  TEXT NOT NULL DEFAULT 'weighted_average' CHECK (costing_method IN ('weighted_average','fifo')),
  weighted_avg_cost NUMERIC NOT NULL DEFAULT 0 CHECK (weighted_avg_cost >= 0),
  tax_rate        NUMERIC NOT NULL DEFAULT 0 CHECK (tax_rate >= 0 AND tax_rate <= 100),
  track_serials   INTEGER NOT NULL DEFAULT 0 CHECK (track_serials IN (0,1)),
  track_expiry    INTEGER NOT NULL DEFAULT 0 CHECK (track_expiry IN (0,1)),
  active          INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  UNIQUE(company_id, sku)
);

CREATE TABLE IF NOT EXISTS item_units (
  id              TEXT PRIMARY KEY,
  item_id         TEXT NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  name_ar         TEXT NOT NULL,
  name_en         TEXT,
  factor_to_base  NUMERIC NOT NULL CHECK (factor_to_base > 0),
  barcode         TEXT,
  sale_price      NUMERIC NOT NULL DEFAULT 0 CHECK (sale_price >= 0),
  purchase_price  NUMERIC NOT NULL DEFAULT 0 CHECK (purchase_price >= 0),
  is_base         INTEGER NOT NULL DEFAULT 0 CHECK (is_base IN (0,1)),
  UNIQUE(item_id, barcode)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_item_single_base_unit ON item_units(item_id) WHERE is_base = 1;

CREATE TABLE IF NOT EXISTS item_prices (
  item_id         TEXT NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  unit_id         TEXT NOT NULL REFERENCES item_units(id) ON DELETE RESTRICT,
  price_group_id  TEXT NOT NULL REFERENCES price_groups(id) ON DELETE RESTRICT,
  price           NUMERIC NOT NULL CHECK (price >= 0),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(item_id, unit_id, price_group_id)
);

CREATE INDEX IF NOT EXISTS idx_item_prices_group ON item_prices(price_group_id, item_id);

CREATE TABLE IF NOT EXISTS stock_balances (
  warehouse_id    TEXT NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  item_id         TEXT NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  qty_base        NUMERIC NOT NULL DEFAULT 0,
  PRIMARY KEY(warehouse_id, item_id)
);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  warehouse_id    TEXT NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  item_id         TEXT NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  movement_date   TEXT NOT NULL,
  movement_type   TEXT NOT NULL CHECK (movement_type IN ('purchase','sale','sale_return','purchase_return','transfer_in','transfer_out','adjustment','opening')),
  reference_type  TEXT,
  reference_id    TEXT,
  qty_base        NUMERIC NOT NULL,
  unit_cost_base  NUMERIC NOT NULL DEFAULT 0 CHECK (unit_cost_base >= 0),
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_inventory_movements_item_date ON inventory_movements(item_id, warehouse_id, movement_date);

-- FIFO layers. Purchases/opening create positive layers; sales consume oldest remaining_qty first.
CREATE TABLE IF NOT EXISTS inventory_cost_layers (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  warehouse_id    TEXT NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  item_id         TEXT NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  source_movement_id TEXT NOT NULL REFERENCES inventory_movements(id) ON DELETE RESTRICT,
  received_at     TEXT NOT NULL,
  original_qty    NUMERIC NOT NULL CHECK (original_qty > 0),
  remaining_qty   NUMERIC NOT NULL CHECK (remaining_qty >= 0),
  unit_cost_base  NUMERIC NOT NULL CHECK (unit_cost_base >= 0),
  CHECK (remaining_qty <= original_qty)
);

CREATE INDEX IF NOT EXISTS idx_fifo_open_layers ON inventory_cost_layers(item_id, warehouse_id, received_at) WHERE remaining_qty > 0;

CREATE TABLE IF NOT EXISTS inventory_batches (
  id              TEXT PRIMARY KEY,
  item_id         TEXT NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  warehouse_id    TEXT NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  batch_no        TEXT,
  expiry_date     TEXT,
  qty_base        NUMERIC NOT NULL DEFAULT 0,
  UNIQUE(item_id, warehouse_id, batch_no)
);

CREATE TABLE IF NOT EXISTS item_serials (
  id              TEXT PRIMARY KEY,
  item_id         TEXT NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  warehouse_id    TEXT REFERENCES warehouses(id) ON DELETE RESTRICT,
  serial_no       TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'in_stock' CHECK (status IN ('in_stock','sold','returned','damaged')),
  UNIQUE(item_id, serial_no)
);

-- ========================= Sales =========================
CREATE TABLE IF NOT EXISTS sales_invoices (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  branch_id       TEXT NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  warehouse_id    TEXT NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  shift_id        TEXT REFERENCES cashier_shifts(id) ON DELETE RESTRICT,
  currency_id     TEXT REFERENCES currencies(id) ON DELETE RESTRICT,
  exchange_rate   NUMERIC NOT NULL DEFAULT 1 CHECK(exchange_rate > 0),
  foreign_total   NUMERIC NOT NULL DEFAULT 0,
  local_total     NUMERIC NOT NULL DEFAULT 0,
  customer_id     TEXT REFERENCES parties(id) ON DELETE RESTRICT,
  invoice_no      TEXT NOT NULL,
  invoice_date    TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted','paid','partial','credit','cancelled','returned')),
  subtotal        NUMERIC NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  discount_total  NUMERIC NOT NULL DEFAULT 0 CHECK (discount_total >= 0),
  tax_total       NUMERIC NOT NULL DEFAULT 0 CHECK (tax_total >= 0),
  grand_total     NUMERIC NOT NULL DEFAULT 0 CHECK (grand_total >= 0),
  paid_total      NUMERIC NOT NULL DEFAULT 0 CHECK (paid_total >= 0),
  due_total       NUMERIC NOT NULL DEFAULT 0 CHECK (due_total >= 0),
  journal_id      TEXT REFERENCES journal_entries(id) ON DELETE RESTRICT,
  created_by      TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(company_id, invoice_no),
  CHECK (ABS((grand_total - paid_total) - due_total) < 0.011)
);

CREATE TABLE IF NOT EXISTS sales_invoice_lines (
  id              TEXT PRIMARY KEY,
  invoice_id      TEXT NOT NULL REFERENCES sales_invoices(id) ON DELETE CASCADE,
  line_no         INTEGER NOT NULL,
  item_id         TEXT NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  unit_id         TEXT NOT NULL REFERENCES item_units(id) ON DELETE RESTRICT,
  qty             NUMERIC NOT NULL CHECK (qty > 0),
  factor_to_base  NUMERIC NOT NULL CHECK (factor_to_base > 0),
  unit_price      NUMERIC NOT NULL CHECK (unit_price >= 0),
  discount_amount NUMERIC NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  tax_rate        NUMERIC NOT NULL DEFAULT 0 CHECK (tax_rate >= 0 AND tax_rate <= 100),
  tax_amount      NUMERIC NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  line_total      NUMERIC NOT NULL CHECK (line_total >= 0),
  cost_total      NUMERIC NOT NULL DEFAULT 0 CHECK (cost_total >= 0),
  UNIQUE(invoice_id, line_no)
);

-- Multiple payment allocations: each collected amount is posted to a real chart-of-accounts account.
CREATE TABLE IF NOT EXISTS sales_invoice_payments (
  id              TEXT PRIMARY KEY,
  invoice_id      TEXT NOT NULL REFERENCES sales_invoices(id) ON DELETE CASCADE,
  account_id      TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  amount          NUMERIC NOT NULL CHECK (amount > 0),
  reference       TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sales_invoice_payments_invoice ON sales_invoice_payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_sales_invoice_payments_account ON sales_invoice_payments(account_id);

-- ========================= Purchases =========================
CREATE TABLE IF NOT EXISTS purchase_invoices (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  branch_id       TEXT NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  warehouse_id    TEXT NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  currency_id     TEXT REFERENCES currencies(id) ON DELETE RESTRICT,
  exchange_rate   NUMERIC NOT NULL DEFAULT 1 CHECK(exchange_rate > 0),
  foreign_total   NUMERIC NOT NULL DEFAULT 0,
  local_total     NUMERIC NOT NULL DEFAULT 0,
  supplier_id     TEXT REFERENCES parties(id) ON DELETE RESTRICT,
  invoice_no      TEXT NOT NULL,
  supplier_invoice_no TEXT,
  invoice_date    TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted','paid','partial','credit','cancelled','returned')),
  gross_subtotal  NUMERIC NOT NULL DEFAULT 0 CHECK (gross_subtotal >= 0),
  discount_mode   TEXT NOT NULL DEFAULT 'amount' CHECK (discount_mode IN ('amount','percent')),
  discount_value  NUMERIC NOT NULL DEFAULT 0 CHECK (discount_value >= 0),
  discount_total  NUMERIC NOT NULL DEFAULT 0 CHECK (discount_total >= 0),
  subtotal        NUMERIC NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  tax_total       NUMERIC NOT NULL DEFAULT 0 CHECK (tax_total >= 0),
  grand_total     NUMERIC NOT NULL DEFAULT 0 CHECK (grand_total >= 0),
  paid_total      NUMERIC NOT NULL DEFAULT 0 CHECK (paid_total >= 0),
  due_total       NUMERIC NOT NULL DEFAULT 0 CHECK (due_total >= 0),
  journal_id      TEXT REFERENCES journal_entries(id) ON DELETE RESTRICT,
  created_by      TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(company_id, invoice_no),
  CHECK (ABS((grand_total - paid_total) - due_total) < 0.011)
);

CREATE TABLE IF NOT EXISTS purchase_invoice_lines (
  id              TEXT PRIMARY KEY,
  invoice_id      TEXT NOT NULL REFERENCES purchase_invoices(id) ON DELETE CASCADE,
  line_no         INTEGER NOT NULL,
  item_id         TEXT NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  unit_id         TEXT NOT NULL REFERENCES item_units(id) ON DELETE RESTRICT,
  qty             NUMERIC NOT NULL CHECK (qty > 0),
  factor_to_base  NUMERIC NOT NULL CHECK (factor_to_base > 0),
  unit_cost       NUMERIC NOT NULL CHECK (unit_cost >= 0),
  discount_amount NUMERIC NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  effective_unit_cost NUMERIC NOT NULL DEFAULT 0 CHECK (effective_unit_cost >= 0),
  tax_rate        NUMERIC NOT NULL DEFAULT 0 CHECK (tax_rate >= 0 AND tax_rate <= 100),
  tax_amount      NUMERIC NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  line_total      NUMERIC NOT NULL CHECK (line_total >= 0),
  UNIQUE(invoice_id, line_no)
);

-- ========================= Vouchers / Cheques =========================
CREATE TABLE IF NOT EXISTS vouchers (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  branch_id       TEXT NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  voucher_no      TEXT NOT NULL,
  voucher_date    TEXT NOT NULL,
  direction       TEXT NOT NULL CHECK (direction IN ('receipt','payment')),
  party_id        TEXT REFERENCES parties(id) ON DELETE RESTRICT,
  currency_id     TEXT REFERENCES currencies(id) ON DELETE RESTRICT,
  exchange_rate   NUMERIC NOT NULL DEFAULT 1 CHECK(exchange_rate > 0),
  foreign_amount  NUMERIC NOT NULL DEFAULT 0,
  local_amount    NUMERIC NOT NULL DEFAULT 0,
  amount          NUMERIC NOT NULL CHECK (amount > 0),
  payment_method  TEXT NOT NULL CHECK (payment_method IN ('cash','bank','card','cheque','other')),
  reference       TEXT,
  journal_id      TEXT NOT NULL REFERENCES journal_entries(id) ON DELETE RESTRICT,
  created_by      TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  UNIQUE(company_id, voucher_no)
);

CREATE TABLE IF NOT EXISTS cheques (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  party_id        TEXT REFERENCES parties(id) ON DELETE RESTRICT,
  cheque_no       TEXT NOT NULL,
  bank_name       TEXT NOT NULL,
  direction       TEXT NOT NULL CHECK (direction IN ('incoming','outgoing')),
  due_date        TEXT NOT NULL,
  amount          NUMERIC NOT NULL CHECK (amount > 0),
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','collected','returned','cancelled')),
  UNIQUE(company_id, bank_name, cheque_no)
);

-- ========================= Audit =========================
CREATE TABLE IF NOT EXISTS audit_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  user_id         TEXT REFERENCES users(id) ON DELETE SET NULL,
  action          TEXT NOT NULL,
  entity_type     TEXT NOT NULL,
  entity_id       TEXT,
  before_json     TEXT,
  after_json      TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

COMMIT;

-- =========================================================
-- Reference transaction for saving a balanced journal in Turso/SQLite.
-- SQLite/Turso does not support stored procedures, therefore the app/API
-- should execute these statements in ONE transaction:
--   1) INSERT journal_entries as status='draft'
--   2) INSERT all journal_lines
--   3) UPDATE journal_entries SET status='posted' ...
-- The trigger trg_journal_require_balance_before_post aborts step 3 and
-- rolls back the transaction if SUM(debit) != SUM(credit).
-- =========================================================

-- ========================= Enterprise extensions: taxes / payroll / chat =========================
CREATE TABLE IF NOT EXISTS taxes (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  rate NUMERIC NOT NULL DEFAULT 0 CHECK(rate >= 0 AND rate <= 100),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payroll_workers (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  employee_no TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  job_title TEXT,
  branch_id TEXT REFERENCES branches(id) ON DELETE RESTRICT,
  basic_salary NUMERIC NOT NULL DEFAULT 0 CHECK(basic_salary >= 0),
  monthly_allowances NUMERIC NOT NULL DEFAULT 0 CHECK(monthly_allowances >= 0),
  shift_start TEXT,
  shift_end TEXT,
  overtime_multiplier NUMERIC NOT NULL DEFAULT 1.5 CHECK(overtime_multiplier >= 1),
  payable_account_id TEXT REFERENCES accounts(id) ON DELETE RESTRICT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(company_id, employee_no)
);

CREATE TABLE IF NOT EXISTS attendance_records (
  id TEXT PRIMARY KEY,
  worker_id TEXT NOT NULL REFERENCES payroll_workers(id) ON DELETE RESTRICT,
  work_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('present','absent','leave')),
  check_in TEXT,
  check_out TEXT,
  late_minutes INTEGER NOT NULL DEFAULT 0 CHECK(late_minutes >= 0),
  overtime_minutes INTEGER NOT NULL DEFAULT 0 CHECK(overtime_minutes >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(worker_id, work_date)
);

CREATE TABLE IF NOT EXISTS employee_loans (
  id TEXT PRIMARY KEY,
  worker_id TEXT NOT NULL REFERENCES payroll_workers(id) ON DELETE RESTRICT,
  loan_date TEXT NOT NULL,
  amount NUMERIC NOT NULL CHECK(amount > 0),
  installment_amount NUMERIC NOT NULL CHECK(installment_amount > 0),
  remaining_amount NUMERIC NOT NULL CHECK(remaining_amount >= 0),
  cash_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  journal_id TEXT REFERENCES journal_entries(id) ON DELETE RESTRICT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payroll_adjustments (
  id TEXT PRIMARY KEY,
  worker_id TEXT NOT NULL REFERENCES payroll_workers(id) ON DELETE RESTRICT,
  adjustment_date TEXT NOT NULL,
  adjustment_type TEXT NOT NULL CHECK(adjustment_type IN ('deduction','allowance')),
  amount NUMERIC NOT NULL CHECK(amount > 0),
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payroll_sheets (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  payroll_month TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','posted','cancelled')),
  posted_at TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(company_id, payroll_month)
);

CREATE TABLE IF NOT EXISTS payroll_sheet_lines (
  id TEXT PRIMARY KEY,
  sheet_id TEXT NOT NULL REFERENCES payroll_sheets(id) ON DELETE CASCADE,
  worker_id TEXT NOT NULL REFERENCES payroll_workers(id) ON DELETE RESTRICT,
  basic_salary NUMERIC NOT NULL DEFAULT 0,
  allowances NUMERIC NOT NULL DEFAULT 0,
  overtime_amount NUMERIC NOT NULL DEFAULT 0,
  attendance_deduction NUMERIC NOT NULL DEFAULT 0,
  other_deductions NUMERIC NOT NULL DEFAULT 0,
  loan_deduction NUMERIC NOT NULL DEFAULT 0,
  net_salary NUMERIC NOT NULL DEFAULT 0,
  UNIQUE(sheet_id, worker_id)
);

CREATE TABLE IF NOT EXISTS internal_messages (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  sender_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  receiver_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  message_text TEXT NOT NULL,
  sent_at TEXT NOT NULL DEFAULT (datetime('now')),
  read_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_attendance_worker_date ON attendance_records(worker_id, work_date);
CREATE INDEX IF NOT EXISTS idx_loans_worker_remaining ON employee_loans(worker_id, remaining_amount);
CREATE INDEX IF NOT EXISTS idx_messages_pair_time ON internal_messages(sender_user_id, receiver_user_id, sent_at);

-- ========================= v7.4: installment contracts / chat groups / messaging =========================
CREATE TABLE IF NOT EXISTS chat_groups (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chat_group_members (
  group_id TEXT NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(group_id,user_id)
);

CREATE TABLE IF NOT EXISTS group_messages (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
  sender_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  message_text TEXT NOT NULL,
  sent_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS installment_contracts (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  contract_no TEXT NOT NULL,
  invoice_id TEXT NOT NULL REFERENCES sales_invoices(id) ON DELETE RESTRICT,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  cash_total NUMERIC NOT NULL CHECK(cash_total >= 0),
  markup_rate NUMERIC NOT NULL DEFAULT 0 CHECK(markup_rate >= 0),
  markup_amount NUMERIC NOT NULL DEFAULT 0 CHECK(markup_amount >= 0),
  installment_total NUMERIC NOT NULL CHECK(installment_total >= 0),
  down_payment NUMERIC NOT NULL DEFAULT 0 CHECK(down_payment >= 0),
  financed_amount NUMERIC NOT NULL CHECK(financed_amount >= 0),
  outstanding_amount NUMERIC NOT NULL CHECK(outstanding_amount >= 0),
  deferred_profit_remaining NUMERIC NOT NULL DEFAULT 0 CHECK(deferred_profit_remaining >= 0),
  frequency TEXT NOT NULL CHECK(frequency IN ('weekly','monthly')),
  installment_count INTEGER NOT NULL CHECK(installment_count > 0),
  first_due_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paid','cancelled')),
  created_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(company_id,contract_no)
);

CREATE TABLE IF NOT EXISTS installment_schedule (
  id TEXT PRIMARY KEY,
  contract_id TEXT NOT NULL REFERENCES installment_contracts(id) ON DELETE CASCADE,
  installment_no INTEGER NOT NULL CHECK(installment_no > 0),
  due_date TEXT NOT NULL,
  due_amount NUMERIC NOT NULL CHECK(due_amount > 0),
  paid_amount NUMERIC NOT NULL DEFAULT 0 CHECK(paid_amount >= 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','partial','paid','overdue','cancelled')),
  last_paid_at TEXT,
  UNIQUE(contract_id,installment_no)
);

CREATE TABLE IF NOT EXISTS installment_payments (
  id TEXT PRIMARY KEY,
  contract_id TEXT NOT NULL REFERENCES installment_contracts(id) ON DELETE RESTRICT,
  schedule_id TEXT NOT NULL REFERENCES installment_schedule(id) ON DELETE RESTRICT,
  payment_date TEXT NOT NULL,
  amount NUMERIC NOT NULL CHECK(amount > 0),
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  realized_profit NUMERIC NOT NULL DEFAULT 0 CHECK(realized_profit >= 0),
  journal_id TEXT REFERENCES journal_entries(id) ON DELETE RESTRICT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS message_templates (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'all' CHECK(channel IN ('all','whatsapp','sms')),
  body TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS customer_message_log (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  template_id TEXT REFERENCES message_templates(id) ON DELETE SET NULL,
  channel TEXT NOT NULL CHECK(channel IN ('whatsapp','sms','call')),
  message_text TEXT,
  status TEXT NOT NULL DEFAULT 'opened',
  created_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_installment_customer_status ON installment_contracts(customer_id,status);
CREATE INDEX IF NOT EXISTS idx_installment_due_status ON installment_schedule(due_date,status);
CREATE INDEX IF NOT EXISTS idx_group_messages_time ON group_messages(group_id,sent_at);


-- ========================= v7.9 safeguards / indexes =========================
CREATE INDEX IF NOT EXISTS idx_exchange_rates_currency_date ON exchange_rates(currency_id, rate_date DESC);
CREATE INDEX IF NOT EXISTS idx_cost_centers_parent ON cost_centers(company_id, parent_id);
CREATE INDEX IF NOT EXISTS idx_financial_years_dates ON financial_years(company_id, starts_on, ends_on, status);
CREATE INDEX IF NOT EXISTS idx_cashier_shifts_user_status ON cashier_shifts(user_id, status, opened_at);
CREATE INDEX IF NOT EXISTS idx_sales_shift ON sales_invoices(shift_id, invoice_date);

CREATE TRIGGER IF NOT EXISTS trg_financial_year_no_overlap_insert
BEFORE INSERT ON financial_years
WHEN EXISTS(
  SELECT 1 FROM financial_years f
  WHERE f.company_id=NEW.company_id
    AND NOT (NEW.ends_on < f.starts_on OR NEW.starts_on > f.ends_on)
)
BEGIN
  SELECT RAISE(ABORT,'financial year overlaps an existing year');
END;

CREATE TRIGGER IF NOT EXISTS trg_sales_no_update_closed_shift
BEFORE UPDATE ON sales_invoices
WHEN OLD.shift_id IS NOT NULL
 AND (SELECT status FROM cashier_shifts WHERE id=OLD.shift_id)='closed'
BEGIN
  SELECT RAISE(ABORT,'invoice belongs to a closed shift');
END;

CREATE TRIGGER IF NOT EXISTS trg_sales_no_delete_closed_shift
BEFORE DELETE ON sales_invoices
WHEN OLD.shift_id IS NOT NULL
 AND (SELECT status FROM cashier_shifts WHERE id=OLD.shift_id)='closed'
BEGIN
  SELECT RAISE(ABORT,'invoice belongs to a closed shift');
END;

CREATE TRIGGER IF NOT EXISTS trg_journal_requires_open_financial_year
BEFORE INSERT ON journal_entries
WHEN EXISTS(SELECT 1 FROM financial_years WHERE company_id=NEW.company_id)
 AND NOT EXISTS(
   SELECT 1 FROM financial_years f
   WHERE f.company_id=NEW.company_id
     AND f.status='open'
     AND NEW.entry_date BETWEEN f.starts_on AND f.ends_on
 )
BEGIN
  SELECT RAISE(ABORT,'journal date is outside an open financial year');
END;

CREATE TRIGGER IF NOT EXISTS trg_journal_no_update_closed_financial_year
BEFORE UPDATE ON journal_entries
WHEN EXISTS(
  SELECT 1 FROM financial_years f
  WHERE f.company_id=OLD.company_id
    AND f.status='closed'
    AND OLD.entry_date BETWEEN f.starts_on AND f.ends_on
)
BEGIN
  SELECT RAISE(ABORT,'journal belongs to a closed financial year');
END;

CREATE TRIGGER IF NOT EXISTS trg_journal_line_cost_center_required
BEFORE INSERT ON journal_lines
WHEN (SELECT type FROM accounts WHERE id=NEW.account_id) IN ('expense','revenue')
 AND NEW.cost_center_id IS NULL
BEGIN
  SELECT RAISE(ABORT,'cost center is required for revenue and expense accounts');
END;

CREATE TRIGGER IF NOT EXISTS trg_journal_line_local_amount_check
BEFORE INSERT ON journal_lines
WHEN ABS(NEW.local_amount - CASE WHEN NEW.debit>0 THEN NEW.debit ELSE NEW.credit END) > 0.011
BEGIN
  SELECT RAISE(ABORT,'local amount must equal the posted debit or credit');
END;


-- ========================= v7.15 FEFO / Restaurant / Manufacturing =========================
-- Optional SQL schema for deployments that persist the browser model in a relational database.

CREATE TABLE IF NOT EXISTS item_cashier_settings (
  item_id          TEXT PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  show_in_cashier  INTEGER NOT NULL DEFAULT 1 CHECK (show_in_cashier IN (0,1)),
  use_recipe       INTEGER NOT NULL DEFAULT 0 CHECK (use_recipe IN (0,1)),
  usage_type       TEXT NOT NULL DEFAULT 'stock' CHECK (usage_type IN ('stock','recipe','manufacturing','service'))
);

CREATE TABLE IF NOT EXISTS recipes (
  id                TEXT PRIMARY KEY,
  company_id        TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  output_item_id    TEXT NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  component_item_id TEXT NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  unit_id           TEXT REFERENCES item_units(id) ON DELETE RESTRICT,
  unit_qty          NUMERIC NOT NULL DEFAULT 1 CHECK (unit_qty > 0),
  unit_factor       NUMERIC NOT NULL DEFAULT 1 CHECK (unit_factor > 0),
  qty_base          NUMERIC NOT NULL CHECK (qty_base > 0),
  active            INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(output_item_id, component_item_id)
);

CREATE TABLE IF NOT EXISTS wastage_documents (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  warehouse_id    TEXT NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  document_no     TEXT NOT NULL,
  document_date   TEXT NOT NULL,
  reason          TEXT NOT NULL,
  notes           TEXT,
  total_cost      NUMERIC NOT NULL DEFAULT 0 CHECK (total_cost >= 0),
  journal_entry_id TEXT REFERENCES journal_entries(id) ON DELETE RESTRICT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(company_id, document_no)
);

CREATE TABLE IF NOT EXISTS wastage_lines (
  id              TEXT PRIMARY KEY,
  wastage_id      TEXT NOT NULL REFERENCES wastage_documents(id) ON DELETE CASCADE,
  item_id         TEXT NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  batch_id        TEXT REFERENCES inventory_batches(id) ON DELETE RESTRICT,
  qty_base        NUMERIC NOT NULL CHECK (qty_base > 0),
  unit_cost_base  NUMERIC NOT NULL DEFAULT 0 CHECK (unit_cost_base >= 0),
  line_cost       NUMERIC NOT NULL DEFAULT 0 CHECK (line_cost >= 0)
);

CREATE TABLE IF NOT EXISTS production_orders (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  warehouse_id    TEXT NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  order_no        TEXT NOT NULL,
  order_date      TEXT NOT NULL,
  output_item_id  TEXT NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  output_unit_id  TEXT REFERENCES item_units(id) ON DELETE RESTRICT,
  output_unit_qty NUMERIC NOT NULL DEFAULT 1 CHECK (output_unit_qty > 0),
  output_unit_factor NUMERIC NOT NULL DEFAULT 1 CHECK (output_unit_factor > 0),
  output_qty_base NUMERIC NOT NULL CHECK (output_qty_base > 0),
  total_cost      NUMERIC NOT NULL DEFAULT 0 CHECK (total_cost >= 0),
  notes           TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(company_id, order_no)
);

CREATE TABLE IF NOT EXISTS production_consumptions (
  id              TEXT PRIMARY KEY,
  production_id   TEXT NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
  item_id         TEXT NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  batch_id        TEXT REFERENCES inventory_batches(id) ON DELETE RESTRICT,
  qty_base        NUMERIC NOT NULL CHECK (qty_base > 0),
  unit_cost_base  NUMERIC NOT NULL DEFAULT 0 CHECK (unit_cost_base >= 0)
);

CREATE TABLE IF NOT EXISTS restaurant_tables (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  branch_id       TEXT REFERENCES branches(id) ON DELETE RESTRICT,
  name            TEXT NOT NULL,
  capacity        INTEGER NOT NULL DEFAULT 4 CHECK (capacity >= 0),
  status          TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','occupied')),
  active          INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  notes           TEXT
);

CREATE TABLE IF NOT EXISTS restaurant_order_links (
  id              TEXT PRIMARY KEY,
  table_id        TEXT NOT NULL REFERENCES restaurant_tables(id) ON DELETE RESTRICT,
  sales_invoice_id TEXT REFERENCES sales_invoices(id) ON DELETE RESTRICT,
  held_order_ref  TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_batches_fefo ON inventory_batches(item_id, warehouse_id, expiry_date, qty_base);
CREATE INDEX IF NOT EXISTS idx_recipes_output ON recipes(output_item_id, active);
CREATE INDEX IF NOT EXISTS idx_wastage_date ON wastage_documents(company_id, document_date);
CREATE INDEX IF NOT EXISTS idx_production_date ON production_orders(company_id, order_date);
CREATE INDEX IF NOT EXISTS idx_restaurant_table_status ON restaurant_tables(company_id, status, active);

-- ============================================================
-- v7.18 Item variants / attributes / in-transit transfer support
-- ============================================================
CREATE TABLE IF NOT EXISTS item_variant_axes (
  id TEXT PRIMARY KEY,
  parent_item_id TEXT NOT NULL,
  axis_name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(parent_item_id) REFERENCES items(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS item_variant_values (
  id TEXT PRIMARY KEY,
  axis_id TEXT NOT NULL,
  value_name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(axis_id) REFERENCES item_variant_axes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS item_variants (
  id TEXT PRIMARY KEY,
  parent_item_id TEXT NOT NULL,
  child_item_id TEXT NOT NULL UNIQUE,
  variant_key TEXT NOT NULL,
  barcode TEXT UNIQUE,
  sale_price NUMERIC NOT NULL DEFAULT 0,
  purchase_price NUMERIC NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE(parent_item_id, variant_key),
  FOREIGN KEY(parent_item_id) REFERENCES items(id) ON DELETE RESTRICT,
  FOREIGN KEY(child_item_id) REFERENCES items(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS item_variant_value_links (
  variant_id TEXT NOT NULL,
  axis_id TEXT NOT NULL,
  value_id TEXT NOT NULL,
  PRIMARY KEY(variant_id, axis_id),
  FOREIGN KEY(variant_id) REFERENCES item_variants(id) ON DELETE CASCADE,
  FOREIGN KEY(axis_id) REFERENCES item_variant_axes(id) ON DELETE RESTRICT,
  FOREIGN KEY(value_id) REFERENCES item_variant_values(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS stock_transfer_lines (
  id TEXT PRIMARY KEY,
  transfer_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  unit_id TEXT,
  quantity NUMERIC NOT NULL,
  factor NUMERIC NOT NULL DEFAULT 1,
  base_quantity NUMERIC NOT NULL,
  FOREIGN KEY(product_id) REFERENCES items(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS in_transit_inventory (
  id TEXT PRIMARY KEY,
  transfer_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  source_warehouse_id TEXT NOT NULL,
  destination_warehouse_id TEXT NOT NULL,
  base_quantity NUMERIC NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_transit',
  sent_at TEXT NOT NULL,
  received_at TEXT,
  FOREIGN KEY(product_id) REFERENCES items(id) ON DELETE RESTRICT,
  FOREIGN KEY(source_warehouse_id) REFERENCES warehouses(id) ON DELETE RESTRICT,
  FOREIGN KEY(destination_warehouse_id) REFERENCES warehouses(id) ON DELETE RESTRICT
);

-- ========================= v7.20 Default cashier unit / fiscal archive behavior =========================
-- The effective close date is stored in financial_years.ends_on. Full historical
-- transaction snapshots are stored in financial_year_archives.snapshot_json.
CREATE TABLE IF NOT EXISTS item_default_units (
  item_id TEXT PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  unit_id TEXT NOT NULL REFERENCES item_units(id) ON DELETE RESTRICT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_item_default_units_unit ON item_default_units(unit_id);
