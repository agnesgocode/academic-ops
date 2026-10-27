// supabase/functions/admin/index.ts
// Manajemen pengguna khusus admin untuk Academic Ops.
// Semua aksi memeriksa peran admin dari data pengguna terbaru di SERVER
// (bukan dari token), supaya akses yang dicabut langsung berlaku.
//
// Aksi:
//   list                      -> daftar semua pengguna + role, center, status, override
//   setRole   {id, role}      -> ganti role seseorang (BM/MTC/SA/Regional/Internship/FEC/admin/none)
//   setCenter {id, center}    -> ganti center seseorang
//   setOverride {id, override}-> set/ganti override per-orang (objek { capKey: bool })
//   clearOverride {id}        -> hapus semua override seseorang (kembali ke default role)
//   revoke/restore {id}       -> cabut / pulihkan akses (ban + role 'revoked')
//   delete {id}               -> hapus permanen (hanya untuk yang sudah dicabut)
import { withSupabase } from 'npm:@supabase/server@1.9.1'

const ALLOWED_ROLES = ['BM', 'MTC', 'SA', 'Regional', 'Internship', 'FEC']
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
    if (!me || isBanned(me) || roleOf(me) !== 'admin') return fail(403, 'Hanya admin yang bisa membuka halaman ini')
    if (req.method !== 'POST') return fail(405, 'Gunakan POST')

    const body = await req.json().catch(() => ({}))

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

        case 'setRole': {
          const role = String(body.role ?? '')
          if (role !== 'none' && role !== 'revoked' && !ALLOWED_ROLES.includes(role) && role !== 'admin') {
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

        // Baca default per-role dari tabel acops_role_defaults (satu baris id=1)
        case 'getRoleDefaults': {
          const { data, error } = await ctx.supabaseAdmin
            .from('acops_role_defaults').select('defaults').eq('id', 1).maybeSingle()
          if (error) return Response.json({ defaults: null })
          return Response.json({ defaults: (data && data.defaults) || null })
        }

        // Simpan default per-role (admin saja)
        case 'setRoleDefaults': {
          const defs = (body.defaults && typeof body.defaults === 'object') ? body.defaults : null
          if (!defs) return fail(400, 'Data default tidak valid')
          const { error } = await ctx.supabaseAdmin
            .from('acops_role_defaults')
            .upsert({ id: 1, defaults: defs, updated_at: new Date().toISOString() })
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
