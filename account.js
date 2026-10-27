// account.js
// Menu akun + halaman Access Control (khusus admin).
// Dua tab: "Orang" (atur per-orang) dan "Default per role" (matriks role).
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var P = window.ACOPS_PERMS || {};
  var CAPS = P.CAPABILITIES || [];
  var ROLES = P.ROLES || [];

  var ROLE_LABEL = {
    admin: 'Admin', BM: 'BM', MTC: 'MTC', SA: 'SA', Regional: 'Regional',
    Internship: 'Internship', FEC: 'FEC', revoked: 'Akses dicabut', none: 'Belum ada role'
  };
  var STATUS_LABEL = { active: 'Aktif', pending: 'Menunggu', revoked: 'Dicabut' };

  var user = null;
  var members = [];
  var roleDefaults = null; // diisi dari server (tabel) atau fallback ke bawaan

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function nameOf(u) { return ((u && u.user_metadata && u.user_metadata.full_name) || '').trim(); }
  function initials(name, email) {
    var parts = String(name || '').split(/\s+/).filter(Boolean);
    if (parts.length) return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
    return (String(email || '?').charAt(0) || '?').toUpperCase();
  }
  function message(el, text, ok) {
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('ok', !!ok);
  }

  // ---------- Menu akun ----------
  function setUser(u) {
    user = u;
    var email = u.email || '', name = nameOf(u), role = Auth.roleOf(u), center = Auth.centerOf(u);
    var btn = $('account-btn');
    var shortRole = (ROLE_LABEL[role] || role) + (center && role !== 'admin' ? ' · ' + center : '');
    if (btn) btn.title = (name ? name + ' · ' : '') + email;
    if ($('account-avatar')) $('account-avatar').textContent = initials(name, email);
    if ($('account-short-name')) $('account-short-name').textContent = name || email;
    if ($('account-short-role')) $('account-short-role').textContent = shortRole;
    if ($('account-name')) $('account-name').textContent = name || 'Tanpa nama';
    if ($('account-email')) $('account-email').textContent = email;
    if ($('account-role')) {
      $('account-role').textContent = (ROLE_LABEL[role] || role) + (center ? ' · ' + center : '');
      $('account-role').dataset.role = role;
    }
    if ($('open-access')) $('open-access').hidden = role !== 'admin';
  }

  function toggleMenu(open) {
    if (!$('account-menu')) return;
    $('account-menu').hidden = !open;
    $('account-btn').setAttribute('aria-expanded', String(open));
  }

  function bindMenu() {
    var btn = $('account-btn');
    if (btn) btn.addEventListener('click', function (e) { e.stopPropagation(); toggleMenu($('account-menu').hidden); });
    document.addEventListener('click', function (e) { if (!e.target.closest('.account')) toggleMenu(false); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && $('account-menu') && !$('account-menu').hidden) { toggleMenu(false); $('account-btn').focus(); }
    });
    if ($('sign-out')) $('sign-out').addEventListener('click', function () { toggleMenu(false); Auth.signOut(); });

    document.querySelectorAll('dialog.modal').forEach(function (dlg) {
      dlg.addEventListener('click', function (e) {
        if (e.target === dlg || e.target.closest('[data-close]')) dlg.close();
      });
    });

    // Edit profil sendiri (nama)
    var pf = $('my-profile-form');
    if (pf) {
      if ($('open-profile')) $('open-profile').addEventListener('click', function () {
        toggleMenu(false);
        pf.full_name.value = nameOf(user);
        pf.email.value = (user && user.email) || '';
        message(pf.querySelector('.auth-msg'), '');
      });
      pf.addEventListener('submit', function (e) {
        e.preventDefault();
        var msg = pf.querySelector('.auth-msg'), btn = pf.querySelector('button[type=submit]');
        var fullName = pf.full_name.value.trim();
        if (!fullName) { message(msg, 'Nama tidak boleh kosong.'); return; }
        btn.disabled = true;
        Auth.updateProfile(fullName)
          .then(function (u) {
            setUser(u);
            message(msg, 'Profil tersimpan.', true);
            setTimeout(function () { $('my-profile-dialog').close(); }, 600);
          })
          .catch(function (err) { message(msg, err.message); })
          .finally(function () { btn.disabled = false; });
      });
    }

    // Ganti password sendiri
    if ($('my-password-form')) {
      $('my-password-form').addEventListener('submit', function (e) {
        e.preventDefault();
        var f = e.currentTarget, msg = f.querySelector('.auth-msg'), btn = f.querySelector('button[type=submit]');
        if (f.password.value.length < 6) { message(msg, 'Password minimal 6 karakter.'); return; }
        if (f.password.value !== f.confirm.value) { message(msg, 'Kedua password tidak sama.'); return; }
        btn.disabled = true;
        Auth.changePassword(f.password.value)
          .then(function () { f.reset(); message(msg, 'Password diganti.', true); })
          .catch(function (err) { message(msg, err.message); })
          .finally(function () { btn.disabled = false; });
      });
    }
  }

  // ---------- Access Control: buka ----------
  function bindAccessOpen() {
    if (!$('open-access')) return;
    $('open-access').addEventListener('click', function () {
      toggleMenu(false);
      $('access-dialog').showModal();
      switchTab('people');
      loadMembers();
      loadRoleDefaults();
    });
    document.querySelectorAll('[data-access-tab]').forEach(function (b) {
      b.addEventListener('click', function () { switchTab(b.dataset.accessTab); });
    });
  }

  function switchTab(name) {
    document.querySelectorAll('[data-access-tab]').forEach(function (b) {
      b.classList.toggle('active', b.dataset.accessTab === name);
    });
    if ($('access-people')) $('access-people').hidden = name !== 'people';
    if ($('access-roles')) $('access-roles').hidden = name !== 'roles';
  }

  // ---------- Tab 1: Orang ----------
  function loadMembers() {
    message($('people-msg'), 'Memuat pengguna…', true);
    return Auth.admin('list')
      .then(function (res) { members = res.members || []; message($('people-msg'), ''); renderMembers(); })
      .catch(function (err) { message($('people-msg'), err.message); });
  }

  function renderMembers() {
    var list = $('people-list');
    if (!list) return;
    list.innerHTML = members.map(function (m) {
      var isAdmin = m.role === 'admin';
      var roleSelect = isAdmin
        ? '<span class="role-badge" data-role="admin">Admin</span>'
        : '<select class="member-role" data-id="' + esc(m.id) + '" aria-label="Role ' + esc(m.email) + '">' +
            ['none'].concat(ROLES).concat(['revoked']).map(function (r) {
              return '<option value="' + r + '"' + (m.role === r ? ' selected' : '') + '>' + esc(ROLE_LABEL[r] || r) + '</option>';
            }).join('') + '</select>';

      var overrideCount = m.override ? Object.keys(m.override).length : 0;
      var actions = isAdmin ? '' :
        '<button class="btn-chip" type="button" data-act="customize" data-id="' + esc(m.id) + '">Atur akses' +
          (overrideCount ? ' (' + overrideCount + ')' : '') + '</button>' +
        (m.status === 'revoked'
          ? '<button class="btn-chip" type="button" data-act="restore" data-id="' + esc(m.id) + '">Pulihkan</button>' +
            '<button class="btn-chip danger" type="button" data-act="delete" data-id="' + esc(m.id) + '" data-email="' + esc(m.email) + '">Hapus</button>'
          : '<button class="btn-chip danger" type="button" data-act="revoke" data-id="' + esc(m.id) + '" data-email="' + esc(m.email) + '">Cabut</button>');

      return '<li class="member">' +
        '<span class="member-avatar" aria-hidden="true">' + esc(initials(m.name, m.email)) + '</span>' +
        '<span class="member-info"><b>' + esc(m.name || m.email) + '</b>' +
          (m.name ? '<span>' + esc(m.email) + '</span>' : '') +
          (m.center ? '<span>Center: ' + esc(m.center) + '</span>' : '') + '</span>' +
        '<span class="member-tags">' + roleSelect +
          '<span class="status-chip" data-status="' + esc(m.status) + '">' + esc(STATUS_LABEL[m.status] || m.status) + '</span></span>' +
        '<span class="member-actions">' + actions + '</span>' +
        '</li>';
    }).join('') || '<li class="member-empty">Belum ada pengguna yang mendaftar.</li>';
  }

  function upsertMember(m) {
    var i = members.findIndex(function (x) { return x.id === m.id; });
    if (i === -1) members.push(m); else members[i] = m;
    renderMembers();
  }

  function bindPeople() {
    var list = $('people-list');
    if (!list) return;

    list.addEventListener('change', function (e) {
      var sel = e.target.closest('.member-role');
      if (!sel) return;
      var id = sel.dataset.id, role = sel.value;
      sel.disabled = true;
      Auth.admin('setRole', { id: id, role: role })
        .then(function (res) { upsertMember(res.member); message($('people-msg'), 'Role diperbarui.', true); })
        .catch(function (err) { message($('people-msg'), err.message); loadMembers(); })
        .finally(function () { sel.disabled = false; });
    });

    list.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-act]');
      if (!btn) return;
      var act = btn.dataset.act, id = btn.dataset.id;
      if (act === 'customize') { openOverride(id); return; }
      if (act === 'revoke' && !confirm('Cabut akses ' + btn.dataset.email + '? Orang ini tidak bisa login sampai dipulihkan.')) return;
      if (act === 'delete' && !confirm('Hapus ' + btn.dataset.email + ' permanen? Akun hilang dan tidak bisa dikembalikan.')) return;
      btn.disabled = true;
      Auth.admin(act, { id: id })
        .then(function (res) {
          if (act === 'delete') {
            members = members.filter(function (m) { return m.id !== res.deleted; });
            renderMembers();
            message($('people-msg'), 'Pengguna dihapus.', true);
            return;
          }
          upsertMember(res.member);
          message($('people-msg'), act === 'revoke' ? 'Akses dicabut.' : 'Akses dipulihkan.', true);
        })
        .catch(function (err) { btn.disabled = false; message($('people-msg'), err.message); });
    });
  }

  // ---------- Tambah orang (dari web) ----------
  function randomPassword() {
    var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    var buf = new Uint32Array(12);
    crypto.getRandomValues(buf);
    var out = '';
    for (var i = 0; i < buf.length; i++) out += chars[buf[i] % chars.length];
    return out;
  }

  function bindAddPerson() {
    var form = $('add-person-form');
    var toggle = $('add-person-toggle');
    if (!form || !toggle) return;
    var roleSel = form.elements.role;
    roleSel.innerHTML = '<option value="" disabled selected>Pilih role…</option>' +
      ROLES.map(function (r) { return '<option value="' + esc(r) + '">' + esc(r) + '</option>'; }).join('');

    toggle.addEventListener('click', function () {
      form.hidden = !form.hidden;
      toggle.setAttribute('aria-expanded', String(!form.hidden));
      if (!form.hidden) form.elements.name.focus();
    });

    $('add-person-gen').addEventListener('click', function () {
      form.elements.password.value = randomPassword();
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var msg = $('add-person-msg');
      var btn = form.querySelector('button[type="submit"]');
      var payload = {
        name: form.elements.name.value,
        email: form.elements.email.value,
        role: form.elements.role.value,
        center: form.elements.center.value,
        password: form.elements.password.value
      };
      var pass = payload.password;
      btn.disabled = true;
      message(msg, 'Membuat akun…', true);
      Auth.admin('createUser', payload)
        .then(function (res) {
          upsertMember(res.member);
          message(msg, 'Akun dibuat untuk ' + payload.email + '. Password awal: ' + pass + ' (salin sekarang, tidak ditampilkan lagi).', true);
          form.reset();
          roleSel.selectedIndex = 0;
        })
        .catch(function (err) { message(msg, err.message); })
        .finally(function () { btn.disabled = false; });
    });
  }

  // ---------- Dialog override per-orang ----------
  function effectiveDefaults(role) {
    if (roleDefaults && roleDefaults[role]) return roleDefaults[role];
    return P.defaultsFor ? P.defaultsFor(role) : {};
  }

  function openOverride(id) {
    var m = members.find(function (x) { return x.id === id; });
    if (!m) return;
    var base = effectiveDefaults(m.role);
    var ov = m.override || {};
    $('override-title').textContent = 'Akses untuk ' + (m.name || m.email);
    $('override-sub').textContent = 'Role: ' + (ROLE_LABEL[m.role] || m.role) + (m.center ? ' · ' + m.center : '') +
      '. Centang = boleh. Yang tidak kamu ubah mengikuti default role.';
    $('override-body').innerHTML = CAPS.map(function (c) {
      var fromRole = base[c.key] === true;
      var hasOv = Object.prototype.hasOwnProperty.call(ov, c.key);
      var checked = hasOv ? ov[c.key] === true : fromRole;
      return '<label class="perm-row' + (hasOv ? ' overridden' : '') + '">' +
        '<input type="checkbox" data-cap="' + esc(c.key) + '"' + (checked ? ' checked' : '') + '>' +
        '<span>' + esc(c.label) + '</span>' +
        '<small>' + (hasOv ? 'diubah khusus' : 'default role: ' + (fromRole ? 'boleh' : 'tidak')) + '</small>' +
        '</label>';
    }).join('');
    $('override-dialog').dataset.memberId = id;
    message($('override-msg'), '');
    $('override-dialog').showModal();
  }

  function bindOverride() {
    if ($('override-save')) {
      $('override-save').addEventListener('click', function () {
        var id = $('override-dialog').dataset.memberId;
        var m = members.find(function (x) { return x.id === id; });
        if (!m) return;
        var base = effectiveDefaults(m.role);
        var override = {};
        $('override-body').querySelectorAll('input[data-cap]').forEach(function (cb) {
          var key = cb.dataset.cap, val = cb.checked;
          // hanya simpan yang BERBEDA dari default role (itu arti "override")
          if ((base[key] === true) !== val) override[key] = val;
        });
        var btn = this; btn.disabled = true;
        Auth.admin('setOverride', { id: id, override: override })
          .then(function (res) { upsertMember(res.member); message($('override-msg'), 'Tersimpan.', true); setTimeout(function () { $('override-dialog').close(); }, 500); })
          .catch(function (err) { message($('override-msg'), err.message); })
          .finally(function () { btn.disabled = false; });
      });
    }
    if ($('override-reset')) {
      $('override-reset').addEventListener('click', function () {
        var id = $('override-dialog').dataset.memberId;
        var btn = this; btn.disabled = true;
        Auth.admin('clearOverride', { id: id })
          .then(function (res) { upsertMember(res.member); message($('override-msg'), 'Dikembalikan ke default role.', true); setTimeout(function () { $('override-dialog').close(); }, 500); })
          .catch(function (err) { message($('override-msg'), err.message); })
          .finally(function () { btn.disabled = false; });
      });
    }
  }

  // ---------- Tab 2: Default per role ----------
  function loadRoleDefaults() {
    return Auth.admin('getRoleDefaults')
      .then(function (res) {
        roleDefaults = (res && res.defaults) || null;
        renderRoleGrid();
      })
      .catch(function () {
        // Belum ada tabel / fungsi lama: pakai bawaan permissions.js
        roleDefaults = null;
        renderRoleGrid();
      });
  }

  function currentRoleDefaults() {
    var out = {};
    ROLES.forEach(function (r) {
      out[r] = (roleDefaults && roleDefaults[r]) ? roleDefaults[r] : (P.defaultsFor ? P.defaultsFor(r) : {});
    });
    return out;
  }

  function renderRoleGrid() {
    var wrap = $('roles-grid');
    if (!wrap) return;
    var defs = currentRoleDefaults();
    var head = '<tr><th>Bagian</th>' + ROLES.map(function (r) { return '<th>' + esc(r) + '</th>'; }).join('') + '</tr>';
    var body = CAPS.map(function (c) {
      return '<tr><td>' + esc(c.label) + '</td>' + ROLES.map(function (r) {
        var on = defs[r] && defs[r][c.key] === true;
        return '<td><input type="checkbox" data-role="' + esc(r) + '" data-cap="' + esc(c.key) + '"' + (on ? ' checked' : '') + '></td>';
      }).join('') + '</tr>';
    }).join('');
    wrap.innerHTML = '<table class="roles-table"><thead>' + head + '</thead><tbody>' + body + '</tbody></table>';
  }

  function bindRoles() {
    if ($('roles-save')) {
      $('roles-save').addEventListener('click', function () {
        var defs = {};
        ROLES.forEach(function (r) { defs[r] = {}; });
        $('roles-grid').querySelectorAll('input[data-role]').forEach(function (cb) {
          defs[cb.dataset.role][cb.dataset.cap] = cb.checked;
        });
        var btn = this; btn.disabled = true;
        Auth.admin('setRoleDefaults', { defaults: defs })
          .then(function () { roleDefaults = defs; message($('roles-msg'), 'Default role tersimpan. Berlaku untuk semua orang di role itu.', true); })
          .catch(function (err) { message($('roles-msg'), err.message + ' (Pastikan tabel acops_role_defaults sudah dibuat.)'); })
          .finally(function () { btn.disabled = false; });
      });
    }
  }

  function init() {
    bindMenu();
    bindAccessOpen();
    bindPeople();
    bindAddPerson();
    bindOverride();
    bindRoles();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.Account = { setUser: setUser };
})();
