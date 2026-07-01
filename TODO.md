# TODO

## 1. Credit Payments (credit card statements)

Create a `credit_payments` table to hold uploaded credit card statements, related to the main credit card.

- [ ] New `credit_payments` table storing uploaded credit card statements as an **attachment**.
- [ ] Dedicated menu item under **Transactions** called **"Credit Payments"**.
- [ ] All created spendings get a dedicated field to store this record (link spending → credit payment record).
- [ ] Record naming format: **"YYYY.MM - Card Name"**.
- [ ] Store the following fields on each record:
  - [ ] Cutover date
  - [ ] Payment date
  - [ ] Total payment amount
  - [ ] Minimum payment amount
- [ ] Associate the record with the corresponding **Credit Card** entry in the `accounts` table.
- [ ] Surface the record on the **calendar widget**.

## 2. Mass delete on all tables

- [ ] Every table should have row **checkboxes** and a **Delete** button to mass-delete selected records.

## 3. Fix GUI

- [x] Fix calendar .date-input-icon color to var(--muted); (also keep it muted on :focus-within instead of turning accent)
- [x] Change color of .cp-empty svg from var(--orange); to var(--red);
- [x] Make "Credit Payments" screen same with "Spending" screen — tightened .cp-body padding to 7px horizontal, loaded menu.js so the sidebar toggle works + persists
- [x] Centralize menu/sidebar — sidebar was already single-source (nav.jsx markup + app.css styling + menu.js behavior). Real fix: removed the stale duplicated mobile-sidebar CSS blocks from accounts.css / budgets.css / dashboard.css so every page renders the bottom tab bar from app.css alone (dropped divergent z-index:200 → canonical 101). Menu items are added/edited in one place: the NAV arrays in nav.jsx.