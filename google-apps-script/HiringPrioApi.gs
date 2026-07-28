const SPREADSHEET_ID = '1gL3HApJk0MjSMtqsMHZjjTyRwnAulcteHIEEpHHJB00';
const SHEET_NAME = 'Hiring PRIO';

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents || '{}');
    verifyToken_(payload.token);

    const branch = String(payload.branch || '').trim();
    const view = String(payload.view || '').toLowerCase();
    const field = String(payload.field || 'needs').toLowerCase();
    const needs = Math.max(0, Math.round(Number(payload.needs)));
    const priority = String(payload.priority || '').toUpperCase();

    if (!branch || !['coach', 'mitra'].includes(view)) {
      throw new Error('branch and view are required');
    }
    if (field === 'priority' && !['P0', 'P1', 'P2', 'NO NEED'].includes(priority)) {
      throw new Error('Priority must be P0, P1, P2, or No Need');
    }
    if (field === 'needs' && !Number.isFinite(needs)) {
      throw new Error('A valid needs value is required');
    }

    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
      if (!sheet) throw new Error('Hiring PRIO sheet was not found');

      const columns = view === 'coach'
        ? { branch: 1, existing: 2, needs: 3, gap: 4, priority: 5 }
        : { branch: 8, existing: 9, needs: 10, gap: 11, priority: 12 };
      const row = findBranchRow_(sheet, columns.branch, branch);
      if (!row) throw new Error('Branch was not found in Hiring PRIO');

      if (field === 'priority') {
        sheet.getRange(row, columns.priority).setValue(priority === 'NO NEED' ? 'No Need' : priority);
        SpreadsheetApp.flush();
        return json_({ ok: true, branch, view, priority });
      }

      const existing = Number(sheet.getRange(row, columns.existing).getValue()) || 0;
      const gap = needs - existing;
      sheet.getRange(row, columns.needs).setValue(needs);
      sheet.getRange(row, columns.gap).setFormulaR1C1('=RC[-1]-RC[-2]');
      SpreadsheetApp.flush();

      return json_({ ok: true, branch, view, existing, needs, gap });
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    return json_({ ok: false, error: error.message });
  }
}

function findBranchRow_(sheet, column, branch) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 3) return 0;
  const target = normalize_(branch);
  const values = sheet.getRange(3, column, lastRow - 2, 1).getDisplayValues();
  const index = values.findIndex(row => normalize_(row[0]) === target);
  return index < 0 ? 0 : index + 3;
}

function normalize_(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function verifyToken_(received) {
  const expected = PropertiesService.getScriptProperties().getProperty('ACOPS_API_TOKEN');
  if (!expected || received !== expected) throw new Error('Unauthorized');
}

function json_(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
