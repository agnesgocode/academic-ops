// auth.js
// Login & daftar (email + password) via Supabase untuk Academic Ops.
// Situs TIDAK bisa dibuka tamu: isi aplikasi baru tampil setelah login.
//
// body[data-auth]:  'pending' (cek sesi) | 'out' (layar login) | 'in' (aplikasi tampil)
(function () {
  'use strict';

  var cfg = window.ACOPS_CONFIG || {};
  var $ = function (id) { return document.getElementById(id); };

  // Tolak secret key kalau salah paste (key itu melewati semua pengaman)
  if (/^sb_secret_/.test(cfg.supabasePublishableKey || '')) {
    console.error('config.js berisi secret key. Ganti dengan publishable key (sb_publishable_...).');
    cfg.supabasePublishableKey = '';
  }

  var configured = /^https:\/\/\S+$/.test(cfg.supabaseUrl || '') &&
                   !!cfg.supabasePublishableKey && !!window.supabase;

  var client = configured
    ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabasePublishableKey)
    : null;

  var handlers = { onSignedIn: function () {}, onSignedOut: function () {}, onUserUpdated: function () {} };
  var currentUserId = null;

  var ROLES = (window.ACOPS_PERMS && window.ACOPS_PERMS.ROLES) || ['BM', 'MTC', 'SA', 'Regional', 'Internship', 'FEC'];

  // ---------- Tampilan ----------
  function setMode(mode) { document.body.dataset.auth = mode; }

  function showView(name) {
    ['login', 'signup', 'config'].forEach(function (v) {
      var el = $('view-' + v);
      if (el) el.hidden = v !== name;
    });
    setMode('out');
    var first = $('view-' + name) && $('view-' + name).querySelector('input, select');
    if (first) setTimeout(function () { first.focus(); }, 0);
  }

  function message(form, text, ok) {
    var el = form.querySelector('.auth-msg');
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('ok', !!ok);
  }

  function busy(form, on) {
    var btn = form.querySelector('.btn-primary');
    if (btn) btn.disabled = on;
    form.setAttribute('aria-busy', String(on));
  }

  function friendlyError(err) {
    var msg = (err && err.message) || '';
    if (/invalid login credentials/i.test(msg)) return 'Email atau password salah.';
    if (/already registered|already been registered|user already exists/i.test(msg)) return 'Email ini sudah terdaftar. Silakan login.';
    if (/email not confirmed/i.test(msg)) return 'Email belum dikonfirmasi. Hubungi admin.';
    if (/rate limit|too many/i.test(msg)) return 'Terlalu banyak percobaan. Coba lagi beberapa menit lagi.';
    if (/password/i.test(msg) && /(weak|short|least|6)/i.test(msg)) return 'Password terlalu pendek. Gunakan minimal 6 karakter.';
    return 'Terjadi kesalahan: ' + (msg || 'coba lagi.');
  }

  // ---------- Sesi ----------
  function enterApp(user) {
    setMode('in');
    if (user.id === currentUserId) { handlers.onUserUpdated(user); return; }
    currentUserId = user.id;
    handlers.onSignedIn(user);
  }

  function handleSession(event, session) {
    if (!session) {
      currentUserId = null;
      handlers.onSignedOut();
      showView('login');
      return;
    }
    enterApp(session.user);
  }

  // ---------- Form: LOGIN ----------
  function bindLogin() {
    var form = $('view-login');
    if (!form) return;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = form.email.value.trim(), password = form.password.value;
      if (!email || !password) { message(form, 'Isi email dan password.'); return; }
      message(form, '');
      busy(form, true);
      client.auth.signInWithPassword({ email: email, password: password })
        .then(function (res) {
          if (res.error) message(form, friendlyError(res.error));
          else form.password.value = '';
        })
        .finally(function () { busy(form, false); });
    });
  }

  // ---------- Form: DAFTAR (signup) ----------
  // Simpan nama di user_metadata.full_name; role & center di app_metadata lewat
  // signUp options.data TIDAK bisa menulis app_metadata (itu server-only).
  // Jadi role/center dikirim sebagai user_metadata saat daftar, lalu Edge Function
  // 'admin' / trigger menyalinnya ke app_metadata. Untuk kesederhanaan di sini,
  // kita simpan role pilihan & center di user_metadata, dan sebuah trigger DB
  // menyalin role -> app_metadata.role saat user dibuat (lihat catatan setup).
  function bindSignup() {
    var form = $('view-signup');
    if (!form) return;

    // Isi dropdown role
    var sel = form.querySelector('select[name=role]');
    function fillRoles(list) {
      if (!sel) return;
      var keep = sel.value;
      sel.innerHTML = '<option value="" disabled' + (keep ? '' : ' selected') + '>Pilih role…</option>' +
        list.map(function (r) {
          return '<option value="' + r + '"' + (r === keep ? ' selected' : '') + '>' + r + '</option>';
        }).join('');
    }
    if (sel && !sel.dataset.filled) {
      sel.dataset.filled = '1';
      fillRoles(ROLES);
      // Daftar terbaru (termasuk role buatan admin) dari database; gagal -> pakai bawaan
      if (client && client.rpc) {
        client.rpc('acops_list_roles').then(function (res) {
          if (res && !res.error && Array.isArray(res.data) && res.data.length) fillRoles(res.data);
        }, function () {});
      }
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = form.full_name.value.trim();
      var email = form.email.value.trim().toLowerCase();
      var role = form.role.value;
      var center = form.center.value.trim();
      var password = form.password.value;

      if (!name) { message(form, 'Isi nama lengkap.'); return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { message(form, 'Masukkan email yang valid.'); return; }
      if (!role) { message(form, 'Pilih role Anda.'); return; }
      if (!center) { message(form, 'Isi center Anda.'); return; }
      if (password.length < 6) { message(form, 'Password minimal 6 karakter.'); return; }

      message(form, '');
      busy(form, true);
      client.auth.signUp({
        email: email,
        password: password,
        options: {
          data: {
            full_name: name,
            requested_role: role,   // disalin ke app_metadata.role oleh trigger DB
            center: center
          }
        }
      })
        .then(function (res) {
          if (res.error) { message(form, friendlyError(res.error)); return; }
          // Dengan email-confirmation OFF, signUp langsung mengembalikan sesi.
          if (res.data && res.data.session) {
            // Sesi aktif; onAuthStateChange akan membawa masuk.
            message(form, 'Akun dibuat. Memuat…', true);
          } else {
            // Tidak ada sesi (mis. konfirmasi email menyala): minta login.
            message(form, 'Akun dibuat. Silakan login.', true);
            setTimeout(function () { showView('login'); }, 1200);
          }
        })
        .finally(function () { busy(form, false); });
    });
  }

  // ---------- Pindah antar layar login/daftar ----------
  function bindViewSwitch() {
    document.addEventListener('click', function (e) {
      var sw = e.target.closest('[data-auth-view]');
      if (!sw) return;
      e.preventDefault();
      var target = sw.dataset.authView;
      var typedEmail = document.querySelector('.auth-view:not([hidden]) input[type=email]');
      showView(target);
      var next = $('view-' + target) && $('view-' + target).querySelector('input[type=email]');
      if (typedEmail && next && typedEmail.value) next.value = typedEmail.value;
    });
  }

  // ---------- Panggil Edge Function (halaman admin) ----------
  function callFunction(name, options) {
    return client.functions.invoke(name, options).then(function (res) {
      if (!res.error) return res.data;
      var ctx = res.error.context, status = ctx && ctx.status;
      if (status === 401) {
        client.auth.signOut();
        throw new Error('Sesi berakhir, silakan masuk lagi');
      }
      var read = ctx && typeof ctx.json === 'function' ? ctx.json().catch(function () { return {}; }) : Promise.resolve({});
      return read.then(function (body) {
        var err = new Error((body && body.error) || (status ? 'Server merespons ' + status : res.error.message));
        err.status = status;
        err.code = body && body.code;
        throw err;
      });
    });
  }

  // ---------- API publik ----------
  window.Auth = {
    init: function (h) {
      handlers = Object.assign({}, handlers, h);
      bindLogin();
      bindSignup();
      bindViewSwitch();
      if (!client) { showView('config'); return; }
      client.auth.onAuthStateChange(function (event, session) {
        setTimeout(function () { handleSession(event, session); }, 0);
      });
    },

    // Aksi admin (dicek ulang di server)
    admin: function (action, payload) {
      return callFunction(cfg.adminFunction || 'admin', { body: Object.assign({ action: action }, payload || {}) });
    },

    roleOf: function (user) {
      return (user && user.app_metadata && user.app_metadata.role) || 'none';
    },

    centerOf: function (user) {
      var m = (user && user.app_metadata) || {};
      if (m.center) return m.center;
      var um = (user && user.user_metadata) || {};
      return um.center || '';
    },

    changePassword: function (password) {
      return client.auth.updateUser({ password: password }).then(function (res) {
        if (res.error) throw new Error(friendlyError(res.error));
      });
    },

    updateProfile: function (fullName) {
      return client.auth.updateUser({ data: { full_name: fullName } }).then(function (res) {
        if (res.error) throw new Error(friendlyError(res.error));
        return res.data.user;
      });
    },

    signOut: function () { return client.auth.signOut(); }
  };
})();
