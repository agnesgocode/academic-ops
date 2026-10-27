// access-control.js
// Menyambungkan login (auth.js) ke aplikasi (app.js): setelah login, sembunyikan
// menu/tab yang tidak boleh diakses role pengguna, dan terapkan filter isi.
// File ini dimuat PALING AKHIR supaya bisa membungkus fungsi app.js yang sudah ada.
(function () {
  'use strict';

  var P = window.ACOPS_PERMS || {};
  var CAPS = P.CAPABILITIES || [];
  var perms = null;         // izin efektif pengguna aktif
  var roleDefaults = null;  // default role dari server (opsional)

  function can(key) {
    if (!perms) return false;
    if (perms.__admin) return true;
    return perms[key] === true;
  }

  // Peta cepat: view -> capability key
  var VIEW_CAP = {};
  var TABS_ACADEMIC = {};   // tab -> cap
  var TABS_OPERATIONS = {}; // tab -> cap
  CAPS.forEach(function (c) {
    if (c.kind === 'page') VIEW_CAP[c.view] = c.key;
    if (c.kind === 'tab' && c.page === 'academic') TABS_ACADEMIC[c.tab] = c.key;
    if (c.kind === 'tab' && c.page === 'operations') TABS_OPERATIONS[c.tab] = c.key;
  });

  function firstAllowedView() {
    var order = ['dashboard', 'academic-dashboard', 'academic', 'operations', 'mtc-productivity',
                 'sessions', 'admin-profile', 'fulfillment', 'events', 'gmb', 'revenue', 'sosmed-monitor'];
    for (var i = 0; i < order.length; i++) {
      if (!VIEW_CAP[order[i]] || can(VIEW_CAP[order[i]])) return order[i];
    }
    return 'dashboard';
  }

  // Sembunyikan menu sidebar yang tidak boleh
  function applyNav() {
    document.querySelectorAll('.nav-link').forEach(function (a) {
      var v = a.dataset.view;
      if (!v) return;
      var capKey = VIEW_CAP[v];
      var allowed = !capKey || can(capKey);
      a.style.display = allowed ? '' : 'none';
      // nama menu muncul sebagai tooltip saat sidebar diciutkan jadi ikon
      if (!a.title) a.title = a.textContent.replace(/\s+/g, ' ').trim();
    });
    // Sembunyikan seluruh divisi (judul + garis + jarak) kalau semua menunya tersembunyi,
    // supaya tidak ada garis kosong di sidebar.
    var firstVisibleEl = null;
    document.querySelectorAll('nav[aria-label="Main navigation"] > *').forEach(function (el) {
      var isDivision = el.classList.contains('nav-division');
      var visible;
      if (isDivision) {
        var links = [...el.querySelectorAll('.nav-link')];
        visible = links.some(function (a) { return a.style.display !== 'none'; });
        el.style.display = visible ? '' : 'none';
        el.classList.remove('nav-first');
      } else {
        visible = el.style.display !== 'none';
      }
      if (visible && !firstVisibleEl) firstVisibleEl = el;
    });
    // Divisi pertama yang terlihat dirapatkan ke atas (tanpa garis pemisah di atasnya)
    if (firstVisibleEl && firstVisibleEl.classList.contains('nav-division')) {
      firstVisibleEl.classList.add('nav-first');
    }
  }

  // Sembunyikan tab di dalam halaman Academic / Operations
  function applyTabs() {
    Object.keys(TABS_ACADEMIC).forEach(function (tab) {
      var allowed = can(TABS_ACADEMIC[tab]);
      document.querySelectorAll('#academic .sqt-tabs [data-academic-tab="' + tab + '"]').forEach(function (btn) {
        btn.style.display = allowed ? '' : 'none';
      });
    });
    Object.keys(TABS_OPERATIONS).forEach(function (tab) {
      var allowed = can(TABS_OPERATIONS[tab]);
      document.querySelectorAll('#operations [data-operations-view="' + tab + '"]').forEach(function (btn) {
        btn.style.display = allowed ? '' : 'none';
      });
    });
  }

  // Filter isi: Observation hanya MT Mitra -> paksa tampilan Mitra, sembunyikan toggle Coach.
  // Catatan: ini membatasi pemilih MT Coach/MT Mitra pada MPP; untuk Observation,
  // kita sembunyikan baris/kolom skor MT Coach lewat atribut body.
  function applyContentFilters() {
    var mitraOnly = can('filter.observation.mitraOnly') && !can('tab.academic.observation'); // mitra-only berlaku saat tak punya observation penuh
    // Lebih tepat: mitraOnly aktif bila capability filter true. Observation penuh (tab) tetap boleh dibuka,
    // tapi isinya dibatasi ke Mitra. Jadi:
    mitraOnly = can('filter.observation.mitraOnly');
    document.body.dataset.obsMitraOnly = mitraOnly ? '1' : '0';
    document.body.dataset.mppMitraOnly = mitraOnly ? '1' : '0';

    if (mitraOnly && window.mppState) {
      try { window.mppState.view = 'mitra'; } catch (e) {}
      // sembunyikan tombol "MT Coach" di MPP
      document.querySelectorAll('[data-mpp-view="coach"]').forEach(function (b) { b.style.display = 'none'; });
    } else {
      document.querySelectorAll('[data-mpp-view="coach"]').forEach(function (b) { b.style.display = ''; });
    }
  }

  // Jika view aktif tidak boleh, pindahkan ke view pertama yang boleh.
  function guardCurrentView() {
    var current = (location.hash.slice(1) || localStorage.getItem('acops-active-view') || 'dashboard');
    var capKey = VIEW_CAP[current];
    if (capKey && !can(capKey)) {
      var target = firstAllowedView();
      if (typeof window.setView === 'function') window.setView(target);
      if (location.hash.slice(1) !== target) location.hash = target;
    }
  }

  // Jika tab aktif di Academic/Operations tidak boleh, pindah ke tab pertama yang boleh.
  function guardTab(page) {
    if (page === 'academic') {
      var order = ['sqt', 'observation', 'smartapp'];
      var active = localStorage.getItem('acops-academic-tab') || 'sqt';
      if (!can(TABS_ACADEMIC[active])) {
        var ok = order.find(function (t) { return can(TABS_ACADEMIC[t]); });
        if (ok && typeof window.switchAcademicTab === 'function') { localStorage.setItem('acops-academic-tab', ok); window.switchAcademicTab(ok); }
      }
    }
    if (page === 'operations') {
      var order2 = ['mpp', 'hiring', 'teachers'];
      // operations default dibuka ke mpp; kalau tak boleh, pindah
      var okOp = order2.find(function (t) { return can(TABS_OPERATIONS[t]); });
      if (okOp && typeof window.setOperationsView === 'function') window.setOperationsView(okOp);
    }
  }

  function wrapRouters() {
    if (typeof window.setView === 'function' && !window.setView.__acWrapped) {
      var _setView = window.setView;
      window.setView = function (v) {
        var capKey = VIEW_CAP[v];
        if (capKey && !can(capKey)) { v = firstAllowedView(); }
        _setView(v);
        applyTabs();
        if (v === 'academic') guardTab('academic');
        if (v === 'operations') { guardTab('operations'); applyContentFilters(); }
      };
      window.setView.__acWrapped = true;
    }

    if (typeof window.switchAcademicTab === 'function' && !window.switchAcademicTab.__acWrapped) {
      var _sat = window.switchAcademicTab;
      window.switchAcademicTab = function (tab) {
        var capKey = TABS_ACADEMIC[tab];
        if (capKey && !can(capKey)) {
          var ok = ['sqt', 'observation', 'smartapp'].find(function (t) { return can(TABS_ACADEMIC[t]); });
          if (ok) tab = ok; else return;
        }
        _sat(tab);
      };
      window.switchAcademicTab.__acWrapped = true;
    }

    if (typeof window.setOperationsView === 'function' && !window.setOperationsView.__acWrapped) {
      var _sov = window.setOperationsView;
      window.setOperationsView = function (view) {
        var capKey = TABS_OPERATIONS[view];
        if (capKey && !can(capKey)) {
          var ok = ['mpp', 'hiring', 'teachers'].find(function (t) { return can(TABS_OPERATIONS[t]); });
          if (ok) view = ok; else return;
        }
        _sov(view);
        applyContentFilters();
      };
      window.setOperationsView.__acWrapped = true;
    }
  }

  function applyAll() {
    wrapRouters();
    applyNav();
    applyTabs();
    applyContentFilters();
    guardCurrentView();
  }

  var readyFor = null; // id pengguna yang aksesnya sudah selesai dihitung

  function doneChecking() {
    // tunggu 2 frame supaya halaman tujuan sudah tergambar sebelum layar "memuat" dibuka
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { document.body.removeAttribute('data-access'); });
    });
  }

  function onSignedIn(user) {
    // Pertama kali login: tutup tampilan (layar "memuat") sampai akses selesai dihitung
    // dan halaman tujuan sudah benar, supaya halaman terlarang tidak sempat terlihat.
    var firstTime = readyFor !== user.id;
    if (firstTime) document.body.setAttribute('data-access', 'checking');

    // ambil default role dari server bila ada (opsional), lalu hitung izin
    function compute() {
      try {
        perms = P.effectiveFor ? P.effectiveFor(user, roleDefaults) : null;
        if (window.Account) window.Account.setUser(user);
        applyAll(); // langsung, tanpa menunggu: menu, tab, dan pindah ke halaman yang diizinkan
      } catch (err) {
        console.error('access-control:', err);
      } finally {
        readyFor = user.id;
        if (firstTime) doneChecking();
        // cadangan: app.js kadang merender sidebar sedikit terlambat
        setTimeout(applyAll, 400);
      }
    }
    if (window.Auth && typeof window.Auth.admin === 'function' && window.Auth.roleOf(user) === 'admin') {
      compute();
    } else if (window.Auth && typeof window.Auth.admin === 'function') {
      // pengguna biasa: coba baca default role (boleh gagal -> pakai bawaan)
      window.Auth.admin('getRoleDefaults')
        .then(function (res) { roleDefaults = (res && res.defaults) || null; })
        .catch(function () { roleDefaults = null; })
        .finally(compute);
    } else {
      compute();
    }
  }

  function start() {
    if (!window.Auth) { console.error('auth.js belum dimuat'); return; }
    window.Auth.init({
      onSignedIn: onSignedIn,
      onUserUpdated: function (user) { onSignedIn(user); },
      onSignedOut: function () { perms = null; readyFor = null; document.body.removeAttribute('data-access'); }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
