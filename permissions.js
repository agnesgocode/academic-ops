// permissions.js
// Pusat aturan hak akses untuk Academic Ops.
// Semua yang bisa dibuka/ditutup didefinisikan di sini sebagai "capability".
// Aturan default per-role ada di ROLE_DEFAULTS. Admin bisa mengubahnya dari
// halaman Access Control; perubahan per-orang disimpan sebagai "override".
//
// CATATAN KEAMANAN: file ini HANYA untuk tampilan (menyembunyikan menu/tab di
// browser). Pengecekan sebenarnya untuk data rahasia harus dilakukan di server
// (Edge Function). Untuk situs ini, aturan menyembunyikan menu sudah cukup
// selama sumber data belum dipindah ke belakang server.

(function () {
  'use strict';

  // ---- Daftar role yang ada ----
  var ROLES = ['BM', 'MTC', 'SA', 'Regional', 'Internship', 'FEC'];
  var BUILTIN_ROLES = ROLES.slice();

  // Daftar role bisa bertambah (role buatan admin). Array ROLES diubah di tempat
  // supaya semua file yang memegang referensinya ikut terbarui.
  function setRoles(extra) {
    var next = BUILTIN_ROLES.slice();
    (extra || []).forEach(function (r) { if (next.indexOf(r) === -1) next.push(r); });
    ROLES.length = 0;
    next.forEach(function (r) { ROLES.push(r); });
  }

  // ---- Daftar semua "capability" (hal yang bisa diberi/dicabut aksesnya) ----
  // key: id internal (dipakai di kode)  |  label: nama untuk halaman admin
  // kind: 'page'  -> menyembunyikan menu & halaman (data-view)
  //       'tab'   -> menyembunyikan satu tab di dalam halaman
  //       'filter'-> membatasi isi di dalam sebuah tab
  var CAPABILITIES = [
    // --- Menu utama (page-level) ---
    { key: 'page.dashboard',          label: 'Regional Dashboard (home)', kind: 'page', view: 'dashboard' },
    { key: 'page.academic-dashboard', label: 'Dashboard Academic',        kind: 'page', view: 'academic-dashboard' },
    { key: 'page.academic',           label: 'Academic Performance (menu)', kind: 'page', view: 'academic' },
    { key: 'page.operations',         label: 'Operations (menu)',         kind: 'page', view: 'operations' },
    { key: 'page.mtc-productivity',   label: 'MTC Productivity',          kind: 'page', view: 'mtc-productivity' },
    { key: 'page.admin-profile',      label: 'Admin Profile',             kind: 'page', view: 'admin-profile' },
    { key: 'page.sessions',           label: 'Sessions',                  kind: 'page', view: 'sessions' },
    { key: 'page.fulfillment',        label: 'Fulfillment Rate',          kind: 'page', view: 'fulfillment' },
    { key: 'page.events',             label: 'Events',                    kind: 'page', view: 'events' },
    { key: 'page.gmb',                label: 'GMB',                       kind: 'page', view: 'gmb' },
    { key: 'page.sosmed-monitor',     label: 'Sosmed Monitor',            kind: 'page', view: 'sosmed-monitor' },
    { key: 'page.revenue',            label: 'Revenue',                   kind: 'page', view: 'revenue' },

    // --- Tab di dalam "Academic Performance" ---
    { key: 'tab.academic.sqt',         label: 'SQT (tab)',             kind: 'tab', page: 'academic',  tab: 'sqt' },
    { key: 'tab.academic.observation', label: 'Observation (tab)',     kind: 'tab', page: 'academic',  tab: 'observation' },
    { key: 'tab.academic.smartapp',    label: 'SmartApp Usage (tab)',  kind: 'tab', page: 'academic',  tab: 'smartapp' },

    // --- Tab di dalam "Operations" ---
    { key: 'tab.operations.mpp',       label: 'MPP Needs (tab)',       kind: 'tab', page: 'operations', tab: 'mpp' },
    { key: 'tab.operations.hiring',    label: 'Hiring (tab)',          kind: 'tab', page: 'operations', tab: 'hiring' },
    { key: 'tab.operations.teachers',  label: 'Teacher Database (tab)', kind: 'tab', page: 'operations', tab: 'teachers' },

    // --- Filter isi (within-page) ---
    // Observation: bila TRUE, hanya skor MT Mitra yang ditampilkan (MT Coach disembunyikan)
    { key: 'filter.observation.mitraOnly', label: 'Observation — hanya skor MT Mitra', kind: 'filter' }
  ];

  // Kunci capability yang valid (untuk membersihkan data lama)
  var CAP_KEYS = CAPABILITIES.map(function (c) { return c.key; });

  // ---- Aturan default per role (dari matriks yang kamu berikan) ----
  // true = boleh,  false = tidak.
  // Catatan pemetaan:
  //  - "Observation full"      = tab.academic.observation TANPA filter mitraOnly
  //  - "Observation MT Mitra"  = tab.academic.observation DENGAN filter mitraOnly = true
  //  - "Hiring/MPP full"       = tab.operations.mpp + tab.operations.hiring
  //  - "Hiring proses saja"    = tab.operations.hiring saja (mpp = false)
  //  - "SmartApp"              = tab.academic.smartapp
  //  - "Teacher Database"      = tab.operations.teachers
  var ROLE_DEFAULTS = {
    BM: {
      'page.dashboard': true, 'page.academic-dashboard': true, 'page.academic': true,
      'page.operations': true, 'page.mtc-productivity': true, 'page.admin-profile': true,
      'page.sessions': true, 'page.fulfillment': true, 'page.events': true,
      'page.gmb': true, 'page.sosmed-monitor': false, 'page.revenue': true,
      'tab.academic.sqt': true, 'tab.academic.observation': true, 'tab.academic.smartapp': true,
      'tab.operations.mpp': true, 'tab.operations.hiring': true, 'tab.operations.teachers': true,
      'filter.observation.mitraOnly': false
    },
    MTC: {
      'page.dashboard': false, 'page.academic-dashboard': true, 'page.academic': true,
      'page.operations': true, 'page.mtc-productivity': true, 'page.admin-profile': true,
      'page.sessions': true, 'page.fulfillment': false, 'page.events': true,
      'page.gmb': false, 'page.sosmed-monitor': false, 'page.revenue': false,
      'tab.academic.sqt': true, 'tab.academic.observation': true, 'tab.academic.smartapp': false,
      'tab.operations.mpp': false, 'tab.operations.hiring': true, 'tab.operations.teachers': true,
      'filter.observation.mitraOnly': true
    },
    SA: {
      'page.dashboard': true, 'page.academic-dashboard': true, 'page.academic': true,
      'page.operations': true, 'page.mtc-productivity': false, 'page.admin-profile': true,
      'page.sessions': true, 'page.fulfillment': true, 'page.events': true,
      'page.gmb': true, 'page.sosmed-monitor': false, 'page.revenue': true,
      'tab.academic.sqt': true, 'tab.academic.observation': true, 'tab.academic.smartapp': true,
      'tab.operations.mpp': false, 'tab.operations.hiring': false, 'tab.operations.teachers': true,
      'filter.observation.mitraOnly': true
    },
    Regional: {
      'page.dashboard': true, 'page.academic-dashboard': true, 'page.academic': true,
      'page.operations': true, 'page.mtc-productivity': true, 'page.admin-profile': true,
      'page.sessions': true, 'page.fulfillment': true, 'page.events': true,
      'page.gmb': true, 'page.sosmed-monitor': true, 'page.revenue': true,
      'tab.academic.sqt': true, 'tab.academic.observation': true, 'tab.academic.smartapp': true,
      'tab.operations.mpp': true, 'tab.operations.hiring': true, 'tab.operations.teachers': true,
      'filter.observation.mitraOnly': false
    },
    Internship: {
      'page.dashboard': false, 'page.academic-dashboard': false, 'page.academic': false,
      'page.operations': false, 'page.mtc-productivity': false, 'page.admin-profile': false,
      'page.sessions': false, 'page.fulfillment': false, 'page.events': true,
      'page.gmb': true, 'page.sosmed-monitor': false, 'page.revenue': false,
      'tab.academic.sqt': false, 'tab.academic.observation': false, 'tab.academic.smartapp': false,
      'tab.operations.mpp': false, 'tab.operations.hiring': false, 'tab.operations.teachers': false,
      'filter.observation.mitraOnly': true
    },
    FEC: {
      'page.dashboard': true, 'page.academic-dashboard': false, 'page.academic': false,
      'page.operations': true, 'page.mtc-productivity': false, 'page.admin-profile': true,
      'page.sessions': true, 'page.fulfillment': true, 'page.events': true,
      'page.gmb': true, 'page.sosmed-monitor': false, 'page.revenue': true,
      'tab.academic.sqt': false, 'tab.academic.observation': false, 'tab.academic.smartapp': false,
      'tab.operations.mpp': false, 'tab.operations.hiring': false, 'tab.operations.teachers': true,
      'filter.observation.mitraOnly': false
    }
  };

  // Default untuk role yang tidak dikenal / belum diset: tidak boleh apa-apa.
  function emptyGrants() {
    var g = {};
    CAP_KEYS.forEach(function (k) { g[k] = false; });
    return g;
  }

  // Ambil aturan default sebuah role (salinan, supaya aman diubah)
  function defaultsFor(role) {
    var base = ROLE_DEFAULTS[role] || emptyGrants();
    var out = {};
    CAP_KEYS.forEach(function (k) { out[k] = base[k] === true; });
    return out;
  }

  // Hitung izin EFEKTIF untuk satu pengguna.
  // Admin selalu boleh semua. Selain itu: mulai dari default role,
  // lalu timpa dengan override per-orang (jika ada).
  // user.app_metadata = { role, center, perms_override?: { key:bool } }
  // roleDefaultsOverride: bila admin sudah mengubah default role dan menyimpannya
  //   di tempat global, kirim ke sini; kalau tidak, pakai ROLE_DEFAULTS bawaan.
  function effectiveFor(user, roleDefaultsOverride) {
    var meta = (user && user.app_metadata) || {};
    var role = meta.role;
    if (role === 'admin') {
      var all = {};
      CAP_KEYS.forEach(function (k) { all[k] = true; });
      all.__admin = true;
      return all;
    }
    var base;
    if (roleDefaultsOverride && roleDefaultsOverride[role]) {
      base = {};
      CAP_KEYS.forEach(function (k) { base[k] = roleDefaultsOverride[role][k] === true; });
    } else {
      base = defaultsFor(role);
    }
    var ov = meta.perms_override || {};
    CAP_KEYS.forEach(function (k) {
      if (Object.prototype.hasOwnProperty.call(ov, k)) base[k] = ov[k] === true;
    });
    return base;
  }

  window.ACOPS_PERMS = {
    ROLES: ROLES,
    BUILTIN_ROLES: BUILTIN_ROLES,
    setRoles: setRoles,
    CAPABILITIES: CAPABILITIES,
    CAP_KEYS: CAP_KEYS,
    ROLE_DEFAULTS: ROLE_DEFAULTS,
    defaultsFor: defaultsFor,
    effectiveFor: effectiveFor,
    emptyGrants: emptyGrants
  };
})();
