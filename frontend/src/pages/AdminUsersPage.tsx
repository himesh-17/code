import { useCallback, useEffect, useState } from 'react'
import { api, msg, type User } from '../api'
import { Badge, Btn, Empty } from '../ui'
import { inputCls } from '../lib/styles'
import { Trash2 } from 'lucide-react'

const ROLES: User['role'][] = ['creator', 'reviewer', 'manager', 'admin']

export default function AdminUsersPage({ user }: { user: User }) {
  const [users, setUsers] = useState<User[]>([])
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<User['role']>('reviewer')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const load = useCallback(() => {
    api<User[]>('/auth/users').then((r) => { setUsers(r); setErr('') })
      .catch((e) => setErr(msg(e)))
  }, [])

  useEffect(load, [load])

  async function create() {
    if (busy) return
    if (!email.trim() || password.length < 8) {
      setErr('Email and password (min 8 chars) required')
      return
    }
    setBusy(true); setErr('')
    try {
      await api('/auth/users', { body: { email: email.trim(), password, role } })
      setEmail(''); setPassword(''); setRole('reviewer')
      load()
    } catch (e) { setErr(msg(e)) } finally { setBusy(false) }
  }

  async function updateRole(id: number, next: User['role']) {
    setErr('')
    try {
      await api(`/auth/users/${id}`, { method: 'PATCH', body: { role: next } })
      load()
    } catch (e) { setErr(msg(e)) }
  }

  async function remove(id: number, who: string) {
    if (!confirm(`Delete ${who}? This cannot be undone.`)) return
    setErr('')
    try {
      await api(`/auth/users/${id}`, { method: 'DELETE' })
      load()
    } catch (e) { setErr(msg(e)) }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-ink">User Management</h1>
        <p className="text-sm text-muted mt-1">
          Create accounts and assign roles. Only admins can manage users.
        </p>
      </header>

      {err && (
        <div className="text-xs text-danger border border-danger/30 bg-danger/10 px-4 py-3 rounded-md">
          {err}
        </div>
      )}

      {/* Create user */}
      <section className="bg-surface border border-hairline rounded-lg p-5 space-y-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-ink">Create User</h2>
        <div className="grid md:grid-cols-3 gap-3">
          <input
            className={inputCls}
            placeholder="email@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            className={inputCls}
            type="password"
            placeholder="Password (min 8)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <select
            className={inputCls}
            value={role}
            onChange={(e) => setRole(e.target.value as User['role'])}
          >
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <Btn kind="primary" onClick={create} disabled={busy}>
          {busy ? 'Creating…' : 'Create User'}
        </Btn>
      </section>

      {/* Users list */}
      <section className="bg-surface border border-hairline rounded-lg overflow-hidden">
        {users.length === 0 && (
          <div className="p-8"><Empty>No users found.</Empty></div>
        )}
        {users.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-hairline text-left text-xs uppercase tracking-wider text-muted">
                <th className="py-3 px-5 font-semibold">Email</th>
                <th className="py-3 px-5 font-semibold">Team</th>
                <th className="py-3 px-5 font-semibold">Role</th>
                <th className="py-3 px-5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-surface-2 transition-colors">
                  <td className="py-3 px-5 text-ink">
                    {u.email}
                    {u.id === user.id && (
                      <Badge className="ml-2 bg-accent/10 text-accent border-accent/25">you</Badge>
                    )}
                  </td>
                  <td className="py-3 px-5 text-muted">{u.team}</td>
                  <td className="py-3 px-5">
                    <select
                      className={inputCls}
                      value={u.role}
                      disabled={u.id === user.id}
                      onChange={(e) => updateRole(u.id, e.target.value as User['role'])}
                    >
                      {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </td>
                  <td className="py-3 px-5 text-right">
                    {u.id !== user.id && (
                      <button
                        onClick={() => remove(u.id, u.email)}
                        className="p-1.5 rounded text-faint hover:text-danger hover:bg-danger/10 transition-colors cursor-pointer"
                        title="Delete user"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
