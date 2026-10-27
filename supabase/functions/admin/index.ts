// supabase/functions/admin/index.ts
// Manajemen pengguna khusus admin untuk Academic Ops.
// Semua aksi memeriksa peran admin dari data pengguna terbaru di SERVER
// (bukan dari token), supaya akses yang dicabut langsung berlaku.
//
// Aksi:
//   list                      -> daftar semua pengguna + role, center, status, override
//   createUser {email,password,name,role,center} -> tambah akun baru langsung aktif
//   setRole   {id, role}      -> ganti role seseorang (BM/MTC/SA/Regional/Internship/FEC/admin/none)
//   setCenter {id, center}    -> ganti center seseorang
//   setOverride {id, override}-> set/ganti override per-orang (objek { capKey: bool })
//   clearOverride {id}        -> hapus semua override seseorang (kembali ke default role)
//   revoke/restore {id}       -> cabut / pulihkan akses (ban + role 'revoked')
//   delete {id}               -> hapus permanen (hanya untuk yang sudah dicabut)
import { withSupabase } from 'npm:@supabase/server@1.9.1'

const ALLOWED_ROLES = ['BM', 'MTC', 'SA', 'Regional', 'Internship', 'FEC'] // role bawaan
const RESERVED_ROLES = ['admin', 'revoked', 'none']
const ROLE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 _.-]{1,23}$/
const BAN_FOREVER = '876000h'

// deno-lint-ignore no-explicit-any
type User = any

const roleOf = (u: User): string =>
  (u && u.app_metadata && typeof u.app_metadata.role === 'string') ? u.app_metadata.role : 'none'

const centerOf = (u: User): string => {
  const a = (u && u.app_metadata) || {}
  if (typeof a.center === 'string') return a.center
  const m = (u && u.user_metadata) || {}
  return typeof m.center === 'string' ? m.center : ''
}

const overrideOf = (u: User) => {
  const o = u && u.app_metadata && u.app_metadata.perms_override
  return (o && typeof o === 'object') ? o : {}
}

const isBanned = (u: User) => !!u.banned_until && new Date(u.banned_until) > new Date()

function statusOf(u: User) {
  if (isBanned(u) || roleOf(u) === 'revoked') return 'revoked'
  if (!u.email_confirmed_at && !u.last_sign_in_at) return 'pending'
  return 'active'
}

const toMember = (u: User) => ({
  id: u.id,
  email: u.email ?? '',
  name: (u.user_metadata && u.user_metadata.full_name) || '',
  role: roleOf(u),
  center: centerOf(u),
  override: overrideOf(u),
  status: statusOf(u),
  last_sign_in_at: u.last_sign_in_at ?? null,
  created_at: u.created_at ?? null,
})

const fail = (status: number, message: string, code?: string) =>
  Response.json({ error: message, code }, { status })

export default {
  fetch: withSupabase({ auth: 'user' }, async (req, ctx) => {
    const admin = ctx.supabaseAdmin.auth.admin

    const { data: meData } = await admin.getUserById(ctx.userClaims!.id)
    const me = meData?.user
    if (!me || isBanned(me)) return fail(403, 'Akses ditolak')
    if (req.method !== 'POST') return fail(405, 'Gunakan POST')

    const body = await req.json().catch(() => ({}))

    // Role bawaan + role buatan admin (disimpan sebagai kunci di acops_role_defaults)
    async function storedDefaults(): Promise<Record<string, unknown> | null> {
      const { data, error } = await ctx.supabaseAdmin
        .from('acops_role_defaults').select('defaults').eq('id', 1).maybeSingle()
      if (error || !data || !data.defaults || typeof data.defaults !== 'object') return null
      return data.defaults as Record<string, unknown>
    }
    async function roleIsKnown(role: string): Promise<boolean> {
      if (ALLOWED_ROLES.includes(role)) return true
      const s = await storedDefaults()
      return !!s && Object.prototype.hasOwnProperty.call(s, role)
    }

    // Boleh dibaca SEMUA pengguna yang login (bukan rahasia): dipakai untuk menghitung
    // akses sesuai default role terbaru. Hanya menulis yang khusus admin.
    if (body.action === 'getRoleDefaults') {
      return Response.json({ defaults: await storedDefaults() })
    }

    if (roleOf(me) !== 'admin') return fail(403, 'Hanya admin yang bisa membuka halaman ini')

    async function allUsers(): Promise<User[]> {
      const users: User[] = []
      for (let page = 1; page < 50; page++) {
        const { data, error } = await admin.listUsers({ page, perPage: 200 })
        if (error) throw error
        users.push(...data.users)
        if (data.users.length < 200) break
      }
      return users
    }

    async function getTarget(id: string): Promise<User | null> {
      if (!id) return null
      const { data, error } = await admin.getUserById(id)
      if (error) return null
      return data?.user ?? null
    }

    try {
      switch (body.action) {
        case 'list': {
          const members = (await allUsers()).map(toMember).sort((a, b) => {
            if (a.role === 'admin' && b.role !== 'admin') return -1
            if (b.role === 'admin' && a.role !== 'admin') return 1
            return (a.name || a.email).localeCompare(b.name || b.email)
          })
          return Response.json({ members, me: me.id })
        }

        // Admin menambah akun langsung dari web (tanpa buka dashboard Supabase).
        // Akun langsung aktif (email dianggap terkonfirmasi) dengan role & center yang dipilih.
        case 'createUser': {
          const email = String(body.email ?? '').trim().toLowerCase()
          const password = String(body.password ?? '')
          const fullName = String(body.name ?? '').trim().slice(0, 80)
          const role = String(body.role ?? '')
          const center = String(body.center ?? '').trim().slice(0, 120)
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(400, 'Email tidak valid')
          if (password.length < 8) return fail(400, 'Password minimal 8 karakter')
          if (!fullName) return fail(400, 'Nama wajib diisi')
          if (!(await roleIsKnown(role))) return fail(400, 'Role tidak dikenal')
          const { data: created, error } = await admin.createUser({
            email,
            password,
            email_confirm: true,
            user_metadata: { full_name: fullName, center: center },
            app_metadata: { role: role, center: center },
          })
          if (error) {
            const msg = /already|registered|exists/i.test(error.message || '')
              ? 'Email ini sudah terdaftar'
              : 'Gagal membuat akun: ' + (error.message || 'tidak diketahui')
            return fail(400, msg)
          }
          return Response.json({ member: toMember(created.user) })
        }

        case 'setRole': {
          const role = String(body.role ?? '')
          if (role !== 'none' && role !== 'revoked' && role !== 'admin' && !(await roleIsKnown(role))) {
            return fail(400, 'Role tidak dikenal')
          }
          const target = await getTarget(String(body.id ?? ''))
          if (!target) return fail(404, 'Pengguna tidak ditemukan')
          if (target.id === me.id) return fail(400, 'Tidak bisa mengubah role akun sendiri')
          if (roleOf(target) === 'admin') return fail(403, 'Role admin tidak bisa diubah dari web')
          if (role === 'admin') return fail(403, 'Admin baru hanya bisa dibuat lewat SQL, bukan dari web')
          const { data: updated, error } = await admin.updateUserById(target.id, {
            app_metadata: { role: role },
          })
          if (error) throw error
          return Response.json({ member: toMember(updated.user) })
        }

        case 'setCenter': {
          const center = String(body.center ?? '').slice(0, 120)
          const target = await getTarget(String(body.id ?? ''))
          if (!target) return fail(404, 'Pengguna tidak ditemukan')
          if (roleOf(target) === 'admin') return fail(403, 'Akun admin tidak bisa diubah dari web')
          const { data: updated, error } = await admin.updateUserById(target.id, {
            app_metadata: { center: center },
          })
          if (error) throw error
          return Response.json({ member: toMember(updated.user) })
        }

        case 'setOverride': {
          const ov = (body.override && typeof body.override === 'object') ? body.override : {}
          // bersihkan: hanya boolean yang diterima
          const clean: Record<string, boolean> = {}
          for (const k of Object.keys(ov)) {
            if (typeof ov[k] === 'boolean') clean[k] = ov[k]
          }
          const target = await getTarget(String(body.id ?? ''))
          if (!target) return fail(404, 'Pengguna tidak ditemukan')
          if (target.id === me.id) return fail(400, 'Tidak bisa mengubah akses akun sendiri')
          if (roleOf(target) === 'admin') return fail(403, 'Akun admin selalu punya akses penuh')
          const { data: updated, error } = await admin.updateUserById(target.id, {
            app_metadata: { perms_override: clean },
          })
          if (error) throw error
          return Response.json({ member: toMember(updated.user) })
        }

        case 'clearOverride': {
          const target = await getTarget(String(body.id ?? ''))
          if (!target) return fail(404, 'Pengguna tidak ditemukan')
          const { data: updated, error } = await admin.updateUserById(target.id, {
            app_metadata: { perms_override: {} },
          })
          if (error) throw error
          return Response.json({ member: toMember(updated.user) })
        }

        case 'revoke':
        case 'restore': {
          const target = await getTarget(String(body.id ?? ''))
          if (!target) return fail(404, 'Pengguna tidak ditemukan')
          if (target.id === me.id) return fail(400, 'Tidak bisa mengubah akses akun sendiri')
          if (roleOf(target) === 'admin') return fail(403, 'Akses admin tidak bisa diubah dari web')
          const attrs = body.action === 'revoke'
            ? { app_metadata: { role: 'revoked' }, ban_duration: BAN_FOREVER }
            : { app_metadata: { role: 'none' }, ban_duration: 'none' }
          const { data: updated, error } = await admin.updateUserById(target.id, attrs)
          if (error) throw error
          return Response.json({ member: toMember(updated.user) })
        }

        case 'delete': {
          const target = await getTarget(String(body.id ?? ''))
          if (!target) return fail(404, 'Pengguna tidak ditemukan')
          if (target.id === me.id) return fail(400, 'Tidak bisa menghapus akun sendiri')
          if (roleOf(target) === 'admin') return fail(403, 'Akun admin tidak bisa dihapus dari web')
          if (statusOf(target) !== 'revoked') return fail(409, 'Cabut akses pengguna ini dulu sebelum menghapus')
          const { error } = await admin.deleteUser(target.id)
          if (error) throw error
          return Response.json({ deleted: target.id })
        }

        // Simpan default semua role (admin saja). Kunci objek = daftar role,
        // jadi menambah/menghapus role = menambah/menghapus kunci di sini.
        case 'setRoleDefaults': {
          const defs = (body.defaults && typeof body.defaults === 'object' && !Array.isArray(body.defaults))
            ? body.defaults as Record<string, unknown> : null
          if (!defs) return fail(400, 'Data default tidak valid')
          const names = Object.keys(defs)
          if (names.length > 40) return fail(400, 'Terlalu banyak role (maksimal 40)')
          const seen = new Set<string>()
          const clean: Record<string, Record<string, boolean>> = {}
          for (const n of names) {
            const isBuiltin = ALLOWED_ROLES.includes(n)
            if (!isBuiltin && !ROLE_NAME_RE.test(n)) {
              return fail(400, 'Nama role "' + n + '" tidak valid (2-24 karakter: huruf, angka, spasi, - _ .)')
            }
            if (RESERVED_ROLES.includes(n.toLowerCase())) return fail(400, 'Nama role "' + n + '" tidak boleh dipakai')
            if (seen.has(n.toLowerCase())) return fail(400, 'Nama role kembar: ' + n)
            seen.add(n.toLowerCase())
            const caps = defs[n]
            if (!caps || typeof caps !== 'object') return fail(400, 'Data role "' + n + '" tidak valid')
            const row: Record<string, boolean> = {}
            for (const k of Object.keys(caps as Record<string, unknown>).slice(0, 60)) {
              const v = (caps as Record<string, unknown>)[k]
              if (typeof v === 'boolean') row[k] = v
            }
            clean[n] = row
          }
          for (const b of ALLOWED_ROLES) if (!clean[b]) return fail(400, 'Role bawaan ' + b + ' tidak boleh dihapus')

          // Role buatan yang dihapus tidak boleh masih dipakai orang
          const before = await storedDefaults()
          if (before) {
            const removed = Object.keys(before).filter((k) => !ALLOWED_ROLES.includes(k) && !clean[k])
            if (removed.length) {
              const inUse = (await allUsers()).filter((u) => removed.includes(roleOf(u)))
              if (inUse.length) {
                return fail(409, 'Role "' + roleOf(inUse[0]) + '" masih dipakai ' + inUse.length +
                  ' orang. Pindahkan mereka ke role lain dulu.')
              }
            }
          }

          const { error } = await ctx.supabaseAdmin
            .from('acops_role_defaults')
            .upsert({ id: 1, defaults: clean, updated_at: new Date().toISOString() })
          if (error) return fail(500, 'Gagal menyimpan. Pastikan tabel acops_role_defaults sudah dibuat.')
          return Response.json({ ok: true })
        }

        default:
          return fail(400, 'Aksi tidak dikenal')
      }
    } catch (err) {
      console.error('admin error:', err)
      return fail(500, 'Terjadi kesalahan di server')
    }
  }),
}
