---
name: actual-budget
description: >-
  Query and safely modify the Actual Budget database ("My Finances") via
  @actual-app/api — budget structure, the Splitwise model, split transactions,
  off-budget Savings/Investments accounts, and the sync/transfer gotchas that
  WILL corrupt data if ignored. Use when analysing the budget, adding
  categories, converting/creating transfers, or writing one-off data scripts.
  For the auto-categoriser service specifically, see /actual-categoriser.
host-only: true
allowed-tools:
  - Bash
  - Read
  - Edit
  - Write
---

# actual-budget

Direct read/write access to the Actual Budget data ("My Finances") via the
JS API. This is the budget **database** itself — accounts, categories,
transactions, transfers. For the nightly auto-categoriser service, see
`/actual-categoriser`.

## Prefer the `finance` CLI over ad-hoc scripts

`~/actual-categoriser` ships a tested **safe-tools CLI** that encodes the
gotchas in this skill as guarded code (sync-before-read, split-child amount
preservation, balance verification, dry-run-by-default). **Reach for it first** —
hand-rolled scripts are how this budget gets corrupted (the 2026-06-22
split-child zeroing happened in an ad-hoc script, {{PLANE_PROJECT_PREFIX}}-103/104).

```bash
cd ~/actual-categoriser && npm run build   # once
node --env-file=secrets.env dist/cli/index.js read balances --json
node --env-file=secrets.env dist/cli/index.js read monthly-view --month 2026-05 [--write-md] [--json]
node --env-file=secrets.env dist/cli/index.js read split <id> --json
node --env-file=secrets.env dist/cli/index.js recategorise <id> <category> [--apply]
node --env-file=secrets.env dist/cli/index.js split <id> <cat:amountPence> ... [--apply]
node --env-file=secrets.env dist/cli/index.js transfer <id> <account> [--apply]
```

Reads are sync-safe; writes are dry-run unless `--apply` and re-verify the
balance. See `~/actual-categoriser/README.md`. Only drop to a throwaway script
(below) for something the CLI doesn't cover yet — and consider adding it to the
CLI instead.

**`read monthly-view` (added 2026-06-22)** is the canonical per-month spending
summary. It emits stable JSON for agents and can optionally write one generated
Markdown file per month under `~/actual-categoriser/reports/monthly/`. It uses
the same core spend rules as `/finance-review`: on-budget only, split-children
only, transfers excluded, neutral categories excluded, and refunds/credits net
against spend.

## Running throwaway scripts against the budget

The `@actual-app/api` package + credentials live in `~/actual-categoriser`.
Write a throwaway `.mjs` **inside that directory** (node_modules resolution)
and run with its env file. Delete it when done.

```js
import * as api from '@actual-app/api';
import path from 'node:path';
await api.init({ dataDir: path.join(process.cwd(),'data','actual-cache'),
  serverURL: process.env.ACTUAL_SERVER_URL, password: process.env.ACTUAL_PASSWORD });
await api.downloadBudget(process.env.ACTUAL_SYNC_ID);
await api.sync();                       // ALWAYS — see gotcha #1
// ... getAccounts / getCategories / runQuery / updateTransaction / addTransactions ...
await api.shutdown();
```

```bash
cd ~/actual-categoriser && node --env-file=secrets.env yourscript.mjs
```

Sync ID (the "My Finances" budget): `bd7f86a1-6b7b-4705-861c-589e0a086a9b`.

**There is exactly ONE canonical budget file** (`bd7f86a1`, cloud file
`bad7da98-1438-405d-b009-5e5f896e9377`). `getBudgets()` lists it under two name
aliases — "My Budget" and "My Finances" — but they are the *same* file (same
groupId); harmless. A stale separate file **"Correct Budget"** (`3f37fcfb`,
cloud `6734a873`, older "Splitwise Clearing" structure, no automation, frozen at
2026-06-07) was **deleted 2026-06-22** ({{PLANE_PROJECT_PREFIX}}-102) — it was the source of a
phantom "uncategorised" count in the UI. If you ever see >1 distinct groupId in
`getBudgets()` again, the importers/categoriser only target `bd7f86a1`; do not
work on any other file. To delete a budget *file* there is no `@actual-app/api`
method — log in to the server (`POST /account/login` → token) and
`POST /sync/delete-user-file {fileId}`; back up `actual-actual-1:/data` first.

## ⚠️ Gotchas that WILL corrupt data or mislead you

**1. The local cache lies. Always `await api.sync()` after `downloadBudget`,
and again after every write before you verify.** Reads taken without a fresh
`sync()` return stale/partial state — you will see different counts on
consecutive runs and chase ghosts. When in doubt, `rm -rf data/actual-cache`
and re-download. Multiple verification reads in this environment disagreed
until `sync()` was called explicitly.

**2. `splits:'none'` makes split-PARENT transactions look uncategorised.**
A split parent has `category: null` by design; its children carry the
categories. `runQuery(...).options({splits:'none'})` returns the parents, so
filtering `!category` counts them as "uncategorised" — they are NOT.
  - For accurate per-category spend, use `.options({splits:'inline'})` (child
    rows replace parents; parents excluded).
  - To find *genuinely* uncategorised txns, trust the categoriser's
    `getUncategorizedTransactions` (default splits handling) — it correctly
    excludes parents. As of 2026-06-21 there are **0** genuinely uncategorised
    transactions; the ~29 "uncategorised" an agent may see with `splits:'none'`
    are all split parents (e.g. Amazon orders split between a personal category
    and a `Splitwise` share). Check `is_parent`/`is_child` before "fixing" them.

**3. Creating transfers via the API — the rules differ by case:**
  - **Single-sided into an (effectively empty) account** (e.g. an expense txn
    you want to redirect into a new Savings account): `updateTransaction(id,
    {payee: <destAccountTransferPayee>, category: null})` works — Actual
    auto-creates the opposite leg. **Do them ONE AT A TIME with `await
    api.sync()` between each.** A tight batch loop leaves *orphaned transfers*
    (payee set, but `transfer_id` null, no opposite leg). Recover an orphan by
    toggling: `updateTransaction(id,{payee:null})` → sync → `updateTransaction
    (id,{payee:transferPayee})` → sync.
  - **Linking two ALREADY-IMPORTED legs** (e.g. a credit-card payment that
    truelayer imported on both the current account and the card): setting the
    transfer payee does NOT match the existing leg — it **DUPLICATES** it
    (verified 2026-06-21). Two options:
    - **Actual UI** (simplest): open the txn, Payee → "Transfer to/from:
      <account>"; Actual matches the existing counterpart, no duplicate.
    - **Safe API method** (used 2026-06-21 to link 17 pairs): for each pair,
      `updateTransaction(outLegId, {payee: inAcctTransferPayee, category:null})`
      → sync (creates a *synthetic* linked in-leg) → `deleteTransaction
      (originalInLegId)` → sync. Deleting the original is safe because at that
      point it is a plain txn (no transfer partner → no cascade, see #4).
      **Guards that made this safe:** (a) one-at-a-time with sync+verify after
      each; (b) only auto-match amounts that are *unambiguous within the
      category* — exactly one `+Y` and one `−Y` of that value (round-number
      collisions like £150×4 must be skipped, a backup can't catch a semantic
      mislink); (c) only pairs older than truelayer's 7-day lookback (so the
      deleted original is never re-imported); (d) **file-backup first**:
      `docker cp actual-actual-1:/data ~/backups/...`; verify balances UNCHANGED
      + 0 orphans + txn-count unchanged at the end, else restore the backup.

**4. Deleting one leg of a transfer cascade-deletes its partner.** If you must
delete a transfer leg, expect the linked transaction to vanish too.

**4a. Editing SPLIT transactions via the API — two traps (verified 2026-06-22, {{PLANE_PROJECT_PREFIX}}-103):**
  - **`updateTransaction(childId, {category})` on a split CHILD ZEROES the
    child's amount** — it does NOT preserve it. The split then becomes
    unbalanced (children no longer sum to the parent; the parent amount and the
    account balance are unaffected, so no money is lost, but the split is
    internally wrong). To recategorise a child, **always pass the amount too**:
    `updateTransaction(childId, {amount: <unchanged>, category: <new>})`. Verify
    afterwards that `sum(children) === parent.amount`.
  - **`updateTransaction(regularTxnId, {subtransactions:[...]})` silently does
    NOTHING** — it does not convert a non-split transaction into a split. (Use
    the Actual UI to split a plain txn, or — for Splitwise-shared expenses —
    don't split at all; see below.)
  - **Before "fixing" any txn, check `is_child`/`is_parent`.** A line that looks
    like a standalone `−£150 Gifts` may be a child of a larger split (e.g. the
    Gifts portion of a £631 group dinner). Query with `splits:'all'` and
    `{$or:[{id},{parent_id:id}]}` to see the whole split first.

**4-Splitwise. Do NOT manually split a Splitwise-shared expense.** Per the
offset model below, the full bank charge stays in the real category and
`splitwise2actual` adds a `+your-receivable` offset to the `Splitwise` account
(same category) on its next run (06:05 daily). Manually splitting the bank charge
into a `Splitwise` child *as well* double-counts the partner's share. If the user
"added it to Splitwise," leave the Actual txn alone — the importer reconciles it.

**4b. On-budget → off-budget transfers show as "uncategorised" in the UI.**
A transfer from an on-budget account to an *off-budget* one (e.g. Natwest →
Savings) is flagged uncategorised by Actual (unlike on↔on transfers, which
aren't). To clear the flag AND budget for the saving, give the on-budget leg a
budget category (e.g. `Savings`/`Investments`) — it stays a transfer but now
shows in the budget. Split parents (category null, `is_parent`) are NOT flagged.
(Verified 2026-06-21: 30 such legs were flagged; categorising them cleared it.)

**4c. Credit-card balances are NEGATIVE when you owe. Reconcile uses the same
sign convention.** A card you owe £1,720.31 on must read **−£1,720.31** in the
sidebar. Actual's Reconcile dialog asks for "the current balance" *in Actual's
sign convention* — it does NOT know a card statement quotes the owed amount as a
positive number. **Entering the owed amount as a positive number is wrong** — it
makes Actual think you hold credit and injects a huge positive "Reconciliation
balance adjustment" (verified 2026-06-22: a +£6,313.04 phantom deposit flipped
Amex to +£6,451). To reconcile a card to reality, either enter the owed figure
as a *negative* number in the UI, or set it via API: get the real owed amount
(positive) from the user, then `addTransactions(cardId, [{date, amount: -(owed) -
currentBalance, payee_name:'Reconciliation balance adjustment', category:
<Starting Balances>, cleared:true}])` so the balance lands on `-(owed)`. Delete
any earlier bogus adjustment first. ({{PLANE_PROJECT_PREFIX}}-100.)

**5. Find the transfer payee** for an account via `getPayees()` →
`p.transfer_acct === <accountId>`. A freshly `createAccount`'d account gets one
automatically.

**6. Recreating a lost transaction:** `addTransactions(accountId, [{date,
amount, payee_name, category, cleared, imported_id, notes}])`. truelayer2actual
only re-fetches `SYNC_DAYS_LOOKBACK` days (default **7**), so transactions older
than ~7 days will never be re-imported — safe to recreate manually without a
duplicate. Newer ones may re-import; reuse the original `imported_id` to dedup.

**7. Recording a pre-existing off-budget account balance (opening balance).**
If an off-budget account (Savings, Investments) already had money in it before
tracking started, Actual's reconcile dialog injects a "Reconciliation balance
adjustment" transaction dated today. To turn this into a proper opening balance:
`updateTransaction(id, { date: '20XX-01-01', notes: 'Opening Balance' })` —
backdate it to before the account's first real transaction so it reads as
the starting value rather than a new inflow. Verify the account balance is
unchanged after the update. (Verified 2026-06-22.)

**8. Bills paid from an unlinked/closed account — pattern and fix.**
If bills were paid from a bank account not linked to Actual, only the
counterpart (e.g. a flatmate's Splitwise repayment) appears in the budget,
making Bills show as a net *credit* rather than spend. Fix: add the actual
outgoing payments as manual transactions to any on-budget account using
`addTransactions`, with `notes: 'Manual - paid from <closed account>'` and
`cleared: true`. Use dates matching the original payment cycle. TrueLayer only
re-imports the last 7 days, so backdated manual transactions for older months
will not be duplicated on the next sync. (Verified 2026-06-22.)

## Budget structure (as of 2026-06-22)

**Accounts** — on-budget: `Amex BA`, `Barclaycard` (credit cards), `Barclays
Current Account`, `Natwest`, `Revolut GBP`, `Revolut EUR`. Special:
  - `Splitwise` (on-budget) — balance = **net amount others owe you**; fed by
    `splitwise2actual`, not a real bank.
  - `Savings`, `Investments`, `Greek Gov Hold` (**off-budget**) — savings,
    investing, and pseudo-savings / receivable transfers. Contributions into
    these are transfers, NOT expenses.

**Category groups:** Usual Expenses (Household, Subscriptions, Credit Card
payment, General, Bills, Bills (Flexible), **Rent**), Investments and Savings,
Food (Drinks, Delivery, Eating Out, Groceries), Transport, Health, Personal
(…, **Shopping**), Social, Misc (…, Splitwise, Transfer, **Reimbursements**),
Income. Added 2026-06-21: `Rent` (was buried in Bills), `Shopping` (Amazon was
in Delivery), `Reimbursements` (neutral home for person-to-person friend
payments via Revolut — routed there by name rules in `/actual-categoriser`).

**Off-budget accounts** (2026-06-22): `Savings` (~£2328), `Investments`
(tracked contribution account / reconciled market value may differ), `Greek Gov Hold`
(£374.65 across Apr/May/Jun 2026), `Santander Edge` (£0, closed) — external-savings /
receivable transfers land here, not as expenses.

**Greek Gov Hold** models the recurring `Bebaivmenes Ofeiles GR` charge. This is
a temporary government hold expected to be returned later, so it is treated as a
**pseudo-savings / receivable account**, not real spending. Known transfers into
it as of 2026-06-22:
- 2026-04-17 £125.48
- 2026-05-29 £125.45
- 2026-06-18 £123.72

If you see a future `Bebaivmenes Ofeiles GR` card charge land in `Bills` or
`General`, convert it into a transfer to `Greek Gov Hold` instead of counting it
as spend.

**Budget:** real envelope budget set 2026-06 onward — £2938/mo spending across
28 categories, balanced to £3950 income (remainder funds the off-budget
save/invest transfers). Replicated through Dec 2026; extend via UI "copy last
month".

(Before 2026-06-21 it was a pure tracker with `budgeted: 0` everywhere; the
envelope budget above replaced that.)

## The Splitwise model (offset model)

`splitwise2actual` writes one transaction per Splitwise expense into the
`Splitwise` account, payee `Splitwise: <desc>`, amount = your net share
(`paid_share − owed_share`), and embeds the original Splitwise category in the
notes (`Category: <name>`). The categoriser maps that to a real Actual category
(see `/actual-categoriser`). Net effect:

- **You pay £100, split 50/50:** bank −£100 (Groceries) + Splitwise +£50
  (Groceries) = net −£50 in Groceries ✓. Splitwise balance +£50 (owed to you).
- **They pay, you owe £50:** only Splitwise −£50 (Groceries) = your £50 share ✓.
- **Settle-ups** are money moving, NOT spending. **Auto-transfer-linking them
  was investigated ({{PLANE_PROJECT_PREFIX}}-98) and is NOT feasible:** the 4 Splitwise-account
  settle-ups (`imported_id` `:payment:`) only sometimes have a bank counterpart,
  and when they do the signs/aggregation are inconsistent (May's £280 matched
  `From Julia K` exactly; Feb's didn't match at all). Reliable automatic linking
  would invent false transfers. **Resolution adopted:** person-to-person Revolut
  payments (`To/From <name>`) go to the neutral **Reimbursements** category (via
  name rules in `/actual-categoriser`); the `Splitwise: Payment` entries stay in
  the `Splitwise` account/category (neutral, not spending). Don't build an
  auto-linker without re-checking the data first.

**Rule of thumb:** Splitwise *expenses* → real spending category (auto-offset);
settle-ups stay neutral (Reimbursements / Splitwise category), not spending.

## Audit trail

This budget work is tracked under Plane **{{PLANE_PROJECT_PREFIX}}-94**. The double-counting
cleanup (Credit Card payment ×25, Transfer ×36 with 21 person-to-person singles)
is partially open: the 19 real pairs need UI transfer-linking (see gotcha #3),
the 21 settle-up singles need recategorisation.
