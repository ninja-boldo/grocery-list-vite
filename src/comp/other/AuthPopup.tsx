import { useState } from "react";

type AuthPopupProps = {
    onAuthenticated?: () => void;
}

const AuthPopup = ({ onAuthenticated }: AuthPopupProps) => {
    const [username, setUsername] = useState("")
    const [password, setPassword] = useState("")
    const [error, setError] = useState<string | null>(null)
    const [isSubmitting, setIsSubmitting] = useState(false)

    const sendAuthReq = async () => {
        if (!username || !password) {
            setError('Please enter username and password.')
            return
        }

        setError(null)
        setIsSubmitting(true)

        const body = new URLSearchParams({
            username,
            password,
        }).toString()

        try {
            const response = await fetch('/api/token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body,
            })

            const result = await response.json()
            if (!response.ok || !result?.access_token) {
                setError('Login failed. Please check your credentials.')
                return
            }

            localStorage.setItem('jwt_auth', `Bearer ${result.access_token}`)
            localStorage.setItem('username', username)
            onAuthenticated?.()
        } catch {
            setError('Login request failed. Please try again.')
        } finally {
            setIsSubmitting(false)
        }
    }

    return (
        <div
            style={{
                position: 'fixed',
                inset: 0,
                zIndex: 3000,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '1rem',
                background:
                    'radial-gradient(circle at 50% 20%, rgba(15, 23, 42, 0.4), rgba(2, 6, 23, 0.66))',
                backdropFilter: 'blur(10px) saturate(125%)',
                WebkitBackdropFilter: 'blur(10px) saturate(125%)',
            }}
        >
            <div
                style={{
                    width: 'min(440px, 100%)',
                    borderRadius: '16px',
                    border: '1px solid rgba(16, 185, 129, 0.4)',
                    background:
                        'linear-gradient(155deg, rgba(15, 23, 42, 0.93), rgba(30, 41, 59, 0.9))',
                    boxShadow:
                        '0 24px 70px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(148, 163, 184, 0.12)',
                    backdropFilter: 'blur(2px)',
                    padding: '1.5rem',
                    color: '#e2e8f0',
                    textAlign: 'left',
                }}
            >
                
                <h2 className="text-2xl font-semibold text-slate-100">Sign in again</h2>
                <p className="mt-1 text-sm text-slate-400">
                    Your token expired. Reauthenticate to continue.
                </p>

                <form
                    className="mt-5 flex flex-col gap-3"
                    onSubmit={(e) => {
                        e.preventDefault()
                        void sendAuthReq()
                    }}
                >
                    <label className="text-xs font-medium uppercase tracking-wide text-slate-400">
                        Username
                    </label>
                    <input
                        style={{
                            width: '100%',
                            borderRadius: '12px',
                            border: '1px solid rgba(71, 85, 105, 0.9)',
                            background: 'rgba(2, 6, 23, 0.6)',
                            color: '#f1f5f9',
                            padding: '0.65rem 0.75rem',
                            outline: 'none',
                        }}
                        placeholder="username..."
                        value={username}
                        onChange={(e) => setUsername(e.currentTarget.value)}
                    />

                    <label className="mt-1 text-xs font-medium uppercase tracking-wide text-slate-400">
                        Password
                    </label>
                    <input
                        style={{
                            width: '100%',
                            borderRadius: '12px',
                            border: '1px solid rgba(71, 85, 105, 0.9)',
                            background: 'rgba(2, 6, 23, 0.6)',
                            color: '#f1f5f9',
                            padding: '0.65rem 0.75rem',
                            outline: 'none',
                        }}
                        type="password"
                        placeholder="password..."
                        value={password}
                        onChange={(e) => setPassword(e.currentTarget.value)}
                    />

                    {error && (
                        <p className="rounded-lg border border-red-500/35 bg-red-950/30 px-3 py-2 text-sm text-red-200">
                            {error}
                        </p>
                    )}

                    <button
                        style={{
                            marginTop: '0.5rem',
                            width: '100%',
                            borderRadius: '12px',
                            border: 'none',
                            background: isSubmitting ? 'rgba(16, 185, 129, 0.65)' : '#10b981',
                            color: '#06281f',
                            padding: '0.7rem 0.75rem',
                            fontWeight: 700,
                            cursor: isSubmitting ? 'not-allowed' : 'pointer',
                            transition: 'all 150ms ease',
                            opacity: isSubmitting ? 0.5 : 1,
                        }}
                        disabled={isSubmitting}
                        type="submit"
                    >
                        {isSubmitting ? 'Submitting...' : 'Continue'}
                    </button>

                    <p
                        className="text-xs text-center"
                        style={{
                            marginTop: '0.15rem',
                            color: 'rgba(148, 163, 184, 0.75)',
                            letterSpacing: '0.01em',
                        }}
                    >
                        Demo access: <strong style={{ color: 'rgba(226, 232, 240, 0.85)' }}>demo</strong> / <strong style={{ color: 'rgba(226, 232, 240, 0.85)' }}>demo</strong>
                    </p>
                </form>
            </div>
        </div>
    )
}

export default AuthPopup;