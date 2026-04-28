# Auth

## JWT Authentication

Token-based auth using `python-jose`. Flow:

1. **Login** → `POST /token` with username/password
2. **Server** → `authenticate_user()` verifies credentials
3. **Server** → `create_access_token()` returns JWT
4. **Client** → stores token, sends in `Authorization: Bearer <token>` header

## Token Structure

```python
create_access_token(data={"sub": username}, expires_delta=...)
```

- `sub` claim = username
- Expiry via `ACCESS_TOKEN_EXPIRE_SECONDS` env (default 30 min)

## Password Hashing

`utils/password_helper.py`:

```python
get_password_hash(password)  # bcrypt
verify_password(plain, hashed)  # bcrypt compare
verify_token(auth_header)  # decode JWT, return username or None
```

## Middleware Auth Check

In `server.py` request middleware:

```python
if targeted_endpoint in auth_needed_endpoints:
    auth_token = request.headers.get("Authorization", "none")
    validUsername = verify_token(auth_token)
    if not validUsername:
        return 401
```

## Admin Endpoints

Check against `ADMIN_USERNAMES` env var (comma-separated). If endpoint in `admin_only_endpoints` and user not in admin list → 403.

## See Also

[[api-endpoints]] - Auth-required endpoints
[[server-infrastructure]] - Server structure
