---
name: finance-review
description: >-
  Run a READ-ONLY deep-dive analysis of the "My Finances" Actual Budget —
  income, spending by category, true (net-of-churn) savings rate, subscription
  & recurring-payment audit, Splitwise position, budget-vs-actual, anomalies,
  net worth, and prioritised recommendations. Use when the user asks to
  "analyse my finances", "how am I doing financially", a monthly/quarterly
  money review, or any holistic look at the budget (not a single lookup).
host-only: true
allowed-tools:
  - Bash
  - Read
  - Edit
  - Write
---

# finance-review

A repeatable, **read-only** financial deep-dive over the Actual Budget
("My Finances"). It ships an analysis script that does all the number-crunching
correctly (handling the data quirks that mislead a naive read), and this doc
tells you how to run it and how to turn its output into a report.

> For the data model, the Splitwise offset model, and the write/transfer
> gotchas, read **`/actual-budget`** first. For the nightly categoriser, see
> **`/actual-categoriser`**. This skill is the *analysis* layer on top.

## How to run

The script needs `@actual-app/api` + credentials, which live in
`~/actual-categoriser`. Node resolves modules from the script's own directory,
and the script reads/writes its cache under `process.cwd()/data/actual-cache`,
so **copy it into `~/actual-categoriser` and run it from there**, then delete it
(keep the source of truth in this skill):

```bash
cp ~/.claude/skills/finance-review/scripts/finance-review.mjs ~/actual-categoriser/_fr.mjs
cd ~/actual-categoriser && node --env-file=secrets.env _fr.mjs 2>/dev/null \
  | grep -vE "Breadcrumb|spreadsheet|Syncing|Got messages|Closing|message:|^}"
rm -f ~/actual-categoriser/_fr.mjs
```

Optional first arg = start month (default: first month that has income), e.g.
`node --env-file=secrets.env _fr.mjs 2026-03`.

It is strictly read-only — it only calls `getAccounts/getCategoryGroups/
runQuery/getBudgetMonth/getAccountBalance`. It never writes. Safe to run anytime.

## What it outputs (and how to read each block)

| Block | What it means |
|---|---|
| **Header rows** (income / spending / essential / discretionary / net saved / free cashflow) | Per-month spine. Spending excludes transfers, income, and neutral cats. |
| **Spend by category** | `*` prefix = classified essential. Sorted by period total. |
| **Discretionary food vs groceries** | Eating Out + Drinks + Delivery vs Groceries — the #1 actionable lever. |
| **Off-budget account flows** | Gross in/out per savings/investment pot. **Big "out" legs = churn** (money parked then pulled back) — this is why gross saving overstates real saving. |
| **True subscriptions** | Only the `Subscriptions` category, recurring ≥3 months, annualised. |
| **Other recurring merchants/habits** | Non-subscription recurring spend (cafés, pubs, gym extras) — habit spend worth flagging. |
| **Budget vs actual** | Budgeted pulled from `getBudgetMonth` (spending only); actual = the clean spend calc (NOT the API's `spent`). |
| **Splitwise** | Net owed to you, gross you fronted, settle-up cadence. |
| **Anomalies** | Top 15 outflows. |
| **Data quality** | On-budget, non-transfer legs matching savings/investment keywords that aren't in Savings/Investments. Off-budget transfer legs are excluded (they harmlessly carry `General` on their side — not a real problem). |
| **Net worth** | All account balances + tracked total. |
| **Averages** | Over "clean" months (drops the ramp-up first month and the partial last month). |

## Drilling into a category's transactions

To list all transactions in a specific category, use `read txns --category`:

```bash
cd ~/actual-categoriser
node --env-file=secrets.env dist/cli/index.js read txns --category "Eating Out" --since 2026-05-01 --json 2>/dev/null \
  | jq '.result[] | "\(.date)  £\(.amount / -100)  \(.payee)"'
```

The `payee` field is the fully resolved display name (joins the payees table automatically). The `--category` flag accepts the exact Actual category name (case-insensitive). Both bugs were fixed 2026-06-22 — before that, `--category` was silently ignored and payees were raw bank strings only.

## Faster per-month view

If the user wants a durable monthly snapshot rather than a full review, prefer
the `finance` CLI's **`read monthly-view`** command:

```bash
cd ~/actual-categoriser
node --env-file=secrets.env dist/cli/index.js read monthly-view --month 2026-05 --write-md --json
```

This writes one generated Markdown file per month under
`~/actual-categoriser/reports/monthly/` and emits machine-readable JSON for
future agents. Use it for "show me April/May", category drill-downs, or when
you need a stable artifact instead of recomputing prose from scratch.

## Off-budget context you MUST load first (else the verdict is wrong)

The budget only sees current accounts + a couple of savings pots. Big parts of
this person's finances live **outside** it. **Before running the script or
forming any verdict, read the full memory file:**

```bash
cat {{USER_HOME}}/.claude/projects/-home-lemon/memory/project_finances_personal_context.md
```

This file contains the full picture: pension, emergency fund, all savings pots
with current balances and rates, complete subscription list with splits,
account purposes, poker activity, bonus timing, saving SO amounts, and the
spending notes that correct for one-off spikes. The inline facts below are a
summary only — the file may have been updated since the skill was last edited,
so always prefer the file over the inline summary.

Key facts as of 2026-06 (read the file for the authoritative version):

- **Pension: 20% of gross salary-sacrificed + 15% employer match.** Take-home
  (~£3,950/mo) is *already net* of the sacrifice. So ~35% of gross goes to
  retirement and **never appears in the budget**. The budget-derived savings
  rate is therefore a *floor*, not the real rate — add pension on top and say so.
- **Emergency fund ~£7,100 in Moneybox Cash ISA (4.39% AER), held outside
  tracked accounts.** Sized for basic expenses (~£1,650/mo), not full lifestyle
  spend. **Never conclude "thin buffer / no runway"** from on-budget
  current-account cash.
- **Greek Gov Hold (~£374.65 as of 2026-06-22) is a pseudo-savings / receivable
  pot, not real spending.** The recurring `Bebaivmenes Ofeiles GR` charge is a
  temporary hold expected to be returned later; monthly spend views should
  exclude it from spending and treat it like a fake savings account.

If the user states updated figures, prefer those and update the memory note.

## Interpretation rules — DO NOT skip these (they prevent wrong conclusions)

1. **Gross saving ≠ real saving.** Savings/investment money churns between pots
   (Trading 212, Moneybox ISA, Zopa, Santander Edge, FD saver) with frequent
   "SEND BACK" / sell-back transfers. The "net saved" row and the savings-rate
   average are **gross of churn**. Always cross-check the off-budget *out* legs:
   if a pot shows large `out`, real saving that month is much lower. The honest
   savings number is the **net change** in off-budget balances, and the most
   representative months (exclude the first, which is usually pot-seeding from
   pre-existing cash).

2. **Free cashflow is the truth-teller.** `income − spend − netSaved`. If it's
   persistently negative while the savings rate looks high, the saving is being
   funded by drawdown / a bonus / churn, **not** a structural surplus. Say so.

3. **The first and last months lie.** Data starts when balances were reconciled,
   so the first month's *spend* is understated (ramp-up) while its *income* may
   include a bonus. The last month is partial (salary + rent usually land
   ~22nd–28th). The script drops both from averages — keep that framing in prose.

4. **`General` is contaminated with savings transfers — but the data-quality
   flag only fires for on-budget legs now.** Many save/invest standing orders
   (TRADING 212, MONEYBOX, ZOPA, FD LOUKAS, ZSAUSAVE, SANTANDER EDGE) get
   mis-filed as `General` instead of `Savings`/`Investments`. The script
   computes real saving from off-budget *account flows* (not categories), so it's
   robust. The data-quality section flags on-budget, non-transfer legs only —
   off-budget transfer legs incidentally carry `General` on their off-budget side,
   which is harmless and was a false positive before 2026-06-22. If the
   data-quality section is empty, the on-budget categorisation is clean; ignore
   any `General` you see on the Savings/Investments account side.

5. **Splitwise = offset model.** Net Splitwise balance is money owed *to* you, an
   illiquid soft asset — don't count it as spendable cash. Shared bills appear
   only as your *share*; full household bills are larger than the `Bills`
   category shows. Settle-ups are neutral, not spending.

6. **Digital subs hide in Splitwise.** Netflix / YouTube Premium / family
   storage are split with others, so they land in the Splitwise list, not the
   Subscriptions category. Add them when totalling subscription cost.

8. **Zopa sinking-fund bypass inflates discretionary spend in some months.**
   The user maintains Zopa holiday + gift pots (fed by £200/mo + £50/mo standing
   orders) specifically to fund Holidays and Gifts spending. When they spend on a
   holiday or gift directly from their current account *without* first withdrawing
   from Zopa, that month's spend looks inflated AND the Zopa pot over-accumulates.
   **How to detect:** for each month, compare (Holidays + Gifts category spend)
   against (Zopa outflows from the off-budget Savings account that month). If
   Holidays + Gifts spend is material (>£50) but Zopa outflows are zero or much
   lower, flag it: "You spent £X on holidays/gifts this month but drew £Y from
   your Zopa sinking fund — the £(X−Y) difference came from regular cashflow.
   Consider withdrawing from Zopa retroactively or treating the Zopa pot as
   already earmarked for a future trip."  
   This is a data-quality flag, not a problem — it just means the monthly spend
   figure overstates what came from the user's discretionary budget vs pre-saved
   funds. Note: Zopa outflows appear as negative amounts in the `Savings`
   off-budget account flows.

7. **Group dinners / reimbursed events inflate Eating Out & Entertainment.**
   The user frequently fronts birthday/group dinners and is paid back, but these
   were often NOT set up as Splitwise/Reimbursements. So large single
   restaurant/event txns may be ~£0 net, not personal spend. Known example:
   **Lion & Unicorn £231.75 (2026-05-31, Entertainment)** — paid for everyone,
   reimbursed. Some "dinners" are really **gifts** the user covered → belong in
   `Gifts`. When analysing discretionary food/entertainment, discount large
   single-txn restaurant/event payments as probable reimbursed-group spend and
   flag them for proper Splitwise/Reimbursements/Gifts setup rather than counting
   them as personal discretionary spend.

10. **Bills showing as net credits = payments came from an unlinked account.**
    If a Bills (or any category) month shows negative net spend, check whether
    only the *repayment* (e.g. a flatmate's Splitwise offset) landed in-budget
    while the actual outgoing payment went through a bank account not linked to
    Actual. The fix is to add the outgoing manually — see `/actual-budget` gotcha
    #8. Once fixed, net Bills = gross payment − Splitwise offset = your real share.

9. **Medication/Supplements had a one-off spike in May 2026.** The £53.69 in
   May 2026 is NOT a true recurring monthly baseline — it was:
   Camden Pharmacy £29.70 + Amazon £15.00 + Amazon £8.99. When reasoning about
   ongoing fixed costs, use roughly **£10/mo** unless later months prove
   otherwise.

## Turning output into the report

Deliver a written report with: (1) income, (2) spending + essential/discretionary
split, (3) **net** savings rate + net-worth snapshot, (4) subscription audit
flagging overlaps/forgotten ones, (5) fixed commitments vs income, (6)
discretionary food vs groceries, (7) Splitwise net & cadence, (8) anomalies, (9)
budget vs actual, (10) honest cashflow verdict. Then:

- **Top 5 prioritised recommendations, each with an estimated £/mo or £/yr
  impact** — lead with the food-out lever and subscription consolidation
  (usually the easiest wins), then data-hygiene (set up Splitwise/Reimbursements
  for fronted group dinners so the numbers reflect reality). Do **not** recommend
  building an emergency fund — one already exists off-budget. Frame the verdict
  around the *full* picture (pension + emergency fund + investing), not just
  on-budget cash.
- **Data-quality issues** (the `General` leak, mis-filed holiday refunds, etc.).
- **One-paragraph plain-English verdict** on overall financial health — be
  honest about gross-vs-net saving and the cash buffer, not just the headline
  savings rate.

Look for, and call out explicitly:
- Subscription overlaps (e.g. multiple cloud-storage tiers; multiple AI tools).
- Discretionary food exceeding groceries.
- Thin liquid cash buffer vs card debt (runway risk).
- Categories consistently over budget.
- **Zopa sinking-fund bypass (see rule 8 below).**

## Audit trail

This is read-only personal analysis — no Plane ticket required (it changes
nothing on the server or in the budget). If a run *recommends* a fix you then
apply (e.g. new categoriser rules), track *that* change under `/actual-budget`'s
{{PLANE_PROJECT_PREFIX}}-94 per its own rules.
