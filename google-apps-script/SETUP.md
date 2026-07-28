# Hiring PRIO write connection

1. Open the source spreadsheet.
2. Choose **Extensions → Apps Script**.
3. Replace the editor contents with `HiringPrioApi.gs`.
4. Open **Project Settings → Script Properties** and add:
   - Property: `ACOPS_API_TOKEN`
   - Value: a long random value that you choose
5. Choose **Deploy → New deployment → Web app**.
6. Set **Execute as** to **Me**.
7. Set access to **Anyone** who can use this dashboard, then deploy.
8. Copy the `/exec` Web App URL into `config.js` as `mppWriteApiUrl`.
9. Put the same token into `config.js` as `mppApiToken`.

Every saved edit finds the matching branch and updates:

- MT Coach: needs C, gap D, priority E
- MT Mitra: needs J, gap K, priority L

Columns F–G and M–N are never modified.
