const SPREADSHEET_ID = '1gL3HApJk0MjSMtqsMHZjjTyRwnAulcteHIEEpHHJB00';
const SHEET_NAME = 'Hiring PRIO';
const HIRING_SHEET_NAME = 'Hiring EA';

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents || '{}');
    verifyToken_(payload.token);
    if (String(payload.module || '').toLowerCase() === 'hiring') {
      return handleHiringPost_(payload);
    }

    const branch = String(payload.branch || '').trim();
    const view = String(payload.view || '').toLowerCase();
    const field = String(payload.field || 'needs').toLowerCase();
    const needs = Math.max(0, Math.round(Number(payload.needs)));
    const priority = String(payload.priority || '').toUpperCase();

    if (!branch || !['coach', 'mitra'].includes(view)) {
      throw new Error('branch and view are required');
    }
    if (field === 'priority' && !['P0', 'P1', 'FILLED', 'NO NEED'].includes(priority)) {
      throw new Error('Priority must be P0, P1, Filled, or No Need');
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
        sheet.getRange(row, columns.priority).setValue(priority === 'NO NEED' ? 'No Need' : priority === 'FILLED' ? 'Filled' : priority);
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

function handleHiringPost_(payload) {
  const action = String(payload.action || '').toLowerCase();
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(HIRING_SHEET_NAME);
    if (!sheet) throw new Error('Hiring EA sheet was not found');

    if (action === 'add') {
      const candidate = normalizeHiringCandidate_(payload.candidate || {});
      if (!candidate.name || !candidate.center || !candidate.phone) {
        throw new Error('Candidate, branch, and phone number are required');
      }
      const row = findNextHiringRow_(sheet);
      sheet.getRange(row, 1, 1, 5).setValues([[
        candidate.address,
        candidate.center,
        candidate.name,
        candidate.email,
        candidate.phone
      ]]);
      sheet.getRange(row, 8, 1, 4).setValues([[
        candidate.role || 'MT Mitra',
        candidate.step || 'Approached',
        candidate.onsiteDate ? new Date(candidate.onsiteDate) : '',
        candidate.notes
      ]]);
      SpreadsheetApp.flush();
      return json_({ ok: true, action, row });
    }

    if (action === 'delete') {
      const original = normalizeHiringCandidate_(payload.original || payload.candidate || {});
      const row = findHiringRow_(sheet, original);
      if (!row) throw new Error('Candidate was not found in Hiring EA');
      sheet.deleteRow(row);
      SpreadsheetApp.flush();
      return json_({ ok: true, action, row });
    }

    if (action !== 'update') throw new Error('Unsupported Hiring EA action');
    const original = normalizeHiringCandidate_(payload.original || {});
    const field = String(payload.field || '').trim();
    const value = payload.value === null || payload.value === undefined ? '' : String(payload.value).trim();
    const columns = {
      address: 1,
      center: 2,
      name: 3,
      email: 4,
      phone: 5,
      role: 8,
      step: 9,
      onsiteDate: 10,
      notes: 11
    };
    if (!columns[field]) throw new Error('Unsupported Hiring EA field');
    const row = findHiringRow_(sheet, original);
    if (!row) throw new Error('Candidate was not found in Hiring EA');
    sheet.getRange(row, columns[field]).setValue(field === 'onsiteDate' && value ? new Date(value) : value);
    if (field === 'center' && payload.address) {
      sheet.getRange(row, columns.address).setValue(String(payload.address).trim());
    }
    SpreadsheetApp.flush();
    return json_({ ok: true, action, row, field });
  } finally {
    lock.releaseLock();
  }
}

function normalizeHiringCandidate_(candidate) {
  return {
    address: String(candidate.address || '').trim(),
    center: String(candidate.center || '').trim(),
    name: String(candidate.name || '').trim(),
    email: String(candidate.email || '').trim(),
    phone: normalizePhone_(candidate.phone),
    role: String(candidate.role || '').trim(),
    step: String(candidate.step || '').trim(),
    onsiteDate: String(candidate.onsiteDate || '').trim(),
    notes: String(candidate.notes || '').trim()
  };
}

function findHiringRow_(sheet, candidate) {
  const maxRows = sheet.getMaxRows();
  if (maxRows < 2) return 0;
  const targetName = normalize_(candidate.name);
  const targetEmail = normalize_(candidate.email);
  const targetPhone = normalizePhone_(candidate.phone);
  const targetCenter = normalize_(candidate.center);
  const values = sheet.getRange(2, 2, maxRows - 1, 4).getDisplayValues();
  const index = values.findIndex(row => {
    const center = normalize_(row[0]);
    const name = normalize_(row[1]);
    const email = normalize_(row[2]);
    const phone = normalizePhone_(row[3]);
    if (!name || name !== targetName) return false;
    if (targetCenter && center && center !== targetCenter) return false;
    if (targetEmail && email && email !== targetEmail) return false;
    if (targetPhone && phone && phone !== targetPhone) return false;
    return true;
  });
  return index < 0 ? 0 : index + 2;
}

function findNextHiringRow_(sheet) {
  const firstDataRow = 2;
  const maxRows = sheet.getMaxRows();
  const names = sheet.getRange(firstDataRow, 3, maxRows - firstDataRow + 1, 1).getDisplayValues();
  const index = names.findIndex(row => !String(row[0] || '').trim());
  if (index >= 0) return firstDataRow + index;
  sheet.insertRowAfter(maxRows);
  return maxRows + 1;
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

function normalizePhone_(value) {
  return String(value || '').replace(/\D/g, '');
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
